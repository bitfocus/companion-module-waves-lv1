// Companion Surface: strip faders / mutes / solos, Mute All and mute groups, plugin parameters
// (any plugin, names and ranges read from the desk) and eMotion's own state as feedbacks.
// Everything that moves dB or frequency can fade (the "Fade" option of the action).

import {
	CompanionActionDefinitions,
	CompanionFeedbackDefinitions,
	combineRgb,
	type DropdownChoice,
} from '@companion-module/base'
import type { LV1Instance } from './main.js'
import {
	MUTE_ALL,
	MUTE_GROUPS,
	RACK_TYPES,
	STRIP_TYPES,
	displayNumber,
	muteGroupAddress,
	strip,
} from './surface-model.js'
import {
	type AnyOpt,
	buildNumberExprField,
	desiredState,
	fadeFields,
	onOffToggle,
	parseStrip,
	resolveFade,
	resolveNumberAsync,
	stripField,
	valueModeField,
} from './surface-ui.js'

const RED = combineRgb(200, 0, 0)
const AMBER = combineRgb(200, 120, 0)
const WHITE = combineRgb(255, 255, 255)

const groupChoices = Array.from({ length: MUTE_GROUPS }, (_, i) => ({ id: String(i), label: `Mute group ${i + 1}` }))

/** Plugin types present on the desk, and one parameter list per type (shown for that type only). */
function pluginFields(self: LV1Instance): AnyOpt[] {
	const plugins = [...self.surfaceModel.plugins.values()]
		.filter((p) => p.params.size)
		.sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))
	const pluginChoices: DropdownChoice[] = plugins.map((p) => ({ id: p.code, label: `${p.name} (${p.code})` }))
	const out: AnyOpt[] = [
		{
			type: 'dropdown',
			id: 'plugin',
			label: 'Plugin',
			default: pluginChoices[0]?.id ?? '',
			choices: pluginChoices.length ? pluginChoices : [{ id: '', label: '— no plugins read from the desk yet —' }],
			tooltip: 'The first slot of the strip that holds this plugin is used.',
		},
	]
	for (const p of plugins) {
		const choices = [...p.params.values()]
			.sort((a, b) => a.index - b.index)
			.map((x) => ({ id: String(x.index), label: x.name }))
		out.push({
			type: 'dropdown',
			id: `param_${p.code}`,
			label: 'Parameter',
			default: choices[0]?.id ?? '0',
			choices,
			isVisibleExpression: `$(options:plugin) == '${p.code}'`,
		})
	}
	return out
}

function pluginTarget(self: LV1Instance, options: Record<string, unknown>) {
	const { tt, track } = parseStrip(options.strip)
	const code = typeof options.plugin === 'string' ? options.plugin : ''
	const raw = options[`param_${code}`]
	const index = parseInt(typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '', 10)
	const param = self.surfaceModel.plugins.get(code)?.params.get(index)
	const slot = self.surfaceModel.findSlot(tt, track, code)
	return { tt, track, code, index, param, slot }
}

export function featureActions(self: LV1Instance): CompanionActionDefinitions {
	return {
		surfaceFader: {
			name: 'Strip: Fader level (dB)',
			description: 'Set, increase or decrease a strip’s fader in dB, optionally as a fade.',
			options: [
				stripField(self, 'strip', 'Strip', STRIP_TYPES),
				valueModeField(),
				buildNumberExprField('db', 'dB', 0, 'dB (−144 = −∞). Variables OK.'),
				...fadeFields(),
			],
			callback: async (a, context) => {
				const { tt, track } = parseStrip(a.options.strip)
				const v = await resolveNumberAsync(a.options, 'db', context, 0)
				const current = self.surfaceFaderDb(tt, track)
				const target =
					a.options.mode === 'inc' ? (current ?? -144) + v : a.options.mode === 'dec' ? (current ?? -144) - v : v
				self.surfaceSetFader(tt, track, Math.max(-144, Math.min(10, target)), await resolveFade(a.options, context))
			},
		},

		surfaceMute: {
			name: 'Strip: Mute',
			options: [stripField(self, 'strip', 'Strip', STRIP_TYPES), ...onOffToggle('Mute', 'Unmute')],
			callback: async (a, context) => {
				const { tt, track } = parseStrip(a.options.strip)
				const addr = strip.mute(tt, track)
				self.surfaceSetBool(addr, await desiredState(a.options, context, self.surfaceBool(addr)))
			},
		},

		surfaceSolo: {
			name: 'Strip: Solo',
			options: [stripField(self, 'strip', 'Strip', STRIP_TYPES), ...onOffToggle('Solo', 'Unsolo')],
			callback: async (a, context) => {
				const { tt, track } = parseStrip(a.options.strip)
				const addr = strip.solo(tt, track)
				self.surfaceSetBool(addr, await desiredState(a.options, context, self.surfaceBool(addr)))
			},
		},

		surfaceMuteAll: {
			name: 'Mute All',
			description: 'eMotion’s MUTE ALL.',
			options: onOffToggle('Mute all', 'Unmute all'),
			callback: async (a, context) => {
				self.surfaceSetBool(MUTE_ALL, await desiredState(a.options, context, self.surfaceBool(MUTE_ALL)))
			},
		},

		surfaceMuteGroup: {
			name: 'Mute group',
			options: [
				{ type: 'dropdown', id: 'group', label: 'Mute group', default: '0', choices: groupChoices },
				...onOffToggle('Mute', 'Unmute'),
			],
			callback: async (a, context) => {
				const addr = muteGroupAddress(Number(a.options.group) || 0)
				self.surfaceSetBool(addr, await desiredState(a.options, context, self.surfaceBool(addr)))
			},
		},

		surfacePluginParam: {
			name: 'Plugin: Parameter',
			description:
				'Change any parameter of a plugin on a strip (EQ gain / frequency, filters, dynamics…), by the names the desk reports. ' +
				'Values are in the plugin’s units (dB, Hz…). On / off and type parameters use Toggle / Next / Previous.',
			options: [
				stripField(self, 'strip', 'Strip', RACK_TYPES),
				...pluginFields(self),
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Change',
					default: 'set',
					choices: [
						{ id: 'set', label: 'Set to' },
						{ id: 'inc', label: 'Increase by' },
						{ id: 'dec', label: 'Decrease by' },
						{ id: 'toggle', label: 'Toggle (on / off)' },
						{ id: 'next', label: 'Next state' },
						{ id: 'prev', label: 'Previous state' },
					],
				},
				{
					...buildNumberExprField(
						'value',
						'Value (plugin units)',
						0,
						'In the parameter’s units (dB, Hz, ms…). For states: the state number (0 = first). Variables OK.',
					),
					isVisibleExpression: "$(options:mode) == 'set' || $(options:mode) == 'inc' || $(options:mode) == 'dec'",
				},
				...fadeFields().map((f) => ({
					...f,
					isVisibleExpression:
						f.id === 'fade'
							? "$(options:mode) == 'set' || $(options:mode) == 'inc' || $(options:mode) == 'dec'"
							: "$(options:fade) && ($(options:mode) == 'set' || $(options:mode) == 'inc' || $(options:mode) == 'dec')",
				})),
			],
			callback: async (a, context) => {
				const t = pluginTarget(self, a.options)
				if (!t.param || t.slot < 0) {
					self.log('warn', `Plugin parameter: ${t.code || 'no plugin'} not found on that strip`)
					return
				}
				const value = await resolveNumberAsync(a.options, 'value', context, 0)
				await self.surfaceChangePluginParam(
					t.tt,
					t.track,
					t.slot,
					t.param,
					String(a.options.mode),
					value,
					await resolveFade(a.options, context),
				)
			},
		},
	}
}

export function featureFeedbacks(self: LV1Instance): CompanionFeedbackDefinitions {
	return {
		surfaceMuted: {
			type: 'boolean',
			name: 'Strip: Muted',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [stripField(self, 'strip', 'Strip', STRIP_TYPES)],
			callback: (fb) => {
				const { tt, track } = parseStrip(fb.options.strip)
				return self.surfaceBool(strip.mute(tt, track))
			},
		},
		surfaceSoloed: {
			type: 'boolean',
			name: 'Strip: Soloed',
			defaultStyle: { bgcolor: combineRgb(220, 180, 0), color: combineRgb(0, 0, 0) },
			options: [stripField(self, 'strip', 'Strip', STRIP_TYPES)],
			callback: (fb) => {
				const { tt, track } = parseStrip(fb.options.strip)
				return self.surfaceBool(strip.solo(tt, track))
			},
		},
		surfaceFaderLevel: {
			type: 'boolean',
			name: 'Strip: Fader compared to a level',
			defaultStyle: { bgcolor: combineRgb(0, 120, 0), color: WHITE },
			options: [
				stripField(self, 'strip', 'Strip', STRIP_TYPES),
				{
					type: 'dropdown',
					id: 'cmp',
					label: 'When the fader is',
					default: 'ge',
					choices: [
						{ id: 'ge', label: 'at or above' },
						{ id: 'le', label: 'at or below' },
					],
				},
				{ type: 'number', id: 'db', label: 'dB', default: 0, min: -144, max: 10, step: 0.1 },
			],
			callback: (fb) => {
				const { tt, track } = parseStrip(fb.options.strip)
				const db = self.surfaceFaderDb(tt, track)
				if (db == null) return false
				return fb.options.cmp === 'le' ? db <= Number(fb.options.db) : db >= Number(fb.options.db)
			},
		},
		surfaceMuteAll: {
			type: 'boolean',
			name: 'Mute All is on',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [],
			callback: () => self.surfaceBool(MUTE_ALL),
		},
		surfaceMuteGroup: {
			type: 'boolean',
			name: 'Mute group is on',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [{ type: 'dropdown', id: 'group', label: 'Mute group', default: '0', choices: groupChoices }],
			callback: (fb) => self.surfaceBool(muteGroupAddress(Number(fb.options.group) || 0)),
		},
		surfacePluginState: {
			type: 'boolean',
			name: 'Plugin: Parameter state',
			description:
				'True when an on / off or type parameter shows that state (e.g. In, On, Bell), or a value is at or above a level.',
			defaultStyle: { bgcolor: AMBER, color: WHITE },
			options: [
				stripField(self, 'strip', 'Strip', RACK_TYPES),
				...pluginFields(self),
				{
					type: 'textinput',
					id: 'text',
					label: 'State shown (e.g. On, In, Bell) — or a number for "at or above"',
					default: 'On',
				},
			],
			callback: (fb) => {
				const t = pluginTarget(self, fb.options)
				if (!t.param || t.slot < 0) return false
				const shown = self.surfacePluginText(t.tt, t.track, t.slot, t.index)
				if (shown == null) return false
				const want = (typeof fb.options.text === 'string' ? fb.options.text : '').trim()
				const wantNum = displayNumber(want)
				const shownNum = displayNumber(shown)
				if (wantNum != null && shownNum != null && t.param.kind === 'continuous') return shownNum >= wantNum
				return shown.trim().toLowerCase() === want.toLowerCase()
			},
		},
		surfacePluginValue: {
			type: 'advanced',
			name: 'Plugin: Show parameter value on the button',
			description: 'Puts the parameter’s value, as eMotion displays it, on the button text.',
			options: [stripField(self, 'strip', 'Strip', RACK_TYPES), ...pluginFields(self)],
			callback: (fb) => {
				const t = pluginTarget(self, fb.options)
				if (!t.param || t.slot < 0) return {}
				const shown = self.surfacePluginText(t.tt, t.track, t.slot, t.index)
				return shown == null ? {} : { text: `${t.param.name}\n${shown}` }
			},
		},
		surfaceLock: {
			type: 'boolean',
			name: 'eMotion: Locked',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [],
			callback: () => !!(self.surfaceModel.gui.consoleLock || self.surfaceModel.gui.surfaceLock),
		},
		surfaceRecording: {
			type: 'boolean',
			name: 'eMotion: Recording',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [],
			callback: () => !!self.surfaceModel.gui.recording,
		},
		surfaceSoloActive: {
			type: 'boolean',
			name: 'eMotion: Any solo / cue active',
			defaultStyle: { bgcolor: combineRgb(220, 180, 0), color: combineRgb(0, 0, 0) },
			options: [],
			callback: () => !!self.surfaceModel.gui.soloActive,
		},
		surfaceSceneDirty: {
			type: 'boolean',
			name: 'Scenes: Current scene has unsaved changes',
			defaultStyle: { bgcolor: AMBER, color: WHITE },
			options: [],
			callback: () => !!self.surfaceModel.gui.sceneDirty,
		},
		surfaceScene: {
			type: 'boolean',
			name: 'Scenes: Scene is the current one',
			defaultStyle: { bgcolor: combineRgb(0, 120, 200), color: WHITE },
			options: [{ type: 'number', id: 'scene', label: 'Scene number', default: 1, min: 0, max: 1000 }],
			callback: (fb) => self.surfaceModel.gui.scene === Number(fb.options.scene),
		},
	}
}
