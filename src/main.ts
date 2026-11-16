// Companion module entrypoint for the Waves LV1.
//
// Lifecycle:
//   init / configUpdated → maybe-discover → connect → register → bind actions / feedbacks
//   on /Notify/... from LV1 → update state map → checkFeedbacks()
//
// State is kept here (channel mute/gain, send on/off, mute-group state, etc.) so
// feedbacks can render without re-querying the LV1. The LV1 broadcasts every change
// from any other client too, so we stay in sync automatically.

import {
	InstanceBase,
	runEntrypoint,
	InstanceStatus,
	SomeCompanionConfigField,
	type CompanionHTTPRequest,
	type CompanionHTTPResponse,
} from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateActions } from './actions.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { UpgradeScripts } from './upgrades.js'
import { OscTcpClient } from './osc-tcp.js'
import { discover, multicastInterfaces, type DiscoverHandle } from './zdns-discover.js'
import { cancelDiscovery, ensureInitialScan, findInCache, refreshDiscovery } from './discovery-cache.js'
import { OscMessage, intArg, boolArg } from './osc.js'
import { UpdateVariables, pushTrack as pushTrackVariable } from './variables.js'
import { channelFeedbacksForDelta } from './channel-feedbacks.js'
import { trackSlug } from './tracks.js'
import { AuxMap, parseAuxTracks } from './aux-map.js'
import { MASK_GROUPS, decodeRouteMask, isTalkBackDest, routeKey } from './routing.js'
import { parseIOConnections, rowLabel, rowTrack } from './io-connections.js'
import { SurfaceClient, controlKey, type ControlAddress, type ControlUpdate } from './surface-client.js'
import { SURFACE_DEFAULT_PORT, SURFACE_DRIVER_VERSION, compareVersions, surfaceInstallPage } from './surface.js'
import {
	SurfaceModel,
	MUTE_ALL,
	MUTE_GROUPS,
	RACK_SLOTS,
	RACK_TYPES,
	STRIP_TYPES,
	SURFACE_TRACK_TYPES,
	displayNumber,
	muteGroupAddress,
	strip,
	type PluginParam,
} from './surface-model.js'
import type { FadeCurve } from './surface-ui.js'
import { surfaceVariableValues } from './surface-presets.js'
import type { ControlProps, EmotionSignal, InterMapMessage, RealUpdate } from './surface-client.js'

interface ChannelState {
	muted: boolean
	/** Channel fader ("channel volume"), dB. `null` = the console has not told us
	 *  yet, which is NOT the same as 0 dB. Defaulting this to a number is what
	 *  made every `*_gain` variable report a confident "0.0", and what made
	 *  "Fade to target dB" ramp from unity on a fader that was really at −∞. */
	gain: number | null
	solo: boolean
	color: { r: number; g: number; b: number } | null
	name: string | null
	pan: number // -1 (full L) … +1 (full R), 0 = center
	width: number // 0 (mono) … 1 (full stereo)
	/** Stereo balance, -1 … +1. Only meaningful on stereo strips. null until the desk reports it. */
	balance: number | null
	/** Stereo strip (from /Channels record field 16: 1 = mono, 2 = stereo). null = unknown
	 *  (not reported yet, or a v16 desk, where the field is not read). */
	stereo: boolean | null
	/** Preamp / input gain, dB. From /Notify/TrackInGain, sub-index 0. null until published. */
	inGain: number | null
	/** Digital trim, dB. From /Notify/TrackTrim, sub-index 0. null until published. */
	trim: number | null
	/** Polarity (phase) invert. From /Notify/PhaseState arg[3], sub-index 0.
	 *  `null` until the console publishes it. */
	polarity: boolean | null
	/** +48 V phantom power. From /Notify/PhantomState arg[3], sub-index 0.
	 *
	 *  ⛔ `null` IS LOAD-BEARING HERE, NOT TIDINESS. MEASURED: the console does
	 *  NOT send /Notify/PhantomState in the post-handshake flood — it appears only
	 *  when phantom actually changes. So on a fresh connect we genuinely do not
	 *  know. Defaulting to `false` would paint "+48 V off" on a button for a
	 *  channel that is live at 48 V, and that is the wrong direction to be wrong
	 *  in: someone unplugs a ribbon mic trusting it. Unknown must render blank,
	 *  never as "off". */
	phantom: boolean | null
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

	/** Talk Back destination enable state per aux sub-index. Populated from
	 *  /Notify/InternalAssign with type=2 (the LV1's authoritative signal for
	 *  TB destination buttons in the TALK BACK panel). key = aux sub idx (0-based). */
	public tbDestEnabled = new Map<number, boolean>()

	/** eMotion LV1 major version (from /Notify/ServiceVersion or /version). null = unknown. */
	public consoleMajor: number | null = null
	/** Full version label, e.g. "v.17.6.26.456". null = unknown. */
	public consoleVersion: string | null = null

	/** v16/v17 aux addressing (FX + Monitor) — see aux-map.ts. */
	public auxMap = new AuxMap()

	/** Internal route state (Patch > Internal), key = routing.routeKey(). Fed by
	 *  /Notify/InternalAssign and seeded from the /Channels route bitmask. */
	public routes = new Map<string, boolean>()

	/** I/O patch per module-internal track (`${group}.${ch}`) → labels of the I/O
	 *  endpoints patched to it. Only filled when config.readIoPatch is on. */
	public ioPatch = new Map<string, string[]>()
	public ioPatchRows: number | null = null
	/** Second, recorder-type connection used to receive /Notify/IOConnections. */
	private ioOsc: OscTcpClient | null = null
	/** Re-handshake if /Channels does not arrive after registering (it sometimes
	 *  does not — observed on v17 — and it is the only source of names/faders). */
	private channelsWatchdog: NodeJS.Timeout | null = null
	private channelsSeen = false
	/** One-shot zDNS scan started by connectIfReady(); stopped on destroy / reconfigure
	 *  so its multicast socket does not outlive the connection. */
	private connectScan: DiscoverHandle | null = null

	/** Companion Surface driver connection (config mode 'surface'). */
	public surface: SurfaceClient | null = null
	/** Last value of every eMotion control the driver reported, key = controlKey(). */
	public surfaceControls = new Map<string, ControlUpdate>()
	/** Controls already requested with getx on the current driver connection. */
	private surfaceAsked = new Set<string>()
	/** Why the driver side is not usable, shown as the connection status. null = fine. */
	private surfaceProblem: string | null = null
	private surfaceFeedbackTimer: NodeJS.Timeout | null = null
	/** The MyRemote connection is registered. */
	private myRemoteOk = false
	/** Desk state learned from the driver: track names, flips, Talk Back preset. */
	public surfaceModel = new SurfaceModel()
	/** eMotion shortcuts registered on our surface this connection: `${fn}.${sel}.${tt}.${track}` → slot. */
	private surfaceKeys = new Map<string, number>()
	private nextSurfaceSlot = 1
	private surfaceDefsTimer: NodeJS.Timeout | null = null
	/** Running fades, key = the control being faded. */
	private surfaceFades = new Map<string, NodeJS.Timeout>()
	/** The desk's strips, racks and groups were read on this connection. */
	private surfaceProbed = false
	/** Plugin codes whose parameter catalogue was requested on this connection. */
	private surfacePluginsAsked = new Set<string>()

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
		/** Track counts per group from /Channels (group 1 = buses, 6 = matrix, 12 = DCA/Link). */
		groupCounts?: Record<number, number>
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
		// Cancel any in-flight zDNS discovery so the dgram socket releases its
		// multicast membership immediately (otherwise it lingers until the 6 s
		// scan timeout, and a rapid delete-recreate cycle stacks sockets on
		// the fixed port 13337).
		cancelDiscovery()
		for (const t of this.activeFades.values()) clearInterval(t)
		this.activeFades.clear()
		if (this.osc) {
			this.osc.disconnect()
			this.osc = null
		}
		this.stopIoPatchClient()
		this.stopSurfaceClient()
		if (this.channelsWatchdog) clearTimeout(this.channelsWatchdog)
		this.channelsWatchdog = null
		this.stopConnectScan()
	}

	private stopConnectScan(): void {
		const scan = this.connectScan
		this.connectScan = null
		scan?.stop()
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		const restart =
			this.config.selected !== config.selected ||
			this.config.host !== config.host ||
			this.config.port !== config.port ||
			!!this.config.readIoPatch !== !!config.readIoPatch ||
			(this.config.mode ?? 'myremote') !== (config.mode ?? 'myremote') ||
			this.config.surfacePort !== config.surfacePort ||
			this.config.surfacePassword !== config.surfacePassword ||
			this.config.surfaceHost !== config.surfaceHost
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
			this.stopIoPatchClient()
			this.stopSurfaceClient()
			this.surfaceControls.clear()
			this.surfaceModel.reset()
			this.myRemoteOk = false
			// L3: clear all mixer-state derived from the previous host so feedbacks
			// don't briefly render the old mixer's values during the cross-over, and
			// a carried-over failure count doesn't trigger a spurious re-discovery.
			this.channels.clear()
			this.sends.clear()
			this.muteGroups.clear()
			this.meters.clear()
			this.scenes.clear()
			this.userKeys.clear()
			this.spillStates.clear()
			this.tbDestEnabled.clear()
			this.routes.clear()
			this.ioPatch.clear()
			this.ioPatchRows = null
			this.auxMap.set([])
			this.detected = {}
			this.consecutiveFailures = 0
			this.currentFlipTarget = null
			this.currentMixer = null
			this.currentLayer = null
			this.currentScene = null
			this.currentSceneName = null
			this.lastTempoBpm = null
			// The next desk may be a different version — re-learn it before decoding
			// any v17-only /Channels fields.
			this.consoleMajor = null
			this.consoleVersion = null
			this.channelsSeen = false
			if (this.channelsWatchdog) clearTimeout(this.channelsWatchdog)
			this.channelsWatchdog = null
			// Redraw everything from the now-empty state, so no button keeps showing the
			// previous desk (phantom in particular is only reported on change).
			this.updateActions()
			this.updateFeedbacks()
			this.updatePresets()
			this.updateVariables()
			this.checkFeedbacks()
			cancelDiscovery()
			this.stopConnectScan()
			await this.connectIfReady()
		}
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields(this.label)
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

		// Companion Surface mode only needs the desk computer's IP: the driver has a fixed port.
		const surfaceMode = this.config.mode === 'surface'
		if (surfaceMode && this.config.surfaceHost?.trim()) {
			this.lastHost = this.config.surfaceHost.trim()
			this.startSurfaceClient(this.lastHost)
			return
		}

		// Priority 3: if we still have no host or no port, try a one-shot discovery.
		if (!host || (!port && !surfaceMode)) {
			this.updateStatus(InstanceStatus.Connecting, 'Discovering LV1…')
			this.log('info', `Running zDNS discovery (host filter: ${host || 'none'})`)
			const scan = discover({
				timeoutMs: 6000,
				filterHostIp: host || undefined,
				// Surface bind failures and the interface list into the Companion log —
				// otherwise "no LV1 found" is the only thing the operator ever sees, and
				// it reads the same whether the desk is off, on another subnet, or the
				// discovery socket never bound at all.
				onDiagnostic: (level, message) => this.log(level, message),
			})
			this.connectScan = scan
			const entries = await scan.done
			// Cancelled by destroy() or a newer configUpdated() — that caller owns the next step.
			if (this.connectScan !== scan) return
			this.connectScan = null
			if (!entries.length) {
				const ifaces = multicastInterfaces()
				const where = ifaces.length
					? ifaces.map((i) => `${i.name} (${i.address})`).join(', ')
					: 'no usable network interfaces'
				this.log(
					'warn',
					`No LV1 announcements in 6 s. Listened on: ${where}. If the LV1 is not on one of those subnets, ` +
						`multicast cannot reach us — enter the LV1 IP manually and leave the port at 0.`,
				)
				this.updateStatus(
					InstanceStatus.BadConfig,
					host
						? `No LV1 matching ${host} found in 6 s. Check the IP, and leave the port at 0.`
						: `No LV1 found on ${ifaces.length} interface(s) in 6 s. Enter the LV1 IP manually, or see Help → "If it doesn't connect".`,
				)
				return
			}
			const chosen = entries[0]
			host = chosen.addresses[0] || chosen.host || ''
			port = chosen.port ?? 0
			this.log('info', `Discovered ${chosen.host} at ${host}:${port}`)
		}

		if (surfaceMode) {
			// Standalone: everything goes through the driver, MyRemote is never opened.
			if (!host) {
				this.updateStatus(InstanceStatus.BadConfig, 'No LV1 address available after discovery')
				return
			}
			this.lastHost = host
			this.startSurfaceClient(host)
			return
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
		if (this.config.readIoPatch) this.startIoPatchClient(host, port)
	}

	// ─── Companion Surface driver ─────────────────────────────────────────

	/** The driver runs inside eMotion, so it lives on the same computer as the MyRemote server. */
	private startSurfaceClient(host: string): void {
		this.stopSurfaceClient()
		const port = this.config.surfacePort || SURFACE_DEFAULT_PORT
		const s = new SurfaceClient({ host, port, password: this.config.surfacePassword ?? '' })
		const rejected = 'Companion Surface rejected the password'
		let failing = false
		this.surfaceProblem = `Companion Surface not reachable on ${host}:${port} — is it installed and added in eMotion's Controls panel?`
		this.updateStatus(InstanceStatus.Connecting, `Connecting to Companion Surface on ${host}:${port}`)
		s.on('ready', (version: string | null) => {
			failing = false
			this.surfaceAsked.clear()
			this.surfaceModel.reset()
			this.surfaceKeys.clear()
			this.nextSurfaceSlot = 1
			// Flip state comes from eMotion's InterMapper messages; names and counts from the tracks.
			s.write('sub im 1')
			this.surfacePluginsAsked.clear()
			for (const a of this.surfaceModel.probeAddresses()) s.getx(a)
			// Strips, racks and groups are read once the names say which tracks exist.
			this.surfaceProbed = false
			this.surfaceProblem =
				version && compareVersions(version, SURFACE_DRIVER_VERSION) < 0
					? `Companion Surface ${version} on the desk is older than ${SURFACE_DRIVER_VERSION} — reinstall it from the install page`
					: null
			this.log('info', `Companion Surface ${version ?? '?'} connected on ${host}:${port}`)
			this.reportStatus()
			// Feedback callbacks request the values they do not know yet.
			this.checkFeedbacks()
		})
		s.on('control', (c: ControlUpdate) => {
			this.surfaceControls.set(controlKey(c), c)
			this.surfaceLearn(c)
			const kind = this.surfaceModel.applyControl(c)
			if (kind === 'names') this.scheduleSurfaceDefinitions()
			else if (kind === 'tb') this.pushSurfaceVariables()
			this.scheduleSurfaceFeedbacks()
		})
		s.on('real', (r: RealUpdate) => {
			if (r.mode !== 3) return
			this.surfaceModel.real.set(controlKey(r), r.value)
			this.scheduleSurfaceFeedbacks()
			this.scheduleSurfaceVariables()
		})
		s.on('props', (p: ControlProps) => {
			const slot = this.surfaceModel.slots.get(`${p.tt}.${p.track}.${p.secType}`)
			if (slot && this.surfaceModel.applyProps(slot.code, slot.name, p)) this.scheduleSurfaceDefinitions()
		})
		s.on('signal', (sig: EmotionSignal) => {
			if (!this.surfaceModel.applySignal(sig.name, sig.args)) return
			this.scheduleSurfaceFeedbacks()
			this.scheduleSurfaceVariables()
		})
		s.on('intermap', (m: InterMapMessage) => {
			if (!this.surfaceModel.applyInterMap(m)) return
			this.checkFeedbacks('surfaceFlip')
			this.pushSurfaceVariables()
		})
		s.on('authFailed', () => {
			if (this.surfaceProblem === rejected) return
			this.surfaceProblem = rejected
			this.log('warn', rejected)
			this.reportStatus()
		})
		s.on('driverError', (msg: string) => this.log('warn', `Companion Surface: ${msg}`))
		s.on('error', (err: Error) => {
			// Warn once per outage; the retries after that only go to debug.
			this.log(failing ? 'debug' : 'warn', `Companion Surface ${host}:${port}: ${err.message} — retrying`)
			if (!failing) this.reportStatus()
			failing = true
		})
		s.on('close', () => {
			this.surfaceProblem = `Companion Surface on ${host}:${port} disconnected — retrying`
			this.reportStatus()
		})
		this.surface = s
		s.connect()
	}

	/** Track names / counts changed: rebuild the dropdowns, presets and variables once. */
	private scheduleSurfaceDefinitions(): void {
		if (this.surfaceDefsTimer) return
		this.surfaceDefsTimer = setTimeout(() => {
			this.surfaceDefsTimer = null
			if (!this.surfaceProbed && this.surface?.isReady()) {
				this.surfaceProbed = true
				this.surfaceProbeDesk(this.surface)
			}
			this.updateActions()
			this.updateFeedbacks()
			this.updatePresets()
			this.updateVariables()
			this.checkFeedbacks()
		}, 400)
	}

	private pushSurfaceVariables(): void {
		this.setVariableValues(surfaceVariableValues(this))
	}

	private surfaceVariablesTimer: NodeJS.Timeout | null = null
	private scheduleSurfaceVariables(): void {
		if (this.surfaceVariablesTimer) return
		this.surfaceVariablesTimer = setTimeout(() => {
			this.surfaceVariablesTimer = null
			this.pushSurfaceVariables()
		}, 100)
	}

	/** After the names: faders (dB), mutes, solos and rack slots of the tracks that exist, mute groups, Mute All. */
	private surfaceProbeDesk(s: SurfaceClient): void {
		for (const t of SURFACE_TRACK_TYPES) {
			if (!STRIP_TYPES.includes(t.tt)) continue
			for (const tr of this.surfaceModel.list(t.tt)) {
				const i = tr.track
				s.getReal(strip.fader(t.tt, i))
				s.getx(strip.mute(t.tt, i))
				s.getx(strip.solo(t.tt, i))
				if (!RACK_TYPES.includes(t.tt)) continue
				for (let slot = 0; slot < RACK_SLOTS; slot++) {
					s.getx(strip.slotName(t.tt, i, slot))
					s.getx(strip.slotCode(t.tt, i, slot))
				}
			}
		}
		for (let g = 0; g < MUTE_GROUPS; g++) s.getx(muteGroupAddress(g))
		s.getx(MUTE_ALL)
	}

	/** Facts learned from control reports: fader dB from its display, plugins in slots, parameter scales. */
	private surfaceLearn(c: ControlUpdate): void {
		const s = this.surface
		const model = this.surfaceModel
		// Fader display (cid 1) carries the dB text of the fader written on cid 0.
		if (c.group === 7 && c.cid === 1 && c.secType === -1) {
			const db = displayNumber(c.text)
			if (db != null) model.real.set(controlKey(strip.fader(c.tt, c.track)), db)
			this.scheduleSurfaceVariables()
			return
		}
		if (c.group !== 4) return
		if (model.applySlot(c)) {
			const slot = model.slots.get(`${c.tt}.${c.track}.${c.secType}`)
			// First time a plugin type shows up: read its parameter names and ranges from this slot.
			if (s && slot?.code && slot.name && !this.surfacePluginsAsked.has(slot.code)) {
				this.surfacePluginsAsked.add(slot.code)
				for (let i = 0; i < 128; i++) {
					s.props(strip.param(c.tt, c.track, c.secType, i))
					s.getx(strip.param(c.tt, c.track, c.secType, i))
				}
			}
			this.scheduleSurfaceDefinitions()
			return
		}
		// A parameter value with its display text: learn whether the parameter is linear or log.
		if (c.cid === 11 && c.secIdx >= 0) {
			const code = model.slotCode(c.tt, c.track, c.secType)
			const p = model.plugins.get(code)?.params.get(c.secIdx)
			if (p && p.kind === 'continuous' && !p.scale) {
				const shown = displayNumber(c.text)
				if (shown != null && c.value > 20 && c.value < 980) {
					const lin = p.min + (c.value / 1000) * (p.max - p.min)
					const log = p.min > 0 ? p.min * Math.pow(p.max / p.min, c.value / 1000) : NaN
					p.scale = Number.isFinite(log) && Math.abs(log - shown) < Math.abs(lin - shown) ? 'log' : 'linear'
				}
			}
			this.scheduleSurfaceFeedbacks()
		}
	}

	/** Fader in dB, from what the desk reported. */
	surfaceFaderDb(tt: number, track: number): number | null {
		const v = this.surfaceModel.real.get(controlKey(strip.fader(tt, track)))
		if (v != null) return v
		this.surface?.getReal(strip.fader(tt, track))
		return null
	}

	surfaceSetFader(tt: number, track: number, db: number, fade: { ms: number; curve: FadeCurve } | null): void {
		const s = this.surface
		if (!s?.isReady()) {
			this.log('warn', 'Companion Surface is not connected — action ignored')
			return
		}
		const addr = strip.fader(tt, track)
		const key = controlKey(addr)
		const apply = (v: number) => {
			s.setReal(addr, Math.round(v * 10) / 10)
			this.surfaceModel.real.set(key, v)
		}
		const from = this.surfaceModel.real.get(key)
		if (!fade || from == null) {
			this.surfaceStopFade(key)
			apply(db)
			this.scheduleSurfaceVariables()
			return
		}
		// Fading up from −∞: start where the fader starts to be audible.
		this.surfaceFade(key, Math.max(from, -80), db, fade, apply)
	}

	/** A plugin parameter's display text (as eMotion shows it), or null when not known yet. */
	surfacePluginText(tt: number, track: number, slot: number, index: number): string | null {
		const addr = strip.param(tt, track, slot, index)
		const c = this.surfaceControls.get(controlKey(addr))
		if (c) return c.text
		if (this.surface?.isReady() && !this.surfaceAsked.has(controlKey(addr))) {
			this.surfaceAsked.add(controlKey(addr))
			this.surface.getx(addr)
		}
		return null
	}

	private toRaw(p: PluginParam, v: number): number {
		if (p.scale === 'log' && p.min > 0 && v > 0) return (1000 * Math.log(v / p.min)) / Math.log(p.max / p.min)
		return ((v - p.min) / (p.max - p.min || 1)) * 1000
	}

	private fromRaw(p: PluginParam, raw: number): number {
		if (p.scale === 'log' && p.min > 0) return p.min * Math.pow(p.max / p.min, raw / 1000)
		return p.min + (raw / 1000) * (p.max - p.min)
	}

	/** Change a plugin parameter: set / inc / dec in its units (optionally fading), toggle, next, prev. */
	async surfaceChangePluginParam(
		tt: number,
		track: number,
		slot: number,
		p: PluginParam,
		mode: string,
		value: number,
		fade: { ms: number; curve: FadeCurve } | null,
	): Promise<void> {
		const s = this.surface
		if (!s?.isReady()) {
			this.log('warn', 'Companion Surface is not connected — action ignored')
			return
		}
		const addr = strip.param(tt, track, slot, p.index)
		const key = controlKey(addr)
		let raw = this.surfaceControls.get(key)?.value
		if (raw == null) {
			s.getx(addr)
			await new Promise((r) => setTimeout(r, 200))
			raw = this.surfaceControls.get(key)?.value
		}
		const write = (r: number) => {
			s.setx(addr, r)
			const prev = this.surfaceControls.get(key)
			this.surfaceControls.set(key, { ...addr, value: r, text: prev?.text ?? '' })
		}
		if (p.kind === 'state' || mode === 'toggle' || mode === 'next' || mode === 'prev') {
			const cur = Math.round(raw ?? 0)
			let next = cur
			if (mode === 'toggle') next = cur ? 0 : 1
			else if (mode === 'next') next = cur + 1
			else if (mode === 'prev') next = Math.max(0, cur - 1)
			else if (mode === 'inc') next = cur + Math.round(value)
			else if (mode === 'dec') next = Math.max(0, cur - Math.round(value))
			else next = Math.max(0, Math.round(value))
			this.surfaceStopFade(key)
			write(next)
			if (mode === 'next') {
				// Past the last state eMotion keeps the old value: wrap to the first one.
				setTimeout(() => {
					if (Math.round(this.surfaceControls.get(key)?.value ?? next) === cur) write(0)
				}, 300)
				s.getx(addr)
			}
			return
		}
		const current = raw != null ? this.fromRaw(p, raw) : p.min
		const lo = Math.min(p.min, p.max)
		const hi = Math.max(p.min, p.max)
		const target = Math.max(
			lo,
			Math.min(hi, mode === 'inc' ? current + value : mode === 'dec' ? current - value : value),
		)
		const targetRaw = Math.max(0, Math.min(1000, this.toRaw(p, target)))
		if (!fade || raw == null) {
			this.surfaceStopFade(key)
			write(targetRaw)
			return
		}
		// Fade on the desk's own 0-1000 scale: even steps on log controls (frequency) too.
		this.surfaceFade(key, raw, targetRaw, fade, write)
	}

	private surfaceStopFade(key: string): void {
		const t = this.surfaceFades.get(key)
		if (t) clearInterval(t)
		this.surfaceFades.delete(key)
	}

	/** Steps a value from → to over the fade time (about 25 steps per second). */
	private surfaceFade(
		key: string,
		from: number,
		to: number,
		fade: { ms: number; curve: FadeCurve },
		apply: (v: number) => void,
	): void {
		this.surfaceStopFade(key)
		const start = Date.now()
		const ease = (x: number) =>
			fade.curve === 'ease' ? x * x * (3 - 2 * x) : fade.curve === 'easeOut' ? 1 - (1 - x) * (1 - x) : x
		const step = () => {
			const x = Math.min(1, (Date.now() - start) / fade.ms)
			apply(from + (to - from) * ease(x))
			if (x >= 1) {
				this.surfaceStopFade(key)
				this.scheduleSurfaceVariables()
			}
		}
		step()
		this.surfaceFades.set(key, setInterval(step, 40))
	}

	/**
	 * Runs an eMotion shortcut function (WCUserKeyHandler action code) the way a surface key does:
	 * the first time, register it on our surface (its own slot), then press and release it.
	 */
	surfaceRunFunction(
		fn: number,
		selection: number,
		tt: number,
		track: number,
		phase: 'tap' | 'down' | 'up' = 'tap',
	): void {
		const s = this.surface
		if (!s?.isReady()) {
			this.log('warn', 'Companion Surface is not connected — action ignored')
			return
		}
		const press = (slot: number) => {
			if (phase !== 'up') s.write(`ukdown ${slot}`)
			if (phase !== 'down') s.write(`ukup ${slot}`)
		}
		const key = `${fn}.${selection}.${tt}.${track}`
		const known = this.surfaceKeys.get(key)
		if (known != null) {
			press(known)
			return
		}
		const slot = this.nextSurfaceSlot++
		this.surfaceKeys.set(key, slot)
		s.write(`ukreg ${slot} ${fn} ${selection} ${tt} ${track}`)
		// eMotion stores the shortcut on its GUI thread a moment after the registration.
		setTimeout(() => {
			if (this.surface === s && s.isReady()) press(slot)
		}, 250)
	}

	private stopSurfaceClient(): void {
		if (this.surfaceFeedbackTimer) clearTimeout(this.surfaceFeedbackTimer)
		this.surfaceFeedbackTimer = null
		for (const t of this.surfaceFades.values()) clearInterval(t)
		this.surfaceFades.clear()
		if (this.surfaceVariablesTimer) clearTimeout(this.surfaceVariablesTimer)
		this.surfaceVariablesTimer = null
		if (this.surfaceDefsTimer) clearTimeout(this.surfaceDefsTimer)
		this.surfaceDefsTimer = null
		if (!this.surface) return
		this.surface.removeAllListeners()
		this.surface.disconnect()
		this.surface = null
	}

	/** eMotion dumps a whole strip (~150 controls) when a channel is selected: redraw once. */
	private scheduleSurfaceFeedbacks(): void {
		if (this.surfaceFeedbackTimer) return
		this.surfaceFeedbackTimer = setTimeout(() => {
			this.surfaceFeedbackTimer = null
			this.checkFeedbacks(
				'surfaceTalk',
				'surfaceSlotBypassed',
				'surfaceRackOut',
				'surfaceTbPreset',
				'surfaceMuted',
				'surfaceSoloed',
				'surfaceFaderLevel',
				'surfaceMuteAll',
				'surfaceMuteGroup',
				'surfacePluginState',
				'surfacePluginValue',
				'surfaceLock',
				'surfaceRecording',
				'surfaceSoloActive',
				'surfaceSceneDirty',
				'surfaceSessionDirty',
				'surfaceScene',
			)
		}, 30)
	}

	/** Connection status: the driver in Companion Surface mode, MyRemote otherwise. */
	private reportStatus(): void {
		if (this.config.mode === 'surface') {
			if (!this.surfaceProblem) this.updateStatus(InstanceStatus.Ok)
			else if (this.surface?.isReady()) this.updateStatus(InstanceStatus.UnknownWarning, this.surfaceProblem)
			else this.updateStatus(InstanceStatus.ConnectionFailure, this.surfaceProblem)
			return
		}
		if (this.myRemoteOk) this.updateStatus(InstanceStatus.Ok)
	}

	/** Last value the driver reported for a control; asks for it once when unknown. */
	surfaceValue(a: ControlAddress): number | null {
		const key = controlKey(a)
		const c = this.surfaceControls.get(key)
		if (c) return c.value
		if (this.surface?.isReady() && !this.surfaceAsked.has(key)) {
			this.surfaceAsked.add(key)
			this.surface.getx(a)
		}
		return null
	}

	surfaceBool(a: ControlAddress): boolean {
		const v = this.surfaceValue(a)
		return v != null && v >= 0.5
	}

	surfaceSet(a: ControlAddress, value: number): void {
		if (!this.surface?.isReady()) {
			this.log('warn', 'Companion Surface is not connected — action ignored')
			return
		}
		this.surface.setx(a, value)
		// Optimistic, so a quick second toggle inverts the new state; the driver's echo confirms it.
		const key = controlKey(a)
		this.surfaceControls.set(key, { ...a, value, text: this.surfaceControls.get(key)?.text ?? '' })
		this.scheduleSurfaceFeedbacks()
	}

	surfaceSetBool(a: ControlAddress, on: boolean): void {
		this.surfaceSet(a, on ? 1 : 0)
	}

	/** Serves the Companion Surface install page: http://<companion>/instance/<label>/surface */
	handleHttpRequest(request: CompanionHTTPRequest): CompanionHTTPResponse {
		const p = request.path.replace(/\/+$/, '')
		if (p === '' || p === '/surface') {
			const page = surfaceInstallPage()
			return {
				status: page.status,
				headers: { 'Content-Type': page.status === 200 ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' },
				body: page.body,
			}
		}
		return { status: 404, body: 'Not found' }
	}

	// ─── I/O patch (experimental) ─────────────────────────────────────────

	/** Second connection registered as client type 6 (Tracks Live). The LV1 sends
	 *  /Notify/IOConnections only to that client type — see io-connections.ts. It
	 *  carries no control traffic; everything else stays on the main connection. */
	private startIoPatchClient(host: string, port: number): void {
		this.stopIoPatchClient()
		const io = new OscTcpClient({
			host,
			port,
			deviceName: 'Companion I/O',
			handshakeStyle: 'tracks',
			autoReconnect: true,
		})
		let failing = false
		io.on('registered', () => {
			failing = false
			this.log('info', 'I/O patch connection registered (recorder client type)')
		})
		io.on('error', (err: Error) => {
			// Warn once per outage; the 3 s retries after that only go to debug.
			this.log(failing ? 'debug' : 'warn', `I/O patch connection: ${err.message} — retrying`)
			failing = true
		})
		io.on('packet', ({ decoded }: { decoded: OscMessage }) => {
			if (decoded.address === '/Notify/IOConnections') this.handleIoConnections(decoded)
		})
		this.ioOsc = io
		io.connect()
	}

	private stopIoPatchClient(): void {
		if (!this.ioOsc) return
		this.ioOsc.removeAllListeners()
		this.ioOsc.disconnect()
		this.ioOsc = null
	}

	private handleIoConnections(m: OscMessage): void {
		const rows = parseIOConnections(m.args)
		if (rows == null) {
			this.log('warn', `/Notify/IOConnections: unexpected shape (${m.args.length} args) — ignored`)
			return
		}
		const patch = new Map<string, string[]>()
		let unmatched = 0
		for (const row of rows) {
			const t = rowTrack(row)
			const label = rowLabel(row)
			if (!t || !label) {
				unmatched++
				continue
			}
			const [g, ch] = this.auxMap.fromWire(t.group, t.ch)
			const key = `${g}.${ch}`
			const list = patch.get(key) ?? []
			if (!list.includes(label)) list.push(label)
			patch.set(key, list)
		}
		this.log(
			'info',
			`I/O patch: ${rows.length} connection(s), ${patch.size} mixer track(s)${unmatched ? `, ${unmatched} unrecognised row(s)` : ''}`,
		)
		if (rows.length) this.log('debug', `I/O patch rows: ${JSON.stringify(rows.slice(0, 8))}`)
		const stale = [...this.ioPatch.keys()].filter((k) => !patch.has(k))
		this.ioPatch = patch
		this.ioPatchRows = rows.length
		const values: Record<string, string> = { io_patch_connections: String(rows.length) }
		for (const key of [...patch.keys(), ...stale]) {
			const [g, ch] = key.split('.').map(Number)
			values[`${trackSlug(g, ch)}_patch`] = (patch.get(key) ?? []).join(' + ')
		}
		this.setVariableValues(values)
		this.checkFeedbacks('channelHasPatch')
	}

	/** Called from the 'close' handler after enough failed reconnects to suspect the LV1
	 *  changed port (mixer config change, restart, etc.). Looks up the new port via zDNS
	 *  and points the OSC client at it. */
	private async rediscoverPort(): Promise<void> {
		if (!this.lastHost || !this.osc) return
		this.log('info', `Reconnect failing — running a fresh zDNS scan to find ${this.lastHost}'s new port…`)
		const results = await refreshDiscovery(5000, (level, message) => this.log(level, message))
		const match = results.find((e) => e.addresses.includes(this.lastHost!))
		if (!match || match.port == null) {
			this.log('warn', `No zDNS match for ${this.lastHost} — will keep retrying current port`)
			return
		}
		this.log('info', `Rediscovered ${this.lastHost} on port ${match.port} — reconnecting`)
		this.osc.updateTarget(this.lastHost, match.port)
		// The I/O-patch connection talks to the same desk — move it too.
		this.ioOsc?.updateTarget(this.lastHost, match.port)
	}

	private bindOscEvents(osc: OscTcpClient): void {
		osc.on('connect', ({ host, port }: { host: string; port: number }) => {
			this.log('info', `TCP connected to ${host}:${port}, running handshake…`)
			this.consecutiveFailures = 0
		})
		osc.on('registered', ({ style }: { style: string }) => {
			this.log('info', `Registered with the LV1 as ${style}`)
			this.myRemoteOk = true
			this.reportStatus()
			// Re-request state on every connect. The LV1 doesn't spontaneously re-broadcast
			// after a handshake the second time, so this keeps the dropdowns populated
			// across module restarts.
			this.requestStateRefresh()
			// /Channels (names, faders, mutes, routes) normally arrives right after the
			// handshake, but on v17 some sessions never get it. A repeated /handshake
			// makes the server re-send /Aux/Tracks + /Channels (verified live), so ask
			// again if it has not shown up.
			this.channelsSeen = false
			if (this.channelsWatchdog) clearTimeout(this.channelsWatchdog)
			this.channelsWatchdog = setTimeout(() => {
				this.channelsWatchdog = null
				if (this.channelsSeen || !this.osc?.isConnected()) return
				this.log('info', 'No /Channels after handshake — asking the LV1 again')
				this.requestChannels()
			}, 2500)
		})
		osc.on('close', () => {
			this.myRemoteOk = false
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

	private handleNotify(raw: OscMessage): void {
		// v17 Monitor buses arrive as (25, local) — fold them back into (2, combined).
		const m = this.auxMap.translateIncoming(raw)
		const addr = m.address
		switch (addr) {
			case '/Notify/Track/Out/Mute': {
				// VERIFIED LIVE (mute on LV1 surface, captured 2026-05-30):
				//   ,iiiT [g, ch, isMuted(0|1), validFlag(ALWAYS TRUE)]
				// The earlier "sub=0, isMuted" interpretation was wrong — the third int IS
				// the mute state, and the trailing T constant is just a validity flag.
				// LV1 sends each event twice (~3 ms apart); idempotent so we just run twice.
				//
				// VERIFIED LIVE (mute-group toggle, captured 2026-06-17):
				//   The LV1 multiplexes /Notify/MuteGroup over THIS address with the
				//   pseudo-group g=13 — there is no separate /Notify/MuteGroup wire
				//   format. Args become [g=13, mg_index(0..7), state(0|1), T].
				//   Intercept that case first and route into muteGroups state.
				const g = intArg(m, 0)
				const ch = intArg(m, 1)
				const state = intArg(m, 2)
				if (g == null || ch == null || state == null) return
				if (g === 13) {
					const on = state !== 0
					this.muteGroups.set(ch, on)
					this.checkFeedbacks('muteGroup')
					this.setVariableValues({ [`mg_${ch + 1}`]: on ? 'on' : 'off' })
					break
				}
				const mute = state !== 0
				const s = this.ensureChannel(g, ch)
				s.muted = mute
				this.checkFeedbacks('channelMute')
				pushTrackVariable(this, g, ch, 'mute')
				break
			}
			case '/Notify/Track/Pan': {
				// ,iid [g, ch, value(-1..+1)]
				const g = intArg(m, 0),
					ch = intArg(m, 1)
				const dArg = m.args[2]
				const v = dArg?.type === 'd' || dArg?.type === 'f' ? dArg.value : null
				if (g == null || ch == null || v == null) return
				this.ensureChannel(g, ch).pan = v
				pushTrackVariable(this, g, ch, 'pan')
				break
			}
			case '/Notify/Track/Pan/Width':
			case '/Notify/PanArcWidth': {
				// Both observed in catalog; pick first numeric arg after g, ch.
				// v17: ,iidi [g, ch, width, valid] — mono strips report d:857.143 with valid=0.
				const g = intArg(m, 0),
					ch = intArg(m, 1)
				const validArg = m.args[3]
				if (validArg?.type === 'i' && validArg.value === 0) break
				const dArg = m.args[2]
				const v = dArg?.type === 'd' || dArg?.type === 'f' ? dArg.value : null
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
				const db = dbArg?.type === 'f' || dbArg?.type === 'd' || dbArg?.type === 'i' ? dbArg.value : null
				if (g == null || ch == null || db == null) return
				this.ensureChannel(g, ch).gain = db
				pushTrackVariable(this, g, ch, 'gain')
				break
			}
			case '/Notify/TrackInGain':
			case '/Notify/TrackTrim': {
				// VERIFIED LIVE (eMotion LV1 v.16.5.18.404, 2026-08-08):
				//   typetag ,iiif — [group, channel, subIndex(0|1), value(f)]
				// Arrives once per strip in the post-handshake flood: TrackInGain 37×
				// across 35 distinct (group, channel) pairs, TrackTrim 35× across 34.
				// Groups seen: 0 (input), 2 (aux/FX), 3 (LR), 6 (matrix), 7 (cue), 8 (TB).
				//
				// args[2] is a SUB-INDEX, not the value — it only ever takes 0 or 1, which
				// is the L/R leg of a stereo strip. We key state on (group, channel) and
				// keep leg 0 as the strip's value; leg 1 is dropped rather than silently
				// overwriting leg 0 with a different number.
				//
				// ⚠️ VALUE FIELD OBSERVED CONSTANT AT 0.0. Every preamp on the capture rig
				// sat at its default, so while the field is unambiguously the value slot
				// (it is the only float, and it is strip-addressed), the dB mapping is NOT
				// confirmed against a moved preamp. It is surfaced verbatim, unscaled.
				const g = intArg(m, 0)
				const ch = intArg(m, 1)
				const sub = intArg(m, 2)
				const vArg = m.args[3]
				const v = vArg?.type === 'f' || vArg?.type === 'd' ? vArg.value : null
				if (g == null || ch == null || v == null) return
				if (sub !== 0) break // stereo leg 1 — see note above
				const s = this.ensureChannel(g, ch)
				if (addr === '/Notify/TrackInGain') {
					s.inGain = v
					pushTrackVariable(this, g, ch, 'ingain')
				} else {
					s.trim = v
					pushTrackVariable(this, g, ch, 'trim')
				}
				break
			}
			case '/Notify/PhaseState':
			case '/Notify/PhantomState': {
				// VERIFIED LIVE (eMotion LV1 v.16.5.18.404, 2026-08-09):
				//   typetag ,iiiii — [group, channel, subIndex(0|1), state(0|1), flag]
				//
				// args[3] is the state. Proven by writing, not by guessing: sending
				// /SetTrackPhaseState [g,ch,0,1] came back as [i:0 i:15 i:0 i:1 i:1] and
				// [g,ch,0,0] came back as [i:0 i:15 i:0 i:0 i:1] — args[3] tracked the
				// value we wrote, in both directions.
				//
				// args[2] is a sub-index (the L/R leg of a stereo strip), not a value; we
				// keep leg 0 as the strip's state. args[4] is constant per strip and
				// correlates with strip type (1 on inputs, 0 on LR) — it looks like a
				// "polarity available here" capability flag, but that is NOT confirmed,
				// so nothing is inferred from it.
				//
				// COVERAGE DIFFERS BETWEEN THE TWO, and it matters:
				//   /Notify/PhaseState   arrives 37× in the connect flood (all strips)
				//   /Notify/PhantomState never appears on connect — only on change
				// So polarity is known from connect; phantom stays null until someone
				// moves it. See the ChannelState doc comment for why that stays null.
				const g = intArg(m, 0)
				const ch = intArg(m, 1)
				const sub = intArg(m, 2)
				const state = intArg(m, 3)
				if (g == null || ch == null || state == null) return
				if (sub !== 0) break // stereo leg 1 — don't clobber leg 0
				const s = this.ensureChannel(g, ch)
				if (addr === '/Notify/PhaseState') {
					s.polarity = state !== 0
					this.checkFeedbacks(...channelFeedbacksForDelta({ polarity: s.polarity }))
					pushTrackVariable(this, g, ch, 'polarity')
				} else {
					s.phantom = state !== 0
					this.checkFeedbacks(...channelFeedbacksForDelta({ phantom: s.phantom }))
					pushTrackVariable(this, g, ch, 'phantom')
				}
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
				const name = m.args[1]?.type === 's' ? m.args[1].value : null
				const func = m.args[2]?.type === 's' ? m.args[2].value : null
				const assigned = intArg(m, 3)
				if (k == null || name == null || func == null || assigned == null) return
				if (k < 0 || k > 31) return
				const prev = this.userKeys.get(k)
				const changed = !prev || prev.func !== func || prev.assigned !== (assigned !== 0)
				this.userKeys.set(k, { name, func, assigned: assigned !== 0 })
				const k1 = k + 1
				this.setVariableValues({
					[`userkey_${k1}_name`]: name,
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
				// ,iiiiii [srcGroup, srcCh, destGroup, destIdx, state, valid]
				// VERIFIED LIVE (v17, 2026-10-23): the 3rd int is the DESTINATION GROUP, not a
				// "type" selector — 1 Group, 2 FX, 25 Mon (folded to 2 + combined index by
				// auxMap), 3/4/5 LR/C/M, 6 Matrix, 7 Cue, 12 DCA/Link, 13 mute-group membership.
				// It fires for every internal route change, including send-on changes
				// (Input → FX 1 arrives as [0, ch, 2, 0, 1, 1]) and TalkBack destinations
				// ([8, 0, 2, aux, …]). See routing.ts.
				//   dest 7 (Cue) → CUE source change (NOT flip itself). Only emitted when "Aux Cue
				//            On Flip" is enabled on the LV1. Pairs of state=0 (old) + state=1
				//            (new). state=1 on LR (g=3 ch=0) = no cue / default; on g=2 ch=N =
				//            cue points at aux N (= flipped). Without Aux Cue On Flip enabled
				//            the LV1 sends NOTHING for flip — surface is silent over OSC.
				const g = intArg(m, 0)
				const ch = intArg(m, 1)
				const type = intArg(m, 2)
				const sub = intArg(m, 3)
				const state = intArg(m, 4)
				if (g == null || ch == null || type == null || sub == null || state == null) return
				if (type !== 7) {
					this.routes.set(routeKey(g, ch, { group: type, idx: sub }), state === 1)
					this.checkFeedbacks('routeAssigned')
					// Only the TalkBack strip drives the TalkBack destination buttons — any
					// other source with dest group 2 is an ordinary send (issue #21).
					if (isTalkBackDest(g, ch, type)) {
						this.tbDestEnabled.set(sub, state === 1)
						this.checkFeedbacks('talkBackToOutput')
					}
					break
				}
				const isLR = g === 3 && ch === 0
				if (state === 1) {
					this.currentFlipTarget = isLR ? null : { group: g, ch }
					this.log('info', `Flip target → ${isLR ? 'LR (default)' : `g${g}.${ch}`}`)
					this.checkFeedbacks('flipActive', 'flipForTarget')
					this.pushFlipVariables()
				} else if (state === 0 && this.currentFlipTarget?.group === g && this.currentFlipTarget?.ch === ch) {
					this.currentFlipTarget = null
					this.checkFeedbacks('flipActive', 'flipForTarget')
					this.pushFlipVariables()
				}
				break
			}
			case '/Notify/ServiceVersion':
			case '/version': {
				// /Notify/ServiceVersion ,siii ["v.17.6.26.456", build, major, minor]; /version ,i [major]
				const major = addr === '/version' ? intArg(m, 0) : intArg(m, 2)
				if (major == null || major <= 0) break
				if (this.consoleMajor !== major) this.log('info', `eMotion LV1 major version ${major}`)
				this.consoleMajor = major
				const label = m.args[0]?.type === 's' ? m.args[0].value : null
				if (label) {
					this.consoleVersion = label
					this.setVariableValues({ console_version: label })
				}
				break
			}
			case '/Notify/Balance': {
				// ,iidi [g, ch, balance(-1..+1), valid] — stereo strips only (verified live, v17)
				const g = intArg(m, 0),
					ch = intArg(m, 1)
				const dArg = m.args[2]
				const v = dArg?.type === 'd' || dArg?.type === 'f' ? dArg.value : null
				if (g == null || ch == null || v == null) return
				this.ensureChannel(g, ch).balance = v
				pushTrackVariable(this, g, ch, 'balance')
				break
			}
			case '/Notify/MuteGroup': {
				// The LV1 does NOT broadcast on this address — confirmed via mgwatch
				// capture 2026-06-17. Real mute-group notifications come over
				// /Notify/Track/Out/Mute with the pseudo-group g=13 (handled above).
				// Keep the handler stub in case a future LV1 firmware adds it.
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
				break
			}
			case '/Notify/TrackColor': {
				const g = intArg(m, 0),
					ch = intArg(m, 1)
				const r = m.args[3]?.type === 'f' ? m.args[3].value : null
				const gC = m.args[4]?.type === 'f' ? m.args[4].value : null
				const b = m.args[5]?.type === 'f' ? m.args[5].value : null
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
				const name = m.args[2]?.type === 's' ? m.args[2].value : null
				if (g == null || ch == null || name == null) return
				this.ensureChannel(g, ch).name = name
				pushTrackVariable(this, g, ch, 'name')
				break
			}
			case '/Channels': {
				// VERIFIED LIVE (NameChange.pcapng, 2026-05-30):
				//   Server pushes this ~6× right after every handshake with the FULL track topology.
				//   Signature: ,i s iidd iiiiiiiiiiii hd × N
				//     args[0] = track count (e.g. 126 for 80ch/32aux mode)
				//     args[1..]: per track 19 args: name(s), group(i), ch(i), 2×d, 12×i, h, d
				//   See lv1_channels_endpoint.md memory for full schema.
				//
				// VERIFIED LIVE (eMotion LV1 v.16.5.18.404, 2026-08-08): the FIRST double
				// (args[base+3]) is the channel fader in dB — the same value the console
				// streams on /Notify/Track/Out/Gain. Confirmed by cross-check: the capture
				// showed "Channel 1" = 6.5 here AND /Notify/Track/Out/Gain g0.ch0 = d:6.5,
				// while every other strip read -144 (−∞).
				//
				// ⛔ THIS TABLE IS THE ONLY SOURCE OF FADER STATE FOR MOST STRIPS.
				// MEASURED over a 15 s idle capture: the console publishes
				// /Notify/Track/Out/Gain for exactly ONE (group, channel) — g0.ch0 — at a
				// steady ~12 Hz, and never sends it for any other strip.
				//
				// The failure mode this fixes (issue #13) is SILENT, not visible: because
				// ensureChannel() defaults gain to 0 and this handler already created a
				// ChannelState for every strip (for the name), every other `*_gain`
				// variable read a confident "0.0" — unity — no matter where the fader
				// actually sat. MEASURED before/after against the same live console:
				//   before → in2_gain = "0.0"    (default, fader really at −∞)
				//   after  → in2_gain = "-144.0" (the console's actual value)
				// A button or trigger built on that variable was acting on a wrong number,
				// which is worse than a variable that is simply blank.
				//
				// The second double and the 12 ints are NOT decoded here: on the capture rig
				// every strip carried identical values, so there is no variation to attribute
				// a meaning to. Naming them would be invention.
				//
				// VERIFIED LIVE (eMotion LV1 v.17.6.26.456, 2026-10-23) — same 19-arg record,
				// more fields pinned by flipping one control at a time and re-reading:
				//   [3] fader dB   [4] balance (stereo)   [6] mute 0/1   [16] legs 1|2 (mono|stereo)
				//   [17] route bitmask (int64, see routing.ts)   [18] pan
				// Only the fader is trusted on older consoles; the rest is read on v17+.
				// v17 lists Monitor buses as group 25 — folded into (2, combined) via auxMap.
				const args = m.args
				const count = args[0]?.type === 'i' ? args[0].value : 0
				if (count <= 0 || count > 512) break
				this.channelsSeen = true
				const v17 = (this.consoleMajor ?? 0) >= 17
				const groupCounts: Record<number, number> = {}
				const masks: Array<{ g: number; ch: number; mask: bigint }> = []
				let updated = 0
				let gainsSeeded = 0
				for (let i = 0; i < count; i++) {
					const base = 1 + i * 19
					if (base + 2 >= args.length) break
					const nameArg = args[base]
					const groupArg = args[base + 1]
					const chArg = args[base + 2]
					if (nameArg?.type !== 's' || groupArg?.type !== 'i' || chArg?.type !== 'i') continue
					const name = nameArg.value
					groupCounts[groupArg.value] = (groupCounts[groupArg.value] ?? 0) + 1
					const [group, ch] = this.auxMap.fromWire(groupArg.value, chArg.value)
					const s = this.ensureChannel(group, ch)
					if (s.name !== name) {
						s.name = name
						updated++
					}
					const faderArg = args[base + 3]
					if (faderArg?.type === 'd' || faderArg?.type === 'f') {
						if (s.gain !== faderArg.value) {
							s.gain = faderArg.value
							gainsSeeded++
						}
					}
					if (!v17) continue
					const num = (k: number): number | null => {
						const x = args[base + k]
						return x?.type === 'd' || x?.type === 'f' || x?.type === 'i' ? x.value : null
					}
					const balance = num(4)
					const mute = num(6)
					const legs = num(16)
					const pan = num(18)
					// Link/DCA records carry -1 in several int fields — only trust 0/1 / 1|2.
					if (mute === 0 || mute === 1) s.muted = mute === 1
					if (legs === 1 || legs === 2) s.stereo = legs === 2
					// Balance only exists on stereo strips; mono strips carry a meaningless 0 here.
					if (balance != null && s.stereo) s.balance = balance
					if (pan != null) s.pan = pan
					const maskArg = args[base + 17]
					if (maskArg?.type === 'h') masks.push({ g: group, ch, mask: BigInt(maskArg.value) })
				}
				this.detected.groupCounts = groupCounts
				// The bitmask layout is only mapped for the 8-group mixer modes.
				if (v17 && groupCounts[1] === 8) this.seedRoutesFromMasks(masks)
				if (updated > 0 || gainsSeeded > 0 || v17) {
					this.log('info', `/Channels arrived (${count} tracks, ${updated} name updates, ${gainsSeeded} fader values)`)
					// Names (and group counts) feed the action/feedback pickers; the rest only variables.
					if (updated > 0) {
						this.updateActions()
						this.updateFeedbacks()
						this.updatePresets()
					}
					if (v17) this.checkFeedbacks('channelMute', 'routeAssigned')
					this.updateVariables()
				}
				break
			}
			case '/Notify/Tempo': {
				const bpm = m.args[0]?.type === 'f' ? m.args[0].value : null
				if (bpm != null) {
					this.lastTempoBpm = bpm
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
					this.currentMixer = mixerPage + 1 // 1-based for display
				}
				if (layer != null) {
					this.currentLayer = layer
				}
				this.setVariableValues({
					current_mixer: this.currentMixer ?? '',
					current_layer_index: this.currentLayer != null ? this.currentLayer + 1 : '',
				})
				break
			}
			case '/Notify/CurSceneIndex': {
				const idx = intArg(m, 0)
				if (idx != null) {
					this.currentScene = idx
					this.currentSceneName = this.scenes.get(idx) ?? null
					this.checkFeedbacks('currentScene', 'currentSceneByName')
					this.setVariableValues({
						scene_index: idx,
						scene_name: this.currentSceneName ?? '',
					})
				}
				break
			}
			case '/Notify/Scene/Name': {
				// ,s "Scene Name" — broadcast for the CURRENT scene only (e.g. on a rename or recall).
				const name = m.args[0]?.type === 's' ? m.args[0].value : null
				if (name == null) break
				this.currentSceneName = name
				// Also update the catalog entry if we know the current index
				if (this.currentScene != null) this.scenes.set(this.currentScene, name)
				this.checkFeedbacks('currentScene', 'currentSceneByName')
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
					fresh.set(idxArg.value, nameArg.value)
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
					const wg = args[i].type === 'i' ? (args[i].value as number) : null
					const wch = args[i + 1].type === 'i' ? (args[i + 1].value as number) : null
					const [g, ch] = wg == null || wch == null ? [null, null] : this.auxMap.fromWire(wg, wch)
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
				this.checkFeedbacks('meterLevel')
				break
			}
			case '/Aux/Tracks': {
				// Reply to /Get/Aux/Tracks: first int is the aux count, then per aux: (idx, group, name).
				// Captured live — always arrives during handshake.
				//   v16: (combined, 2, name) for every aux.
				//   v17: FX = (0.., 2, name), Monitors = (0.., 25, name). The list ORDER is still
				//        the combined aux index the send plane uses — see aux-map.ts.
				const count = intArg(m, 0)
				if (count == null) break
				const entries = parseAuxTracks(m.args)
				const names = entries.map((e) => e.name)
				const changed = this.detected.auxes !== count || (this.detected.auxNames ?? []).join('|') !== names.join('|')
				this.auxMap.set(entries)
				this.detected.auxes = count
				this.detected.auxNames = names
				if (changed) {
					const mons = entries.filter((e) => e.group === 25).length
					this.log(
						'info',
						`LV1 reports ${count} aux buses (${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''})` +
							(mons ? ` — ${count - mons} FX + ${mons} Monitor (v17 addressing)` : ''),
					)
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
					const name = nameArg.value
					const entryCount = countArg.value
					const entries: Array<{ group: number; ch: number } | null> = []
					for (let e = 0; e < entryCount && idx + 1 < args.length; e++) {
						const g = args[idx++]?.value as number
						const ch = args[idx++]?.value as number
						if (g === -1 && ch === -1) {
							entries.push(null)
						} else {
							// v17 Monitor layer entries are (25, local) — count them as auxes.
							const [tg, tc] = this.auxMap.fromWire(g, ch)
							entries.push({ group: tg, ch: tc })
						}
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
			s = {
				muted: false,
				gain: null,
				solo: false,
				color: null,
				name: null,
				pan: 0,
				width: 1,
				balance: null,
				stereo: null,
				inGain: null,
				trim: null,
				polarity: null,
				phantom: null,
			}
			this.channels.set(key, s)
		}
		return s
	}

	/** Optimistic update used by actions BEFORE the /Notify echoes back. Keeps the
	 *  toggle-from-current-state logic correct on rapid presses and lets feedbacks
	 *  flip immediately without waiting for the round-trip. */
	/** Replace the bitmask-covered route state of each strip with what /Channels says. */
	private seedRoutesFromMasks(masks: Array<{ g: number; ch: number; mask: bigint }>): void {
		for (const { g, ch, mask } of masks) {
			const prefix = `${g}.${ch}>`
			for (const key of [...this.routes.keys()]) {
				if (!key.startsWith(prefix)) continue
				const destGroup = Number(key.slice(prefix.length).split('.')[0])
				if (MASK_GROUPS.has(destGroup)) this.routes.delete(key)
			}
			for (const dest of decodeRouteMask(mask)) this.routes.set(routeKey(g, ch, dest), true)
		}
	}

	/** Route state as last reported by the LV1. undefined = never reported. */
	routeState(srcGroup: number, srcCh: number, destGroup: number, destIdx: number): boolean | undefined {
		return this.routes.get(routeKey(srcGroup, srcCh, { group: destGroup, idx: destIdx }))
	}

	/** Optimistic route update from an action — the LV1 echoes the real state back. */
	setRouteState(srcGroup: number, srcCh: number, destGroup: number, destIdx: number, on: boolean): void {
		this.routes.set(routeKey(srcGroup, srcCh, { group: destGroup, idx: destIdx }), on)
		this.checkFeedbacks('routeAssigned')
	}

	/** Ask the LV1 to re-send /Aux/Tracks + /Channels. A repeated /handshake does
	 *  exactly that (verified live, v17) and is otherwise harmless. */
	requestChannels(): void {
		if (!this.osc?.isConnected()) return
		this.osc.send('/handshake', [
			{ type: 'i', value: 1 },
			{ type: 'i', value: -1 },
			{ type: 'i', value: 1 },
		])
	}

	applyChannelDelta(group: number, ch: number, delta: Partial<ChannelState>): void {
		const s = this.ensureChannel(group, ch)
		Object.assign(s, delta)
		const channelFeedbacks = channelFeedbacksForDelta(delta)
		if (channelFeedbacks.length) this.checkFeedbacks(...channelFeedbacks)
		if (delta.muted != null) {
			this.checkFeedbacks('channelMute')
			pushTrackVariable(this, group, ch, 'mute')
		}
		if (delta.solo != null) {
			this.checkFeedbacks('channelSolo', 'anySolo')
			pushTrackVariable(this, group, ch, 'solo')
		}
		if (delta.gain != null) pushTrackVariable(this, group, ch, 'gain')
		if (delta.pan != null) pushTrackVariable(this, group, ch, 'pan')
		if (delta.width != null) pushTrackVariable(this, group, ch, 'width')
		if (delta.balance != null) pushTrackVariable(this, group, ch, 'balance')
		if (delta.name != null) pushTrackVariable(this, group, ch, 'name')
		if (delta.polarity != null) {
			pushTrackVariable(this, group, ch, 'polarity')
		}
		if (delta.phantom != null) {
			pushTrackVariable(this, group, ch, 'phantom')
		}
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
			flip_group: t ? t.group : 3,
			flip_ch: t ? t.ch : 0,
			flip_name: name,
			flip_aux: aux1based,
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
		// Auxes are (2, combined) inside the module; v17 Monitors go out as (25, local).
		this.osc.send(address, this.auxMap.translateOutgoing(address, args))
	}
}

runEntrypoint(LV1Instance, UpgradeScripts)
