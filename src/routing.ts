// Internal routing (Patch > Internal) — /SetInternalAsgn and /Notify/InternalAssign.
//
// VERIFIED LIVE (eMotion LV1 v.17.6.26.456, 2026-10-23). On v16 the desk had no
// handler for /SetInternalAsgn (writes were silently dropped); v17 added one.
//
//   /SetInternalAsgn        ,iiiii  [srcGroup, srcCh, destGroup, destIdx, state]
//   /Notify/InternalAssign  ,iiiiii [srcGroup, srcCh, destGroup, destIdx, state, valid]
//
// destIdx is local to the destination group (Group 1 = (1,0), Mon 1 = (25,0)).
// Inside the module FX + Monitor destinations are expressed as (2, combined aux
// index) and translated by AuxMap like every other aux address.
//
// The /Channels record also carries the route state of every strip as an int64
// bitmask (record field 17). Mapped one bit at a time on Channel 80 in the
// 80ch / 8-group / 32-aux mixer mode, each flip restored and re-checked:
//   bits  0-15  Link/DCA 1-16       (group 12)
//   bits 16-23  Mute group 1-8      (group 13 = membership, not engage)
//   bits 24-31  Group 1-8           (group 1)
//   bits 32-39  Matrix 1-8          (group 6)
//   bit  40 LR (3)   41 Mono (5)   42 Center (4)
// FX / Monitor routes are NOT in the mask — they are send-on states.
// The 16-group mixer mode has not been mapped, so the mask is only decoded when
// the desk reports 8 group buses.
//
// No runtime imports on purpose: tests load this file directly.

export interface RouteDest {
	group: number
	idx: number
}

export interface RouteKind {
	id: string
	label: string
	group: number
	/** Single-instance destination (LR / Center / Mono): index is always 0. */
	single?: boolean
	/** Shown by the feedback only — not offered by the action (see note below). */
	feedbackOnly?: boolean
}

/** Destination kinds for the "Route" action / feedback, in display order.
 *
 *  Aux (FX / Monitor) routes are send-on states: /SetInternalAsgn to an aux is
 *  echoed ON and immediately reverted to OFF by the desk (verified live, v17), so
 *  the action drives them with /Set/Aux/Send/On instead.
 *  Matrix: /SetInternalAsgn assigned Input → Matrix 1 but the matching OFF was
 *  acknowledged and NOT applied (the route stayed set) — kept out of the action
 *  until that is understood; the feedback still shows it. */
export const ROUTE_KINDS: RouteKind[] = [
	{ id: 'grp', label: 'Group bus', group: 1 },
	{ id: 'aux', label: 'Aux (FX / Monitor)', group: 2 },
	{ id: 'mtx', label: 'Matrix', group: 6, feedbackOnly: true },
	{ id: 'dca', label: 'DCA / Link', group: 12 },
	{ id: 'mg', label: 'Mute group membership', group: 13 },
	{ id: 'lr', label: 'LR (Main)', group: 3, single: true },
	{ id: 'c', label: 'Center', group: 4, single: true },
	{ id: 'm', label: 'Mono', group: 5, single: true },
]

export function routeKey(srcGroup: number, srcCh: number, dest: RouteDest): string {
	return `${srcGroup}.${srcCh}>${dest.group}.${dest.idx}`
}

/** Decode the /Channels route bitmask (8-group layout only — see header). */
export function decodeRouteMask(mask: bigint): RouteDest[] {
	const out: RouteDest[] = []
	const bit = (n: number) => ((mask >> BigInt(n)) & 1n) === 1n
	for (let i = 0; i < 16; i++) if (bit(i)) out.push({ group: 12, idx: i })
	for (let i = 0; i < 8; i++) if (bit(16 + i)) out.push({ group: 13, idx: i })
	for (let i = 0; i < 8; i++) if (bit(24 + i)) out.push({ group: 1, idx: i })
	for (let i = 0; i < 8; i++) if (bit(32 + i)) out.push({ group: 6, idx: i })
	if (bit(40)) out.push({ group: 3, idx: 0 })
	if (bit(41)) out.push({ group: 5, idx: 0 })
	if (bit(42)) out.push({ group: 4, idx: 0 })
	return out
}

/** Destination groups the bitmask covers — used to clear stale entries when a
 *  fresh /Channels arrives. */
export const MASK_GROUPS = new Set([1, 3, 4, 5, 6, 12, 13])

/** True when an InternalAssign packet describes a TalkBack destination button.
 *  Every other strip uses the same destination ids (Input → FX 1 arrives as
 *  [0, ch, 2, 0, …]), so the source must be checked, not just the destination. */
export function isTalkBackDest(srcGroup: number, srcCh: number, destGroup: number): boolean {
	return srcGroup === 8 && srcCh === 0 && destGroup === 2
}
