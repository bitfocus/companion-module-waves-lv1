// I/O patch — /Notify/IOConnections.
//
// eMotion LV1 v17 publishes the I/O patch to recorder clients. The desk only sends it
// to connections that register as client type 6 (Waves Tracks Live):
//   /handshake i:1 i:-1 i:6     then /device_name s s s
// and re-sends it on every patch change.
//
// Wire shape, read from both ends (MyMonService.dll sender, Tracks Live 2 parser):
//   i:count, then count × ( s, i, s, i, s, i, s )
// Verified live that a patch change re-triggers it — but with a Generic (virtual)
// I/O the desk reported count = 0, so the meaning of each field has NOT been seen
// with real I/O hardware yet. The parser therefore does not trust field order: it
// finds the mixer endpoint by its "Mixer_<Type>_<n>" key (the naming the desk uses
// in ExternalService_IOConnections.csv) and describes the I/O side with the other
// strings.
//
// No runtime imports on purpose: tests load this file directly.

import type { OscArg } from './osc.js'

export interface IOConnectionRow {
	strings: string[]
	ints: number[]
}

/** Mixer endpoint type names → LV1 track group (taken from Tracks Live 2). */
export const MIXER_TYPE_GROUP: Record<string, number> = {
	Ch: 0,
	Gp: 1,
	EFX: 2,
	Main: 3,
	Center: 4,
	Mono: 5,
	Mtx: 6,
	Cue: 7,
	TB: 8,
	DCA: 12,
	CR: 22,
	CRGrp: 23,
	Mon: 25,
}

export function parseIOConnections(args: OscArg[]): IOConnectionRow[] | null {
	const count = args[0]?.type === 'i' ? args[0].value : null
	if (count == null || count < 0) return null
	if (count === 0) return []
	const per = Math.floor((args.length - 1) / count)
	if (per < 6) return null
	const rows: IOConnectionRow[] = []
	for (let r = 0; r < count; r++) {
		const slice = args.slice(1 + r * per, 1 + (r + 1) * per)
		const row: IOConnectionRow = { strings: [], ints: [] }
		for (const a of slice) {
			if (a.type === 's') row.strings.push(a.value)
			else if (a.type === 'i') row.ints.push(a.value)
		}
		rows.push(row)
	}
	return rows
}

const MIXER_KEY = /^Mixer_([A-Za-z]+)_(\d+)$/
const MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i

/** Mixer track a row belongs to (wire group, 0-based ch), or null if the row
 *  carries no recognisable "Mixer_<Type>_<n>" key. */
export function rowTrack(row: IOConnectionRow): { group: number; ch: number } | null {
	for (const s of row.strings) {
		const m = MIXER_KEY.exec(s)
		if (!m) continue
		const group = MIXER_TYPE_GROUP[m[1]]
		if (group == null) continue
		return { group, ch: Number(m[2]) - 1 }
	}
	return null
}

/** Human-readable description of the I/O side of a row: every string except the
 *  mixer key and MAC addresses, e.g. "IONIC 24-1 Analog_Mic/Line_1". */
export function rowLabel(row: IOConnectionRow): string {
	return row.strings
		.filter((s) => s && !MIXER_KEY.test(s) && !MAC.test(s))
		.join(' ')
		.trim()
}
