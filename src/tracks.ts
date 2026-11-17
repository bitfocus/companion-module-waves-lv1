// Track-picker helpers.
//
// The LV1 has a fixed topology (standard groups + variable input/aux counts).
// The dropdowns are built as a Group selector + a per-group Channel selector,
// where the Channel field uses Companion's `isVisibleExpression` so only the right list
// shows per selected group. Single-track groups (LR/C/M/Cue/TB) hide the
// channel field entirely.
//
// Channel choices per group come from:
//   group=0 (Input)   → /Notify/Layers inputLayers, or fallback to effectiveChannels()
//   group=1 (Groups)  → /Channels count (8 or 16), default 8
//   group=2 (Aux/FX)  → /Aux/Tracks names, or auxes count
//   group=6 (Matrix)  → /Channels count, default 8
//   group=12 (DCA)    → /Channels count (16 "Link" tracks on v17), default 8

import type { DropdownChoice, CompanionInputFieldDropdown, CompanionInputFieldTextInput } from '@companion-module/base'
import type { LV1Instance } from './main.js'
import { ROUTE_KINDS } from './routing.js'

/** Sentinel used as a dropdown entry to switch that field into "custom
 *  expression" mode. A paired `<field>_expr` textinput becomes visible; Companion
 *  fills in its variables before the callback reads it. */
export const CUSTOM_EXPR = '__custom'
export const CUSTOM_EXPR_CHOICE: DropdownChoice = { id: CUSTOM_EXPR, label: '✎ Custom (expression)…' }

/** The action / feedback callback context. Not needed any more to read option values (Companion
 *  fills in variables before the callback), kept so the resolvers keep one signature. */
export type ExprContext = unknown

/** Companion option values are typed as `unknown`. Coerce safely to a string
 *  without triggering the "[object Object]" path. */
function coerceStr(v: unknown): string {
	if (v == null) return ''
	if (typeof v === 'string') return v
	if (typeof v === 'number' || typeof v === 'boolean') return String(v)
	return ''
}

export function withCustomOption(choices: DropdownChoice[]): DropdownChoice[] {
	return [CUSTOM_EXPR_CHOICE, ...choices]
}

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
	CUSTOM_EXPR_CHOICE,
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

/** Number of Group (1) / Matrix (6) / DCA (12) tracks. Read from /Channels when it
 *  has arrived — v17 reports 16 DCA/Link tracks and up to 16 groups — else the
 *  historic fixed 8. */
export function busCount(self: LV1Instance, group: 1 | 6 | 12): number {
	const n = self.detected.groupCounts?.[group]
	return n && n > 0 && n <= 64 ? n : 8
}

/** Per-group channel dropdown, shown for its own group only. */
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
			for (let i = 0; i < busCount(self, 1); i++) out.push({ id: i + 1, label: named(i, 'Group') })
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
			for (let i = 0; i < busCount(self, 6); i++) out.push({ id: i + 1, label: named(i, 'Mtx') })
			return out
		}
		case 12: {
			const out: DropdownChoice[] = []
			for (let i = 0; i < busCount(self, 12); i++) out.push({ id: i + 1, label: named(i, 'DCA') })
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
 *  its matching group is selected. Each per-group dropdown has a "Custom
 *  expression" entry and a paired `<id>_expr` textinput that appears when
 *  chosen — see resolveTrackAsync().
 *
 *  Visibility is a Companion expression on the Group field. */
export function buildChannelOptions(
	self: LV1Instance,
	idPrefix = 'ch',
): Array<CompanionInputFieldDropdown | CompanionInputFieldTextInput> {
	const groups: Array<{ g: number; label: string; slug: string }> = [
		{ g: 0, label: 'Channel', slug: 'in' },
		{ g: 1, label: 'Group bus', slug: 'grp' },
		{ g: 2, label: 'Aux', slug: 'aux' },
		{ g: 6, label: 'Matrix', slug: 'mtx' },
		{ g: 12, label: 'DCA', slug: 'dca' },
	]

	const out: Array<CompanionInputFieldDropdown | CompanionInputFieldTextInput> = []
	for (const { g, label, slug } of groups) {
		const id = `${idPrefix}_${slug}`
		out.push({
			id,
			type: 'dropdown',
			label,
			default: 1,
			choices: withCustomOption(channelsFor(self, g)),
			isVisibleExpression: `$(options:group) == ${g}`,
		})
		out.push({
			id: `${id}_expr`,
			type: 'textinput',
			label: `${label} (expression)`,
			tooltip: 'Type a channel number or a variable like $(mod:my_var). 1-based.',
			default: '',
			useVariables: true,
			isVisibleExpression: `$(options:group) == ${g} && $(options:${id}) == '${CUSTOM_EXPR}'`,
		})
	}
	// Fallback ch expression used when Group itself is __custom (we can't know
	// which per-group ch_<slug> dropdown to render, so the user types it here).
	out.push({
		id: `${idPrefix}_expr`,
		type: 'textinput',
		label: 'Channel (expression)',
		tooltip: 'Used when Group is set to Custom. 1-based channel index.',
		default: '',
		useVariables: true,
		isVisibleExpression: `$(options:group) == '${CUSTOM_EXPR}'`,
	})
	return out
}

/** Group-only expression textinput, shown when Group is set to Custom. */
export function buildGroupExprField(): CompanionInputFieldTextInput {
	return {
		id: 'group_expr',
		type: 'textinput',
		label: 'Group (expression)',
		tooltip: '0=In, 1=Grp, 2=Aux, 3=LR, 4=C, 5=M, 6=Mtx, 7=Cue, 8=TB, 12=DCA',
		default: '',
		useVariables: true,
		isVisibleExpression: `$(options:group) == '${CUSTOM_EXPR}'`,
	}
}

/** Everything the Group + per-group Channel picker needs, in one call. */
export function buildTrackPicker(
	self: LV1Instance,
	idPrefix = 'ch',
): Array<CompanionInputFieldDropdown | CompanionInputFieldTextInput> {
	return [
		{ id: 'group', type: 'dropdown', label: 'Group', default: 0, choices: GROUP_CHOICES },
		buildGroupExprField(),
		...buildChannelOptions(self, idPrefix),
	]
}

/** A single dropdown (used e.g. for inputCh / aux) with the __custom entry
 *  and its paired expression textinput. */
export function buildExprDropdown(
	id: string,
	label: string,
	choices: DropdownChoice[],
	tooltip: string,
	defaultValue: string | number = 1,
): Array<CompanionInputFieldDropdown | CompanionInputFieldTextInput> {
	return [
		{
			id,
			type: 'dropdown',
			label,
			default: defaultValue,
			choices: withCustomOption(choices),
		},
		{
			id: `${id}_expr`,
			type: 'textinput',
			label: `${label} (expression)`,
			tooltip,
			default: '',
			useVariables: true,
			isVisibleExpression: `$(options:${id}) == '${CUSTOM_EXPR}'`,
		},
	]
}

/** State enum dropdown (on/off/toggle style) with a __custom expression path.
 *  Resolves via `resolveStateAsync` to one of the canonical `choices` ids. */
export function buildStateField(
	id: string,
	choices: DropdownChoice[],
	defaultValue: string,
): Array<CompanionInputFieldDropdown | CompanionInputFieldTextInput> {
	return [
		{
			id,
			type: 'dropdown',
			label: 'State',
			default: defaultValue,
			choices: withCustomOption(choices),
		},
		{
			id: `${id}_expr`,
			type: 'textinput',
			label: 'State (expression)',
			tooltip: 'Result: on/off/toggle (or 1/0/true/false).',
			default: '',
			useVariables: true,
			isVisibleExpression: `$(options:${id}) == '${CUSTOM_EXPR}'`,
		},
	]
}

/** Numeric textinput with variables enabled — used in place of `type:'number'`
 *  for dB, pan, ms, etc. */
export function buildNumberExprField(
	id: string,
	label: string,
	defaultValue: number,
	tooltip: string,
): CompanionInputFieldTextInput {
	return {
		id,
		type: 'textinput',
		label,
		tooltip,
		default: String(defaultValue),
		useVariables: true,
	}
}

// ─── Resolvers ────────────────────────────────────────────────────────────

/** Resolve group + channel (0-based wire values) from options, honoring the
 *  custom-expression path. Handles legacy `channel` field too. */
export async function resolveTrackAsync(
	options: Record<string, unknown>,
	_context: ExprContext,
): Promise<{ group: number; ch: number }> {
	// Group
	const rawGroup = options.group
	let group: number
	if (rawGroup === CUSTOM_EXPR) {
		const parsed = String(coerceStr(options.group_expr)).trim()
		const n = parseInt(parsed, 10)
		group = Number.isFinite(n) ? n : 0
	} else {
		group = Number(rawGroup)
	}

	// Channel
	if (isSingletonGroup(group)) return { group, ch: 0 }

	// When Group is __custom, channel comes from the sibling ch_expr field.
	if (rawGroup === CUSTOM_EXPR) {
		const parsed = String(coerceStr(options.ch_expr)).trim()
		const n = parseInt(parsed, 10)
		return { group, ch: Number.isFinite(n) ? n - 1 : 0 }
	}

	const fieldByGroup: Record<number, string> = {
		0: 'ch_in',
		1: 'ch_grp',
		2: 'ch_aux',
		6: 'ch_mtx',
		12: 'ch_dca',
	}
	const field = fieldByGroup[group]
	if (field && options[field] === CUSTOM_EXPR) {
		const parsed = String(coerceStr(options[`${field}_expr`])).trim()
		const n = parseInt(parsed, 10)
		return { group, ch: Number.isFinite(n) ? n - 1 : 0 }
	}
	const v = field ? options[field] : undefined
	if (v != null && v !== '') return { group, ch: Number(v) - 1 }
	// Backwards-compat: old buttons saved `channel`.
	if (options.channel != null) return { group, ch: Number(options.channel) - 1 }
	return { group, ch: 0 }
}

/** Resolve a dropdown-or-expression to a 0-based wire index. The dropdown
 *  values are 1-based (matching channelsFor) so we subtract 1. */
export async function resolveIndexAsync(
	options: Record<string, unknown>,
	field: string,
	_context: ExprContext,
	fallback = 0,
): Promise<number> {
	const raw = options[field]
	if (raw === CUSTOM_EXPR) {
		const parsed = String(coerceStr(options[`${field}_expr`])).trim()
		const n = parseInt(parsed, 10)
		return Number.isFinite(n) ? n - 1 : fallback
	}
	const n = Number(raw)
	return Number.isFinite(n) ? n - 1 : fallback
}

/** Resolve a numeric textinput (e.g. dB, pan, ms); variables are already filled in. */
export async function resolveNumberAsync(
	options: Record<string, unknown>,
	field: string,
	_context: ExprContext,
	fallback = 0,
): Promise<number> {
	const raw = options[field]
	if (raw == null || raw === '') return fallback
	const parsed = String(coerceStr(raw)).trim()
	const n = parseFloat(parsed)
	return Number.isFinite(n) ? n : fallback
}

/** Resolve a state dropdown (on/off/toggle style). If the value is __custom,
 *  parses `<field>_expr` and normalises: 1/true/on/mute/solo/engage → 'on',
 *  0/false/off/unmute → 'off', -1/toggle/flip → 'toggle'. Returns the raw
 *  dropdown id otherwise. */
export async function resolveStateAsync(
	options: Record<string, unknown>,
	field: string,
	_context: ExprContext,
	fallback = 'toggle',
): Promise<string> {
	const raw = options[field]
	if (raw !== CUSTOM_EXPR) return coerceStr(raw)
	const parsed = String(coerceStr(options[`${field}_expr`]))
		.trim()
		.toLowerCase()
	if (['1', 'true', 'on', 'mute', 'solo', 'engage', 'enable', 'enabled'].includes(parsed)) return 'on'
	if (['0', 'false', 'off', 'unmute', 'unsolo', 'disable', 'disabled'].includes(parsed)) return 'off'
	if (['-1', 'toggle', 'flip', 'invert'].includes(parsed)) return 'toggle'
	return fallback
}

/** Destination fields shared by the "Internal route" action and feedback. */
export function buildRouteDestOptions(
	self: LV1Instance,
	forAction = true,
): Array<CompanionInputFieldDropdown | CompanionInputFieldTextInput> {
	const kinds = ROUTE_KINDS.filter((k) => !forAction || !k.feedbackOnly)
	// Hide the number field for single-instance destinations and for Aux (which has
	// its own picker). Built as a Companion expression, not an isVisible function.
	const hideIdx = [...ROUTE_KINDS.filter((k) => k.single).map((k) => k.id), 'aux']
	const showIdx = hideIdx.map((id) => `$(options:destKind) != '${id}'`).join(' && ')
	return [
		{
			id: 'destKind',
			type: 'dropdown',
			label: 'Destination',
			default: 'grp',
			choices: kinds.map((k) => ({ id: k.id, label: k.label })),
		},
		{
			id: 'destIdx',
			type: 'textinput',
			label: 'Destination number (1-based)',
			tooltip: 'e.g. 1 = Group 1 / Matrix 1 / DCA 1 / mute group 1. Variables OK.',
			default: '1',
			useVariables: true,
			isVisibleExpression: showIdx,
		},
		{
			id: 'destAux',
			type: 'dropdown',
			label: 'Aux (FX / Monitor)',
			default: 1,
			choices: withCustomOption(channelsFor(self, 2)),
			isVisibleExpression: "$(options:destKind) == 'aux'",
		},
		{
			id: 'destAux_expr',
			type: 'textinput',
			label: 'Aux (expression)',
			tooltip: '1-based aux index as listed above (FX first, then Monitors).',
			default: '',
			useVariables: true,
			isVisibleExpression: `$(options:destKind) == 'aux' && $(options:destAux) == '${CUSTOM_EXPR}'`,
		},
	]
}

/** Resolve the route destination to module-internal (group, 0-based index).
 *  Auxes come back as (2, combined index); AuxMap translates them on send. */
export async function resolveRouteDest(
	options: Record<string, unknown>,
	context: ExprContext,
): Promise<{ group: number; idx: number }> {
	const kind = ROUTE_KINDS.find((k) => k.id === options.destKind) ?? ROUTE_KINDS[0]
	if (kind.single) return { group: kind.group, idx: 0 }
	if (kind.id === 'aux') return { group: kind.group, idx: await resolveIndexAsync(options, 'destAux', context, 0) }
	const n = Math.round(await resolveNumberAsync(options, 'destIdx', context, 1))
	return { group: kind.group, idx: Math.max(0, n - 1) }
}

// ─── Track enumeration (used by variables.ts) ────────────────────────────────

/** Returns the list of every real (group, ch) track on this LV1. Always includes
 *  the standard groups (Groups / Matrix / DCA — 8 each until /Channels says otherwise,
 *  masters=1) regardless of whether /Notify/Layers has confirmed them — so variables
 *  register up front. */
export function enumerateTracks(self: LV1Instance): Array<{ group: number; ch: number }> {
	const out: Array<{ group: number; ch: number }> = []
	const inputCount = countInputs(self)
	const auxCount = self.effectiveAuxes()
	for (let i = 0; i < inputCount; i++) out.push({ group: 0, ch: i })
	for (let i = 0; i < busCount(self, 1); i++) out.push({ group: 1, ch: i })
	for (let i = 0; i < auxCount; i++) out.push({ group: 2, ch: i })
	out.push({ group: 3, ch: 0 }) // LR
	out.push({ group: 4, ch: 0 }) // Center
	out.push({ group: 5, ch: 0 }) // Mono
	for (let i = 0; i < busCount(self, 6); i++) out.push({ group: 6, ch: i })
	out.push({ group: 7, ch: 0 }) // Cue
	out.push({ group: 8, ch: 0 }) // TalkBack
	for (let i = 0; i < busCount(self, 12); i++) out.push({ group: 12, ch: i })
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
