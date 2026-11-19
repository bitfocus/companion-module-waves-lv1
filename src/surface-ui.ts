// Option fields shared by the Companion Surface actions and feedbacks.

import type {
	CompanionInputFieldCheckbox,
	CompanionInputFieldDropdown,
	CompanionInputFieldTextInput,
	DropdownChoice,
} from '@companion-module/base'
import type { LV1Instance } from './main.js'
import { SURFACE_MIXERS, SURFACE_TRACK_TYPES } from './surface-model.js'
import { buildStateField, buildNumberExprField, resolveStateAsync, resolveNumberAsync } from './tracks.js'

export type AnyOpt = CompanionInputFieldDropdown | CompanionInputFieldTextInput | CompanionInputFieldCheckbox
export type ExprContext = Parameters<typeof resolveNumberAsync>[2]

export const SLOT_CHOICES = Array.from({ length: 8 }, (_, i) => ({ id: String(i), label: `Slot ${i + 1}` }))

/**
 * "tt:track" ids for every track the desk reported, labelled "Ch 1 — Kick". Before the desk has
 * been read, every possible track of the type is listed, so saved buttons keep valid values.
 * Once it has, a type the desk has none of (Monitor buses on an LV1 without them) is left out.
 */
export function stripChoices(
	self: LV1Instance,
	types: readonly number[] = SURFACE_TRACK_TYPES.map((t) => t.tt),
): DropdownChoice[] {
	const out: DropdownChoice[] = []
	const deskRead = self.surfaceModel.tracks.size > 0
	for (const t of SURFACE_TRACK_TYPES) {
		if (!types.includes(t.tt)) continue
		const known = self.surfaceModel.list(t.tt)
		const tracks = known.length || deskRead ? known : Array.from({ length: t.max }, (_, track) => ({ track, name: '' }))
		for (const tr of tracks) {
			const label = t.max === 1 ? t.label : `${t.label} ${tr.track + 1}`
			out.push({ id: `${t.tt}:${tr.track}`, label: tr.name && tr.name !== label ? `${label} — ${tr.name}` : label })
		}
	}
	return out
}

export function stripField(
	self: LV1Instance,
	id = 'strip',
	label = 'Strip',
	types?: readonly number[],
): CompanionInputFieldDropdown {
	const choices = stripChoices(self, types)
	return { type: 'dropdown', id, label, default: choices[0]?.id ?? '0:0', choices }
}

export function auxField(self: LV1Instance): CompanionInputFieldDropdown {
	return stripField(self, 'aux', 'Aux (FX / Monitor)', [2, 25])
}

export function parseStrip(v: unknown): { tt: number; track: number } {
	const [tt, track] = (typeof v === 'string' || typeof v === 'number' ? String(v) : '0:0')
		.split(':')
		.map((n) => parseInt(n, 10))
	return { tt: Number.isFinite(tt) ? tt : 0, track: Number.isFinite(track) ? track : 0 }
}

/** Mixer 1, Mixer 2 or the All page (each has its own aux flip). */
export function mixerField(): CompanionInputFieldDropdown {
	const choices: DropdownChoice[] = SURFACE_MIXERS.map((m) => ({
		id: m.id,
		label: m.label === 'All' ? 'All page' : m.label,
	}))
	return { type: 'dropdown', id: 'mixer', label: 'Mixer', default: 'm1', choices }
}

export function onOffToggle(on: string, off: string): AnyOpt[] {
	return buildStateField(
		'state',
		[
			{ id: 'on', label: on },
			{ id: 'off', label: off },
			{ id: 'toggle', label: 'Toggle' },
		],
		'toggle',
	)
}

/** on / off / toggle → the boolean to write, toggling from the last known value. */
export async function desiredState(
	options: Record<string, unknown>,
	context: ExprContext,
	current: boolean,
): Promise<boolean> {
	const mode = await resolveStateAsync(options, 'state', context, 'toggle')
	if (mode === 'on') return true
	if (mode === 'off') return false
	return !current
}

/** Set / increase / decrease. */
export function valueModeField(): CompanionInputFieldDropdown {
	return {
		type: 'dropdown',
		id: 'mode',
		label: 'Change',
		default: 'set',
		choices: [
			{ id: 'set', label: 'Set to' },
			{ id: 'inc', label: 'Increase by' },
			{ id: 'dec', label: 'Decrease by' },
		],
	}
}

export type FadeCurve = 'linear' | 'ease' | 'easeOut'

/** "Fade" checkbox; ticking it shows the fade time and curve. */
export function fadeFields(): AnyOpt[] {
	return [
		{ type: 'checkbox', id: 'fade', label: 'Fade', default: false },
		{
			...buildNumberExprField('fadeMs', 'Fade time (ms)', 1000, 'Milliseconds. Variables OK.'),
			isVisibleExpression: '$(options:fade)',
		},
		{
			type: 'dropdown',
			id: 'curve',
			label: 'Fade curve',
			default: 'linear',
			choices: [
				{ id: 'linear', label: 'Linear' },
				{ id: 'ease', label: 'Ease in / out' },
				{ id: 'easeOut', label: 'Ease out (fast start)' },
			],
			isVisibleExpression: '$(options:fade)',
		},
	]
}

export async function resolveFade(
	options: Record<string, unknown>,
	context: ExprContext,
): Promise<{ ms: number; curve: FadeCurve } | null> {
	if (options.fade !== true) return null
	const ms = Math.max(0, Math.round(await resolveNumberAsync(options, 'fadeMs', context, 1000)))
	if (!ms) return null
	const curve = (['linear', 'ease', 'easeOut'] as const).find((c) => c === options.curve) ?? 'linear'
	return { ms, curve }
}

export { buildNumberExprField, resolveNumberAsync, resolveStateAsync }
