// Aux-bus addressing across eMotion LV1 v16 and v17.
//
// eMotion LV1 v17 split the old "Aux" track group (2) in two: FX buses stay in
// group 2, Monitor buses moved to a NEW group 25 with their own 0-based index.
// The SEND plane did not change — /Set/Aux/Send/*, /Get/Sends and the order of
// /Aux/Tracks still use one combined aux index (FX first, then Monitors).
//
// VERIFIED LIVE (eMotion LV1 v.17.6.26.456, 80ch / 8 FX / 24 Mon, 2026-10-23):
//   /Aux/Tracks              i:32 (0,2,"Fx 1")…(7,2,"Fx 8") (0,25,"Mon 1")…(23,25,"Mon 24")
//   /Set/Aux/Send/On         [0,79, 8,T]  → Ch 80 → Mon 1        (combined index)
//   /Set/Track/Out/Gain      [25,23,d]    → Mon 24 fader moves
//   /Set/Track/Out/Gain      [2,31,d]     → silently ignored
//   /Notify/Track/Out/Mute   [25,23,1,T]
//   /Notify/InternalAssign   [0,79,25,0,1,1]  (Ch 80 → Mon 1, dest = group 25 idx 0)
// On v16 every /Aux/Tracks entry is (combined, 2, name), so both mappings below
// are the identity and nothing changes for v16 desks.
//
// The module keeps addressing every aux as (2, combinedIndex) internally — so
// existing buttons, presets and `auxN_*` variables keep their meaning — and
// translates only at the wire boundary.
//
// No runtime imports on purpose: tests load this file directly.

import type { OscArg, OscMessage } from './osc.js'

export const AUX_GROUP = 2
export const MON_GROUP = 25

export interface AuxEntry {
	/** Track group on the wire: 2 (FX, and every aux on v16) or 25 (Monitor, v17+). */
	group: number
	/** Index within that group on the wire. */
	local: number
	name: string
}

/** Parse a /Aux/Tracks reply: i:count, then (i idx, i group, s name) × count. */
export function parseAuxTracks(args: OscArg[]): AuxEntry[] {
	const out: AuxEntry[] = []
	for (let i = 1; i + 2 < args.length; i += 3) {
		const idx = args[i]
		const group = args[i + 1]
		const name = args[i + 2]
		if (idx?.type !== 'i' || group?.type !== 'i' || name?.type !== 's') continue
		out.push({ group: group.value, local: idx.value, name: name.value })
	}
	return out
}

/** Outgoing addresses whose args[0..1] are a (group, ch) track address. */
const OUT_TRACK = /^\/(Set\/Track|Set\/Solo$|Set\/Aux\/Send\/|SetTrack|SetInternalAsgn$)/
/** Incoming addresses whose args[0..1] are a (group, ch) track address. Deliberately
 *  a whitelist: /Notify/Sends* lead with a combined aux index, /Notify/SceneList with
 *  a count, etc. — rewriting those would corrupt them. */
const IN_TRACK =
	/^\/Notify\/(Track|Solo$|Aux\/Send\/|PanArcWidth$|Balance$|Pha(se|ntom)State$|RangePRGain$|LocalGain|GEQ\/|EQ|(Filter|Dynamics|Gate|Compressor|Leveler|Limiter|DeEsser)State$|InternalAssign$|StemFormatForSource$)/
/** Addresses that ALSO carry a destination (group, index) in args[2..3]. */
const DEST_PAIR = /^\/(Notify\/InternalAssign|SetInternalAsgn)$/

export class AuxMap {
	private entries: AuxEntry[] = []
	private byWire = new Map<string, number>()

	set(entries: AuxEntry[]): void {
		this.entries = entries
		this.byWire.clear()
		entries.forEach((e, i) => this.byWire.set(`${e.group}.${e.local}`, i))
	}

	get size(): number {
		return this.entries.length
	}

	/** True once a v17-style /Aux/Tracks (with group-25 monitors) has been seen. */
	get splitMonitors(): boolean {
		return this.entries.some((e) => e.group === MON_GROUP)
	}

	names(): string[] {
		return this.entries.map((e) => e.name)
	}

	/** Module-internal (group, ch) → wire (group, ch). Only (2, combined) changes. */
	toWire(group: number, ch: number): [number, number] {
		if (group === AUX_GROUP) {
			const e = this.entries[ch]
			if (e) return [e.group, e.local]
		}
		return [group, ch]
	}

	/** Wire (group, ch) → module-internal. (25, local) → (2, combined). */
	fromWire(group: number, ch: number): [number, number] {
		if (group === AUX_GROUP || group === MON_GROUP) {
			const idx = this.byWire.get(`${group}.${ch}`)
			if (idx != null) return [AUX_GROUP, idx]
		}
		return [group, ch]
	}

	translateOutgoing(address: string, args: OscArg[]): OscArg[] {
		if (!OUT_TRACK.test(address)) return args
		return this.rewrite(address, args, (g, c) => this.toWire(g, c))
	}

	translateIncoming(m: OscMessage): OscMessage {
		if (!IN_TRACK.test(m.address)) return m
		const args = this.rewrite(m.address, m.args, (g, c) => this.fromWire(g, c))
		return args === m.args ? m : { address: m.address, args }
	}

	private rewrite(address: string, args: OscArg[], map: (g: number, c: number) => [number, number]): OscArg[] {
		let out = args
		const pair = (at: number) => {
			const g = out[at]
			const c = out[at + 1]
			if (g?.type !== 'i' || c?.type !== 'i') return
			const [ng, nc] = map(g.value, c.value)
			if (ng === g.value && nc === c.value) return
			if (out === args) out = [...args]
			out[at] = { type: 'i', value: ng }
			out[at + 1] = { type: 'i', value: nc }
		}
		pair(0)
		if (DEST_PAIR.test(address)) pair(2)
		return out
	}
}
