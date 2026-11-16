// Ready-made buttons for the Companion Surface mode: one flip button per mixer and aux (named
// after the aux, lit only while that mixer is flipped to it), Talk Back presets and TALK.

import { CompanionPresetDefinitions, combineRgb } from '@companion-module/base'
import type { LV1Instance } from './main.js'
import { SURFACE_MIXERS, SURFACE_TRACK_TYPES } from './surface-model.js'

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

/** Variables of the Companion Surface mode: every track name, and each mixer's flip. */
export function surfaceVariableDefinitions(self: LV1Instance): Array<{ variableId: string; name: string }> {
	const defs: Array<{ variableId: string; name: string }> = []
	for (const t of SURFACE_TRACK_TYPES) {
		for (const tr of self.surfaceModel.list(t.tt)) {
			defs.push({ variableId: `${t.slug}${tr.track + 1}_name`, name: `${t.label} ${tr.track + 1} name` })
		}
	}
	for (const m of SURFACE_MIXERS)
		defs.push({
			variableId: `${m.id === 'm1' ? 'mixer1' : 'mixer2'}_flip`,
			name: `${m.label} flipped to (aux name, blank = not flipped)`,
		})
	defs.push({ variableId: 'tb_preset', name: 'Talk Back preset selected (1 = first)' })
	return defs
}

export function surfaceVariableValues(self: LV1Instance): Record<string, string> {
	const v: Record<string, string> = {}
	for (const t of SURFACE_TRACK_TYPES) {
		for (const tr of self.surfaceModel.list(t.tt)) v[`${t.slug}${tr.track + 1}_name`] = tr.name
	}
	for (const m of SURFACE_MIXERS) {
		const f = self.surfaceModel.flips.get(m.surface)
		v[`${m.id === 'm1' ? 'mixer1' : 'mixer2'}_flip`] = f?.on ? self.surfaceModel.name(f.tt, f.track) : ''
	}
	v.tb_preset = self.surfaceModel.tbPreset != null ? String(self.surfaceModel.tbPreset) : ''
	return v
}
