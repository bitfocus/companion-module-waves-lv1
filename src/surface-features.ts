// Companion Surface: strip faders / mutes / solos, Mute All and mute groups, plugin parameters
// (any plugin, names and ranges read from the desk) and eMotion's own state as feedbacks.
// Everything that moves dB or frequency can fade (the "Fade" option of the action).

import { CompanionActionDefinitions, CompanionFeedbackDefinitions, combineRgb } from '@companion-module/base'
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

/** "Band1 Gain-L" → "Band1 Gain": stereo plugin versions split parameters into L / R. */
function baseName(name: string): string {
	return name.replace(/[-\s](L|R)$/, '')
}

/** Option id for a plugin name ("EMO-Q4" → "EMO_Q4"). */
function pluginKey(name: string): string {
	return name.replace(/[^A-Za-z0-9]/g, '_')
}

/**
 * Plugins present on the desk, by name (mono and stereo versions together), and one parameter
 * list per plugin by name without L / R. Any strip can be mono or stereo: the version in the
 * strip's own slot decides which parameters are written when the action runs.
 */
function pluginFields(self: LV1Instance): AnyOpt[] {
	const byName = new Map<string, string[]>()
	for (const p of self.surfaceModel.plugins.values()) {
		if (!p.params.size) continue
		const list = byName.get(p.name) ?? []
		for (const x of [...p.params.values()].sort((a, b) => a.index - b.index)) {
			const n = baseName(x.name)
			if (!list.includes(n)) list.push(n)
		}
		byName.set(p.name, list)
	}
	const names = [...byName.keys()].sort((a, b) => a.localeCompare(b))
	const out: AnyOpt[] = [
		{
			type: 'dropdown',
			id: 'plugin',
			label: 'Plugin',
			default: names[0] ?? '',
			choices: names.length
				? names.map((n) => ({ id: n, label: n }))
				: [{ id: '', label: '— no plugins read from the desk yet —' }],
			tooltip: 'The first slot of the strip that holds this plugin is used.',
		},
	]
	for (const n of names) {
		const params = byName.get(n) ?? []
		out.push({
			type: 'dropdown',
			id: `param_${pluginKey(n)}`,
			label: 'Parameter',
			default: params[0] ?? '',
			choices: params.map((x) => ({ id: x, label: x })),
			isVisibleExpression: `$(options:plugin) == '${n}'`,
		})
	}
	out.push({
		type: 'dropdown',
		id: 'side',
		label: 'On stereo strips',
		default: 'both',
		choices: [
			{ id: 'both', label: 'Left and right together' },
			{ id: 'L', label: 'Left only' },
			{ id: 'R', label: 'Right only' },
		],
	})
	return out
}

/** The slot, plugin version and parameter(s) an action / feedback addresses on its strip. */
function pluginTarget(self: LV1Instance, options: Record<string, unknown>) {
	const { tt, track } = parseStrip(options.strip)
	const model = self.surfaceModel
	const plugin = typeof options.plugin === 'string' ? options.plugin : ''
	const rawParam = options[`param_${pluginKey(plugin)}`]
	const wanted = typeof rawParam === 'string' ? rawParam : ''
	let slot = -1
	for (let sl = 0; sl < 8 && slot < 0; sl++) if (model.slots.get(`${tt}.${track}.${sl}`)?.name === plugin) slot = sl
	const code = slot >= 0 ? model.slotCode(tt, track, slot) : ''
	const info = model.plugins.get(code)
	const all = info ? [...info.params.values()] : []
	const exact = all.find((p) => p.name === wanted)
	const left = all.find((p) => p.name === `${wanted}-L` || p.name === `${wanted} L`)
	const right = all.find((p) => p.name === `${wanted}-R` || p.name === `${wanted} R`)
	const side = options.side === 'L' || options.side === 'R' ? options.side : 'both'
	// Mono version: the parameter itself. Stereo version: L, R or both.
	const params = exact ? [exact] : side === 'L' ? [left] : side === 'R' ? [right] : [left, right]
	const targets = params.filter((p): p is NonNullable<typeof p> => !!p)
	return { tt, track, plugin, wanted, slot, targets, param: targets[0], index: targets[0]?.index ?? -1 }
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
				if (!t.targets.length || t.slot < 0) {
					self.log('warn', `Plugin parameter: ${t.plugin || 'no plugin'} / ${t.wanted} not found on that strip`)
					return
				}
				const value = await resolveNumberAsync(a.options, 'value', context, 0)
				const fade = await resolveFade(a.options, context)
				await Promise.all(
					t.targets.map(async (p) =>
						self.surfaceChangePluginParam(t.tt, t.track, t.slot, p, String(a.options.mode), value, fade),
					),
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
				return shown == null ? {} : { text: `${t.wanted}\n${shown}` }
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
		surfaceSessionDirty: {
			type: 'boolean',
			name: 'eMotion: Session has unsaved changes',
			defaultStyle: { bgcolor: AMBER, color: WHITE },
			options: [],
			callback: () => !!self.surfaceModel.gui.sessionDirty,
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
