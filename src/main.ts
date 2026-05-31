// Companion module entrypoint for the Waves LV1.
//
// Lifecycle:
//   init / configUpdated → maybe-discover → connect → register → bind actions / feedbacks
//   on /Notify/... from LV1 → update state map → checkFeedbacks()
//
// State is kept here (channel mute/gain, send on/off, mute-group state, etc.) so
// feedbacks can render without re-querying the LV1. The LV1 broadcasts every change
// from any other client too, so we stay in sync automatically.

import { InstanceBase, runEntrypoint, InstanceStatus, SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateActions } from './actions.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { UpgradeScripts } from './upgrades.js'
import { OscTcpClient } from './osc-tcp.js'
import { discover } from './zdns-discover.js'
import { ensureInitialScan, findInCache, refreshDiscovery } from './discovery-cache.js'
import { OscMessage, intArg, boolArg } from './osc.js'
import { UpdateVariables, pushTrack as pushTrackVariable } from './variables.js'
import { trackSlug } from './tracks.js'

interface ChannelState {
	muted: boolean
	gain: number // dB
	solo: boolean
	color: { r: number; g: number; b: number } | null
	name: string | null
	pan: number    // -1 (full L) … +1 (full R), 0 = center
	width: number  // 0 (mono) … 1 (full stereo)
}
interface SendState {
	on: boolean
	gain: number
}

export class LV1Instance extends InstanceBase<ModuleConfig> {
	public config!: ModuleConfig
	public osc: OscTcpClient | null = null

	/** key = `${group}.${ch}` */
	public channels = new Map<string, ChannelState>()
	/** key = `${inputGroup}.${inputCh}.${aux}` */
	public sends = new Map<string, SendState>()
	/** mute group state, key = 0..7 */
	public muteGroups = new Map<number, boolean>()
	/** /Notify/Meters dB values, key = `${group}.${ch}.${sub}` */
	public meters = new Map<string, number>()
	public lastTempoBpm: number | null = null
	public currentLayer: number | null = null
	/** Which mixer view is active in eMotion/MyFOH: 1 or 2.
	 *  Derived from /Notify/CurrentLayer args[0] + 1. The LV1 supports two
	 *  simultaneous mixer engines (typical: FOH + MON). */
	public currentMixer: number | null = null
	public currentScene: number | null = null
	public currentSceneName: string | null = null
	/** Scene catalogue from /Notify/SceneList. key = scene index (0-based). */
	public scenes = new Map<number, string>()

	/** Currently flipped-to-faders target. Derived from /Notify/InternalAssign with type=7
	 *  (= master fader strip assignment). null means default (LR) — no flip active. */
	public currentFlipTarget: { group: number; ch: number } | null = null

	/** User Assignable Keys (16 slots). Populated from /Notify/UserKeyInfo on connect.
	 *  key = 0..15. value = { name, func, assigned }.
	 *  Example: { name: "Mon 1", func: "Flip Sends: MX1: Mon 1", assigned: true }. */
	public userKeys = new Map<number, { name: string; func: string; assigned: boolean }>()

	/** Spill button state per bank/idx. Populated from /Notify/SpillButton.
	 *  key = `${bank}.${idx}`. Spill expands a group/DCA to show its members on
	 *  the surface faders (different feature from flip-to-sends). */
	public spillStates = new Map<string, boolean>()

	/** Mixer config discovered from the LV1 itself. Fully populated from /Notify/Layers
	 *  (factory) + /Aux/Tracks. No user config needed. */
	public detected: {
		channels?: number
		auxes?: number
		auxNames?: string[]
		/** Factory layers containing input channels (group=0). e.g. "CH 1-16".."CH 65-80". */
		inputLayers?: { name: string; entries: Array<{ group: number; ch: number } | null> }[]
		/** Factory layers containing mix buses (groups, monitors, masters, DCAs). */
		mixLayers?: { name: string; entries: Array<{ group: number; ch: number } | null> }[]
		/** User-defined custom layers (args[1]=1 in /Notify/Layers). NOT used for channel/aux
		 *  counting — these are just the surface layout the user configured in MyFOH ("Page-1"..). */
		customLayers?: { name: string; entries: Array<{ group: number; ch: number } | null> }[]
	} = {}

	/** Last successfully-resolved host/port. Used to re-discover if the LV1 changes port
	 *  (e.g. after the user changes the mixer config — the LV1 restarts on a new port). */
	private lastHost: string | null = null
	private consecutiveFailures = 0

	/** Active fade-fader timers, keyed by target id ("out_g.ch" or "send_g.ch.aux").
	 *  Triggering a new fade on the same target cancels the old one. */
	private activeFades = new Map<string, NodeJS.Timeout>()

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = config
		// One-time initial scan so the config dropdown isn't empty when first opened.
		// After this, the user triggers fresh scans via the "Scan for LV1s" action.
		ensureInitialScan()
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariables()
		await this.connectIfReady()
	}

	async destroy(): Promise<void> {
		for (const t of this.activeFades.values()) clearInterval(t)
		this.activeFades.clear()
		if (this.osc) {
			this.osc.disconnect()
			this.osc = null
		}
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		const restart =
			this.config.selected !== config.selected ||
			this.config.host !== config.host ||
			this.config.port !== config.port
		this.config = config

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariables()

		if (restart) {
			if (this.osc) {
				this.osc.disconnect()
				this.osc = null
			}
			await this.connectIfReady()
		}
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}
	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}
	updatePresets(): void {
		UpdatePresets(this)
	}
	updateVariables(): void {
		UpdateVariables(this)
	}

	// ─── Discovery + connect ─────────────────────────────────────────────

	private async connectIfReady(): Promise<void> {
		let host = ''
		let port = 0

		// Priority 1: user picked something from the "Discovered LV1" dropdown.
		if (this.config.selected) {
			const cached = findInCache(this.config.selected)
			if (cached) {
				host = cached.addresses[0] || cached.host || ''
				port = cached.port ?? 0
				this.log('info', `Using selected LV1 from discovery: ${cached.host} @ ${host}:${port}`)
			} else {
				// The cached entry isn't there anymore (LV1 went away, or background poll cleared it).
				// Fall through to a fresh discovery using the IP we remember from the encoded key.
				const [ip, portStr] = this.config.selected.split(':')
				if (ip) {
					host = ip
					port = parseInt(portStr, 10) || 0
					this.log('warn', `Selected LV1 ${ip} not in current discovery cache — trying anyway`)
				}
			}
		}

		// Priority 2: manual override fields. The host may force a different IP than the dropdown.
		if (this.config.host?.trim()) host = this.config.host.trim()
		if (this.config.port > 0) port = this.config.port

		// Priority 3: if we still have no host or no port, try a one-shot discovery.
		if (!host || !port) {
			this.updateStatus(InstanceStatus.Connecting, 'Discovering LV1…')
			this.log('info', `Running zDNS discovery (host filter: ${host || 'none'})`)
			const entries = await discover({
				timeoutMs: 6000,
				filterHostIp: host || undefined,
			})
			if (!entries.length) {
				this.updateStatus(
					InstanceStatus.BadConfig,
					host
						? `No LV1 matching ${host} found in 6 s. Check the IP or pick from the dropdown.`
						: 'No LV1 found on the LAN in 6 s. Pick one from the dropdown or enter an IP manually.',
				)
				return
			}
			const chosen = entries[0]
			host = chosen.addresses[0] || chosen.host || ''
			port = chosen.port ?? 0
			this.log('info', `Discovered ${chosen.host} at ${host}:${port}`)
		}

		if (!host || !port) {
			this.updateStatus(InstanceStatus.BadConfig, 'No host or port available after discovery')
			return
		}

		this.updateStatus(InstanceStatus.Connecting, `Connecting to ${host}:${port}`)
		this.lastHost = host
		this.osc = new OscTcpClient({
			host,
			port,
			deviceName: 'Companion',
			handshakeStyle: 'myfoh',
			autoReconnect: true,
		})
		this.bindOscEvents(this.osc)
		this.osc.connect()
	}

	/** Called from the 'close' handler after enough failed reconnects to suspect the LV1
	 *  changed port (mixer config change, restart, etc.). Looks up the new port via zDNS
	 *  and points the OSC client at it. */
	private async rediscoverPort(): Promise<void> {
		if (!this.lastHost || !this.osc) return
		this.log('info', `Reconnect failing — running a fresh zDNS scan to find ${this.lastHost}'s new port…`)
		const results = await refreshDiscovery(5000)
		const match = results.find((e) => e.addresses.includes(this.lastHost!))
		if (!match || match.port == null) {
			this.log('warn', `No zDNS match for ${this.lastHost} — will keep retrying current port`)
			return
		}
		this.log('info', `Rediscovered ${this.lastHost} on port ${match.port} — reconnecting`)
		this.osc.updateTarget(this.lastHost, match.port)
	}

	private bindOscEvents(osc: OscTcpClient): void {
		osc.on('connect', ({ host, port }: { host: string; port: number }) => {
			this.log('info', `TCP connected to ${host}:${port}, running handshake…`)
			this.consecutiveFailures = 0
		})
		osc.on('registered', ({ style }: { style: string }) => {
			this.log('info', `Registered with the LV1 as ${style}`)
			this.updateStatus(InstanceStatus.Ok)
			// Re-request state on every connect. The LV1 doesn't spontaneously re-broadcast
			// after a handshake the second time, so this keeps the dropdowns populated
			// across module restarts.
			this.requestStateRefresh()
		})
		osc.on('close', () => {
			this.updateStatus(InstanceStatus.Disconnected)
			this.consecutiveFailures++
			this.log('warn', `Connection closed (attempt ${this.consecutiveFailures}), will auto-reconnect`)
			// Clear the detected mixer config — when the LV1 reconnects (possibly with a
			// different mixer config like 16ch → 80ch), the new /Aux/Tracks will repopulate it.
			this.detected = {}
			// After 2 failed reconnect attempts, suspect the LV1 changed port (typical when the
			// user switches mixer config — the LV1 restarts and gets a fresh port). Re-discover.
			if (this.consecutiveFailures >= 2) {
				void this.rediscoverPort()
			}
		})
		osc.on('error', (err: Error) => {
			this.log('error', `OSC error: ${err.message}`)
		})
		osc.on('packet', ({ decoded }: { decoded: OscMessage }) => {
			this.handleNotify(decoded)
		})
	}

	// ─── /Notify/... state handling ───────────────────────────────────────

	private handleNotify(m: OscMessage): void {
		const addr = m.address
		switch (addr) {
			case '/Notify/Track/Out/Mute': {
				// VERIFIED LIVE (mute on LV1 surface, captured 2026-05-30):
				//   ,iiiT [g, ch, isMuted(0|1), validFlag(ALWAYS TRUE)]
				// The earlier "sub=0, isMuted" interpretation was wrong — the third int IS
				// the mute state, and the trailing T constant is just a validity flag.
				// LV1 sends each event twice (~3 ms apart); idempotent so we just run twice.
				const g = intArg(m, 0)
				const ch = intArg(m, 1)
				const state = intArg(m, 2)
				if (g == null || ch == null || state == null) return
				const mute = state !== 0
				const s = this.ensureChannel(g, ch)
				s.muted = mute
				this.checkFeedbacks('channelMute')
				pushTrackVariable(this, g, ch, 'mute')
				break
			}
			case '/Notify/Track/Pan': {
				// ,iid [g, ch, value(-1..+1)]
				const g = intArg(m, 0), ch = intArg(m, 1)
				const dArg = m.args[2]
				const v = dArg?.type === 'd' || dArg?.type === 'f' ? (dArg.value as number) : null
				if (g == null || ch == null || v == null) return
				this.ensureChannel(g, ch).pan = v
				pushTrackVariable(this, g, ch, 'pan')
				break
			}
			case '/Notify/Track/Pan/Width':
			case '/Notify/PanArcWidth': {
				// Both observed in catalog; pick first numeric arg after g, ch.
				const g = intArg(m, 0), ch = intArg(m, 1)
				const dArg = m.args[2]
				const v = dArg?.type === 'd' || dArg?.type === 'f' ? (dArg.value as number) : null
				if (g == null || ch == null || v == null) return
				this.ensureChannel(g, ch).width = v
				pushTrackVariable(this, g, ch, 'width')
				break
			}
			case '/Notify/Track/Out/Gain': {
				const g = intArg(m, 0),
					ch = intArg(m, 1)
				// Gain can arrive as int (legacy) or float — accept both.
				const dbArg = m.args[2]
				const db = dbArg?.type === 'f' || dbArg?.type === 'd' || dbArg?.type === 'i'
					? (dbArg.value as number) : null
				if (g == null || ch == null || db == null) return
				this.ensureChannel(g, ch).gain = db
				this.checkFeedbacks('channelGain')
				pushTrackVariable(this, g, ch, 'gain')
				break
			}
			case '/Notify/Solo': {
				const g = intArg(m, 0),
					ch = intArg(m, 1),
					state = intArg(m, 2)
				if (g == null || ch == null || state == null) return
				this.ensureChannel(g, ch).solo = state !== 0
				this.checkFeedbacks('channelSolo', 'anySolo')
				pushTrackVariable(this, g, ch, 'solo')
				break
			}
			case '/Notify/UserKeyInfo': {
				// ,issi [keyIdx, shortName, function, assigned(0|1)]
				// Verified live: /Notify/UserKeyInfo i:0 "Mon 1" "Flip Sends: MX1: Mon 1" i:1
				// Sent for each of the 16 user keys during the initial state flood.
				const k = intArg(m, 0)
				const name = m.args[1]?.type === 's' ? (m.args[1].value as string) : null
				const func = m.args[2]?.type === 's' ? (m.args[2].value as string) : null
				const assigned = intArg(m, 3)
				if (k == null || name == null || func == null || assigned == null) return
				if (k < 0 || k > 31) return
				const prev = this.userKeys.get(k)
				const changed = !prev || prev.func !== func || prev.assigned !== (assigned !== 0)
				this.userKeys.set(k, { name, func, assigned: assigned !== 0 })
				const k1 = k + 1
				this.setVariableValues({
					[`userkey_${k1}_name`]:     name,
					[`userkey_${k1}_function`]: func,
					[`userkey_${k1}_assigned`]: assigned !== 0 ? 'on' : 'off',
				})
				// If a "Flip Sends" key was added/removed/changed, regenerate actions
				// (so the dropdown updates) and presets (so the per-key button appears).
				if (changed && func.startsWith('Flip Sends')) {
					this.updateActions()
					this.updatePresets()
				}
				break
			}
			case '/Notify/SpillButton': {
				// ,iii [bank, idx, state]. Spill expands a group/DCA to show its
				// members on the surface faders (different feature from flip-to-sends).
				const bank = intArg(m, 0)
				const idx = intArg(m, 1)
				const state = intArg(m, 2)
				if (bank == null || idx == null || state == null) return
				this.spillStates.set(`${bank}.${idx}`, state !== 0)
				this.checkFeedbacks('spillActive')
				break
			}
			case '/Notify/InternalAssign': {
				// VERIFIED LIVE (FlipOnLV1.pcapng + live test 2026-05-31):
				//   ,iiiiii [group, ch, type, sub, state, validFlag]
				// When type == 7, this is the "master fader strip assignment" — i.e. which bus
				// the surface master strip is currently controlling. That's the FLIP-TO-FADERS
				// indicator: when state=1 on an aux (group=2) it means the surface is flipped
				// to show that aux's sends. When state=1 on LR (group=3 ch=0) it means default
				// (no flip). The LV1 sends the un-assignment (old, state=0) AND the new
				// assignment (new, state=1) in pairs, so we keep our model as "the LAST entry
				// with state=1 for type=7" = current flip target.
				const g = intArg(m, 0)
				const ch = intArg(m, 1)
				const type = intArg(m, 2)
				const state = intArg(m, 4)
				if (g == null || ch == null || type == null || state == null) return
				if (type !== 7) break  // not the master strip assignment
				const isLR = g === 3 && ch === 0
				if (state === 1) {
					// New assignment. LR=default (no flip); anything else = flip active.
					this.currentFlipTarget = isLR ? null : { group: g, ch }
					this.log('info', `Flip target → ${isLR ? 'LR (default)' : `g${g}.${ch}`}`)
					this.checkFeedbacks('flipActive', 'flipForTarget')
					this.pushFlipVariables()
				} else if (state === 0 && this.currentFlipTarget?.group === g && this.currentFlipTarget?.ch === ch) {
					// Explicit un-assignment of the CURRENT target with no following state=1 (rare).
					this.currentFlipTarget = null
					this.checkFeedbacks('flipActive', 'flipForTarget')
					this.pushFlipVariables()
				}
				break
			}
			case '/Notify/MuteGroup': {
				const grp = intArg(m, 0),
					state = boolArg(m, 1)
				if (grp == null || state == null) return
				this.muteGroups.set(grp, state)
				this.checkFeedbacks('muteGroup')
				this.setVariableValues({ [`mg_${grp + 1}`]: state ? 'on' : 'off' })
				break
			}
			case '/Notify/Aux/Send/On': {
				const g = intArg(m, 0),
					ch = intArg(m, 1),
					aux = intArg(m, 2),
					on = boolArg(m, 3)
				if (g == null || ch == null || aux == null || on == null) return
				const key = `${g}.${ch}.${aux}`
				const s = this.sends.get(key) ?? { on: false, gain: -144 }
				s.on = on
				this.sends.set(key, s)
				this.checkFeedbacks('sendOn')
				break
			}
			case '/Notify/Aux/Send/Gain': {
				const g = intArg(m, 0),
					ch = intArg(m, 1),
					aux = intArg(m, 2),
					db = intArg(m, 3)
				if (g == null || ch == null || aux == null || db == null) return
				const key = `${g}.${ch}.${aux}`
				const s = this.sends.get(key) ?? { on: false, gain: -144 }
				s.gain = db
				this.sends.set(key, s)
				this.checkFeedbacks('sendGain')
				break
			}
			case '/Notify/TrackColor': {
				const g = intArg(m, 0),
					ch = intArg(m, 1)
				const r = m.args[3]?.type === 'f' ? (m.args[3].value as number) : null
				const gC = m.args[4]?.type === 'f' ? (m.args[4].value as number) : null
				const b = m.args[5]?.type === 'f' ? (m.args[5].value as number) : null
				if (g == null || ch == null || r == null || gC == null || b == null) return
				this.ensureChannel(g, ch).color = { r, g: gC, b }
				this.checkFeedbacks('channelColor')
				pushTrackVariable(this, g, ch, 'color')
				break
			}
			case '/Notify/Track/Name':
			case '/Notify/TrackName': {
				const g = intArg(m, 0),
					ch = intArg(m, 1)
				const name = m.args[2]?.type === 's' ? (m.args[2].value as string) : null
				if (g == null || ch == null || name == null) return
				this.ensureChannel(g, ch).name = name
				this.checkFeedbacks('channelName')
				pushTrackVariable(this, g, ch, 'name')
				break
			}
			case '/Channels': {
				// VERIFIED LIVE (NameChange.pcapng, 2026-05-30):
				//   Server pushes this ~6× right after every handshake with the FULL track topology.
				//   Signature: ,i s iidd iiiiiiiiiiii hd × N
				//     args[0] = track count (e.g. 126 for 80ch/32aux mode)
				//     args[1..]: per track 19 args: name(s), group(i), ch(i), 2×d, 12×i, h, d
				//   We only need name + group + ch for the picker labels & variables.
				//   See lv1_channels_endpoint.md memory for full schema.
				const args = m.args
				const count = args[0]?.type === 'i' ? (args[0].value as number) : 0
				if (count <= 0 || count > 256) break
				let updated = 0
				for (let i = 0; i < count; i++) {
					const base = 1 + i * 19
					if (base + 2 >= args.length) break
					const nameArg = args[base]
					const groupArg = args[base + 1]
					const chArg = args[base + 2]
					if (nameArg?.type !== 's' || groupArg?.type !== 'i' || chArg?.type !== 'i') continue
					const name = nameArg.value as string
					const group = groupArg.value as number
					const ch = chArg.value as number
					const s = this.ensureChannel(group, ch)
					if (s.name !== name) {
						s.name = name
						updated++
					}
				}
				if (updated > 0) {
					this.log('info', `/Channels arrived (${count} tracks, ${updated} name updates)`)
					this.updateActions()
					this.updateFeedbacks()
					this.updateVariables()
				}
				break
			}
			case '/Notify/Tempo': {
				const bpm = m.args[0]?.type === 'f' ? (m.args[0].value as number) : null
				if (bpm != null) {
					this.lastTempoBpm = bpm
					this.checkFeedbacks('tempo')
					this.setVariableValues({ tempo: bpm.toFixed(1) })
				}
				break
			}
			case '/Notify/CurrentLayer': {
				// ,ii [mixerPage, layerIndex]
				//   mixerPage = 0 → Mixer 1 view, 1 → Mixer 2 view
				//   layerIndex = 0..7 → which surface layer in that mixer
				// See lv1_flip_and_mixer.md for full notes.
				const mixerPage = intArg(m, 0)
				const layer = intArg(m, 1)
				if (mixerPage != null) {
					this.currentMixer = mixerPage + 1   // 1-based for display
				}
				if (layer != null) {
					this.currentLayer = layer
					this.checkFeedbacks('currentLayer')
				}
				this.setVariableValues({
					current_mixer:       this.currentMixer ?? '',
					current_layer_index: this.currentLayer != null ? this.currentLayer + 1 : '',
				})
				break
			}
			case '/Notify/CurSceneIndex': {
				const idx = intArg(m, 0)
				if (idx != null) {
					this.currentScene = idx
					this.currentSceneName = this.scenes.get(idx) ?? null
					this.checkFeedbacks('currentScene')
					this.setVariableValues({
						scene_index: idx,
						scene_name: this.currentSceneName ?? '',
					})
				}
				break
			}
			case '/Notify/Scene/Name': {
				// ,s "Scene Name" — broadcast for the CURRENT scene only (e.g. on a rename or recall).
				const name = m.args[0]?.type === 's' ? (m.args[0].value as string) : null
				if (name == null) break
				this.currentSceneName = name
				// Also update the catalog entry if we know the current index
				if (this.currentScene != null) this.scenes.set(this.currentScene, name)
				this.checkFeedbacks('currentScene')
				this.setVariableValues({ scene_name: name })
				// Update dropdowns/variables so the new name shows up in pickers
				this.updateActions()
				this.updateVariables()
				break
			}
			case '/Notify/SceneList': {
				// ,i (i s)*N — first int = count, then (idx, name) pairs.
				// Captured live: /Notify/SceneList i:2 i:0 "Scene Teste A" i:1 "Scene Teste B"
				const count = intArg(m, 0)
				if (count == null || count < 0 || count > 999) break
				const fresh = new Map<number, string>()
				for (let i = 0; i + 1 < count * 2 && 1 + i + 1 < m.args.length; i += 2) {
					const idxArg = m.args[1 + i]
					const nameArg = m.args[1 + i + 1]
					if (idxArg?.type !== 'i' || nameArg?.type !== 's') continue
					fresh.set(idxArg.value as number, nameArg.value as string)
				}
				this.scenes = fresh
				// Refresh current scene name if we have an index
				if (this.currentScene != null) {
					this.currentSceneName = this.scenes.get(this.currentScene) ?? null
				}
				this.log('info', `Scene list updated: ${this.scenes.size} scene(s)`)
				this.updateActions()
				this.updateVariables()
				break
			}
			case '/Notify/Meters': {
				// args[0] = count, then (g, ch, sub, dB-float) per meter.
				// Batch the VU variable updates into one setVariableValues call (way faster
				// than 121 individual sets per frame).
				const args = m.args
				const vuValues: Record<string, string> = {}
				for (let i = 1; i + 3 < args.length; i += 4) {
					const g = args[i].type === 'i' ? (args[i].value as number) : null
					const ch = args[i + 1].type === 'i' ? (args[i + 1].value as number) : null
					const sub = args[i + 2].type === 'i' ? (args[i + 2].value as number) : null
					const db = args[i + 3].type === 'f' ? (args[i + 3].value as number) : null
					if (g == null || ch == null || sub == null || db == null) continue
					this.meters.set(`${g}.${ch}.${sub}`, db)
					// Only expose sub=0 (mono / left) and sub=1 (right of stereo) as variables.
					if (sub === 0 || sub === 1) {
						const slug = trackSlug(g, ch)
						const suffix = sub === 0 ? '_vu' : '_vu_r'
						vuValues[`${slug}${suffix}`] = db.toFixed(1)
					}
				}
				if (Object.keys(vuValues).length > 0) this.setVariableValues(vuValues)
				this.checkFeedbacks('meter')
				break
			}
			case '/Aux/Tracks': {
				// Reply to /Get/Aux/Tracks: first int is the aux count, then per aux: (idx, group, name).
				// Captured live — always arrives during handshake.
				const count = intArg(m, 0)
				if (count == null) break
				const names: string[] = []
				for (let i = 1; i + 2 < m.args.length; i += 3) {
					const nameArg = m.args[i + 2]
					if (nameArg?.type === 's') names.push(nameArg.value as string)
				}
				const changed = this.detected.auxes !== count
				this.detected.auxes = count
				this.detected.auxNames = names
				if (changed) {
					this.log('info', `LV1 reports ${count} aux buses (${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''})`)
					this.updateActions()
					this.updateFeedbacks()
					this.updatePresets()
					this.updateVariables()
				}
				break
			}
			case '/Notify/NumberOfChannels': {
				// Signature unverified — best-effort: assume first int = channel count.
				const n = intArg(m, 0)
				if (n != null && n > 0 && n <= 256 && this.detected.channels !== n) {
					this.detected.channels = n
					this.log('info', `LV1 reports ${n} input channels (from /Notify/NumberOfChannels)`)
					this.updateActions()
					this.updateFeedbacks()
					this.updatePresets()
				}
				break
			}
			case '/Notify/Layers': {
				// Verified live (MixerModesChange.pcapng, 80ChMode.pcapng, CustomLayer3.pcapng):
				//   args[0] = surface page selector (0 or 1). Each distinct layout is broadcast
				//             under BOTH 0 and 1 — the indicator does NOT reliably mean
				//             "INPUT vs MIX". We can't dispatch on it.
				//   args[1] = 0 → factory layers (CH 1-16, GROUPS, MON…)
				//             1 → user-defined custom layers ("Page-1".."Page-8" from MyFOH)
				//   args[2] = layerCount (typically 8 — the LV1 surface has 8 layer buttons)
				//   then per layer: string name, int entryCount, (int group, int ch) * entryCount
				// Empty slots are (group=-1, ch=-1).
				//
				// IMPORTANT: when custom layers are configured, the LV1 sends the CUSTOM packet
				// IN PLACE OF the MIX factory packet — the MIX factory (GROUPS/MON/…) never
				// arrives. So we MUST ignore custom layers for channel/aux counting, and rely on
				// /Aux/Tracks for the aux count in that case.
				//
				// In SMALL mixer modes (16/32/64ch) everything fits in 8 layers and the LV1
				// sends ONE distinct factory layout per page indicator (2 packets, identical
				// content). In LARGE mode (80ch) the surface splits — TWO distinct factory
				// layouts: INPUT (CH 1-16..CH 65-80) and MIX (GROUPS/FX/MON/MASTERS/DCA).
				const args = m.args
				if (args.length < 3) break
				const page = intArg(m, 0)
				const isCustom = intArg(m, 1) === 1
				const layerCount = intArg(m, 2)
				if (layerCount == null || layerCount <= 0 || layerCount > 32) break
				const layers: { name: string; entries: Array<{ group: number; ch: number } | null> }[] = []
				let idx = 3
				for (let L = 0; L < layerCount && idx < args.length; L++) {
					const nameArg = args[idx++]
					const countArg = args[idx++]
					if (!nameArg || nameArg.type !== 's' || !countArg || countArg.type !== 'i') break
					const name = nameArg.value as string
					const entryCount = countArg.value as number
					const entries: Array<{ group: number; ch: number } | null> = []
					for (let e = 0; e < entryCount && idx + 1 < args.length; e++) {
						const g = args[idx++]?.value as number
						const ch = args[idx++]?.value as number
						entries.push(g === -1 && ch === -1 ? null : { group: g, ch })
					}
					layers.push({ name, entries })
				}
				void page // page indicator unused — see comment above

				// Custom layers are user-defined surface layout, NOT mixer topology. Store
				// them for reference but skip the channel/aux count recomputation — the
				// factory packets (which always arrive) carry the authoritative topology.
				if (isCustom) {
					this.detected.customLayers = layers
					const summary = layers
						.filter((L) => L.entries.some((e) => e))
						.map((L) => `"${L.name}"=${L.entries.filter((e) => e).length}`)
						.join(' ')
					this.log('info', `Custom layers received: ${summary || '(all empty)'}`)
					this.updateActions()
					this.updateFeedbacks()
					this.updatePresets()
					break
				}

				// Factory packet — categorise by content. Inputs (group=0) → inputLayers;
				// anything else (groups, auxes, etc.) → mixLayers. In small mixer modes one
				// packet carries both kinds, so we update both.
				let hasInputs = false
				let hasMix = false
				for (const L of layers) {
					for (const e of L.entries) {
						if (!e) continue
						if (e.group === 0) hasInputs = true
						else if (e.group !== -1) hasMix = true
					}
				}
				if (hasInputs) this.detected.inputLayers = layers
				if (hasMix) this.detected.mixLayers = layers

				// Recompute totals from the cached factory layouts only.
				const inputChannels = new Set<number>()
				const auxChannels = new Set<number>()
				for (const L of [...(this.detected.inputLayers ?? []), ...(this.detected.mixLayers ?? [])]) {
					for (const e of L.entries) {
						if (!e) continue
						if (e.group === 0) inputChannels.add(e.ch)
						if (e.group === 2) auxChannels.add(e.ch)
					}
				}
				this.detected.channels = inputChannels.size
				// Only override the /Aux/Tracks count if we actually saw aux entries in the
				// MIX factory layout. In custom-layer mode the MIX factory never arrives, so
				// auxChannels stays empty and /Aux/Tracks remains the source of truth.
				if (auxChannels.size > 0) this.detected.auxes = auxChannels.size

				const kind = hasInputs && hasMix ? 'INPUT+MIX' : hasInputs ? 'INPUT' : hasMix ? 'MIX' : 'empty'
				const summary = layers
					.filter((L) => L.entries.some((e) => e))
					.map((L) => `"${L.name}"=${L.entries.filter((e) => e).length}`)
					.join(' ')
				this.log(
					'info',
					`Layers updated (${kind}): ${summary}  →  total ${this.detected.channels} channels, ${this.detected.auxes ?? '?'} auxes`,
				)
				this.updateActions()
				this.updateFeedbacks()
				this.updatePresets()
				this.updateVariables()
				break
			}
			case '/Notify/MixerConfig': {
				// Signature unverified — log raw for analysis. Once we know the structure
				// (probably [channels, groups, auxes, matrix, ...]) we can parse properly.
				const summary = m.args
					.slice(0, 8)
					.map((a) => (a.type === 'i' || a.type === 'f' ? a.value : a.type === 's' ? `"${a.value}"` : `<${a.type}>`))
					.join(' ')
				this.log('info', `/Notify/MixerConfig ${summary}${m.args.length > 8 ? ' …' : ''}`)
				break
			}
			default:
				// Many /Notify/... addresses are unhandled by design — log only when debug-noisy is on.
				break
		}
	}

	/** Effective number of channels to expose in dropdowns. Comes from the LV1's INPUT
	 *  /Notify/Layers (factory). Falls back to 80 (the largest mixer mode) while not yet
	 *  detected so the dropdowns aren't empty before the first connect completes. */
	public effectiveChannels(): number {
		return this.detected.channels ?? 80
	}
	/** Aux count from the LV1's MIX /Notify/Layers (factory), falling back to 32 (largest mode). */
	public effectiveAuxes(): number {
		return this.detected.auxes ?? 32
	}

	private ensureChannel(group: number, ch: number): ChannelState {
		const key = `${group}.${ch}`
		let s = this.channels.get(key)
		if (!s) {
			s = { muted: false, gain: 0, solo: false, color: null, name: null, pan: 0, width: 1 }
			this.channels.set(key, s)
		}
		return s
	}

	/** Optimistic update used by actions BEFORE the /Notify echoes back. Keeps the
	 *  toggle-from-current-state logic correct on rapid presses and lets feedbacks
	 *  flip immediately without waiting for the round-trip. */
	applyChannelDelta(group: number, ch: number, delta: Partial<ChannelState>): void {
		const s = this.ensureChannel(group, ch)
		Object.assign(s, delta)
		if (delta.muted != null) {
			this.checkFeedbacks('channelMute')
			pushTrackVariable(this, group, ch, 'mute')
		}
		if (delta.solo != null) {
			this.checkFeedbacks('channelSolo', 'anySolo')
			pushTrackVariable(this, group, ch, 'solo')
		}
		if (delta.gain != null)  pushTrackVariable(this, group, ch, 'gain')
		if (delta.pan != null)   pushTrackVariable(this, group, ch, 'pan')
		if (delta.width != null) pushTrackVariable(this, group, ch, 'width')
		if (delta.name != null)  pushTrackVariable(this, group, ch, 'name')
	}

	applySendDelta(group: number, ch: number, aux: number, delta: Partial<SendState>): void {
		const key = `${group}.${ch}.${aux}`
		const s = this.sends.get(key) ?? { on: false, gain: -144 }
		Object.assign(s, delta)
		this.sends.set(key, s)
		if (delta.on != null) this.checkFeedbacks('sendOn')
	}

	pushFlipVariables(): void {
		const t = this.currentFlipTarget
		const active = t != null
		let name = 'LR'
		let aux1based = 0
		if (t) {
			if (t.group === 2) {
				name = this.detected.auxNames?.[t.ch] ?? `Aux ${t.ch + 1}`
				aux1based = t.ch + 1
			} else {
				name = this.channels.get(`${t.group}.${t.ch}`)?.name ?? `g${t.group}.${t.ch}`
			}
		}
		this.setVariableValues({
			flip_active: active ? 'on' : 'off',
			flip_group:  t ? t.group : 3,
			flip_ch:     t ? t.ch : 0,
			flip_name:   name,
			flip_aux:    aux1based,
		})
	}

	/** Optimistic local clear of every channel's solo flag, paired with the
	 *  /ClearAllSolo command. Refreshes feedbacks + variables. */
	applyClearAllSolo(): void {
		for (const [key, s] of this.channels) {
			if (s.solo) {
				s.solo = false
				const [g, ch] = key.split('.').map(Number)
				pushTrackVariable(this, g, ch, 'solo')
			}
		}
		this.checkFeedbacks('channelSolo', 'anySolo')
	}

	applyMuteGroup(grp: number, state: boolean): void {
		this.muteGroups.set(grp, state)
		this.checkFeedbacks('muteGroup')
		this.setVariableValues({ [`mg_${grp + 1}`]: state ? 'on' : 'off' })
	}

	/** Re-request state from the LV1. Used on (re)connect to repopulate aux names
	 *  and layer/mixer info — the LV1 doesn't echo `/Set/...` calls back to the
	 *  client that sent them and won't spontaneously re-flood after the first
	 *  handshake, so we have to nudge it.
	 *
	 *  NOTE: /Set/TrackName is NOT broadcast in the initial state flood — channel
	 *  names only arrive via /Notify/Track/Name when someone renames a channel.
	 *  There's no /Get equivalent in the LV1 protocol, so input channel names
	 *  configured before the module started will NOT be recoverable.
	 */
	/** Smoothly ramp a fader from its current value to `targetDb` over `durationMs`.
	 *  Linear interpolation in dB (perceptually log already). Cancels any previous fade
	 *  on the same `key`. Calls `apply(db)` every ~30 ms with the intermediate value —
	 *  `apply` is responsible for sending the OSC message and updating local state. */
	startFade(key: string, currentDb: number, targetDb: number, durationMs: number, apply: (db: number) => void): void {
		this.cancelFade(key)
		if (durationMs <= 0 || currentDb === targetDb) {
			apply(targetDb)
			return
		}
		const stepMs = 30
		const start = Date.now()
		const delta = targetDb - currentDb
		const tick = (): void => {
			const elapsed = Date.now() - start
			const t = Math.min(1, elapsed / durationMs)
			apply(currentDb + delta * t)
			if (t >= 1) this.cancelFade(key)
		}
		const timer = setInterval(tick, stepMs)
		this.activeFades.set(key, timer)
	}

	cancelFade(key: string): void {
		const t = this.activeFades.get(key)
		if (t) {
			clearInterval(t)
			this.activeFades.delete(key)
		}
	}

	requestStateRefresh(): void {
		if (!this.osc?.isConnected()) {
			this.log('warn', 'requestStateRefresh: not connected')
			return
		}
		this.log('info', 'Refreshing state: /Get/Aux/Tracks + /Get/Layers')
		this.osc.send('/Get/Aux/Tracks', [])
		// /Get/Layers ,ii [0, 0] — verified live: server replies with a fresh
		// /Notify/Layers (factory INPUT layout + /Notify/CurrentLayer).
		this.osc.send('/Get/Layers', [
			{ type: 'i', value: 0 },
			{ type: 'i', value: 0 },
		])
	}

	// Public helper used by actions.ts.
	send(address: string, args: import('./osc.js').OscArg[]): void {
		if (!this.osc || !this.osc.isConnected()) {
			this.log('warn', `send(${address}) dropped — not connected`)
			return
		}
		this.osc.send(address, args)
	}
}

runEntrypoint(LV1Instance, UpgradeScripts)
