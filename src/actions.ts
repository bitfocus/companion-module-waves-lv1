// Every action below uses an OSC signature confirmed live against the real LV1.
// Reference: c:\Users\migue\.claude\projects\c--www-myfoh\memory\lv1_confirmed_command_signatures.md
//
// Wire convention: ALL group/channel/aux indices are 0-based on the wire.
// The UI uses a Group dropdown + a per-group Channel dropdown (filtered via isVisible)
// so LR/C/M only show one entry, Auxes show real names, etc.
//
// Every dropdown that accepts a Group / Channel / Aux / State exposes a
// "✎ Custom (expression)…" entry that reveals a paired textinput with
// Companion variable support — see helpers in tracks.ts.

import {
	CompanionActionDefinitions,
	CompanionInputFieldDropdown,
	CompanionInputFieldTextInput,
} from '@companion-module/base'
import type { LV1Instance } from './main.js'
import type { OscArg } from './osc.js'
import { refreshDiscovery, getDiscoveryCache } from './discovery-cache.js'
import {
	channelsFor,
	buildTrackPicker,
	buildExprDropdown,
	buildStateField,
	buildNumberExprField,
	resolveTrackAsync,
	resolveIndexAsync,
	resolveNumberAsync,
	resolveStateAsync,
	CUSTOM_EXPR,
} from './tracks.js'

type AnyOpt = CompanionInputFieldDropdown | CompanionInputFieldTextInput

function intCh(n: number): OscArg {
	return { type: 'i', value: n }
}

export function UpdateActions(self: LV1Instance): void {
	const trackPicker: AnyOpt[] = buildTrackPicker(self, 'ch')
	const inputOpts: AnyOpt[] = buildExprDropdown(
		'inputCh',
		'Input channel',
		channelsFor(self, 0),
		'1-based input channel index.',
	)
	const auxDestOpts: AnyOpt[] = buildExprDropdown(
		'aux',
		'Aux destination',
		channelsFor(self, 2),
		'1-based aux/FX destination index.',
	)

	const muteState = buildStateField(
		'state',
		[
			{ id: 'on', label: 'Mute' },
			{ id: 'off', label: 'Unmute' },
			{ id: 'toggle', label: 'Toggle' },
		],
		'toggle',
	)
	const soloState = buildStateField(
		'state',
		[
			{ id: 'on', label: 'Solo' },
			{ id: 'off', label: 'Unsolo' },
			{ id: 'toggle', label: 'Toggle' },
		],
		'toggle',
	)
	const sendState = buildStateField(
		'state',
		[
			{ id: 'on', label: 'Send on' },
			{ id: 'off', label: 'Send off' },
			{ id: 'toggle', label: 'Toggle' },
		],
		'toggle',
	)
	const spillState = buildStateField(
		'state',
		[
			{ id: 'on', label: 'Spill on' },
			{ id: 'off', label: 'Spill off' },
			{ id: 'toggle', label: 'Toggle' },
		],
		'toggle',
	)
	const tbState = buildStateField(
		'state',
		[
			{ id: 'on', label: 'On (engage TB to this output)' },
			{ id: 'off', label: 'Off (cut TB to this output)' },
			{ id: 'toggle', label: 'Toggle' },
		],
		'toggle',
	)
	const muteGroupState = buildStateField(
		'state',
		[
			{ id: 'on', label: 'Mute (on)' },
			{ id: 'off', label: 'Unmute (off)' },
			{ id: 'toggle', label: 'Toggle' },
		],
		'toggle',
	)
	const onOffState = buildStateField(
		'state',
		[
			{ id: 'on', label: 'On' },
			{ id: 'off', label: 'Off' },
		],
		'on',
	)
	const phaseState = buildStateField(
		'state',
		[
			{ id: 'on', label: 'Inverted' },
			{ id: 'off', label: 'Normal' },
		],
		'on',
	)

	const dbField = (id = 'db', label = 'dB', def = 0) =>
		buildNumberExprField(id, label, def, 'dB value: −144..+10 (−144 = mute, 0 = unity). Variables OK.')
	const panField = (id = 'value', label = 'Pan (−1 = full L, +1 = full R)', def = 0) =>
		buildNumberExprField(id, label, def, 'Pan value −1..+1. Variables OK.')
	const widthField = (id = 'value', label = 'Width (0 = mono, 1 = full stereo)', def = 1) =>
		buildNumberExprField(id, label, def, 'Width value 0..1. Variables OK.')
	const msField = (id = 'duration', label = 'Duration (ms)', def = 1000) =>
		buildNumberExprField(id, label, def, 'Duration in milliseconds. Variables OK.')

	const actions: CompanionActionDefinitions = {
		// ─── Mute / Solo ──────────────────────────────────────────────
		mute: {
			name: 'Channel: Mute / Unmute / Toggle',
			options: [...trackPicker, ...muteState],
			callback: async (a, context) => {
				const { group, ch } = await resolveTrackAsync(a.options, context)
				const cur = self.channels.get(`${group}.${ch}`)?.muted ?? false
				const mode = await resolveStateAsync(a.options, 'state', context, 'toggle')
				const desired = mode === 'on' ? true : mode === 'off' ? false : !cur
				self.log('debug', `mute g=${group} ch=${ch} mode=${mode} cur=${cur} → ${desired}`)
				// Optimistic first so a rapid double-press inverts the new state, not the old one.
				self.applyChannelDelta(group, ch, { muted: desired })
				self.send('/Set/Track/Out/Mute', [intCh(group), intCh(ch), { type: desired ? 'T' : 'F' }])
			},
		},

		solo: {
			name: 'Channel: Solo / Unsolo / Toggle',
			options: [...trackPicker, ...soloState],
			callback: async (a, context) => {
				const { group, ch } = await resolveTrackAsync(a.options, context)
				const cur = self.channels.get(`${group}.${ch}`)?.solo ?? false
				const mode = await resolveStateAsync(a.options, 'state', context, 'toggle')
				const desired = mode === 'on' ? true : mode === 'off' ? false : !cur
				self.applyChannelDelta(group, ch, { solo: desired })
				self.send('/Set/Solo', [intCh(group), intCh(ch), intCh(desired ? 1 : 0)])
			},
		},

		// ─── Channel faders ──────────────────────────────────────────
		outGain: {
			name: 'Channel: Set output fader (dB)',
			options: [...trackPicker, dbField('db', 'dB (−144 = mute, 0 = unity, +10 = max)', 0)],
			callback: async (a, context) => {
				const { group, ch } = await resolveTrackAsync(a.options, context)
				const db = await resolveNumberAsync(a.options, 'db', context, 0)
				self.applyChannelDelta(group, ch, { gain: db })
				self.send('/Set/Track/Out/Gain', [intCh(group), intCh(ch), { type: 'd', value: db }])
			},
		},

		pan: {
			name: 'Channel: Pan',
			options: [...trackPicker, panField()],
			callback: async (a, context) => {
				const { group, ch } = await resolveTrackAsync(a.options, context)
				const v = await resolveNumberAsync(a.options, 'value', context, 0)
				self.applyChannelDelta(group, ch, { pan: v })
				self.send('/Set/Track/Pan', [intCh(group), intCh(ch), { type: 'd', value: v }])
			},
		},

		width: {
			name: 'Channel: Stereo width',
			options: [...trackPicker, widthField()],
			callback: async (a, context) => {
				const { group, ch } = await resolveTrackAsync(a.options, context)
				const v = await resolveNumberAsync(a.options, 'value', context, 1)
				self.applyChannelDelta(group, ch, { width: v })
				self.send('/Set/Track/Pan/Width', [intCh(group), intCh(ch), { type: 'd', value: v }])
			},
		},

		// ─── Sends from inputs to auxes ──────────────────────────────
		sendOn: {
			name: 'Send: On / Off / Toggle',
			options: [...inputOpts, ...auxDestOpts, ...sendState],
			callback: async (a, context) => {
				const ch = await resolveIndexAsync(a.options, 'inputCh', context, 0)
				const aux = await resolveIndexAsync(a.options, 'aux', context, 0)
				const cur = self.sends.get(`0.${ch}.${aux}`)?.on ?? false
				const mode = await resolveStateAsync(a.options, 'state', context, 'toggle')
				const desired = mode === 'on' ? true : mode === 'off' ? false : !cur
				self.applySendDelta(0, ch, aux, { on: desired })
				self.send('/Set/Aux/Send/On', [intCh(0), intCh(ch), intCh(aux), { type: desired ? 'T' : 'F' }])
			},
		},

		sendGain: {
			name: 'Send: Set fader (dB)',
			options: [...inputOpts, ...auxDestOpts, dbField('db', 'dB', -10)],
			callback: async (a, context) => {
				const ch = await resolveIndexAsync(a.options, 'inputCh', context, 0)
				const aux = await resolveIndexAsync(a.options, 'aux', context, 0)
				const db = await resolveNumberAsync(a.options, 'db', context, -10)
				self.applySendDelta(0, ch, aux, { gain: db })
				self.send('/Set/Aux/Send/Gain', [intCh(0), intCh(ch), intCh(aux), { type: 'd', value: db }])
			},
		},

		fadeFader: {
			name: 'Fade: Smoothly ramp a fader to target dB',
			description: 'Ramps a fader to a target dB over the given duration.',
			options: [
				{
					id: 'target',
					type: 'dropdown',
					label: 'What to fade',
					default: 'out',
					choices: [
						{ id: 'out', label: 'Channel output fader' },
						{ id: 'send', label: 'Send fader (input channel → aux)' },
					],
				},
				// ───── Channel-output mode: Group + per-group Channel picker ─────
				...trackPicker.map((o) => {
					const prevVis = (o as CompanionInputFieldDropdown).isVisible as
						| ((opts: Record<string, unknown>, data: unknown) => boolean)
						| undefined
					const prevData = (o as CompanionInputFieldDropdown).isVisibleData as unknown
					if (prevVis) {
						return {
							...o,
							isVisible: (opts: Record<string, unknown>, data: { inner: unknown }) =>
								opts.target === 'out' && prevVis(opts, data.inner),
							isVisibleData: { inner: prevData },
						}
					}
					return {
						...o,
						isVisible: (opts: Record<string, unknown>) => opts.target === 'out',
					}
				}),
				// ───── Send mode: Input ch + Aux ─────
				...inputOpts.map((o) => {
					const prevVis = (o as CompanionInputFieldDropdown).isVisible as
						| ((opts: Record<string, unknown>, data: unknown) => boolean)
						| undefined
					const prevData = (o as CompanionInputFieldDropdown).isVisibleData as unknown
					if (prevVis) {
						return {
							...o,
							isVisible: (opts: Record<string, unknown>, data: { inner: unknown }) =>
								opts.target === 'send' && prevVis(opts, data.inner),
							isVisibleData: { inner: prevData },
						}
					}
					return {
						...o,
						isVisible: (opts: Record<string, unknown>) => opts.target === 'send',
					}
				}),
				...auxDestOpts.map((o) => {
					const prevVis = (o as CompanionInputFieldDropdown).isVisible as
						| ((opts: Record<string, unknown>, data: unknown) => boolean)
						| undefined
					const prevData = (o as CompanionInputFieldDropdown).isVisibleData as unknown
					if (prevVis) {
						return {
							...o,
							isVisible: (opts: Record<string, unknown>, data: { inner: unknown }) =>
								opts.target === 'send' && prevVis(opts, data.inner),
							isVisibleData: { inner: prevData },
						}
					}
					return {
						...o,
						isVisible: (opts: Record<string, unknown>) => opts.target === 'send',
					}
				}),
				// ───── Common ─────
				dbField('db', 'Target dB', 0),
				msField(),
			],
			callback: async (a, context) => {
				const target = String(a.options.target)
				const targetDb = await resolveNumberAsync(a.options, 'db', context, 0)
				const durationMs = await resolveNumberAsync(a.options, 'duration', context, 1000)
				if (target === 'out') {
					const { group, ch } = await resolveTrackAsync(a.options, context)
					const currentDb = self.channels.get(`${group}.${ch}`)?.gain ?? 0
					self.startFade(`out_${group}.${ch}`, currentDb, targetDb, durationMs, (db) => {
						self.applyChannelDelta(group, ch, { gain: db })
						self.send('/Set/Track/Out/Gain', [intCh(group), intCh(ch), { type: 'd', value: db }])
					})
				} else {
					const ch = await resolveIndexAsync(a.options, 'inputCh', context, 0)
					const aux = await resolveIndexAsync(a.options, 'aux', context, 0)
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
			options: [...inputOpts, ...auxDestOpts, panField('value', 'Pan (−1..+1)', 0)],
			callback: async (a, context) => {
				const ch = await resolveIndexAsync(a.options, 'inputCh', context, 0)
				const aux = await resolveIndexAsync(a.options, 'aux', context, 0)
				const v = await resolveNumberAsync(a.options, 'value', context, 0)
				self.send('/Set/Aux/Send/Pan', [intCh(0), intCh(ch), intCh(aux), { type: 'd', value: v }])
			},
		},

		flipSendsViaUserKey: {
			name: 'Flip Sends: Trigger (via User Key)',
			description: 'Triggers a User Key set to "Flip Sends" on the LV1.',
			options: [
				{
					id: 'userKey',
					type: 'dropdown',
					label: 'Flip Sends user key',
					default: -1,
					choices: (() => {
						const c: { id: number | string; label: string }[] = []
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
			description: 'Expands a group/DCA onto the channel faders.',
			options: [
				buildNumberExprField('bank', 'Bank (0 = Mixer 1, 1 = Mixer 2)', 0, '0 or 1. Variables OK.'),
				buildNumberExprField('idx', 'Slot (0-based)', 0, '0..31. Variables OK.'),
				...spillState,
			],
			callback: async (a, context) => {
				const bank = Math.round(await resolveNumberAsync(a.options, 'bank', context, 0))
				const idx = Math.round(await resolveNumberAsync(a.options, 'idx', context, 0))
				const cur = self.spillStates.get(`${bank}.${idx}`) ?? false
				const mode = await resolveStateAsync(a.options, 'state', context, 'toggle')
				const desired = mode === 'on' ? true : mode === 'off' ? false : !cur
				self.send('/Set/SpillButton', [intCh(bank), intCh(idx), intCh(desired ? 1 : 0)])
				// Optimistic update
				self.spillStates.set(`${bank}.${idx}`, desired)
				self.checkFeedbacks('spillActive')
			},
		},

		talkBackToOutput: {
			name: 'Talk Back: Engage to output',
			description: 'Sends TalkBack mic to the chosen output.',
			options: [...buildExprDropdown('aux', 'Output', channelsFor(self, 2), '1-based output/aux index.'), ...tbState],
			callback: async (a, context) => {
				const aux = await resolveIndexAsync(a.options, 'aux', context, 0)
				const mode = await resolveStateAsync(a.options, 'state', context, 'toggle')
				const wasActive = self.tbDestEnabled.get(aux) ?? false
				const engage = mode === 'on' ? true : mode === 'off' ? false : !wasActive
				const targetDb = engage ? 0 : -144
				self.applySendDelta(8, 0, aux, { on: engage, gain: targetDb })
				self.tbDestEnabled.set(aux, engage)
				self.checkFeedbacks('talkBackToOutput')
				self.send('/Set/Aux/Send/On', [intCh(8), intCh(0), intCh(aux), { type: engage ? 'T' : 'F' }])
				self.send('/Set/Aux/Send/Gain', [intCh(8), intCh(0), intCh(aux), { type: 'd', value: targetDb }])
			},
		},

		clearAllSolo: {
			name: 'Solo: Clear All',
			description: 'Clears solo on every channel.',
			options: [],
			callback: async () => {
				self.send('/ClearAllSolo', [])
				self.applyClearAllSolo()
			},
		},

		auxSelect: {
			name: 'Aux: Focus (MyMon view)',
			options: buildExprDropdown(
				'aux',
				'Aux to focus (0 = none)',
				[{ id: 0, label: 'None' }, ...channelsFor(self, 2)],
				'0 = none, else 1-based aux.',
				0,
			),
			callback: async (a, context) => {
				// Note: this dropdown is special — value 0 = "None" (wire=-1), value N = aux #N.
				const raw = a.options.aux
				let uiVal: number
				if (raw === CUSTOM_EXPR) {
					uiVal = await resolveNumberAsync(a.options, 'aux_expr', context, 0)
				} else {
					uiVal = Number(raw)
				}
				const wire = uiVal === 0 ? -1 : uiVal - 1
				self.send('/Set/AuxId', [intCh(wire)])
			},
		},

		// ─── Mute groups + user keys + scenes ───────────────────────
		muteGroup: {
			name: 'Mute Group: On / Off / Toggle',
			options: [buildNumberExprField('group', 'Mute Group (1-8)', 1, '1..8. Variables OK.'), ...muteGroupState],
			callback: async (a, context) => {
				const grp = Math.round(await resolveNumberAsync(a.options, 'group', context, 1)) - 1
				const cur = self.muteGroups.get(grp) ?? false
				const mode = await resolveStateAsync(a.options, 'state', context, 'toggle')
				const desired = mode === 'on' ? true : mode === 'off' ? false : !cur
				self.applyMuteGroup(grp, desired)
				self.send('/Set/MuteGroup', [intCh(grp), { type: desired ? 'T' : 'F' }])
			},
		},

		userKey: {
			name: 'User Key: Press (momentary) or Hold',
			options: [
				buildNumberExprField('key', 'User Key (1-16)', 1, '1..16. Variables OK.'),
				...buildStateField(
					'mode',
					[
						{ id: 'momentary', label: 'Momentary press (down + up)' },
						{ id: 'on', label: 'Force ON' },
						{ id: 'off', label: 'Force OFF' },
					],
					'momentary',
				),
			],
			callback: async (a, context) => {
				const k = Math.round(await resolveNumberAsync(a.options, 'key', context, 1)) - 1
				// resolveStateAsync only understands on/off/toggle; for 'momentary' we
				// need the raw dropdown value or the trimmed expression string.
				let mode: string
				if (a.options.mode === CUSTOM_EXPR) {
					mode = (await context.parseVariablesInString(String(a.options.mode_expr ?? ''))).trim().toLowerCase()
				} else {
					mode = String(a.options.mode)
				}
				if (mode === 'momentary' || mode === '' || mode === 'press' || mode === 'tap') {
					self.send('/Set/UserKey', [intCh(k), { type: 'T' }])
					self.send('/Set/UserKey', [intCh(k), { type: 'F' }])
				} else {
					const on = ['1', 'true', 'on'].includes(mode)
					self.send('/Set/UserKey', [intCh(k), { type: on ? 'T' : 'F' }])
				}
			},
		},

		sceneRecall: {
			name: 'Scene: Recall by index',
			options: [buildNumberExprField('scene', 'Scene index (0-based)', 0, '0..999. Variables OK.')],
			callback: async (a, context) => {
				const idx = Math.round(await resolveNumberAsync(a.options, 'scene', context, 0))
				self.send('/Set/CurSceneIndex', [intCh(idx)])
			},
		},

		sceneRecallByName: {
			name: 'Scene: Recall (pick from list)',
			description: 'Pick a scene from the list.',
			options: buildExprDropdown(
				'scene',
				'Scene',
				self.scenes.size > 0
					? [...self.scenes.entries()]
							.sort(([a], [b]) => a - b)
							.map(([idx, name]) => ({ id: idx, label: `${idx + 1} — ${name}` }))
					: [{ id: 0, label: '(no scenes detected yet — connect and wait for /Notify/SceneList)' }],
				'0-based scene index.',
				0,
			),
			callback: async (a, context) => {
				const raw = a.options.scene
				let idx: number
				if (raw === CUSTOM_EXPR) {
					idx = Math.round(await resolveNumberAsync(a.options, 'scene_expr', context, 0))
				} else {
					idx = Number(raw)
				}
				self.send('/Set/CurSceneIndex', [intCh(idx)])
			},
		},

		sceneNext: {
			name: 'Scene: Next',
			description: 'Next scene (wraps).',
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
			description: 'Previous scene (wraps).',
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
			options: [...inputOpts, dbField('db', 'dB', 20)],
			callback: async (a, context) => {
				const ch = await resolveIndexAsync(a.options, 'inputCh', context, 0)
				const db = await resolveNumberAsync(a.options, 'db', context, 20)
				self.send('/SetTrackInGain', [intCh(0), intCh(ch), intCh(0), { type: 'f', value: db }])
			},
		},

		trim: {
			name: 'Channel: Digital trim (dB)',
			options: [...trackPicker, dbField('db', 'dB', 0)],
			callback: async (a, context) => {
				const { group, ch } = await resolveTrackAsync(a.options, context)
				const db = await resolveNumberAsync(a.options, 'db', context, 0)
				self.send('/SetTrackTrim', [intCh(group), intCh(ch), intCh(0), { type: 'f', value: db }])
			},
		},

		phantom: {
			name: 'Channel: +48 V on/off',
			options: [...inputOpts, ...onOffState],
			callback: async (a, context) => {
				const ch = await resolveIndexAsync(a.options, 'inputCh', context, 0)
				const mode = await resolveStateAsync(a.options, 'state', context, 'on')
				const on = mode === 'on' ? 1 : 0
				self.send('/SetTrackPhantomState', [intCh(0), intCh(ch), intCh(0), intCh(on)])
			},
		},

		polarity: {
			name: 'Channel: Polarity (phase) on/off',
			options: [...inputOpts, ...phaseState],
			callback: async (a, context) => {
				const ch = await resolveIndexAsync(a.options, 'inputCh', context, 0)
				const mode = await resolveStateAsync(a.options, 'state', context, 'on')
				const on = mode === 'on' ? 1 : 0
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
				...onOffState,
			],
			callback: async (a, context) => {
				const { group, ch } = await resolveTrackAsync(a.options, context)
				const mode = await resolveStateAsync(a.options, 'state', context, 'on')
				const on = mode === 'on' ? 1 : 0
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
				buildNumberExprField('band', 'Band (1-based)', 1, '1..6. Variables OK.'),
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
				buildNumberExprField('value', 'Value', 0, 'Hz / dB / Q depending on Parameter. Variables OK.'),
			],
			callback: async (a, context) => {
				const { group, ch } = await resolveTrackAsync(a.options, context)
				const band = Math.round(await resolveNumberAsync(a.options, 'band', context, 1))
				const v = await resolveNumberAsync(a.options, 'value', context, 0)
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
			options: [...trackPicker, { id: 'name', type: 'textinput', label: 'New name', default: '', useVariables: true }],
			callback: async (a, context) => {
				const { group, ch } = await resolveTrackAsync(a.options, context)
				const nameRaw = String(a.options.name || '')
				const name = (await context.parseVariablesInString(nameRaw)).trim()
				if (!name) return
				self.send('/Set/TrackName', [intCh(group), intCh(ch), { type: 's', value: name }])
				// Optimistic — our own /Set isn't echoed back, so update local state too.
				self.applyChannelDelta(group, ch, { name })
			},
		},

		refreshState: {
			name: 'State: Re-request layers + aux tracks',
			description: 'Re-requests layer + aux info from the LV1.',
			options: [],
			callback: async () => {
				self.requestStateRefresh()
			},
		},

		scanForLv1: {
			name: 'Discovery: Scan for LV1s on the LAN',
			description: 'Scans the LAN for LV1s.',
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
				{
					id: 'address',
					type: 'textinput',
					label: 'OSC address (e.g. /Set/Track/Out/Mute)',
					default: '',
					useVariables: true,
				},
				{
					id: 'args',
					type: 'textinput',
					label: 'Args (whitespace-separated, prefix with type — e.g. "i:0 i:1 T")',
					default: '',
					useVariables: true,
				},
			],
			callback: async (a, context) => {
				const addr = (await context.parseVariablesInString(String(a.options.address || ''))).trim()
				if (!addr.startsWith('/')) return
				const argsStr = await context.parseVariablesInString(String(a.options.args || ''))
				const tokens = argsStr.trim().split(/\s+/).filter(Boolean)
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
