// Companion variables — one per track property (mute/solo/gain/name), plus globals
// (tempo, scene, mute groups). Variable IDs follow `{group}{ch1based}_{prop}`,
// e.g. `in1_mute`, `aux9_gain`, `lr_mute`, `mg_1`, `tempo`.
//
// Definitions are rebuilt every time the mixer config changes (detected.channels /
// auxes / layers update). Values are pushed from main.ts as state arrives.

import type { CompanionVariableDefinition, CompanionVariableValues } from '@companion-module/base'
import type { LV1Instance } from './main.js'
import { enumerateTracks, trackLabel, trackSlug } from './tracks.js'

export { trackSlug }

export function UpdateVariables(self: LV1Instance): void {
	const defs: CompanionVariableDefinition[] = []

	for (const { group, ch } of enumerateTracks(self)) {
		const slug = trackSlug(group, ch)
		const label = trackLabel(self, group, ch)
		defs.push({ variableId: `${slug}_name`, name: `${label} — name` })
		defs.push({ variableId: `${slug}_mute`, name: `${label} — mute (on/off)` })
		defs.push({ variableId: `${slug}_solo`, name: `${label} — solo (on/off)` })
		defs.push({ variableId: `${slug}_gain`, name: `${label} — fader (dB)` })
		defs.push({ variableId: `${slug}_pan`, name: `${label} — pan (-1..+1)` })
		defs.push({ variableId: `${slug}_width`, name: `${label} — stereo width (0..1)` })
		defs.push({ variableId: `${slug}_vu`, name: `${label} — VU meter, L/mono (dB, ~0.8 Hz)` })
		defs.push({ variableId: `${slug}_vu_r`, name: `${label} — VU meter, R of stereo (dB)` })
		defs.push({ variableId: `${slug}_color`, name: `${label} — color (#RRGGBB)` })
	}

	// Globals.
	defs.push({ variableId: 'tempo', name: 'Tempo (BPM)' })
	defs.push({ variableId: 'scene_index', name: 'Current scene index (0-based)' })
	defs.push({ variableId: 'scene_name', name: 'Current scene name' })
	defs.push({ variableId: 'scene_count', name: 'Total scenes' })
	defs.push({ variableId: 'channels_total', name: 'Total input channels (detected)' })
	defs.push({ variableId: 'auxes_total', name: 'Total aux buses (detected)' })
	defs.push({ variableId: 'flip_active', name: 'Flip-to-faders active (on/off)' })
	defs.push({ variableId: 'flip_aux', name: 'Flipped aux 1-based (0 = none)' })
	defs.push({ variableId: 'flip_group', name: 'Flipped target group (3=LR if none)' })
	defs.push({ variableId: 'flip_ch', name: 'Flipped target channel (0-based)' })
	defs.push({ variableId: 'flip_name', name: 'Flipped target name ("Mon 1", "LR", …)' })
	defs.push({ variableId: 'current_mixer', name: 'Active mixer view (1 = Mixer 1, 2 = Mixer 2)' })
	defs.push({ variableId: 'current_layer_index', name: 'Active surface layer index (1-8) within the current mixer' })
	for (let i = 1; i <= 8; i++) {
		defs.push({ variableId: `mg_${i}`, name: `Mute group ${i} (on/off)` })
	}
	// User Assignable Keys (16 slots, 1-based for the UI).
	for (let i = 1; i <= 16; i++) {
		defs.push({ variableId: `userkey_${i}_name`, name: `User key ${i} — short label (e.g. "Mon 1")` })
		defs.push({
			variableId: `userkey_${i}_function`,
			name: `User key ${i} — full function (e.g. "Flip Sends: MX1: Mon 1")`,
		})
		defs.push({ variableId: `userkey_${i}_assigned`, name: `User key ${i} — assigned (on/off)` })
	}
	// One variable per scene with its name. Iterate up to the highest index we've seen
	// (scenes can be sparse if user deleted some, but typically contiguous from 0).
	for (const [idx, name] of self.scenes) {
		defs.push({ variableId: `scene_${idx + 1}_name`, name: `Scene ${idx + 1} name (${name})` })
	}

	self.setVariableDefinitions(defs)
	pushAll(self)
}

/** Push the current state of EVERY known variable. Call after definitions change
 *  or when a connect/reconnect bulk-arrives. */
export function pushAll(self: LV1Instance): void {
	const values: CompanionVariableValues = {}
	for (const { group, ch } of enumerateTracks(self)) {
		const slug = trackSlug(group, ch)
		const s = self.channels.get(`${group}.${ch}`)
		values[`${slug}_name`] = s?.name ?? ''
		values[`${slug}_mute`] = s?.muted ? 'on' : 'off'
		values[`${slug}_solo`] = s?.solo ? 'on' : 'off'
		values[`${slug}_gain`] = s?.gain != null ? s.gain.toFixed(1) : ''
		values[`${slug}_pan`] = s?.pan != null ? s.pan.toFixed(2) : ''
		values[`${slug}_width`] = s?.width != null ? s.width.toFixed(2) : ''
		values[`${slug}_color`] = s?.color ? toHex(s.color) : ''
		const vuL = self.meters.get(`${group}.${ch}.0`)
		const vuR = self.meters.get(`${group}.${ch}.1`)
		values[`${slug}_vu`] = vuL != null ? vuL.toFixed(1) : ''
		values[`${slug}_vu_r`] = vuR != null ? vuR.toFixed(1) : ''
	}
	values['tempo'] = self.lastTempoBpm != null ? self.lastTempoBpm.toFixed(1) : ''
	values['scene_index'] = self.currentScene ?? ''
	values['scene_name'] = self.currentSceneName ?? ''
	values['scene_count'] = self.scenes.size
	values['channels_total'] = self.effectiveChannels()
	values['auxes_total'] = self.effectiveAuxes()
	// Flip state — same logic as pushFlipVariables() in main.ts (kept in sync).
	const t = self.currentFlipTarget
	values['flip_active'] = t ? 'on' : 'off'
	values['flip_group'] = t ? t.group : 3
	values['flip_ch'] = t ? t.ch : 0
	values['flip_aux'] = t && t.group === 2 ? t.ch + 1 : 0
	values['flip_name'] = t
		? t.group === 2
			? (self.detected.auxNames?.[t.ch] ?? `Aux ${t.ch + 1}`)
			: (self.channels.get(`${t.group}.${t.ch}`)?.name ?? `g${t.group}.${t.ch}`)
		: 'LR'
	values['current_mixer'] = self.currentMixer ?? ''
	values['current_layer_index'] = self.currentLayer != null ? self.currentLayer + 1 : ''
	for (let i = 1; i <= 8; i++) {
		values[`mg_${i}`] = self.muteGroups.get(i - 1) ? 'on' : 'off'
	}
	for (let i = 1; i <= 16; i++) {
		const uk = self.userKeys.get(i - 1)
		values[`userkey_${i}_name`] = uk?.name ?? ''
		values[`userkey_${i}_function`] = uk?.func ?? ''
		values[`userkey_${i}_assigned`] = uk?.assigned ? 'on' : 'off'
	}
	for (const [idx, name] of self.scenes) {
		values[`scene_${idx + 1}_name`] = name
	}
	self.setVariableValues(values)
}

/** Push a single track's mute/solo/gain/pan/width/name/color value. Cheap — call from handleNotify. */
export function pushTrack(
	self: LV1Instance,
	group: number,
	ch: number,
	prop: 'mute' | 'solo' | 'gain' | 'pan' | 'width' | 'name' | 'color',
): void {
	const slug = trackSlug(group, ch)
	const s = self.channels.get(`${group}.${ch}`)
	if (!s) return
	const v: CompanionVariableValues = {}
	if (prop === 'mute') v[`${slug}_mute`] = s.muted ? 'on' : 'off'
	if (prop === 'solo') v[`${slug}_solo`] = s.solo ? 'on' : 'off'
	if (prop === 'gain') v[`${slug}_gain`] = s.gain != null ? s.gain.toFixed(1) : ''
	if (prop === 'pan') v[`${slug}_pan`] = s.pan != null ? s.pan.toFixed(2) : ''
	if (prop === 'width') v[`${slug}_width`] = s.width != null ? s.width.toFixed(2) : ''
	if (prop === 'name') v[`${slug}_name`] = s.name ?? ''
	if (prop === 'color') v[`${slug}_color`] = s.color ? toHex(s.color) : ''
	self.setVariableValues(v)
}

function toHex(c: { r: number; g: number; b: number }): string {
	const toByte = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)))
	const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase()
	return `#${hex(toByte(c.r))}${hex(toByte(c.g))}${hex(toByte(c.b))}`
}
