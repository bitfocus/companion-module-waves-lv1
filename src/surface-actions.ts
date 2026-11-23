// Actions and feedbacks of the Companion Surface mode. Everything goes through the driver
// inside eMotion LV1: controls by address, and eMotion's own shortcut functions (flips, Talk
// Back presets, scenes…) pressed like a surface key. MyRemote is not used in this mode.

import { CompanionActionDefinitions, CompanionFeedbackDefinitions, combineRgb } from '@companion-module/base'
import type { LV1Instance } from './main.js'
import { optionText } from './definitions.js'
import { SurfaceControls } from './surface.js'
import { MUTE_GROUP_TT, SURFACE_MIXERS, TB_PRESET } from './surface-model.js'
import {
	FN_TB_PRESET,
	HOT_SCENE_CHOICES,
	MIXER_VIEW_CHOICES,
	MODULE_CHOICES,
	MUTE_GROUP_CHOICES,
	SURFACE_FUNCTIONS,
	TAB_CHOICES,
	TOP_MODE_CHOICES,
	type FunctionTarget,
	type SurfaceFunction,
} from './surface-functions.js'
import {
	SLOT_CHOICES,
	auxField,
	buildNumberExprField,
	desiredState,
	mixerField,
	onOffToggle,
	parseStrip,
	resolveNumberAsync,
	stripField,
	type AnyOpt,
} from './surface-ui.js'
import { featureActions, featureFeedbacks } from './surface-features.js'
import { parityActions, parityFeedbacks, sceneChoices } from './surface-parity.js'

/** A function's SelectionIndex and target track from the action's options (-1 = unused). */
function functionArgs(f: SurfaceFunction, o: Record<string, unknown>): { sel: number; tt: number; track: number } {
	const num = (v: unknown) => {
		const n = parseInt(optionText(v), 10)
		return Number.isFinite(n) ? n : 0
	}
	switch (f.target) {
		case 'track':
			return { sel: -1, ...parseStrip(o.strip) }
		case 'module':
			return { sel: num(o.module), ...parseStrip(o.strip) }
		case 'aux':
			return { sel: -1, ...parseStrip(o.aux) }
		case 'muteGroup':
			return { sel: -1, tt: MUTE_GROUP_TT, track: num(o.muteGroup) }
		case 'mixer':
			return { sel: num(o.view), tt: -1, track: -1 }
		case 'topMode':
			return { sel: num(o.view), tt: -1, track: num(o.topMode) }
		case 'tab':
			return { sel: num(o.tab), tt: -1, track: -1 }
		case 'hotScene':
			return { sel: num(o.hotScene), tt: -1, track: -1 }
		case 'scene':
			return { sel: num(o.scene), tt: -1, track: -1 }
		default:
			return { sel: -1, tt: -1, track: -1 }
	}
}

function phaseField(): AnyOpt {
	return {
		type: 'dropdown',
		id: 'phase',
		label: 'Key',
		default: 'tap',
		tooltip:
			'Tap = press and release. Hold keys (Alt, Ctrl): Press on the button-down step and Release on the button-up step ' +
			'(momentary), or Toggle (press on one push, release on the next).',
		choices: [
			{ id: 'tap', label: 'Tap (press + release)' },
			{ id: 'down', label: 'Press only' },
			{ id: 'up', label: 'Release only' },
			{ id: 'toggle', label: 'Toggle (press / release on alternate pushes)' },
		],
	}
}

export function surfaceActions(self: LV1Instance): CompanionActionDefinitions {
	const fnChoices = SURFACE_FUNCTIONS.map((f) => ({ id: String(f.id), label: f.name }))
	const fnWith = (kinds: FunctionTarget[]) =>
		SURFACE_FUNCTIONS.filter((f) => kinds.includes(f.target))
			.map((f) => `$(options:fn) == '${f.id}'`)
			.join(' || ')

	return {
		...featureActions(self),
		...parityActions(self),
		surfaceFlip: {
			name: 'Flip: Sends on fader',
			description:
				'Flip a mixer’s faders to an FX / Monitor aux, like a surface linked to that mixer does: eMotion stays on the page it shows.',
			options: [mixerField(), auxField(self), ...onOffToggle('Flip on', 'Flip off')],
			callback: async (a, context) => {
				const { tt, track } = parseStrip(a.options.aux)
				const mixer = optionText(a.options.mixer)
				const views = SURFACE_MIXERS.filter((m) => m.id === mixer)
				const current = views.every((m) => self.surfaceModel.isFlipped(m.surface, tt, track))
				const want = await desiredState(a.options, context, current)
				if (want === current) return
				self.surfaceFlipViews(
					views.map((m) => m.surface),
					tt,
					track,
					want,
				)
			},
		},

		surfaceTbPreset: {
			name: 'Talk Back: Recall preset',
			description: 'Select a Talk Back preset exactly like the preset buttons in eMotion’s Talk Back panel.',
			options: [buildNumberExprField('preset', 'Preset (1 = first)', 1, 'Variables OK.')],
			callback: async (a, context) => {
				const preset = Math.max(1, Math.round(await resolveNumberAsync(a.options, 'preset', context, 1)))
				self.surfaceRunFunction(FN_TB_PRESET, preset, -1, -1)
			},
		},

		surfaceTalk: {
			name: 'Talk Back: TALK',
			description: 'Presses TALK exactly like the button in eMotion (Talk Back mic to the selected destinations).',
			options: onOffToggle('Talk on', 'Talk off'),
			callback: async (a, context) => {
				const addr = SurfaceControls.talk()
				self.surfaceSetBool(addr, await desiredState(a.options, context, self.surfaceBool(addr)))
			},
		},

		surfaceKey: {
			name: 'Keyboard: Ctrl / Alt / Shift on the eMotion computer',
			description:
				'Holds a key down on the eMotion computer, like its keyboard: Ctrl and Alt can be held together ' +
				'(Ctrl + Alt + drag on a pan knob = rotation). Keys go up again when Companion disconnects.',
			options: [
				{
					type: 'dropdown',
					id: 'key',
					label: 'Key',
					default: 'ctrl',
					choices: [
						{ id: 'ctrl', label: 'Ctrl' },
						{ id: 'alt', label: 'Alt' },
						{ id: 'shift', label: 'Shift' },
					],
				},
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Action',
					default: 'toggle',
					choices: [
						{ id: 'down', label: 'Press (hold down)' },
						{ id: 'up', label: 'Release' },
						{ id: 'toggle', label: 'Toggle (press / release on alternate pushes)' },
					],
				},
			],
			callback: (a) => {
				const key = optionText(a.options.key)
				const mode = optionText(a.options.mode)
				if (key !== 'ctrl' && key !== 'alt' && key !== 'shift') return
				self.surfaceSetKey(key, mode === 'down' || mode === 'up' ? mode : 'toggle')
			},
		},

		surfaceFunction: {
			name: 'eMotion function (shortcut)',
			description:
				'Runs any eMotion user-key function, as if a surface key assigned to it was pressed: scenes, sessions, presets, ' +
				'navigation, mute groups, Lock, Clear Solo, recording…',
			options: [
				{ type: 'dropdown', id: 'fn', label: 'Function', default: fnChoices[0].id, choices: fnChoices },
				{ ...stripField(self), isVisibleExpression: fnWith(['track', 'module']) },
				{
					type: 'dropdown',
					id: 'module',
					label: 'EQ, Dynamics, Filter or plugin slot',
					default: '4',
					choices: MODULE_CHOICES,
					isVisibleExpression: fnWith(['module']),
				},
				{ ...auxField(self), isVisibleExpression: fnWith(['aux']) },
				{
					type: 'dropdown',
					id: 'muteGroup',
					label: 'Mute group',
					default: '0',
					choices: MUTE_GROUP_CHOICES,
					isVisibleExpression: fnWith(['muteGroup']),
				},
				{
					type: 'dropdown',
					id: 'view',
					label: 'Mixer',
					default: '0',
					choices: MIXER_VIEW_CHOICES,
					isVisibleExpression: fnWith(['mixer', 'topMode']),
				},
				{
					type: 'dropdown',
					id: 'topMode',
					label: 'Top bay mode',
					default: '0',
					choices: TOP_MODE_CHOICES,
					isVisibleExpression: fnWith(['topMode']),
				},
				{
					type: 'dropdown',
					id: 'tab',
					label: 'Tab',
					default: '0',
					choices: TAB_CHOICES,
					isVisibleExpression: fnWith(['tab']),
				},
				{
					type: 'dropdown',
					id: 'hotScene',
					label: 'Hot scene',
					default: '0',
					choices: HOT_SCENE_CHOICES,
					isVisibleExpression: fnWith(['hotScene']),
				},
				{
					type: 'dropdown',
					id: 'scene',
					label: 'Scene',
					default: '0',
					choices: sceneChoices(self),
					isVisibleExpression: fnWith(['scene']),
				},
				phaseField(),
			],
			callback: async (a) => {
				const id = parseInt(optionText(a.options.fn), 10)
				const f = SURFACE_FUNCTIONS.find((x) => x.id === id)
				if (!f) return
				const { sel, tt, track } = functionArgs(f, a.options)
				const phase = (optionText(a.options.phase) || 'tap') as 'tap' | 'down' | 'up' | 'toggle'
				self.surfaceRunFunction(f.id, sel, tt, track, phase)
			},
		},

		surfaceSlotBypass: {
			name: 'Plugin: Slot bypass',
			description: 'Bypass one plugin slot in a strip’s rack.',
			options: [
				stripField(self),
				{ type: 'dropdown', id: 'slot', label: 'Plugin slot', default: '0', choices: SLOT_CHOICES },
				...onOffToggle('Bypass', 'Active'),
			],
			callback: async (a, context) => {
				const { tt, track } = parseStrip(a.options.strip)
				const addr = SurfaceControls.slotBypass(tt, track, Number(a.options.slot) || 0)
				self.surfaceSetBool(addr, await desiredState(a.options, context, self.surfaceBool(addr)))
			},
		},

		surfaceRack: {
			name: 'Plugin: Rack In / Out',
			description: 'Switch a strip’s whole plugin rack in or out.',
			options: [stripField(self), ...onOffToggle('In', 'Out')],
			callback: async (a, context) => {
				const { tt, track } = parseStrip(a.options.strip)
				const addr = SurfaceControls.rackIn(tt, track)
				self.surfaceSetBool(addr, await desiredState(a.options, context, self.surfaceBool(addr)))
			},
		},
	}
}

export function surfaceFeedbacks(self: LV1Instance): CompanionFeedbackDefinitions {
	return {
		...featureFeedbacks(self),
		...parityFeedbacks(self),
		surfaceKeyHeld: {
			type: 'boolean',
			name: 'Keyboard: key is held (Ctrl, Alt, Shift)',
			description: 'True while this connection holds that key down on the eMotion computer.',
			defaultStyle: { bgcolor: combineRgb(0, 120, 200), color: combineRgb(255, 255, 255) },
			options: [
				{
					type: 'dropdown',
					id: 'key',
					label: 'Key',
					default: 'ctrl',
					choices: [
						{ id: 'ctrl', label: 'Ctrl' },
						{ id: 'alt', label: 'Alt' },
						{ id: 'shift', label: 'Shift' },
					],
				},
			],
			callback: (fb) => self.surfaceKeyHeld(optionText(fb.options.key)),
		},
		surfaceFunctionHeld: {
			type: 'boolean',
			name: 'eMotion function is held (Alt, Ctrl…)',
			description:
				'True while this connection holds that function down: pressed (Press or Toggle) and not released yet.',
			defaultStyle: { bgcolor: combineRgb(0, 120, 200), color: combineRgb(255, 255, 255) },
			options: [
				{
					type: 'dropdown',
					id: 'fn',
					label: 'Function',
					default: '46',
					choices: SURFACE_FUNCTIONS.map((f) => ({ id: String(f.id), label: f.name })),
				},
			],
			callback: (fb) => self.surfaceFunctionHeld(parseInt(optionText(fb.options.fn), 10)),
		},
		surfaceFlip: {
			type: 'boolean',
			name: 'Flip: Mixer is flipped to aux',
			description: 'True while that mixer’s faders are flipped to that FX / Monitor aux (each mixer separately).',
			defaultStyle: { bgcolor: combineRgb(0, 120, 200), color: combineRgb(255, 255, 255) },
			options: [mixerField(), auxField(self)],
			callback: (fb) => {
				const { tt, track } = parseStrip(fb.options.aux)
				const view = SURFACE_MIXERS.find((m) => m.id === fb.options.mixer) ?? SURFACE_MIXERS[0]
				return self.surfaceModel.isFlipped(view.surface, tt, track)
			},
		},
		surfaceTbPreset: {
			type: 'boolean',
			name: 'Talk Back: Preset is selected',
			defaultStyle: { bgcolor: combineRgb(200, 120, 0), color: combineRgb(255, 255, 255) },
			options: [{ type: 'number', id: 'preset', label: 'Preset (1 = first)', default: 1, min: 1, max: 64 }],
			callback: (fb) => {
				self.surfaceValue(TB_PRESET) // asks the desk once when unknown
				return self.surfaceModel.tbPreset === Number(fb.options.preset)
			},
		},
		surfaceTalk: {
			type: 'boolean',
			name: 'Talk Back: TALK is on',
			defaultStyle: { bgcolor: combineRgb(200, 120, 0), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => self.surfaceBool(SurfaceControls.talk()),
		},
		surfaceSlotBypassed: {
			type: 'boolean',
			name: 'Plugin: Slot bypassed',
			defaultStyle: { bgcolor: combineRgb(180, 120, 0), color: combineRgb(255, 255, 255) },
			options: [
				stripField(self),
				{ type: 'dropdown', id: 'slot', label: 'Plugin slot', default: '0', choices: SLOT_CHOICES },
			],
			callback: (fb) => {
				const { tt, track } = parseStrip(fb.options.strip)
				return self.surfaceBool(SurfaceControls.slotBypass(tt, track, Number(fb.options.slot) || 0))
			},
		},
		surfaceRackOut: {
			type: 'boolean',
			name: 'Plugin: Rack is Out',
			defaultStyle: { bgcolor: combineRgb(180, 120, 0), color: combineRgb(255, 255, 255) },
			options: [stripField(self)],
			callback: (fb) => {
				const { tt, track } = parseStrip(fb.options.strip)
				const v = self.surfaceValue(SurfaceControls.rackIn(tt, track))
				return v != null && v < 0.5
			},
		},
	}
}
