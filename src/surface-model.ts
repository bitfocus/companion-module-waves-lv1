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

/**
 * Controls MyRemote also reaches (same addresses as eMotion's MyRemote server uses), written and
 * read in real-world units: the output pan section, sends, the input section.
 */
export const pan = {
	/** Pan (mono) / balance (stereo), group 7 cid 6. */
	pan: (tt: number, track: number): ControlAddress => ({ tt, track, group: 7, secType: -1, secIdx: -1, cid: 6 }),
	/** Stereo width, cid 5 (-1.4 .. 1.4, 1 = normal). */
	width: (tt: number, track: number): ControlAddress => ({ tt, track, group: 7, secType: -1, secIdx: -1, cid: 5 }),
	/** Stereo rotation, cid 2 (degrees, -45 .. 45). */
	rotate: (tt: number, track: number): ControlAddress => ({ tt, track, group: 7, secType: -1, secIdx: -1, cid: 2 }),
}

/** A strip's send to an aux (eMotion's combined aux index: FX first, then Monitors), group 5. */
export const send = {
	on: (tt: number, track: number, aux: number): ControlAddress => ({
		tt,
		track,
		group: 5,
		secType: aux,
		secIdx: -1,
		cid: 0,
	}),
	level: (tt: number, track: number, aux: number): ControlAddress => ({
		tt,
		track,
		group: 5,
		secType: aux,
		secIdx: -1,
		cid: 2,
	}),
	pan: (tt: number, track: number, aux: number): ControlAddress => ({
		tt,
		track,
		group: 5,
		secType: aux,
		secIdx: -1,
		cid: 7,
	}),
}

/** eMotion's Modes presets in a new session (each can be renamed in the session). */
export const DEFAULT_MODE_NAMES = ['Home', 'Setup', 'SndChk', 'Edit', 'Fx', 'Monitor', 'Status', 'Dugan']

/** Key of an internal route in SurfaceModel.routes. */
export const surfaceRouteKey = (srcTt: number, srcTrack: number, dstTt: number, dstTrack: number): string =>
	`${srcTt}.${srcTrack}>${dstTt}.${dstTrack}`

/** Internal route destinations (Patch > Internal), as the MyRemote mode offers them; Aux = the send. */
export const ROUTE_DESTS = [
	{ id: 'grp', label: 'Group bus', tt: 1, count: 16 },
	{ id: 'aux', label: 'Aux (FX / Monitor send)', tt: -1, count: 0 },
	{ id: 'mtx', label: 'Matrix', tt: 6, count: 16 },
	{ id: 'dca', label: 'Link (DCA)', tt: 12, count: 16 },
	{ id: 'mg', label: 'Mute group membership', tt: 13, count: 8 },
	{ id: 'lr', label: 'LR (Main)', tt: 3, count: 1 },
	{ id: 'c', label: 'Center', tt: 4, count: 1 },
	{ id: 'm', label: 'Mono', tt: 5, count: 1 },
] as const

/** Talk Back track: its sends are the Talk Back destinations (engage to output). */
export const TALKBACK_TT = 8

/**
 * An input channel's input section (group 0): input bank A / B (cid 5, 0 = A); per bank and leg
 * (0 = left / mono, 1 = right) the preamp gain (cid 0, dB) and +48 V (cid 2); per leg the
 * polarity (cid 7) and the digital trim (cid 8, dB).
 */
export const input = {
	bank: (track: number): ControlAddress => ({ tt: 0, track, group: 0, secType: -1, secIdx: -1, cid: 5 }),
	gain: (track: number, bank: number, leg: number): ControlAddress => ({
		tt: 0,
		track,
		group: 0,
		secType: bank,
		secIdx: leg,
		cid: 0,
	}),
	phantom: (track: number, bank: number, leg: number): ControlAddress => ({
		tt: 0,
		track,
		group: 0,
		secType: bank,
		secIdx: leg,
		cid: 2,
	}),
	polarity: (track: number, leg: number): ControlAddress => ({
		tt: 0,
		track,
		group: 0,
		secType: -1,
		secIdx: leg,
		cid: 7,
	}),
	trim: (track: number, leg: number): ControlAddress => ({ tt: 0, track, group: 0, secType: -1, secIdx: leg, cid: 8 }),
}

/** A track's colour: group 18, cid -1, value = index in eMotion's 32-colour palette (read only). */
export const colorAddress = (tt: number, track: number): ControlAddress => ({
	tt,
	track,
	group: 18,
	secType: -1,
	secIdx: -1,
	cid: -1,
})

/** eMotion's track colours, by palette index. */
export const LV1_PALETTE = [
	'#5e98a0',
	'#3c5f7b',
	'#6455af',
	'#61ac61',
	'#1a8e66',
	'#87ccd1',
	'#6c869b',
	'#d9a964',
	'#d96464',
	'#0564dc',
	'#239dcb',
	'#05ffff',
	'#136a84',
	'#87a5d2',
	'#0fa2ab',
	'#718f76',
	'#64ffa5',
	'#8c51c0',
	'#cd878c',
	'#ffe664',
	'#e14040',
	'#ffffff',
	'#b4055a',
	'#8cff12',
	'#a0a0a0',
	'#fa7b14',
	'#ff00ff',
	'#cc8ec1',
	'#e4618d',
	'#98845c',
	'#946b7c',
	'#a04182',
]

/** Controls whose value is kept in real-world units (model.real) rather than eMotion's raw 0-1000. */
export function isRealValued(a: ControlAddress): boolean {
	if (a.group === 7) return a.secType === -1 && (a.cid === 0 || a.cid === 2 || a.cid === 5 || a.cid === 6)
	if (a.group === 5) return a.secType >= 0 && (a.cid === 2 || a.cid === 7)
	if (a.group === 0 && a.tt === 0) return (a.cid === 0 && a.secType >= 0) || (a.cid === 8 && a.secType === -1)
	return false
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

/** eMotion's mixer views as InterMapper surfaces (Mixer 1, Mixer 2 and the All page, each with its
 *  own aux flip), the user-key "mixer" selection for flips, and the name of its flip variable. */
export const SURFACE_MIXERS = [
	{ id: 'm1', label: 'Mixer 1', surface: 0, selection: 0, variable: 'mixer1_flip' },
	{ id: 'm2', label: 'Mixer 2', surface: 1, selection: 1, variable: 'mixer2_flip' },
	{ id: 'all', label: 'All', surface: 27, selection: 10, variable: 'all_flip' },
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
		/** Page eMotion shows ("Mixer 1", "Channel"…), from the driver. */
		page: '',
	}
	/** The session's scene names, in order (driver `scenes`). */
	sceneList: string[] = []
	/** eMotion's version. */
	appVersion = ''
	/** Layer each mixer view shows (0-based), key = view surface. */
	layers = new Map<number, number>()
	/** INPUT / MIX layers of each mixer view (80-channel mode), key = view. */
	mixLayers = new Map<number, { active: boolean; mix: boolean }>()
	/** Modes preset (1-8) each mixer view shows, key = view (0 Mixer 1, 1 Mixer 2). */
	modePresets = new Map<number, number>()
	/** The session's Modes preset names (eMotion's defaults until the desk sent them). */
	modeNames: string[] = [...DEFAULT_MODE_NAMES]
	/** Internal routes read from the desk, key surfaceRouteKey(). */
	routes = new Map<string, boolean>()
	/** User key definitions eMotion announced (userKeyDataNotified), key `${surface}.${index}`. */
	userKeys = new Map<string, { action: number; sel: number; tt: number; ti: number }>()

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
		this.gui.page = ''
		this.sceneList = []
		this.layers.clear()
		this.routes.clear()
		this.modePresets.clear()
		this.mixLayers.clear()
		this.userKeys.clear()
	}

	/** userKeyDataNotified [surface, index, {action, sel, tt, ti}]. True when a definition changed. */
	applyUserKeyData(args: unknown[]): boolean {
		const [surface, index, data] = args
		if (typeof surface !== 'number' || typeof index !== 'number' || !data || typeof data !== 'object') return false
		const d = data as Record<string, unknown>
		const num = (v: unknown) => (typeof v === 'number' ? v : -1)
		const next = { action: num(d.action), sel: num(d.sel), tt: num(d.tt), ti: num(d.ti) }
		const key = `${surface}.${index}`
		const prev = this.userKeys.get(key)
		if (prev && prev.action === next.action && prev.sel === next.sel && prev.tt === next.tt && prev.ti === next.ti)
			return false
		this.userKeys.set(key, next)
		return true
	}

	/** eMotion's combined aux index of an FX (2) or Monitor (25) bus: FX first, then Monitors; -1 otherwise. */
	auxIndex(tt: number, track: number): number {
		return tt === 2 ? track : tt === 25 ? this.list(2).length + track : -1
	}

	/** A mixer view's state (InterMapper msg 0, double @0x14 = current layer). True when it changed. */
	applyLayer(m: InterMapMessage): boolean {
		if (m.msg !== 0 || !SURFACE_MIXERS.some((x) => x.surface === m.src) || m.payload.length < 0x1c) return false
		const layer = Math.round(m.payload.readDoubleLE(0x14))
		if (!Number.isFinite(layer) || layer < 0 || layer > 64 || this.layers.get(m.src) === layer) return false
		this.layers.set(m.src, layer)
		return true
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
			case 'pageShown':
				this.gui.page = t(0)
				return 'page'
			case 'mixLayer': {
				const view = n(0)
				if (view == null) return null
				const next = { active: b(1), mix: b(2) }
				const prev = this.mixLayers.get(view)
				if (prev && prev.active === next.active && prev.mix === next.mix) return null
				this.mixLayers.set(view, next)
				return 'modes'
			}
			case 'modePreset': {
				const view = n(0)
				const preset = n(1)
				if (view == null || preset == null || this.modePresets.get(view) === preset) return null
				this.modePresets.set(view, preset)
				return 'modes'
			}
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
			// eMotion also sends section titles as track -1: only real tracks are strips.
			const type = SURFACE_TRACK_TYPES.find((t) => t.tt === c.tt)
			if (c.track < 0 || (type && c.track >= type.max)) return null
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
