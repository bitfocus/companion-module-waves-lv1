// Actions and feedbacks of the Companion Surface mode. Everything goes through the driver
// inside eMotion LV1: controls by address, and eMotion's own shortcut functions (flips, Talk
// Back presets, scenes…) pressed like a surface key. MyRemote is not used in this mode.

import { CompanionActionDefinitions, CompanionFeedbackDefinitions, combineRgb } from '@companion-module/base'
import type { LV1Instance } from './main.js'
import { optionText } from './definitions.js'
import { SurfaceControls } from './surface.js'
import { FLIP_ALL_SELECTION, SURFACE_MIXERS, TB_PRESET } from './surface-model.js'
import { FN_FLIP_SENDS, FN_TB_PRESET, SURFACE_FUNCTIONS } from './surface-functions.js'
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

function phaseField(): AnyOpt {
	return {
		type: 'dropdown',
		id: 'phase',
		label: 'Key',
		default: 'tap',
		tooltip:
			'Tap = press and release. Use Press on the button-down step and Release on the button-up step for hold keys (Alt, Ctrl).',
		choices: [
			{ id: 'tap', label: 'Tap (press + release)' },
			{ id: 'down', label: 'Press only' },
			{ id: 'up', label: 'Release only' },
		],
	}
}

export function surfaceActions(self: LV1Instance): CompanionActionDefinitions {
	const fnChoices = SURFACE_FUNCTIONS.map((f) => ({ id: String(f.id), label: f.name }))
	const fnWith = (kinds: string[]) =>
		SURFACE_FUNCTIONS.filter((f) => kinds.includes(f.param))
			.map((f) => `$(options:fn) == '${f.id}'`)
			.join(' || ')

	return {
		...featureActions(self),
		surfaceFlip: {
			name: 'Flip: Sends on fader',
			description:
				'Flip a mixer’s faders to an FX / Monitor aux, like a surface linked to that mixer does: eMotion stays on the page it shows.',
			options: [mixerField(true), auxField(self), ...onOffToggle('Flip on', 'Flip off')],
			callback: async (a, context) => {
				const { tt, track } = parseStrip(a.options.aux)
				const mixer = optionText(a.options.mixer)
				const views = mixer === 'all' ? SURFACE_MIXERS : SURFACE_MIXERS.filter((m) => m.id === mixer)
				const current = views.every((m) => self.surfaceModel.isFlipped(m.surface, tt, track))
				const want = await desiredState(a.options, context, current)
				if (want === current) return
				// Driver 0.1.19+: tell the mixer views directly, eMotion keeps its page.
				if (
					self.surfaceFlipViews(
						views.map((m) => m.surface),
						tt,
						track,
						want,
					)
				)
					return
				// Older driver: eMotion's Flip Sends user key (it toggles, and switches to the mixer page).
				const selection = mixer === 'all' ? FLIP_ALL_SELECTION : (views[0]?.selection ?? 0)
				self.surfaceRunFunction(FN_FLIP_SENDS, selection, tt, track)
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

		surfaceFunction: {
			name: 'eMotion function (shortcut)',
			description:
				'Runs any eMotion user-key function, as if a surface key assigned to it was pressed: scenes, sessions, presets, ' +
				'navigation, mute groups, Lock, Clear Solo, recording…',
			options: [
				{ type: 'dropdown', id: 'fn', label: 'Function', default: fnChoices[0].id, choices: fnChoices },
				{ ...stripField(self), isVisibleExpression: fnWith(['track', 'track+number']) },
				{
					...buildNumberExprField('number', 'Number (scene, preset, slot… — see the function)', 1, 'Variables OK.'),
					isVisibleExpression: fnWith(['number', 'track+number']),
				},
				phaseField(),
			],
			callback: async (a, context) => {
				const id = parseInt(optionText(a.options.fn), 10)
				const f = SURFACE_FUNCTIONS.find((x) => x.id === id)
				if (!f) return
				const needsTrack = f.param === 'track' || f.param === 'track+number'
				const needsNumber = f.param === 'number' || f.param === 'track+number'
				const { tt, track } = needsTrack ? parseStrip(a.options.strip) : { tt: -1, track: -1 }
				const number = needsNumber ? Math.round(await resolveNumberAsync(a.options, 'number', context, 1)) : -1
				const phase = (optionText(a.options.phase) || 'tap') as 'tap' | 'down' | 'up'
				self.surfaceRunFunction(f.id, number, tt, track, phase)
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
		surfaceFlip: {
			type: 'boolean',
			name: 'Flip: Mixer is flipped to aux',
			description: 'True while that mixer’s faders are flipped to that FX / Monitor aux (each mixer separately).',
			defaultStyle: { bgcolor: combineRgb(0, 120, 200), color: combineRgb(255, 255, 255) },
			options: [mixerField(false), auxField(self)],
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
