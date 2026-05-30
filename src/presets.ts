// A small set of ready-made buttons that exercise the most common actions.
// Users will roll their own for production layouts; these are starter templates.

import { CompanionPresetDefinitions, combineRgb } from '@companion-module/base'
import type { LV1Instance } from './main.js'

export function UpdatePresets(self: LV1Instance): void {
	const presets: CompanionPresetDefinitions = {}

	const chCount = self.effectiveChannels()
	// One mute button per input channel. Uses the new per-group field (ch_in) — see tracks.ts.
	for (let ch = 1; ch <= Math.min(chCount, 16); ch++) {
		presets[`mute_ch_${ch}`] = {
			category: 'Mute (Ch 1-16)',
			type: 'button',
			name: `Mute Ch ${ch}`,
			style: {
				text: `MUTE\n$(lv1:in${ch}_name)`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(30, 30, 30),
			},
			steps: [
				{
					down: [{ actionId: 'mute', options: { group: 0, ch_in: ch, state: 'toggle' } }],
					up: [],
				},
			],
			feedbacks: [{ feedbackId: 'channelMute', options: { group: 0, ch_in: ch } }],
		}
	}

	// One solo button per input channel.
	for (let ch = 1; ch <= Math.min(chCount, 16); ch++) {
		presets[`solo_ch_${ch}`] = {
			category: 'Solo (Ch 1-16)',
			type: 'button',
			name: `Solo Ch ${ch}`,
			style: {
				text: `SOLO\n$(lv1:in${ch}_name)`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(30, 30, 30),
			},
			steps: [
				{
					down: [{ actionId: 'solo', options: { group: 0, ch_in: ch, state: 'toggle' } }],
					up: [],
				},
			],
			feedbacks: [{ feedbackId: 'channelSolo', options: { group: 0, ch_in: ch } }],
		}
	}

	// Mute Groups 1-8.
	for (let g = 1; g <= 8; g++) {
		presets[`mutegroup_${g}`] = {
			category: 'Mute Groups',
			type: 'button',
			name: `Mute Group ${g}`,
			style: {
				text: `MG ${g}`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(30, 30, 30),
			},
			steps: [{ down: [{ actionId: 'muteGroup', options: { group: g, state: 'toggle' } }], up: [] }],
			feedbacks: [{ feedbackId: 'muteGroup', options: { group: g } }],
		}
	}

	// User Keys 1-16 (momentary).
	for (let k = 1; k <= 16; k++) {
		presets[`userkey_${k}`] = {
			category: 'User Keys',
			type: 'button',
			name: `User Key ${k}`,
			style: {
				text: `UK ${k}`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(30, 60, 90),
			},
			steps: [{ down: [{ actionId: 'userKey', options: { key: k, mode: 'momentary' } }], up: [] }],
			feedbacks: [],
		}
	}

	presets['tap_tempo'] = {
		category: 'Tempo',
		type: 'button',
		name: 'Tap Tempo',
		style: { text: 'TAP', size: '24', color: combineRgb(255, 255, 255), bgcolor: combineRgb(0, 100, 0) },
		steps: [{ down: [{ actionId: 'tapTempo', options: {} }], up: [] }],
		feedbacks: [],
	}

	self.setPresetDefinitions(presets)
}
