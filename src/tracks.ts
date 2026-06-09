// Track-picker helpers.
//
// The LV1 has a fixed topology (standard groups + variable input/aux counts).
// The dropdowns are built as a Group selector + a per-group Channel selector,
// where the Channel field uses Companion's `isVisible` so only the right list
// shows per selected group. Single-track groups (LR/C/M/Cue/TB) hide the
// channel field entirely.
//
// Channel choices per group come from:
//   group=0 (Input)   → /Notify/Layers inputLayers, or fallback to effectiveChannels()
//   group=1 (Groups)  → 8 fixed (LV1 always has 8 group buses)
//   group=2 (Aux/FX)  → /Aux/Tracks names, or auxes count
//   group=6 (Matrix)  → 8 fixed
//   group=12 (DCA)    → 8 fixed

import type { DropdownChoice } from '@companion-module/base'
import type { LV1Instance } from './main.js'

/** Companion-facing label tag per group. */
const GROUP_TAG: Record<number, string> = {
	0: 'In',
	1: 'Grp',
	2: 'Aux',
	3: 'LR',
	4: 'C',
	5: 'M',
	6: 'Mtx',
	7: 'Cue',
	8: 'TB',
	12: 'DCA',
}

/** Variable-name-safe slug per group. */
const GROUP_SLUG: Record<number, string> = {
	0: 'in',
	1: 'grp',
	2: 'aux',
	3: 'lr',
	4: 'c',
	5: 'm',
	6: 'mtx',
	7: 'cue',
	8: 'tb',
	12: 'dca',
}

/** Groups where there is only one possible track (single master / sole bus). */
export function isSingletonGroup(g: number): boolean {
	return g === 3 || g === 4 || g === 5 || g === 7 || g === 8
}

/** Groups the LV1 always has, in display order. The Group dropdown lists all of them
 *  whether or not /Notify/Layers has confirmed their presence. */
export const GROUP_CHOICES: DropdownChoice[] = [
	{ id: 0, label: '0 — Input' },
	{ id: 1, label: '1 — Group bus' },
	{ id: 2, label: '2 — Aux / FX' },
	{ id: 3, label: '3 — LR (Master)' },
	{ id: 4, label: '4 — Center (Master)' },
	{ id: 5, label: '5 — Mono (Master)' },
	{ id: 6, label: '6 — Matrix' },
	{ id: 7, label: '7 — Cue (Master)' },
	{ id: 8, label: '8 — Talk Back (Master)' },
	{ id: 12, label: '12 — DCA' },
]

/** Per-group channel dropdown. Caller uses `isVisible: o => Number(o.group) === <g>`. */
export function channelsFor(self: LV1Instance, group: number): DropdownChoice[] {
	const named = (idx0: number, fallback: string): string => {
		if (group === 2 && self.detected.auxNames?.[idx0]) return `${idx0 + 1} — ${self.detected.auxNames[idx0]}`
		const n = self.channels.get(`${group}.${idx0}`)?.name
		return n ? `${idx0 + 1} — ${n}` : `${fallback} ${idx0 + 1}`
	}

	switch (group) {
		case 0: {
			const total = countInputs(self)
			const out: DropdownChoice[] = []
			for (let i = 0; i < total; i++) out.push({ id: i + 1, label: named(i, 'Ch') })
			return out
		}
		case 1: {
			const out: DropdownChoice[] = []
			for (let i = 0; i < 8; i++) out.push({ id: i + 1, label: named(i, 'Group') })
			return out
		}
		case 2: {
			const total = self.effectiveAuxes()
			const out: DropdownChoice[] = []
			for (let i = 0; i < total; i++) out.push({ id: i + 1, label: named(i, 'Aux') })
			return out
		}
		case 6: {
			const out: DropdownChoice[] = []
			for (let i = 0; i < 8; i++) out.push({ id: i + 1, label: named(i, 'Mtx') })
			return out
		}
		case 12: {
			const out: DropdownChoice[] = []
			for (let i = 0; i < 8; i++) out.push({ id: i + 1, label: named(i, 'DCA') })
			return out
		}
		default:
			// LR/C/M/Cue/TB — single track, dropdown is unused (hidden)
			return [{ id: 1, label: 'Master' }]
	}
}

/** Count distinct input channels visible in the detected factory INPUT layers,
 *  falling back to the configured/default count if layers haven't arrived. */
function countInputs(self: LV1Instance): number {
	const set = new Set<number>()
	for (const L of self.detected.inputLayers ?? []) {
		for (const e of L.entries) if (e && e.group === 0) set.add(e.ch)
	}
	if (set.size === 0) return self.effectiveChannels()
	return set.size
}

/** Resolve the channel index (0-based wire value) for an action/feedback
 *  given its option values. Handles both old (group+channel) and new
 *  (group+ch_<grp>) button formats. */
export function resolveChannel(options: Record<string, unknown>, group: number): number {
	if (isSingletonGroup(group)) return 0
	const fieldByGroup: Record<number, string> = {
		0: 'ch_in',
		1: 'ch_grp',
		2: 'ch_aux',
		6: 'ch_mtx',
		12: 'ch_dca',
	}
	const field = fieldByGroup[group]
	const v = field ? options[field] : undefined
	if (v != null && v !== '') return Number(v) - 1
	// Backwards-compat: old buttons saved `channel` instead of the per-group field.
	if (options.channel != null) return Number(options.channel) - 1
	return 0
}

/** Build the set of per-group channel options to attach to an action/feedback.
 *  Pass these alongside the Group dropdown — each becomes visible only when
 *  its matching group is selected.
 *
 *  IMPORTANT: Companion serializes `isVisible` and evaluates it in the browser,
 *  so it CANNOT capture closure variables. We pass the expected group via
 *  `isVisibleData` instead. */
export function buildChannelOptions(
	self: LV1Instance,
	idPrefix = 'ch',
): Array<{
	id: string
	type: 'dropdown'
	label: string
	default: number
	choices: DropdownChoice[]
	isVisible: (opts: Record<string, unknown>, data: { group: number }) => boolean
	isVisibleData: { group: number }
}> {
	const visFn = (opts: Record<string, unknown>, data: { group: number }) => Number(opts.group) === data.group
	return [
		{
			id: `${idPrefix}_in`,
			type: 'dropdown',
			label: 'Channel',
			default: 1,
			choices: channelsFor(self, 0),
			isVisible: visFn,
			isVisibleData: { group: 0 },
		},
		{
			id: `${idPrefix}_grp`,
			type: 'dropdown',
			label: 'Group bus',
			default: 1,
			choices: channelsFor(self, 1),
			isVisible: visFn,
			isVisibleData: { group: 1 },
		},
		{
			id: `${idPrefix}_aux`,
			type: 'dropdown',
			label: 'Aux',
			default: 1,
			choices: channelsFor(self, 2),
			isVisible: visFn,
			isVisibleData: { group: 2 },
		},
		{
			id: `${idPrefix}_mtx`,
			type: 'dropdown',
			label: 'Matrix',
			default: 1,
			choices: channelsFor(self, 6),
			isVisible: visFn,
			isVisibleData: { group: 6 },
		},
		{
			id: `${idPrefix}_dca`,
			type: 'dropdown',
			label: 'DCA',
			default: 1,
			choices: channelsFor(self, 12),
			isVisible: visFn,
			isVisibleData: { group: 12 },
		},
	]
}

// ─── Track enumeration (used by variables.ts) ────────────────────────────────

/** Returns the list of every real (group, ch) track on this LV1. Always includes
 *  the standard fixed-count groups (Groups=8, Matrix=8, DCA=8, masters=1) regardless
 *  of whether /Notify/Layers has confirmed them — so variables register up front. */
export function enumerateTracks(self: LV1Instance): Array<{ group: number; ch: number }> {
	const out: Array<{ group: number; ch: number }> = []
	const inputCount = countInputs(self)
	const auxCount = self.effectiveAuxes()
	for (let i = 0; i < inputCount; i++) out.push({ group: 0, ch: i })
	for (let i = 0; i < 8; i++) out.push({ group: 1, ch: i })
	for (let i = 0; i < auxCount; i++) out.push({ group: 2, ch: i })
	out.push({ group: 3, ch: 0 }) // LR
	out.push({ group: 4, ch: 0 }) // Center
	out.push({ group: 5, ch: 0 }) // Mono
	for (let i = 0; i < 8; i++) out.push({ group: 6, ch: i })
	out.push({ group: 7, ch: 0 }) // Cue
	out.push({ group: 8, ch: 0 }) // TalkBack
	for (let i = 0; i < 8; i++) out.push({ group: 12, ch: i })
	return out
}

export function trackSlug(group: number, ch: number): string {
	const prefix = GROUP_SLUG[group] ?? `g${group}`
	if (isSingletonGroup(group)) return prefix
	return `${prefix}${ch + 1}`
}

export function trackLabel(self: LV1Instance, group: number, ch: number): string {
	const tag = GROUP_TAG[group] ?? `g${group}`
	if (isSingletonGroup(group)) return `${tag} — Master`
	const chName = self.channels.get(`${group}.${ch}`)?.name
	const auxName = group === 2 ? self.detected.auxNames?.[ch] : undefined
	const name = auxName || chName
	return name ? `${tag} ${ch + 1} — ${name}` : `${tag} ${ch + 1}`
}
