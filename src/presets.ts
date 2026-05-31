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

	// User Keys 1-16 (momentary). Label shows the LV1's own short name from
	// /Notify/UserKeyInfo (e.g. "Mon 1") with a fallback to "UK N" if the key
	// is unassigned or names haven't arrived yet.
	for (let k = 1; k <= 16; k++) {
		presets[`userkey_${k}`] = {
			category: 'User Keys',
			type: 'button',
			name: `User Key ${k}`,
			style: {
				text: `UK ${k}\n$(lv1:userkey_${k}_name)`,
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

	// CLR SOLO — clears solo everywhere. Lights up (yellow) whenever any track is soloed.
	presets['clear_all_solo'] = {
		category: 'Solo',
		type: 'button',
		name: 'Clear All Solo',
		style: {
			text: 'CLR\nSOLO',
			size: 'auto',
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(30, 30, 30),
		},
		steps: [{ down: [{ actionId: 'clearAllSolo', options: {} }], up: [] }],
		feedbacks: [{ feedbackId: 'anySolo', options: {} }],
	}

	// Flip Sends presets — one per User Key configured on the LV1 with the
	// "Flip Sends" function. Each press triggers that user key (momentary),
	// and the button lights up while the LV1 is flipped to that specific aux.
	for (const [idx, uk] of self.userKeys) {
		if (!uk.assigned || !uk.func.startsWith('Flip Sends')) continue
		// uk.func looks like "Flip Sends: MX1: Mon 1". uk.name is the short label ("Mon 1").
		// Find the matching aux index by name so the feedback knows which aux to watch.
		const auxIdx = self.detected.auxNames?.findIndex((n) => n === uk.name) ?? -1
		presets[`flip_sends_${idx + 1}`] = {
			category: 'Flip Sends',
			type: 'button',
			name: `Flip Sends — ${uk.name} (UK ${idx + 1})`,
			style: {
				text: `FLIP\n${uk.name}`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(60, 30, 90),
			},
			steps: [
				{
					down: [{ actionId: 'flipSendsViaUserKey', options: { userKey: idx } }],
					up: [],
				},
			],
			feedbacks: auxIdx >= 0
				? [{ feedbackId: 'flipForTarget', options: { aux: auxIdx + 1 } }]
				: [],
		}
	}

	// Spill button presets — one per Mixer (bank 0 and 1), default to slot 0.
	// Users will likely edit the slot index to match the group/DCA they want to spill.
	for (let bank = 0; bank < 2; bank++) {
		presets[`spill_mixer_${bank + 1}`] = {
			category: 'Spill',
			type: 'button',
			name: `Spill Mixer ${bank + 1} — slot 0`,
			style: {
				text: `SPILL\nMX${bank + 1}`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(40, 30, 50),
			},
			steps: [
				{
					down: [{ actionId: 'spillButton', options: { bank, idx: 0, state: 'toggle' } }],
					up: [],
				},
			],
			feedbacks: [{ feedbackId: 'spillActive', options: { bank, idx: 0 } }],
		}
	}

	self.setPresetDefinitions(presets)
}
