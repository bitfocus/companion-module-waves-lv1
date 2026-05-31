// Every action below uses an OSC signature confirmed live against the real LV1.
// Reference: c:\Users\migue\.claude\projects\c--www-myfoh\memory\lv1_confirmed_command_signatures.md
//
// Wire convention: ALL group/channel/aux indices are 0-based on the wire.
// The UI uses a Group dropdown + a per-group Channel dropdown (filtered via isVisible)
// so LR/C/M only show one entry, Auxes show real names, etc.

import { CompanionActionDefinitions, CompanionInputFieldDropdown } from '@companion-module/base'
import type { LV1Instance } from './main.js'
import type { OscArg } from './osc.js'
import { refreshDiscovery, getDiscoveryCache } from './discovery-cache.js'
import { GROUP_CHOICES, channelsFor, buildChannelOptions, resolveChannel } from './tracks.js'

function intCh(n: number): OscArg {
	return { type: 'i', value: n }
}

export function UpdateActions(self: LV1Instance): void {
	// Per-group channel dropdowns (only the one matching the selected group is visible).
	const trackOpts = buildChannelOptions(self, 'ch') as CompanionInputFieldDropdown[]
	// For sends/preamp/etc. we want a SECOND set of dropdowns scoped to the input channel.
	const inputOpts: CompanionInputFieldDropdown[] = [
		{ id: 'inputCh', type: 'dropdown', label: 'Input channel', default: 1, choices: channelsFor(self, 0) },
	]
	const auxDestOpts: CompanionInputFieldDropdown[] = [
		{ id: 'aux', type: 'dropdown', label: 'Aux destination', default: 1, choices: channelsFor(self, 2) },
	]

	const trackPicker: CompanionInputFieldDropdown[] = [
		{ id: 'group', type: 'dropdown', label: 'Group', default: 0, choices: GROUP_CHOICES },
		...trackOpts,
	]

	const actions: CompanionActionDefinitions = {
		// ─── Mute / Solo ──────────────────────────────────────────────
		mute: {
			name: 'Channel: Mute / Unmute / Toggle',
			options: [
				...trackPicker,
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					default: 'toggle',
					choices: [
						{ id: 'on', label: 'Mute' },
						{ id: 'off', label: 'Unmute' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (a) => {
				const group = Number(a.options.group)
				const ch = resolveChannel(a.options as Record<string, unknown>, group)
				const cur = self.channels.get(`${group}.${ch}`)?.muted ?? false
				const mode = String(a.options.state)
				const desired = mode === 'on' ? true : mode === 'off' ? false : !cur
				self.log('debug', `mute g=${group} ch=${ch} mode=${mode} cur=${cur} → ${desired}`)
				// Optimistic first so a rapid double-press inverts the new state, not the old one.
				self.applyChannelDelta(group, ch, { muted: desired })
				self.send('/Set/Track/Out/Mute', [intCh(group), intCh(ch), { type: desired ? 'T' : 'F' }])
			},
		},

		solo: {
			name: 'Channel: Solo / Unsolo / Toggle',
			options: [
				...trackPicker,
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					default: 'toggle',
					choices: [
						{ id: 'on', label: 'Solo' },
						{ id: 'off', label: 'Unsolo' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (a) => {
				const group = Number(a.options.group)
				const ch = resolveChannel(a.options as Record<string, unknown>, group)
				const cur = self.channels.get(`${group}.${ch}`)?.solo ?? false
				const mode = String(a.options.state)
				const desired = mode === 'on' ? true : mode === 'off' ? false : !cur
				self.applyChannelDelta(group, ch, { solo: desired })
				self.send('/Set/Solo', [intCh(group), intCh(ch), intCh(desired ? 1 : 0)])
			},
		},

		// ─── Channel faders ──────────────────────────────────────────
		outGain: {
			name: 'Channel: Set output fader (dB)',
			options: [
				...trackPicker,
				{ id: 'db', type: 'number', label: 'dB (−144 = mute, 0 = unity, +10 = max)', default: 0, min: -144, max: 10, step: 0.1 },
			],
			callback: async (a) => {
				const group = Number(a.options.group)
				const ch = resolveChannel(a.options as Record<string, unknown>, group)
				const db = Number(a.options.db)
				self.applyChannelDelta(group, ch, { gain: db })
				self.send('/Set/Track/Out/Gain', [intCh(group), intCh(ch), { type: 'd', value: db }])
			},
		},

		pan: {
			name: 'Channel: Pan',
			options: [
				...trackPicker,
				{ id: 'value', type: 'number', label: 'Pan (−1 = full L, +1 = full R)', default: 0, min: -1, max: 1, step: 0.05 },
			],
			callback: async (a) => {
				const group = Number(a.options.group)
				const ch = resolveChannel(a.options as Record<string, unknown>, group)
				const v = Number(a.options.value)
				self.applyChannelDelta(group, ch, { pan: v })
				self.send('/Set/Track/Pan', [intCh(group), intCh(ch), { type: 'd', value: v }])
			},
		},

		width: {
			name: 'Channel: Stereo width',
			options: [
				...trackPicker,
				{ id: 'value', type: 'number', label: 'Width (0 = mono, 1 = full stereo)', default: 1, min: 0, max: 1, step: 0.05 },
			],
			callback: async (a) => {
				const group = Number(a.options.group)
				const ch = resolveChannel(a.options as Record<string, unknown>, group)
				const v = Number(a.options.value)
				self.applyChannelDelta(group, ch, { width: v })
				self.send('/Set/Track/Pan/Width', [intCh(group), intCh(ch), { type: 'd', value: v }])
			},
		},

		// ─── Sends from inputs to auxes ──────────────────────────────
		sendOn: {
			name: 'Send: On / Off / Toggle',
			options: [
				...inputOpts,
				...auxDestOpts,
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					default: 'toggle',
					choices: [
						{ id: 'on', label: 'Send on' },
						{ id: 'off', label: 'Send off' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (a) => {
				const ch = Number(a.options.inputCh) - 1
				const aux = Number(a.options.aux) - 1
				const cur = self.sends.get(`0.${ch}.${aux}`)?.on ?? false
				const mode = String(a.options.state)
				const desired = mode === 'on' ? true : mode === 'off' ? false : !cur
				self.applySendDelta(0, ch, aux, { on: desired })
				self.send('/Set/Aux/Send/On', [intCh(0), intCh(ch), intCh(aux), { type: desired ? 'T' : 'F' }])
			},
		},

		sendGain: {
			name: 'Send: Set fader (dB)',
			options: [
				...inputOpts,
				...auxDestOpts,
				{ id: 'db', type: 'number', label: 'dB', default: -10, min: -144, max: 10, step: 0.1 },
			],
			callback: async (a) => {
				const ch = Number(a.options.inputCh) - 1
				const aux = Number(a.options.aux) - 1
				const db = Number(a.options.db)
				self.applySendDelta(0, ch, aux, { gain: db })
				self.send('/Set/Aux/Send/Gain', [intCh(0), intCh(ch), intCh(aux), { type: 'd', value: db }])
			},
		},

		fadeFader: {
			name: 'Fade: Smoothly ramp a fader to target dB',
			description: 'Linear ramp in dB over the chosen duration (~33 Hz update rate). Cancels any previous fade on the same target.',
			options: [
				{
					id: 'target',
					type: 'dropdown',
					label: 'What to fade',
					default: 'out',
					choices: [
						{ id: 'out',  label: 'Channel output fader' },
						{ id: 'send', label: 'Send fader (input channel → aux)' },
					],
				},
				// ───── Channel-output mode: Group + per-group Channel picker ─────
				{
					id: 'group', type: 'dropdown', label: 'Group',
					default: 0, choices: GROUP_CHOICES,
					isVisible: (opts: Record<string, unknown>) => opts.target === 'out',
				},
				// Per-group channel dropdowns — visible only when target='out' AND group matches.
				...trackOpts.map((o) => ({
					...o,
					isVisible: (opts: Record<string, unknown>, data: { group: number }) =>
						opts.target === 'out' && Number(opts.group) === data.group,
				})),
				// ───── Send mode: Input ch + Aux ─────
				{
					id: 'inputCh', type: 'dropdown', label: 'Input channel',
					default: 1, choices: channelsFor(self, 0),
					isVisible: (opts: Record<string, unknown>) => opts.target === 'send',
				},
				{
					id: 'aux', type: 'dropdown', label: 'Aux destination',
					default: 1, choices: channelsFor(self, 2),
					isVisible: (opts: Record<string, unknown>) => opts.target === 'send',
				},
				// ───── Common ─────
				{ id: 'db',       type: 'number', label: 'Target dB',     default: 0,    min: -144, max: 10,    step: 0.1 },
				{ id: 'duration', type: 'number', label: 'Duration (ms)', default: 1000, min: 0,    max: 60000, step: 100 },
			],
			callback: async (a) => {
				const target = String(a.options.target)
				const targetDb = Number(a.options.db)
				const durationMs = Number(a.options.duration)
				if (target === 'out') {
					const group = Number(a.options.group)
					const ch = resolveChannel(a.options as Record<string, unknown>, group)
					const currentDb = self.channels.get(`${group}.${ch}`)?.gain ?? 0
					self.startFade(`out_${group}.${ch}`, currentDb, targetDb, durationMs, (db) => {
						self.applyChannelDelta(group, ch, { gain: db })
						self.send('/Set/Track/Out/Gain', [intCh(group), intCh(ch), { type: 'd', value: db }])
					})
				} else {
					const ch = Number(a.options.inputCh) - 1
					const aux = Number(a.options.aux) - 1
					const currentDb = self.sends.get(`0.${ch}.${aux}`)?.gain ?? -144
					self.startFade(`send_0.${ch}.${aux}`, currentDb, targetDb, durationMs, (db) => {
						self.applySendDelta(0, ch, aux, { gain: db })
						self.send('/Set/Aux/Send/Gain', [intCh(0), intCh(ch), intCh(aux), { type: 'd', value: db }])
					})
				}
			},
		},

		sendPan: {
			name: 'Send: Pan',
			options: [
				...inputOpts,
				...auxDestOpts,
				{ id: 'value', type: 'number', label: 'Pan (−1..+1)', default: 0, min: -1, max: 1, step: 0.05 },
			],
			callback: async (a) => {
				const ch = Number(a.options.inputCh) - 1
				const aux = Number(a.options.aux) - 1
				const v = Number(a.options.value)
				self.send('/Set/Aux/Send/Pan', [intCh(0), intCh(ch), intCh(aux), { type: 'd', value: v }])
			},
		},

		flipSendsViaUserKey: {
			name: 'Flip Sends: Trigger (via User Key)',
			description:
				'Presses a User Key configured on the LV1 with the "Flip Sends" function. ' +
				'You must first assign a User Key on the LV1 to "Flip Sends: MX1: Mon X" (or similar). ' +
				'This is the ONLY way to physically engage flip-to-sends on the LV1 surface via OSC.',
			options: [
				{
					id: 'userKey',
					type: 'dropdown',
					label: 'Flip Sends user key',
					default: -1,
					choices: (() => {
						const c: { id: number; label: string }[] = []
						for (const [idx, uk] of self.userKeys) {
							if (uk.assigned && uk.func.startsWith('Flip Sends')) {
								c.push({ id: idx, label: `UK ${idx + 1}: ${uk.func}` })
							}
						}
						if (c.length === 0) {
							c.push({ id: -1, label: '(no User Key with "Flip Sends" function found — configure on the LV1 first)' })
						}
						return c
					})(),
				},
			],
			callback: async (a) => {
				const k = Number(a.options.userKey)
				if (!Number.isFinite(k) || k < 0) {
					self.log('warn', 'flipSendsViaUserKey: no valid User Key selected')
					return
				}
				// Momentary press: T then F in the same ms (matches iPad MyFOH pattern)
				self.send('/Set/UserKey', [intCh(k), { type: 'T' }])
				self.send('/Set/UserKey', [intCh(k), { type: 'F' }])
			},
		},

		spillButton: {
			name: 'Spill: Press a Spill button (expand group/DCA on faders)',
			description:
				'Engages SPILL mode on the LV1 surface — expands a group or DCA so its members show on the channel faders. ' +
				'NOT the same as flip-to-sends. The bank/idx map to the LV1\'s Spill buttons on the master strip area.',
			options: [
				{ id: 'bank', type: 'number', label: 'Bank (0 = Mixer 1, 1 = Mixer 2)', default: 0, min: 0, max: 1 },
				{ id: 'idx', type: 'number', label: 'Slot (0-based)', default: 0, min: 0, max: 31 },
				{
					id: 'state', type: 'dropdown', label: 'State', default: 'toggle',
					choices: [
						{ id: 'on', label: 'Spill on' },
						{ id: 'off', label: 'Spill off' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (a) => {
				const bank = Number(a.options.bank)
				const idx = Number(a.options.idx)
				const cur = self.spillStates.get(`${bank}.${idx}`) ?? false
				const mode = String(a.options.state)
				const desired = mode === 'on' ? true : mode === 'off' ? false : !cur
				self.send('/Set/SpillButton', [intCh(bank), intCh(idx), intCh(desired ? 1 : 0)])
				// Optimistic update
				self.spillStates.set(`${bank}.${idx}`, desired)
				self.checkFeedbacks('spillActive')
			},
		},

		clearAllSolo: {
			name: 'Solo: Clear All',
			description: 'Sends /ClearAllSolo — clears solo on every channel, aux and group. Equivalent to the CLR SOLO button on the LV1 surface.',
			options: [],
			callback: async () => {
				self.send('/ClearAllSolo', [])
				self.applyClearAllSolo()
			},
		},

		auxSelect: {
			name: 'Aux: Focus (MyMon view)',
			options: [
				{
					id: 'aux', type: 'dropdown', label: 'Aux to focus (0 = none)',
					default: 0, choices: [{ id: 0, label: 'None' }, ...channelsFor(self, 2)],
				},
			],
			callback: async (a) => {
				const aux = Number(a.options.aux)
				const wire = aux === 0 ? -1 : aux - 1
				self.send('/Set/AuxId', [intCh(wire)])
			},
		},

		// ─── Mute groups + user keys + scenes ───────────────────────
		muteGroup: {
			name: 'Mute Group: On / Off / Toggle',
			options: [
				{ id: 'group', type: 'number', label: 'Mute Group (1-8)', default: 1, min: 1, max: 8 },
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					default: 'toggle',
					choices: [
						{ id: 'on', label: 'Mute (on)' },
						{ id: 'off', label: 'Unmute (off)' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (a) => {
				const grp = Number(a.options.group) - 1
				const cur = self.muteGroups.get(grp) ?? false
				const mode = String(a.options.state)
				const desired = mode === 'on' ? true : mode === 'off' ? false : !cur
				self.applyMuteGroup(grp, desired)
				self.send('/Set/MuteGroup', [intCh(grp), { type: desired ? 'T' : 'F' }])
			},
		},

		userKey: {
			name: 'User Key: Press (momentary) or Hold',
			options: [
				{ id: 'key', type: 'number', label: 'User Key (1-16)', default: 1, min: 1, max: 16 },
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'momentary',
					choices: [
						{ id: 'momentary', label: 'Momentary press (down + up)' },
						{ id: 'on', label: 'Force ON' },
						{ id: 'off', label: 'Force OFF' },
					],
				},
			],
			callback: async (a) => {
				const k = Number(a.options.key) - 1
				const mode = String(a.options.mode)
				if (mode === 'momentary') {
					self.send('/Set/UserKey', [intCh(k), { type: 'T' }])
					self.send('/Set/UserKey', [intCh(k), { type: 'F' }])
				} else {
					self.send('/Set/UserKey', [intCh(k), { type: mode === 'on' ? 'T' : 'F' }])
				}
			},
		},

		sceneRecall: {
			name: 'Scene: Recall by index',
			options: [{ id: 'scene', type: 'number', label: 'Scene index (0-based)', default: 0, min: 0, max: 999 }],
			callback: async (a) => {
				self.send('/Set/CurSceneIndex', [intCh(Number(a.options.scene))])
			},
		},

		sceneRecallByName: {
			name: 'Scene: Recall (pick from list)',
			description: 'Dropdown of all scenes the LV1 has reported via /Notify/SceneList. Reflects renames live.',
			options: [
				{
					id: 'scene',
					type: 'dropdown',
					label: 'Scene',
					default: 0,
					choices: self.scenes.size > 0
						? [...self.scenes.entries()]
							.sort(([a], [b]) => a - b)
							.map(([idx, name]) => ({ id: idx, label: `${idx + 1} — ${name}` }))
						: [{ id: 0, label: '(no scenes detected yet — connect and wait for /Notify/SceneList)' }],
				},
			],
			callback: async (a) => {
				self.send('/Set/CurSceneIndex', [intCh(Number(a.options.scene))])
			},
		},

		sceneNext: {
			name: 'Scene: Next',
			description: 'Recall the scene one index higher than the current. Wraps to first if at the end.',
			options: [],
			callback: async () => {
				const cur = self.currentScene ?? -1
				const total = self.scenes.size
				if (total === 0) return
				const next = (cur + 1) % total
				self.send('/Set/CurSceneIndex', [intCh(next)])
			},
		},

		scenePrev: {
			name: 'Scene: Previous',
			description: 'Recall the scene one index lower than the current. Wraps to last if at the start.',
			options: [],
			callback: async () => {
				const cur = self.currentScene ?? 0
				const total = self.scenes.size
				if (total === 0) return
				const prev = (cur - 1 + total) % total
				self.send('/Set/CurSceneIndex', [intCh(prev)])
			},
		},

		tapTempo: {
			name: 'Tap Tempo',
			options: [],
			callback: async () => {
				self.send('/TapTempo', [intCh(1)])
				self.send('/TapTempo', [intCh(0)])
			},
		},

		// ─── Preamp + plugin enables (input channels only) ───────────
		inGain: {
			name: 'Preamp: Set input gain (dB)',
			options: [
				...inputOpts,
				{ id: 'db', type: 'number', label: 'dB', default: 20, min: -10, max: 60, step: 0.1 },
			],
			callback: async (a) => {
				const ch = Number(a.options.inputCh) - 1
				const db = Number(a.options.db)
				self.send('/SetTrackInGain', [intCh(0), intCh(ch), intCh(0), { type: 'f', value: db }])
			},
		},

		trim: {
			name: 'Channel: Digital trim (dB)',
			options: [
				...trackPicker,
				{ id: 'db', type: 'number', label: 'dB', default: 0, min: -20, max: 20, step: 0.1 },
			],
			callback: async (a) => {
				const group = Number(a.options.group)
				const ch = resolveChannel(a.options as Record<string, unknown>, group)
				const db = Number(a.options.db)
				self.send('/SetTrackTrim', [intCh(group), intCh(ch), intCh(0), { type: 'f', value: db }])
			},
		},

		phantom: {
			name: 'Channel: +48 V on/off',
			options: [
				...inputOpts,
				{ id: 'state', type: 'dropdown', label: 'State', default: 'on', choices: [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }] },
			],
			callback: async (a) => {
				const ch = Number(a.options.inputCh) - 1
				const on = a.options.state === 'on' ? 1 : 0
				self.send('/SetTrackPhantomState', [intCh(0), intCh(ch), intCh(0), intCh(on)])
			},
		},

		polarity: {
			name: 'Channel: Polarity (phase) on/off',
			options: [
				...inputOpts,
				{ id: 'state', type: 'dropdown', label: 'State', default: 'on', choices: [{ id: 'on', label: 'Inverted' }, { id: 'off', label: 'Normal' }] },
			],
			callback: async (a) => {
				const ch = Number(a.options.inputCh) - 1
				const on = a.options.state === 'on' ? 1 : 0
				self.send('/SetTrackPhaseState', [intCh(0), intCh(ch), intCh(0), intCh(on)])
			},
		},

		pluginEnable: {
			name: 'Plugin section: Enable / Disable',
			options: [
				{
					id: 'which',
					type: 'dropdown',
					label: 'Section',
					default: 'eq',
					choices: [
						{ id: 'eq', label: 'EQ' },
						{ id: 'filter', label: 'Filter' },
						{ id: 'comp', label: 'Compressor' },
						{ id: 'deesser', label: 'De-Esser' },
						{ id: 'dyn', label: 'Dynamics' },
						{ id: 'gate', label: 'Gate' },
						{ id: 'leveler', label: 'Leveler' },
						{ id: 'limiter', label: 'Limiter' },
					],
				},
				...trackPicker,
				{ id: 'state', type: 'dropdown', label: 'State', default: 'on', choices: [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }] },
			],
			callback: async (a) => {
				const group = Number(a.options.group)
				const ch = resolveChannel(a.options as Record<string, unknown>, group)
				const on = a.options.state === 'on' ? 1 : 0
				const addrMap: Record<string, string> = {
					eq: '/SetEQState',
					filter: '/SetFilterState',
					comp: '/SetCompressorState',
					deesser: '/SetDeEsserState',
					dyn: '/SetDynamicsState',
					gate: '/SetGateState',
					leveler: '/SetLevelerState',
					limiter: '/SetLimiterState',
				}
				const addr = addrMap[String(a.options.which)]
				if (!addr) return
				self.send(addr, [intCh(group), intCh(ch), intCh(on)])
			},
		},

		// ─── EQ band ─────────────────────────────────────────────────
		eqBand: {
			name: 'EQ: Set band (Freq / Gain / Q)',
			options: [
				...trackPicker,
				{ id: 'band', type: 'number', label: 'Band (1-based)', default: 1, min: 1, max: 6 },
				{
					id: 'param',
					type: 'dropdown',
					label: 'Parameter',
					default: 'gain',
					choices: [
						{ id: 'freq', label: 'Frequency (Hz)' },
						{ id: 'gain', label: 'Gain (dB)' },
						{ id: 'q', label: 'Q' },
					],
				},
				{ id: 'value', type: 'number', label: 'Value', default: 0, min: -100, max: 22000, step: 0.1 },
			],
			callback: async (a) => {
				const group = Number(a.options.group)
				const ch = resolveChannel(a.options as Record<string, unknown>, group)
				const band = Number(a.options.band)
				const v = Number(a.options.value)
				const addrMap: Record<string, string> = {
					freq: '/Set/EQ/Band/Freq',
					gain: '/Set/EQ/Band/Gain',
					q: '/Set/EQ/Band/Q',
				}
				const addr = addrMap[String(a.options.param)]
				if (!addr) return
				self.send(addr, [intCh(group), intCh(ch), intCh(band), { type: 'd', value: v }])
			},
		},

		// ─── Misc / utilities ────────────────────────────────────────
		rename: {
			name: 'Channel: Rename',
			options: [
				...trackPicker,
				{ id: 'name', type: 'textinput', label: 'New name', default: '' },
			],
			callback: async (a) => {
				const group = Number(a.options.group)
				const ch = resolveChannel(a.options as Record<string, unknown>, group)
				const name = String(a.options.name || '')
				if (!name) return
				self.send('/Set/TrackName', [intCh(group), intCh(ch), { type: 's', value: name }])
				// Optimistic — our own /Set isn't echoed back, so update local state too.
				self.applyChannelDelta(group, ch, { name })
			},
		},

		refreshState: {
			name: 'State: Re-request layers + aux tracks',
			description: 'Asks the LV1 to re-broadcast layer + aux info (useful after a module restart).',
			options: [],
			callback: async () => {
				self.requestStateRefresh()
			},
		},

		scanForLv1: {
			name: 'Discovery: Scan for LV1s on the LAN',
			description:
				'Triggers a zDNS multicast discovery. After it finishes, reopen the module config dialog to see the updated dropdown of detected LV1s.',
			options: [],
			callback: async () => {
				self.log('info', 'Scanning for LV1s on the LAN…')
				const results = await refreshDiscovery(5000)
				if (results.length === 0) {
					self.log('warn', 'No LV1s found. Make sure the LV1 server is running and on the same broadcast domain.')
				} else {
					const cache = getDiscoveryCache()
					self.log(
						'info',
						`Found ${results.length} LV1${results.length > 1 ? 's' : ''} ${cache.ageMs >= 0 ? `(cached ${Math.round(cache.ageMs / 1000)} s ago)` : ''}:`,
					)
					for (const e of results) {
						self.log('info', `  • ${e.host ?? 'unknown'} — ${e.addresses[0] ?? '?'}:${e.port ?? '?'}`)
					}
				}
			},
		},

		rawOsc: {
			name: 'Raw: Send any OSC address',
			options: [
				{ id: 'address', type: 'textinput', label: 'OSC address (e.g. /Set/Track/Out/Mute)', default: '' },
				{
					id: 'args',
					type: 'textinput',
					label: 'Args (whitespace-separated, prefix with type — e.g. "i:0 i:1 T")',
					default: '',
				},
			],
			callback: async (a) => {
				const addr = String(a.options.address || '')
				if (!addr.startsWith('/')) return
				const tokens = String(a.options.args || '').trim().split(/\s+/).filter(Boolean)
				const parsed: OscArg[] = []
				for (const tok of tokens) {
					const m = /^([ifsdhTFNI]):?(.*)$/.exec(tok)
					if (!m) continue
					const t = m[1] as OscArg['type']
					const v = m[2]
					if (t === 'i') parsed.push({ type: 'i', value: parseInt(v, 10) })
					else if (t === 'f') parsed.push({ type: 'f', value: parseFloat(v) })
					else if (t === 'd') parsed.push({ type: 'd', value: parseFloat(v) })
					else if (t === 's') parsed.push({ type: 's', value: v })
					else if (t === 'T') parsed.push({ type: 'T' })
					else if (t === 'F') parsed.push({ type: 'F' })
				}
				self.send(addr, parsed)
			},
		},
	}

	self.setActionDefinitions(actions)
}
