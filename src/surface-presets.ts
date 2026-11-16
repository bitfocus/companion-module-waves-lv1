// Ready-made buttons for the Companion Surface mode: one flip button per mixer and aux (named
// after the aux, lit only while that mixer is flipped to it), Talk Back presets and TALK.

import { CompanionPresetDefinitions, combineRgb } from '@companion-module/base'
import type { LV1Instance } from './main.js'
import { MUTE_ALL, STRIP_TYPES, SURFACE_MIXERS, SURFACE_TRACK_TYPES, strip } from './surface-model.js'
import { controlKey } from './surface-client.js'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)

export function surfacePresets(self: LV1Instance): CompanionPresetDefinitions {
	const presets: CompanionPresetDefinitions = {}
	const label = self.label

	for (const mixer of SURFACE_MIXERS) {
		for (const t of SURFACE_TRACK_TYPES.filter((x) => x.tt === 2 || x.tt === 25)) {
			for (const tr of self.surfaceModel.list(t.tt)) {
				const aux = `${t.tt}:${tr.track}`
				presets[`flip_${mixer.id}_${t.slug}${tr.track + 1}`] = {
					type: 'button',
					category: `Flip ${mixer.label}`,
					name: `Flip ${mixer.label} to ${t.label} ${tr.track + 1}`,
					style: {
						text: `${mixer.label}\n$(${label}:${t.slug}${tr.track + 1}_name)`,
						size: '14',
						color: WHITE,
						bgcolor: BLACK,
					},
					steps: [
						{
							down: [{ actionId: 'surfaceFlip', options: { mixer: mixer.id, aux, state: 'toggle', state_expr: '' } }],
							up: [],
						},
					],
					feedbacks: [
						{
							feedbackId: 'surfaceFlip',
							options: { mixer: mixer.id, aux },
							style: { bgcolor: combineRgb(0, 120, 200), color: WHITE },
						},
					],
				}
			}
		}
	}

	for (let p = 1; p <= 8; p++) {
		presets[`tb_preset_${p}`] = {
			type: 'button',
			category: 'Talk Back',
			name: `Talk Back preset ${p}`,
			style: { text: `TB\nPRESET ${p}`, size: '14', color: WHITE, bgcolor: BLACK },
			steps: [{ down: [{ actionId: 'surfaceTbPreset', options: { preset: String(p) } }], up: [] }],
			feedbacks: [
				{
					feedbackId: 'surfaceTbPreset',
					options: { preset: p },
					style: { bgcolor: combineRgb(200, 120, 0), color: WHITE },
				},
			],
		}
	}

	presets.tb_talk = {
		type: 'button',
		category: 'Talk Back',
		name: 'TALK (hold)',
		style: { text: 'TALK', size: '18', color: WHITE, bgcolor: BLACK },
		steps: [
			{
				down: [{ actionId: 'surfaceTalk', options: { state: 'on', state_expr: '' } }],
				up: [{ actionId: 'surfaceTalk', options: { state: 'off', state_expr: '' } }],
			},
		],
		feedbacks: [{ feedbackId: 'surfaceTalk', options: {}, style: { bgcolor: combineRgb(200, 0, 0), color: WHITE } }],
	}

	return presets
}

/** Variable slug of a track: "in1", "mon3", "lr"… */
function slugOf(t: { slug: string; max: number }, track: number): string {
	return t.max === 1 ? t.slug : `${t.slug}${track + 1}`
}

/** Variables of the Companion Surface mode: per strip name / fader / mute / solo, and the desk's state. */
export function surfaceVariableDefinitions(self: LV1Instance): Array<{ variableId: string; name: string }> {
	const defs: Array<{ variableId: string; name: string }> = []
	for (const t of SURFACE_TRACK_TYPES) {
		for (const tr of self.surfaceModel.list(t.tt)) {
			const slug = slugOf(t, tr.track)
			const label = t.max === 1 ? t.label : `${t.label} ${tr.track + 1}`
			defs.push({ variableId: `${slug}_name`, name: `${label} name` })
			if (!STRIP_TYPES.includes(t.tt)) continue
			defs.push({ variableId: `${slug}_fader`, name: `${label} fader (dB)` })
			defs.push({ variableId: `${slug}_mute`, name: `${label} mute (on / off)` })
			defs.push({ variableId: `${slug}_solo`, name: `${label} solo (on / off)` })
		}
	}
	for (const m of SURFACE_MIXERS)
		defs.push({
			variableId: `${m.id === 'm1' ? 'mixer1' : 'mixer2'}_flip`,
			name: `${m.label} flipped to (aux name, blank = not flipped)`,
		})
	defs.push(
		{ variableId: 'tb_preset', name: 'Talk Back preset selected (1 = first)' },
		{ variableId: 'mute_all', name: 'Mute All (on / off)' },
		{ variableId: 'scene', name: 'Current scene number' },
		{ variableId: 'scene_name', name: 'Current scene name' },
		{ variableId: 'scene_dirty', name: 'Current scene has unsaved changes (yes / no)' },
		{ variableId: 'tempo', name: 'Tempo (BPM)' },
		{ variableId: 'locked', name: 'eMotion locked (yes / no)' },
		{ variableId: 'recording', name: 'Recording (yes / no)' },
		{ variableId: 'solo_active', name: 'Any solo / cue active (yes / no)' },
		{ variableId: 'selected_channel', name: 'Selected channel name' },
		{ variableId: 'session', name: 'Session name' },
		{ variableId: 'session_dirty', name: 'Session has unsaved changes (yes / no)' },
	)
	return defs
}

const yesNo = (v: boolean | null) => (v == null ? '' : v ? 'yes' : 'no')

export function surfaceVariableValues(self: LV1Instance): Record<string, string> {
	const v: Record<string, string> = {}
	const m = self.surfaceModel
	for (const t of SURFACE_TRACK_TYPES) {
		for (const tr of m.list(t.tt)) {
			const slug = slugOf(t, tr.track)
			v[`${slug}_name`] = tr.name
			if (!STRIP_TYPES.includes(t.tt)) continue
			const db = m.real.get(controlKey(strip.fader(t.tt, tr.track)))
			v[`${slug}_fader`] = db == null ? '' : db <= -144 ? '-inf' : db.toFixed(1)
			const mute = self.surfaceControls.get(controlKey(strip.mute(t.tt, tr.track)))
			const solo = self.surfaceControls.get(controlKey(strip.solo(t.tt, tr.track)))
			v[`${slug}_mute`] = mute ? (mute.value >= 0.5 ? 'on' : 'off') : ''
			v[`${slug}_solo`] = solo ? (solo.value >= 0.5 ? 'on' : 'off') : ''
		}
	}
	for (const mx of SURFACE_MIXERS) {
		const f = m.flips.get(mx.surface)
		v[`${mx.id === 'm1' ? 'mixer1' : 'mixer2'}_flip`] = f?.on ? m.name(f.tt, f.track) : ''
	}
	const g = m.gui
	const muteAll = self.surfaceControls.get(controlKey(MUTE_ALL))
	v.tb_preset = m.tbPreset != null ? String(m.tbPreset) : ''
	v.mute_all = muteAll ? (muteAll.value >= 0.5 ? 'on' : 'off') : ''
	v.scene = g.scene != null ? String(g.scene) : ''
	v.scene_name = g.scene != null ? (g.sceneNames.get(g.scene) ?? '') : ''
	v.scene_dirty = yesNo(g.sceneDirty)
	v.tempo = g.tempo != null ? String(Math.round(g.tempo * 10) / 10) : ''
	v.locked = g.consoleLock == null && g.surfaceLock == null ? '' : yesNo(!!(g.consoleLock || g.surfaceLock))
	v.recording = yesNo(g.recording)
	v.solo_active = yesNo(g.soloActive)
	v.selected_channel = g.channelName
	v.session = g.session
	v.session_dirty = yesNo(g.sessionDirty)
	return v
}
