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
	{ tt: 3, slug: 'lr', label: 'LR', max: 1 },
	{ tt: 4, slug: 'c', label: 'Center', max: 1 },
	{ tt: 5, slug: 'm', label: 'Mono', max: 1 },
] as const

/** Track types that have an output section (fader, mute, solo, pan) and a plugin rack. */
export const STRIP_TYPES = [0, 1, 2, 25, 6, 12, 3, 4, 5]
export const RACK_TYPES = [0, 1, 2, 25, 6, 3, 4, 5]
export const RACK_SLOTS = 8

/** User mute groups (track type 13) and the special groups (type 16: track 1 = Mute All). */
export const MUTE_GROUP_TT = 13
export const MUTE_GROUPS = 8
export const MUTE_ALL: ControlAddress = { tt: 16, track: 1, group: 7, secType: -1, secIdx: -1, cid: 11 }
export const muteGroupAddress = (n: number): ControlAddress => ({
	tt: MUTE_GROUP_TT,
	track: n,
	group: 7,
	secType: -1,
	secIdx: -1,
	cid: 11,
})

/** A strip's output controls. Fader: write cid 0 in dB (mode 3); eMotion displays it on cid 1. */
export const strip = {
	fader: (tt: number, track: number): ControlAddress => ({ tt, track, group: 7, secType: -1, secIdx: -1, cid: 0 }),
	faderDisplay: (tt: number, track: number): ControlAddress => ({
		tt,
		track,
		group: 7,
		secType: -1,
		secIdx: -1,
		cid: 1,
	}),
	mute: (tt: number, track: number): ControlAddress => ({ tt, track, group: 7, secType: -1, secIdx: -1, cid: 11 }),
	solo: (tt: number, track: number): ControlAddress => ({ tt, track, group: 7, secType: -1, secIdx: -1, cid: 10 }),
	pan: (tt: number, track: number): ControlAddress => ({ tt, track, group: 7, secType: -1, secIdx: -1, cid: 6 }),
	slotName: (tt: number, track: number, slot: number): ControlAddress => ({
		tt,
		track,
		group: 4,
		secType: slot,
		secIdx: -1,
		cid: 0,
	}),
	slotCode: (tt: number, track: number, slot: number): ControlAddress => ({
		tt,
		track,
		group: 4,
		secType: slot,
		secIdx: -1,
		cid: 1,
	}),
	param: (tt: number, track: number, slot: number, param: number): ControlAddress => ({
		tt,
		track,
		group: 4,
		secType: slot,
		secIdx: param,
		cid: 11,
	}),
}

export interface PluginParam {
	index: number
	name: string
	min: number
	max: number
	minText: string
	maxText: string
	/** 'state' = the value is a state number (On/Off, Bell/Shelf…); else 0-1000 over min..max. */
	kind: 'state' | 'continuous'
	/** Continuous scale, learned from a live value and its display text. */
	scale: 'linear' | 'log' | null
}

export interface PluginInfo {
	code: string
	name: string
	params: Map<number, PluginParam>
}

/** A display text as a number ("-18.8" → -18.8, "-Inf" → -144), or null. */
export function displayNumber(text: string): number | null {
	const t = text.trim()
	if (/^-?inf/i.test(t)) return t.startsWith('-') ? -144 : null
	const n = parseFloat(t.replace(/[^0-9.+-].*$/, ''))
	return Number.isFinite(n) ? n : null
}

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
	/** Plugin in each rack slot, key `${tt}.${track}.${slot}`. */
	slots = new Map<string, { name: string; code: string }>()
	/** Parameter catalogue per plugin code (MQ4M, CDYM…), read from the desk. */
	plugins = new Map<string, PluginInfo>()
	/** Output meters per strip, key `${tt}.${track}`: legs (0 = left / mono, 1 = right) and clip. */
	meters = new Map<string, { legs: number[]; clip: boolean }>()
	/** Real-world values (dB…), key = controlKey of the written control. */
	real = new Map<string, number>()
	/** eMotion GUI state from its signals; null = not reported yet. */
	gui = {
		talk: null as boolean | null,
		consoleLock: null as boolean | null,
		surfaceLock: null as boolean | null,
		recording: null as boolean | null,
		scene: null as number | null,
		sceneNames: new Map<number, string>(),
		sceneDirty: null as boolean | null,
		sceneUndo: null as number | null,
		soloActive: null as boolean | null,
		tempo: null as number | null,
		channelName: '',
		session: '',
		sessionDirty: null as boolean | null,
		userKeyLights: new Map<number, boolean>(),
	}

	reset(): void {
		this.tracks.clear()
		this.flips.clear()
		this.tbPreset = null
		this.slots.clear()
		this.real.clear()
		this.meters.clear()
		this.gui.sceneNames.clear()
		this.gui.userKeyLights.clear()
		this.gui.talk = null
		this.gui.consoleLock = null
		this.gui.surfaceLock = null
		this.gui.recording = null
		this.gui.scene = null
		this.gui.sceneDirty = null
		this.gui.sceneUndo = null
		this.gui.soloActive = null
		this.gui.tempo = null
		this.gui.sessionDirty = null
		this.gui.channelName = ''
		this.gui.session = ''
	}

	/**
	 * eMotion's state signals → GUI state. Returns what changed (for feedback refreshes), or
	 * null for signals we do not use.
	 */
	applySignal(name: string, args: unknown[]): string | null {
		const b = (i: number) => args[i] === true
		const n = (i: number) => (typeof args[i] === 'number' ? args[i] : null)
		const t = (i: number) => (typeof args[i] === 'string' ? args[i] : '')
		switch (name) {
			case 'talkStatusChanged':
				this.gui.talk = b(0)
				return 'talk'
			case 'consoleLockStatus':
				this.gui.consoleLock = b(0)
				return 'lock'
			case 'surfaceLockStatus':
				this.gui.surfaceLock = b(0)
				return 'lock'
			case 'recordStateChanged':
				this.gui.recording = b(0)
				return 'recording'
			case 'currentSceneChanged':
				this.gui.scene = n(0)
				return 'scene'
			case 'sceneNameChanged': {
				const i = n(0)
				if (i != null) this.gui.sceneNames.set(i, t(1))
				return 'scene'
			}
			case 'sceneDirtyChanged':
				this.gui.sceneDirty = b(0)
				return 'scene'
			case 'sceneUndoCount':
				this.gui.sceneUndo = n(0)
				return 'scene'
			case 'cueStatusChanged':
				this.gui.soloActive = b(0)
				return 'solo'
			case 'tempoChanged':
				this.gui.tempo = n(0)
				return 'tempo'
			case 'currentChannelNameChanged':
				this.gui.channelName = t(0)
				return 'channel'
			case 'currentSessionNameChanged':
				this.gui.session = t(0)
				return 'session'
			case 'sessionDirtyStatus':
				this.gui.sessionDirty = b(0)
				return 'session'
			case 'userKeyLight': {
				const i = n(0)
				if (i != null) this.gui.userKeyLights.set(i, b(1))
				return 'userkey'
			}
			default:
				return null
		}
	}

	/** Plugin slot name / code reports. Returns true when a slot's plugin changed. */
	applySlot(c: ControlUpdate): boolean {
		if (c.group !== 4 || c.secIdx !== -1 || (c.cid !== 0 && c.cid !== 1) || c.secType < 0) return false
		const key = `${c.tt}.${c.track}.${c.secType}`
		const prev = this.slots.get(key) ?? { name: '', code: '' }
		const text = c.value === MISSING ? '' : c.text
		const next = c.cid === 0 ? { ...prev, name: text } : { ...prev, code: text }
		if (next.name === prev.name && next.code === prev.code) return false
		if (!next.name && !next.code) this.slots.delete(key)
		else this.slots.set(key, next)
		return true
	}

	/** A parameter's properties (name, range). Returns true when the catalogue changed. */
	applyProps(
		code: string,
		pluginName: string,
		p: { secIdx: number; name: string; min: number; max: number; minText: string; maxText: string },
	): boolean {
		if (!code || p.secIdx < 0) return false
		let info = this.plugins.get(code)
		if (!info) {
			info = { code, name: pluginName, params: new Map() }
			this.plugins.set(code, info)
		}
		if (!p.name) return false
		const numeric = displayNumber(p.minText) != null && displayNumber(p.maxText) != null
		info.params.set(p.secIdx, {
			index: p.secIdx,
			name: p.name,
			min: p.min,
			max: p.max,
			minText: p.minText,
			maxText: p.maxText,
			kind: numeric ? 'continuous' : 'state',
			scale: info.params.get(p.secIdx)?.scale ?? null,
		})
		return true
	}

	/** Plugin code in a slot, if known. */
	slotCode(tt: number, track: number, slot: number): string {
		return this.slots.get(`${tt}.${track}.${slot}`)?.code ?? ''
	}

	/** First slot of a strip holding that plugin, or -1. */
	findSlot(tt: number, track: number, code: string): number {
		for (let s = 0; s < RACK_SLOTS; s++) if (this.slotCode(tt, track, s) === code) return s
		return -1
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
