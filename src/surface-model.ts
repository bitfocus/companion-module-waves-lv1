// What the module knows about the desk in Companion Surface mode, learned from the driver:
// the track catalogue (names, counts), the flip state of each mixer view and the Talk Back
// preset. Nothing here comes from MyRemote.

import type { ControlAddress, ControlUpdate, InterMapMessage } from './surface-client.js'

/** Track types we list, with the most the desk can have of each (probed on connect). */
export const SURFACE_TRACK_TYPES = [
	{ tt: 0, slug: 'in', label: 'Ch', max: 128 },
	{ tt: 1, slug: 'grp', label: 'Group', max: 16 },
	{ tt: 2, slug: 'fx', label: 'Fx', max: 16 },
	{ tt: 25, slug: 'mon', label: 'Mon', max: 32 },
	{ tt: 6, slug: 'mtx', label: 'Matrix', max: 16 },
	{ tt: 12, slug: 'dca', label: 'Link', max: 16 },
] as const

/** eMotion's mixer views as InterMapper surfaces, and the user-key "mixer" selection for flips. */
export const SURFACE_MIXERS = [
	{ id: 'm1', label: 'Mixer 1', surface: 0, selection: 0 },
	{ id: 'm2', label: 'Mixer 2', surface: 1, selection: 1 },
] as const
export const FLIP_ALL_SELECTION = 10

/** A track's name control: section group 8, control id -1 (text). */
export const nameAddress = (tt: number, track: number): ControlAddress => ({
	tt,
	track,
	group: 8,
	secType: -1,
	secIdx: -1,
	cid: -1,
})

/** Talk Back preset selection: Talk Back track, section 14, control 1 (0-based preset). */
export const TB_PRESET: ControlAddress = { tt: 8, track: 0, group: 14, secType: -1, secIdx: -1, cid: 1 }

/** eMotion fills nothing (our sentinel stays) for tracks that do not exist. */
const MISSING = -12345

export interface SurfaceTrack {
	tt: number
	track: number
	name: string
}

export interface FlipState {
	/** Track the view's master fader shows while flipped: aux type (2 = FX, 25 = Mon) and index. */
	tt: number
	track: number
	on: boolean
}

export class SurfaceModel {
	/** key `${tt}.${track}` */
	tracks = new Map<string, SurfaceTrack>()
	/** key = mixer view surface (0 = Mixer 1, 1 = Mixer 2). Absent = not known yet. */
	flips = new Map<number, FlipState>()
	/** 1-based Talk Back preset, null = unknown. */
	tbPreset: number | null = null

	reset(): void {
		this.tracks.clear()
		this.flips.clear()
		this.tbPreset = null
	}

	/** Addresses to ask for on connect: every possible track name. */
	probeAddresses(): ControlAddress[] {
		const out: ControlAddress[] = []
		for (const t of SURFACE_TRACK_TYPES) for (let i = 0; i < t.max; i++) out.push(nameAddress(t.tt, i))
		out.push(TB_PRESET)
		return out
	}

	/** Returns 'names' when the track catalogue changed, 'tb' for the Talk Back preset, else null. */
	applyControl(c: ControlUpdate): 'names' | 'tb' | null {
		if (c.group === 8 && c.cid === -1 && c.secType === -1 && c.secIdx === -1) {
			const key = `${c.tt}.${c.track}`
			const prev = this.tracks.get(key)
			if (c.value === MISSING && !c.text) {
				if (!prev) return null
				this.tracks.delete(key)
				return 'names'
			}
			if (prev?.name === c.text) return null
			this.tracks.set(key, { tt: c.tt, track: c.track, name: c.text })
			return 'names'
		}
		if (c.tt === TB_PRESET.tt && c.group === TB_PRESET.group && c.cid === TB_PRESET.cid) {
			const preset = c.value === MISSING ? null : Math.round(c.value) + 1
			if (preset === this.tbPreset) return null
			this.tbPreset = preset
			return 'tb'
		}
		return null
	}

	/**
	 * Mixer views announce flips to every surface (verified on v17):
	 *   msg 3: ints @0x14 = track the master fader shows (2 / 25 = flipped to that aux, 3 = LR = not flipped)
	 *   msg 4: ints @0x14 = combined aux index, @0x18 = flip on (1) / off (0)
	 * Returns true when a mixer's flip state changed.
	 */
	applyInterMap(m: InterMapMessage): boolean {
		if (!SURFACE_MIXERS.some((x) => x.surface === m.src) || m.payload.length < 0x1c) return false
		if (m.msg !== 3 && m.msg !== 4) return false
		const a = m.payload.readInt32LE(0x14)
		const b = m.payload.readInt32LE(0x18)
		const prev = this.flips.get(m.src)
		let next: FlipState
		if (m.msg === 3) {
			next =
				a === 2 || a === 25
					? { tt: a, track: b, on: true }
					: { tt: prev?.tt ?? -1, track: prev?.track ?? -1, on: false }
		} else {
			if (b === 1 || !prev) return false // msg 3 carries the target; msg 4 only confirms on / off
			next = { ...prev, on: false }
		}
		if (prev && prev.on === next.on && prev.tt === next.tt && prev.track === next.track) return false
		this.flips.set(m.src, next)
		return true
	}

	/** Tracks of one type, in order. */
	list(tt: number): SurfaceTrack[] {
		return [...this.tracks.values()].filter((t) => t.tt === tt).sort((x, y) => x.track - y.track)
	}

	name(tt: number, track: number): string {
		return this.tracks.get(`${tt}.${track}`)?.name ?? ''
	}

	isFlipped(surface: number, tt: number, track: number): boolean {
		const f = this.flips.get(surface)
		return !!f && f.on && f.tt === tt && f.track === track
	}
}
