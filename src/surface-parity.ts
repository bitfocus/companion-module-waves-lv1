// Companion Surface: what the MyRemote mode offers and the driver did not cover yet, through the
// driver (the same controls eMotion's MyRemote server uses): pan / width / rotation, sends, Talk
// Back destinations, the input section (preamp gain, +48 V, trim, polarity), renaming, track
// colours, the scene list, MyRemote's own user keys, Spill, meter thresholds, the page shown.

import {
	type CompanionActionDefinition,
	type CompanionActionDefinitions,
	type CompanionFeedbackDefinitions,
	combineRgb,
} from '@companion-module/base'
import type { LV1Instance } from './main.js'
import { optionText } from './definitions.js'
import {
	LV1_PALETTE,
	ROUTE_DESTS,
	SURFACE_MIXERS,
	STRIP_TYPES,
	TALKBACK_TT,
	colorAddress,
	input,
	pan,
	send,
} from './surface-model.js'
import {
	type AnyOpt,
	auxField,
	buildNumberExprField,
	desiredState,
	fadeFields,
	onOffToggle,
	parseStrip,
	resolveFade,
	resolveNumberAsync,
	stripField,
} from './surface-ui.js'
import { controlKey } from './surface-client.js'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const BLUE = combineRgb(0, 120, 200)
const AMBER = combineRgb(200, 120, 0)
const RED = combineRgb(200, 0, 0)

/** Strips that send to auxes. */
const SEND_TYPES = [0, 1, 2]
/** eMotion's "Recall scene" shortcut function: its number is the scene's place in the list. */
const FN_RECALL_SCENE = 10

/** Pan section controls: what each one is, its range and its centre / default. */
const PAN_KINDS = {
	pan: { label: 'Pan / balance', addr: pan.pan, min: -100, max: 100, home: 0, unit: '' },
	width: { label: 'Stereo width', addr: pan.width, min: -1.4, max: 1.4, home: 1, unit: '' },
	rotate: { label: 'Stereo rotation', addr: pan.rotate, min: -45, max: 45, home: 0, unit: '°' },
} as const

function changeField(withHome: string): AnyOpt {
	return {
		type: 'dropdown',
		id: 'mode',
		label: 'Change',
		default: 'set',
		choices: [
			{ id: 'set', label: 'Set to' },
			{ id: 'inc', label: 'Increase by' },
			{ id: 'dec', label: 'Decrease by' },
			{ id: 'home', label: withHome },
		],
	}
}

const valueVisible = "$(options:mode) != 'home'"

/** set / inc / dec / home → the new value, clamped. */
function nextValue(mode: unknown, current: number | null, v: number, home: number, min: number, max: number): number {
	const cur = current ?? home
	const next = mode === 'inc' ? cur + v : mode === 'dec' ? cur - v : mode === 'home' ? home : v
	return Math.max(min, Math.min(max, next))
}

/** The leg(s) of an input channel an input action changes. */
function legField(): AnyOpt {
	return {
		type: 'dropdown',
		id: 'leg',
		label: 'On stereo channels',
		default: 'both',
		choices: [
			{ id: 'both', label: 'Left and right together' },
			{ id: '0', label: 'Left only' },
			{ id: '1', label: 'Right only' },
		],
	}
}

function legs(option: unknown): number[] {
	return option === '0' ? [0] : option === '1' ? [1] : [0, 1]
}

export function sceneChoices(self: LV1Instance): Array<{ id: string; label: string }> {
	const list = self.surfaceModel.sceneList
	if (!list.length) return [{ id: '0', label: 'Scene 1 (the desk has not sent its scene list yet)' }]
	return list.map((name, i) => ({ id: String(i), label: `${i + 1}. ${name || '(no name)'}` }))
}

function userKeyField(): AnyOpt {
	return buildNumberExprField(
		'key',
		'User key (1-16)',
		1,
		'MyRemote’s user keys, as set up in eMotion for MyRemote. Variables OK.',
	)
}

function hexToRgb(hex: string): number {
	const n = parseInt(hex.slice(1), 16)
	return combineRgb((n >> 16) & 255, (n >> 8) & 255, n & 255)
}

/** Readable text on a colour: black on light colours, white on dark ones. */
function textOn(hex: string): number {
	const n = parseInt(hex.slice(1), 16)
	const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
	return lum > 150 ? BLACK : WHITE
}

/** A track's colour as #rrggbb, or '' while unknown. */
export function trackColorHex(self: LV1Instance, tt: number, track: number): string {
	const v = self.surfaceValue(colorAddress(tt, track))
	if (v == null || v < 0) return ''
	return LV1_PALETTE[Math.round(v) % LV1_PALETTE.length] ?? ''
}

/** Route source strips (Patch > Internal). */
const ROUTE_SOURCES = [0, 1, 2, 25, 6]

/** Destination kind + index (1-based, Variables OK) or aux, as the MyRemote mode's route action. */
function routeFields(self: LV1Instance): AnyOpt[] {
	const many = ROUTE_DESTS.filter((d) => d.count > 1).map((d) => `$(options:dest) == '${d.id}'`)
	return [
		{
			type: 'dropdown',
			id: 'dest',
			label: 'Destination',
			default: 'grp',
			choices: ROUTE_DESTS.map((d) => ({ id: d.id, label: d.label })),
		},
		{
			...buildNumberExprField(
				'index',
				'Number (1 = first)',
				1,
				'Group / Matrix / Link / mute group number. Variables OK.',
			),
			isVisibleExpression: many.join(' || '),
		},
		{ ...auxField(self), isVisibleExpression: "$(options:dest) == 'aux'" },
	]
}

/** The destination a route action / feedback addresses: a send (aux) or an internal route. */
async function routeTarget(
	self: LV1Instance,
	options: Record<string, unknown>,
	context: Parameters<typeof resolveNumberAsync>[2] | null,
): Promise<{ aux: number; dstTt: number; dstTrack: number } | null> {
	const d = ROUTE_DESTS.find((x) => x.id === options.dest)
	if (!d) return null
	if (d.id === 'aux') {
		const to = parseStrip(options.aux)
		const aux = self.surfaceModel.auxIndex(to.tt, to.track)
		return aux < 0 ? null : { aux, dstTt: -1, dstTrack: -1 }
	}
	const n =
		d.count > 1
			? context
				? Math.round(await resolveNumberAsync(options, 'index', context, 1))
				: Number(options.index)
			: 1
	if (!Number.isFinite(n) || n < 1 || n > d.count) return null
	return { aux: -1, dstTt: d.tt, dstTrack: n - 1 }
}

export function parityActions(self: LV1Instance): CompanionActionDefinitions {
	const panAction = (kind: keyof typeof PAN_KINDS): CompanionActionDefinition => {
		const k = PAN_KINDS[kind]
		return {
			name: `Strip: ${k.label}`,
			description: `Set or step a strip’s ${k.label.toLowerCase()} (${k.min} to ${k.max}${k.unit}), optionally as a fade.`,
			options: [
				stripField(self, 'strip', 'Strip', STRIP_TYPES),
				changeField(kind === 'width' ? 'Back to normal (1.00)' : 'Centre'),
				{
					...buildNumberExprField('value', `Value (${k.min} to ${k.max})`, 0, 'Variables OK.'),
					isVisibleExpression: valueVisible,
				},
				...fadeFields(),
			],
			callback: async (a, context) => {
				const { tt, track } = parseStrip(a.options.strip)
				const addr = k.addr(tt, track)
				const v = await resolveNumberAsync(a.options, 'value', context, 0)
				const target = nextValue(a.options.mode, self.surfaceReal(addr), v, k.home, k.min, k.max)
				self.surfaceSetRealValue(addr, target, await resolveFade(a.options, context))
			},
		}
	}

	return {
		surfacePan: panAction('pan'),
		surfaceWidth: panAction('width'),
		surfaceRotate: panAction('rotate'),

		surfaceSendOn: {
			name: 'Send: On / Off',
			description: 'Switch a strip’s send to an FX / Monitor bus on or off.',
			options: [stripField(self, 'strip', 'From strip', SEND_TYPES), auxField(self), ...onOffToggle('On', 'Off')],
			callback: async (a, context) => {
				const from = parseStrip(a.options.strip)
				const to = parseStrip(a.options.aux)
				const aux = self.surfaceModel.auxIndex(to.tt, to.track)
				if (aux < 0) return
				const addr = send.on(from.tt, from.track, aux)
				self.surfaceSetBool(addr, await desiredState(a.options, context, self.surfaceBool(addr)))
			},
		},

		surfaceSendLevel: {
			name: 'Send: Level (dB)',
			description: 'Set or step a send’s level in dB, optionally as a fade.',
			options: [
				stripField(self, 'strip', 'From strip', SEND_TYPES),
				auxField(self),
				changeField('−∞'),
				{ ...buildNumberExprField('db', 'dB', 0, 'dB (−144 = −∞). Variables OK.'), isVisibleExpression: valueVisible },
				...fadeFields(),
			],
			callback: async (a, context) => {
				const from = parseStrip(a.options.strip)
				const to = parseStrip(a.options.aux)
				const aux = self.surfaceModel.auxIndex(to.tt, to.track)
				if (aux < 0) return
				const addr = send.level(from.tt, from.track, aux)
				const v = await resolveNumberAsync(a.options, 'db', context, 0)
				const target = nextValue(a.options.mode, self.surfaceReal(addr), v, -144, -144, 10)
				const fade = await resolveFade(a.options, context)
				// Fading up from −∞: start where the send starts to be audible.
				const cur = self.surfaceReal(addr)
				if (fade && cur != null && cur < -80) self.surfaceModel.real.set(controlKey(addr), -80)
				self.surfaceSetRealValue(addr, target, fade)
			},
		},

		surfaceSendPan: {
			name: 'Send: Pan',
			description: 'Set or step the pan of a send (−100 to 100), optionally as a fade.',
			options: [
				stripField(self, 'strip', 'From strip', SEND_TYPES),
				auxField(self),
				changeField('Centre'),
				{
					...buildNumberExprField('value', 'Pan (−100 to 100)', 0, 'Variables OK.'),
					isVisibleExpression: valueVisible,
				},
				...fadeFields(),
			],
			callback: async (a, context) => {
				const from = parseStrip(a.options.strip)
				const to = parseStrip(a.options.aux)
				const aux = self.surfaceModel.auxIndex(to.tt, to.track)
				if (aux < 0) return
				const addr = send.pan(from.tt, from.track, aux)
				const v = await resolveNumberAsync(a.options, 'value', context, 0)
				const target = nextValue(a.options.mode, self.surfaceReal(addr), v, 0, -100, 100)
				self.surfaceSetRealValue(addr, target, await resolveFade(a.options, context))
			},
		},

		surfaceTbAssign: {
			name: 'Talk Back: Engage to output',
			description:
				'Add or remove an FX / Monitor bus from the Talk Back destinations (the Talk Back send to that bus).',
			options: [auxField(self), ...onOffToggle('Engage', 'Release')],
			callback: async (a, context) => {
				const to = parseStrip(a.options.aux)
				const aux = self.surfaceModel.auxIndex(to.tt, to.track)
				if (aux < 0) return
				const addr = send.on(TALKBACK_TT, 0, aux)
				self.surfaceSetBool(addr, await desiredState(a.options, context, self.surfaceBool(addr)))
			},
		},

		surfaceInGain: {
			name: 'Input: Preamp gain (dB)',
			description: 'The preamp gain of an input channel, on the input bank (A / B) it uses.',
			options: [
				stripField(self, 'strip', 'Channel', [0]),
				changeField('0 dB'),
				{ ...buildNumberExprField('db', 'dB', 0, 'Variables OK.'), isVisibleExpression: valueVisible },
				legField(),
			],
			callback: async (a, context) => {
				const { track } = parseStrip(a.options.strip)
				const bank = self.surfaceInputBank(track)
				const v = await resolveNumberAsync(a.options, 'db', context, 0)
				for (const leg of legs(a.options.leg)) {
					const addr = input.gain(track, bank, leg)
					self.surfaceSetRealValue(addr, nextValue(a.options.mode, self.surfaceReal(addr), v, 0, -20, 80), null)
				}
			},
		},

		surfaceTrim: {
			name: 'Input: Digital trim (dB)',
			options: [
				stripField(self, 'strip', 'Channel', [0]),
				changeField('0 dB'),
				{ ...buildNumberExprField('db', 'dB', 0, 'Variables OK.'), isVisibleExpression: valueVisible },
				legField(),
			],
			callback: async (a, context) => {
				const { track } = parseStrip(a.options.strip)
				const v = await resolveNumberAsync(a.options, 'db', context, 0)
				for (const leg of legs(a.options.leg)) {
					const addr = input.trim(track, leg)
					self.surfaceSetRealValue(addr, nextValue(a.options.mode, self.surfaceReal(addr), v, 0, -60, 30), null)
				}
			},
		},

		surfacePhantom: {
			name: 'Input: +48 V',
			description: 'Phantom power of an input channel, on the input bank (A / B) it uses.',
			options: [stripField(self, 'strip', 'Channel', [0]), ...onOffToggle('On', 'Off'), legField()],
			callback: async (a, context) => {
				const { track } = parseStrip(a.options.strip)
				const bank = self.surfaceInputBank(track)
				const on = await desiredState(a.options, context, self.surfaceBool(input.phantom(track, bank, 0)))
				for (const leg of legs(a.options.leg)) self.surfaceSetBool(input.phantom(track, bank, leg), on)
			},
		},

		surfacePolarity: {
			name: 'Input: Polarity (phase)',
			options: [stripField(self, 'strip', 'Channel', [0]), ...onOffToggle('Inverted', 'Normal'), legField()],
			callback: async (a, context) => {
				const { track } = parseStrip(a.options.strip)
				const on = await desiredState(a.options, context, self.surfaceBool(input.polarity(track, 0)))
				for (const leg of legs(a.options.leg)) self.surfaceSetBool(input.polarity(track, leg), on)
			},
		},

		surfaceRename: {
			name: 'Strip: Rename',
			description: 'Give a strip a new name, as typed in eMotion. Variables OK.',
			options: [
				stripField(self, 'strip', 'Strip'),
				{ type: 'textinput', id: 'name', label: 'New name', default: '', useVariables: true },
			],
			callback: async (a) => {
				const { tt, track } = parseStrip(a.options.strip)
				const name = optionText(a.options.name).trim()
				self.surfaceRename(tt, track, name.slice(0, 127))
			},
		},

		surfaceSceneRecallList: {
			name: 'Scenes: Recall (pick from list)',
			description: 'Recall a scene of the session, picked by its name.',
			options: [{ type: 'dropdown', id: 'scene', label: 'Scene', default: '0', choices: sceneChoices(self) }],
			callback: async (a) => {
				const index = parseInt(optionText(a.options.scene), 10)
				if (Number.isFinite(index)) self.surfaceRunFunction(FN_RECALL_SCENE, index, -1, -1)
			},
		},

		surfaceMyRemoteKey: {
			name: 'User key: MyRemote’s user keys (1-16)',
			description:
				'Press MyRemote’s own user keys, as set up for MyRemote in eMotion (the keys the MyRemote mode pressed). ' +
				'Tap = press and release; Press / Release for hold functions (Talk…).',
			options: [
				userKeyField(),
				{
					type: 'dropdown',
					id: 'phase',
					label: 'Key',
					default: 'tap',
					choices: [
						{ id: 'tap', label: 'Tap (press + release)' },
						{ id: 'down', label: 'Press only' },
						{ id: 'up', label: 'Release only' },
					],
				},
			],
			callback: async (a, context) => {
				const k = Math.round(await resolveNumberAsync(a.options, 'key', context, 1)) - 1
				if (k < 0 || k > 15) return
				const phase = optionText(a.options.phase)
				self.surfaceMyRemoteUserKey(k, phase === 'down' || phase === 'up' ? phase : 'tap')
			},
		},

		surfaceRoute: {
			name: 'Strip: Internal route (Patch > Internal)',
			description:
				'Assign a strip to a group bus, Link (DCA), mute group, LR / Center / Mono or a matrix, like Patch > Internal. ' +
				'Aux destinations switch the send.',
			options: [
				stripField(self, 'strip', 'From strip', ROUTE_SOURCES),
				...routeFields(self),
				...onOffToggle('Assign', 'Remove'),
			],
			callback: async (a, context) => {
				const { tt, track } = parseStrip(a.options.strip)
				const t = await routeTarget(self, a.options, context)
				if (!t) return
				if (t.aux >= 0) {
					const addr = send.on(tt, track, t.aux)
					self.surfaceSetBool(addr, await desiredState(a.options, context, self.surfaceBool(addr)))
					return
				}
				const cur = self.surfaceRouted(tt, track, t.dstTt, t.dstTrack) ?? false
				self.surfaceSetRoute(tt, track, t.dstTt, t.dstTrack, await desiredState(a.options, context, cur))
			},
		},

		surfaceSpill: {
			name: 'Spill: Press the Spill button',
			description:
				'The Spill button of Mixer 1 or Mixer 2 (spill the selected group / Link to the faders), as MyRemote sends it.',
			options: [
				{
					type: 'dropdown',
					id: 'mixer',
					label: 'Mixer',
					default: 'm1',
					choices: SURFACE_MIXERS.filter((m) => m.id !== 'all').map((m) => ({ id: m.id, label: m.label })),
				},
			],
			callback: async (a) => {
				const view = SURFACE_MIXERS.find((m) => m.id === a.options.mixer)?.surface ?? 0
				self.surfaceSpill(view)
			},
		},

		surfaceMixLayer: {
			name: 'Mixer: INPUTS / MIX layers',
			description:
				'Show the INPUTS or the MIX layers of Mixer 1 or Mixer 2, like its INPUTS and MIX buttons (80-channel mode; the ' +
				'eMotion shortcut only toggles between them).',
			options: [
				{
					type: 'dropdown',
					id: 'mixer',
					label: 'Mixer',
					default: 'm1',
					choices: SURFACE_MIXERS.filter((m) => m.id !== 'all').map((m) => ({ id: m.id, label: m.label })),
				},
				{
					type: 'dropdown',
					id: 'layer',
					label: 'Layers',
					default: 'inputs',
					choices: [
						{ id: 'inputs', label: 'INPUTS' },
						{ id: 'mix', label: 'MIX' },
					],
				},
			],
			callback: async (a) => {
				const view = SURFACE_MIXERS.find((m) => m.id === a.options.mixer)?.surface ?? 0
				self.surfaceSetMixLayer(view, a.options.layer === 'mix')
			},
		},

		surfaceModePreset: {
			name: 'Mixer: Mode preset (recall)',
			description:
				'Recall one of the 8 Modes presets of Mixer 1 or Mixer 2 (Home, Setup, SndChk…, with the names of the session), ' +
				'as a click in that mixer’s Modes panel.',
			options: [
				{
					type: 'dropdown',
					id: 'mixer',
					label: 'Mixer',
					default: 'm1',
					choices: SURFACE_MIXERS.filter((m) => m.id !== 'all').map((m) => ({ id: m.id, label: m.label })),
				},
				modePresetField(self),
			],
			callback: async (a) => {
				const view = SURFACE_MIXERS.find((m) => m.id === a.options.mixer)?.surface ?? 0
				const preset = parseInt(optionText(a.options.preset), 10)
				if (preset >= 1 && preset <= 8) self.surfaceRecallModePreset(view, preset)
			},
		},
	}
}

/** Modes presets 1-8 with the session's names. */
function modePresetField(self: LV1Instance): AnyOpt {
	return {
		type: 'dropdown',
		id: 'preset',
		label: 'Mode preset',
		default: '1',
		choices: self.surfaceModel.modeNames.map((name, i) => ({ id: String(i + 1), label: `${i + 1}. ${name}` })),
	}
}

export function parityFeedbacks(self: LV1Instance): CompanionFeedbackDefinitions {
	const auxOf = (v: unknown) => {
		const to = parseStrip(v)
		return self.surfaceModel.auxIndex(to.tt, to.track)
	}
	return {
		surfaceSendOn: {
			type: 'boolean',
			name: 'Send: Is on',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [stripField(self, 'strip', 'From strip', SEND_TYPES), auxField(self)],
			callback: (fb) => {
				const from = parseStrip(fb.options.strip)
				const aux = auxOf(fb.options.aux)
				return aux >= 0 && self.surfaceBool(send.on(from.tt, from.track, aux))
			},
		},
		surfaceRouted: {
			type: 'boolean',
			name: 'Strip: Internally routed to destination',
			description: 'True while the strip is assigned to that destination (Patch > Internal); aux = the send is on.',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [
				stripField(self, 'strip', 'From strip', ROUTE_SOURCES),
				...routeFields(self).map((f) =>
					f.id === 'index'
						? {
								type: 'number' as const,
								id: 'index',
								label: 'Number (1 = first)',
								default: 1,
								min: 1,
								max: 16,
								isVisibleExpression: f.isVisibleExpression,
							}
						: f,
				),
			],
			callback: async (fb) => {
				const { tt, track } = parseStrip(fb.options.strip)
				const t = await routeTarget(self, fb.options, null)
				if (!t) return false
				if (t.aux >= 0) return self.surfaceBool(send.on(tt, track, t.aux))
				return !!self.surfaceRouted(tt, track, t.dstTt, t.dstTrack)
			},
		},
		surfaceTbAssigned: {
			type: 'boolean',
			name: 'Talk Back: Engaged to output',
			defaultStyle: { bgcolor: AMBER, color: WHITE },
			options: [auxField(self)],
			callback: (fb) => {
				const aux = auxOf(fb.options.aux)
				return aux >= 0 && self.surfaceBool(send.on(TALKBACK_TT, 0, aux))
			},
		},
		surfacePhantom: {
			type: 'boolean',
			name: 'Input: +48 V is on',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [stripField(self, 'strip', 'Channel', [0])],
			callback: (fb) => {
				const { track } = parseStrip(fb.options.strip)
				return self.surfaceBool(input.phantom(track, self.surfaceInputBank(track), 0))
			},
		},
		surfacePolarity: {
			type: 'boolean',
			name: 'Input: Polarity is inverted',
			defaultStyle: { bgcolor: AMBER, color: WHITE },
			options: [stripField(self, 'strip', 'Channel', [0])],
			callback: (fb) => {
				const { track } = parseStrip(fb.options.strip)
				return self.surfaceBool(input.polarity(track, 0))
			},
		},
		surfaceColor: {
			type: 'advanced',
			affectedProperties: ['bgcolor', 'color'],
			name: 'Strip: Colour (as in eMotion)',
			description: 'Gives the button the strip’s colour from eMotion, with readable text.',
			options: [
				stripField(self, 'strip', 'Strip'),
				{ type: 'checkbox', id: 'text', label: 'Also set the text colour', default: true },
			],
			callback: (fb) => {
				const { tt, track } = parseStrip(fb.options.strip)
				const hex = trackColorHex(self, tt, track)
				if (!hex) return {}
				return fb.options.text === false ? { bgcolor: hexToRgb(hex) } : { bgcolor: hexToRgb(hex), color: textOn(hex) }
			},
		},
		surfaceMeterAbove: {
			type: 'boolean',
			name: 'Strip: Meter above a level',
			description: 'True while the strip’s output meter (loudest leg) is at or above the level.',
			defaultStyle: { bgcolor: combineRgb(0, 160, 0), color: WHITE },
			options: [
				stripField(self, 'strip', 'Strip', STRIP_TYPES),
				{ type: 'number', id: 'db', label: 'Level (dBFS)', default: -20, min: -60, max: 0, step: 1 },
			],
			unsubscribe: (fb) => self.surfaceMeterUnbind(fb.id),
			callback: (fb) => {
				const { tt, track } = parseStrip(fb.options.strip)
				self.surfaceMeterBind(fb.id, tt, track)
				const legs2 = self.surfaceModel.meters.get(`${tt}.${track}`)?.legs ?? []
				const loudest = Math.max(legs2[0] ?? -144, legs2[1] ?? -144)
				return loudest >= Number(fb.options.db)
			},
		},
		surfaceFlipAny: {
			type: 'boolean',
			name: 'Flip: Mixer is flipped (any aux)',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [
				{
					type: 'dropdown',
					id: 'mixer',
					label: 'Mixer',
					default: 'm1',
					choices: SURFACE_MIXERS.map((m) => ({ id: m.id, label: m.label === 'All' ? 'All page' : m.label })),
				},
			],
			callback: (fb) => {
				const view = SURFACE_MIXERS.find((m) => m.id === fb.options.mixer)?.surface ?? 0
				return !!self.surfaceModel.flips.get(view)?.on
			},
		},
		surfaceSceneIs: {
			type: 'boolean',
			name: 'Scenes: Current scene (pick from list)',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [{ type: 'dropdown', id: 'scene', label: 'Scene', default: '0', choices: sceneChoices(self) }],
			callback: (fb) => self.surfaceModel.gui.scene === parseInt(optionText(fb.options.scene), 10),
		},
		surfacePage: {
			type: 'boolean',
			name: 'eMotion: Page shown',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [
				{
					type: 'dropdown',
					id: 'page',
					label: 'Page',
					default: 'Mixer 1',
					choices: ['Mixer 1', 'Mixer 2', 'All', 'Channel', 'Show', 'Patch', 'Setup'].map((p) => ({ id: p, label: p })),
				},
			],
			callback: (fb) => self.surfaceModel.gui.page === fb.options.page,
		},
		surfaceMixLayer: {
			type: 'boolean',
			name: 'Mixer: INPUTS / MIX layers shown',
			description: 'True while that mixer shows those layers (80-channel mode).',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [
				{
					type: 'dropdown',
					id: 'mixer',
					label: 'Mixer',
					default: 'm1',
					choices: SURFACE_MIXERS.filter((m) => m.id !== 'all').map((m) => ({ id: m.id, label: m.label })),
				},
				{
					type: 'dropdown',
					id: 'layer',
					label: 'Layers',
					default: 'inputs',
					choices: [
						{ id: 'inputs', label: 'INPUTS' },
						{ id: 'mix', label: 'MIX' },
					],
				},
			],
			callback: (fb) => {
				const view = SURFACE_MIXERS.find((m) => m.id === fb.options.mixer)?.surface ?? 0
				const l = self.surfaceModel.mixLayers.get(view)
				return !!l && l.active && l.mix === (fb.options.layer === 'mix')
			},
		},
		surfaceModePreset: {
			type: 'boolean',
			name: 'Mixer: Mode preset is',
			description: 'True while that mixer shows that Modes preset.',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [
				{
					type: 'dropdown',
					id: 'mixer',
					label: 'Mixer',
					default: 'm1',
					choices: SURFACE_MIXERS.filter((m) => m.id !== 'all').map((m) => ({ id: m.id, label: m.label })),
				},
				modePresetField(self),
			],
			callback: (fb) => {
				const view = SURFACE_MIXERS.find((m) => m.id === fb.options.mixer)?.surface ?? 0
				return self.surfaceModel.modePresets.get(view) === parseInt(optionText(fb.options.preset), 10)
			},
		},
	}
}
