// Actions and feedbacks that go through the Companion Surface driver (config mode
// "Companion Surface"). Each one addresses an eMotion control directly; the driver sends
// every change back, so feedbacks follow edits made on the desk too.

import {
	CompanionActionDefinitions,
	CompanionFeedbackDefinitions,
	CompanionInputFieldDropdown,
	CompanionInputFieldTextInput,
	combineRgb,
} from '@companion-module/base'
import type { LV1Instance } from './main.js'
import type { ControlAddress } from './surface-client.js'
import { SurfaceControls } from './surface.js'
import {
	buildTrackPicker,
	buildStateField,
	buildNumberExprField,
	resolveTrackAsync,
	resolveStateAsync,
	resolveNumberAsync,
} from './tracks.js'

type AnyOpt = CompanionInputFieldDropdown | CompanionInputFieldTextInput
type ExprContext = Parameters<typeof resolveTrackAsync>[1]

const SLOT_CHOICES = Array.from({ length: 8 }, (_, i) => ({ id: String(i), label: `Slot ${i + 1}` }))

function slotField(): AnyOpt {
	return { type: 'dropdown', id: 'slot', label: 'Plugin slot', default: '0', choices: SLOT_CHOICES }
}

/** The strip picked in the options, as the desk's track type / index. */
async function stripOf(self: LV1Instance, options: Record<string, unknown>, context: ExprContext) {
	const { group, ch } = await resolveTrackAsync(options, context)
	const [tt, track] = self.auxMap.toWire(group, ch)
	return { tt, track }
}

/** on / off / toggle → the boolean to write, toggling from the last known value. */
async function desiredState(
	self: LV1Instance,
	options: Record<string, unknown>,
	context: ExprContext,
	a: ControlAddress,
): Promise<boolean> {
	const mode = await resolveStateAsync(options, 'state', context, 'toggle')
	if (mode === 'on') return true
	if (mode === 'off') return false
	return !self.surfaceBool(a)
}

export function surfaceActions(self: LV1Instance): CompanionActionDefinitions {
	const trackPicker: AnyOpt[] = buildTrackPicker(self, 'ch')
	return {
		surfaceTalk: {
			name: 'Talk Back: TALK',
			description: 'Presses TALK exactly like the button in eMotion (Talk Back mic to the selected destinations).',
			options: [
				...buildStateField(
					'state',
					[
						{ id: 'on', label: 'Talk on' },
						{ id: 'off', label: 'Talk off' },
						{ id: 'toggle', label: 'Toggle' },
					],
					'toggle',
				),
			],
			callback: async (a, context) => {
				const addr = SurfaceControls.talk()
				self.surfaceSetBool(addr, await desiredState(self, a.options, context, addr))
			},
		},

		surfaceSlotBypass: {
			name: 'Plugin: Slot bypass',
			description: 'Bypass one plugin slot in a strip’s rack.',
			options: [
				...trackPicker,
				slotField(),
				...buildStateField(
					'state',
					[
						{ id: 'on', label: 'Bypass' },
						{ id: 'off', label: 'Active' },
						{ id: 'toggle', label: 'Toggle' },
					],
					'toggle',
				),
			],
			callback: async (a, context) => {
				const { tt, track } = await stripOf(self, a.options, context)
				const addr = SurfaceControls.slotBypass(tt, track, Number(a.options.slot) || 0)
				self.surfaceSetBool(addr, await desiredState(self, a.options, context, addr))
			},
		},

		surfaceRack: {
			name: 'Plugin: Rack In / Out',
			description: 'Switch a strip’s whole plugin rack in or out.',
			options: [
				...trackPicker,
				...buildStateField(
					'state',
					[
						{ id: 'on', label: 'In' },
						{ id: 'off', label: 'Out' },
						{ id: 'toggle', label: 'Toggle' },
					],
					'toggle',
				),
			],
			callback: async (a, context) => {
				const { tt, track } = await stripOf(self, a.options, context)
				const addr = SurfaceControls.rackIn(tt, track)
				self.surfaceSetBool(addr, await desiredState(self, a.options, context, addr))
			},
		},

		surfaceRawControl: {
			name: 'Advanced: Set any control',
			description:
				'Writes one eMotion control by its raw address (track type, track, section group, section type / index, control id). ' +
				'For controls that have no action yet.',
			options: [
				buildNumberExprField('tt', 'Track type (0 = input, 2 = FX, 8 = Talk Back, 25 = Monitor…)', 0, 'Variables OK.'),
				buildNumberExprField('track', 'Track index (0-based)', 0, 'Variables OK.'),
				buildNumberExprField('group', 'Section group', 7, 'Variables OK.'),
				buildNumberExprField('secType', 'Section type (-1 = none)', -1, 'Variables OK.'),
				buildNumberExprField('secIdx', 'Section index (-1 = none)', -1, 'Variables OK.'),
				buildNumberExprField('cid', 'Control id', 0, 'Variables OK.'),
				buildNumberExprField('value', 'Value', 0, 'Raw control value. Variables OK.'),
			],
			callback: async (a, context) => {
				const n = async (id: string, def: number) => Math.round(await resolveNumberAsync(a.options, id, context, def))
				const addr: ControlAddress = {
					tt: await n('tt', 0),
					track: await n('track', 0),
					group: await n('group', 7),
					secType: await n('secType', -1),
					secIdx: await n('secIdx', -1),
					cid: await n('cid', 0),
				}
				self.surfaceSet(addr, await resolveNumberAsync(a.options, 'value', context, 0))
			},
		},
	}
}

export function surfaceFeedbacks(self: LV1Instance): CompanionFeedbackDefinitions {
	const trackPicker: AnyOpt[] = buildTrackPicker(self, 'ch')
	return {
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
			options: [...trackPicker, slotField()],
			callback: async (fb, context) => {
				const { tt, track } = await stripOf(self, fb.options, context)
				return self.surfaceBool(SurfaceControls.slotBypass(tt, track, Number(fb.options.slot) || 0))
			},
		},
		surfaceRackOut: {
			type: 'boolean',
			name: 'Plugin: Rack is Out',
			defaultStyle: { bgcolor: combineRgb(180, 120, 0), color: combineRgb(255, 255, 255) },
			options: trackPicker,
			callback: async (fb, context) => {
				const { tt, track } = await stripOf(self, fb.options, context)
				const v = self.surfaceValue(SurfaceControls.rackIn(tt, track))
				return v != null && v < 0.5
			},
		},
	}
}
