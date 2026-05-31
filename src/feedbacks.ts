// Feedbacks reflect the LV1's current state on Companion buttons.
// State is populated by main.ts's handleNotify() from the /Notify/... stream,
// AND by optimistic updates in actions.ts when the local user changes something
// (the LV1 doesn't echo our own /Set back to us — see
// lv1_confirmed_command_signatures.md "Echoes vs broadcasts").

import { CompanionFeedbackDefinitions, CompanionInputFieldDropdown, combineRgb } from '@companion-module/base'
import type { LV1Instance } from './main.js'
import { GROUP_CHOICES, channelsFor, buildChannelOptions, resolveChannel } from './tracks.js'

export function UpdateFeedbacks(self: LV1Instance): void {
	const trackOpts = buildChannelOptions(self, 'ch') as CompanionInputFieldDropdown[]
	const trackPicker: CompanionInputFieldDropdown[] = [
		{ id: 'group', type: 'dropdown', label: 'Group', default: 0, choices: GROUP_CHOICES },
		...trackOpts,
	]
	const inputOpts: CompanionInputFieldDropdown[] = [
		{ id: 'inputCh', type: 'dropdown', label: 'Input channel', default: 1, choices: channelsFor(self, 0) },
	]
	const auxDestOpts: CompanionInputFieldDropdown[] = [
		{ id: 'aux', type: 'dropdown', label: 'Aux destination', default: 1, choices: channelsFor(self, 2) },
	]

	const feedbacks: CompanionFeedbackDefinitions = {
		channelMute: {
			type: 'boolean',
			name: 'Channel muted',
			description: 'True when the channel is muted',
			defaultStyle: { bgcolor: combineRgb(180, 30, 30), color: combineRgb(255, 255, 255) },
			options: trackPicker,
			callback: (fb) => {
				const group = Number(fb.options.group)
				const ch = resolveChannel(fb.options as Record<string, unknown>, group)
				return self.channels.get(`${group}.${ch}`)?.muted ?? false
			},
		},

		channelSolo: {
			type: 'boolean',
			name: 'Channel solo',
			defaultStyle: { bgcolor: combineRgb(200, 160, 30), color: combineRgb(0, 0, 0) },
			options: trackPicker,
			callback: (fb) => {
				const group = Number(fb.options.group)
				const ch = resolveChannel(fb.options as Record<string, unknown>, group)
				return self.channels.get(`${group}.${ch}`)?.solo ?? false
			},
		},

		sendOn: {
			type: 'boolean',
			name: 'Send ON to aux',
			defaultStyle: { bgcolor: combineRgb(30, 130, 60), color: combineRgb(255, 255, 255) },
			options: [...inputOpts, ...auxDestOpts],
			callback: (fb) => {
				const ch = Number(fb.options.inputCh) - 1
				const aux = Number(fb.options.aux) - 1
				return self.sends.get(`0.${ch}.${aux}`)?.on ?? false
			},
		},

		muteGroup: {
			type: 'boolean',
			name: 'Mute group active',
			defaultStyle: { bgcolor: combineRgb(200, 60, 60), color: combineRgb(255, 255, 255) },
			options: [{ id: 'group', type: 'number', label: 'Mute group (1-8)', default: 1, min: 1, max: 8 }],
			callback: (fb) => {
				const grp = Number(fb.options.group) - 1
				return self.muteGroups.get(grp) ?? false
			},
		},

		channelColor: {
			type: 'advanced',
			name: 'Channel color (from LV1 GUI)',
			description: 'Apply the channel\'s color from the LV1 surface to the button background',
			options: trackPicker,
			callback: (fb) => {
				const group = Number(fb.options.group)
				const ch = resolveChannel(fb.options as Record<string, unknown>, group)
				const c = self.channels.get(`${group}.${ch}`)?.color
				if (!c) return {}
				return {
					bgcolor: combineRgb(Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)),
				}
			},
		},

		meterLevel: {
			type: 'boolean',
			name: 'Meter above threshold',
			description: 'Updates ~1 Hz with the live meter from /Notify/Meters',
			defaultStyle: { bgcolor: combineRgb(200, 30, 30), color: combineRgb(255, 255, 255) },
			options: [
				...trackPicker,
				{ id: 'sub', type: 'number', label: 'Sub-channel (0 = L / mono, 1 = R)', default: 0, min: 0, max: 1 },
				{ id: 'threshold', type: 'number', label: 'Threshold (dB)', default: -3, min: -144, max: 0, step: 0.1 },
			],
			callback: (fb) => {
				const group = Number(fb.options.group)
				const ch = resolveChannel(fb.options as Record<string, unknown>, group)
				const sub = Number(fb.options.sub)
				const db = self.meters.get(`${group}.${ch}.${sub}`)
				if (db == null) return false
				return db >= Number(fb.options.threshold)
			},
		},

		flipActive: {
			type: 'boolean',
			name: 'Flip-to-faders active (any aux)',
			description: 'True whenever the LV1 surface is flipped to show sends for any aux (i.e. master strip controls an aux instead of LR).',
			defaultStyle: { bgcolor: combineRgb(220, 130, 30), color: combineRgb(0, 0, 0) },
			options: [],
			callback: () => self.currentFlipTarget != null,
		},

		flipForTarget: {
			type: 'boolean',
			name: 'Flip-to-faders active (specific aux)',
			description: 'True when the LV1 surface is flipped to this specific aux.',
			defaultStyle: { bgcolor: combineRgb(220, 130, 30), color: combineRgb(0, 0, 0) },
			options: [
				{ id: 'aux', type: 'dropdown', label: 'Aux', default: 1, choices: channelsFor(self, 2) },
			],
			callback: (fb) => {
				const t = self.currentFlipTarget
				if (!t || t.group !== 2) return false
				return t.ch === Number(fb.options.aux) - 1
			},
		},

		currentScene: {
			type: 'boolean',
			name: 'Current scene index matches',
			defaultStyle: { bgcolor: combineRgb(60, 130, 200), color: combineRgb(255, 255, 255) },
			options: [{ id: 'scene', type: 'number', label: 'Scene index (0-based)', default: 0, min: 0, max: 999 }],
			callback: (fb) => self.currentScene === Number(fb.options.scene),
		},

		currentSceneByName: {
			type: 'boolean',
			name: 'Current scene matches (pick from list)',
			description: 'True when the active scene is the one you picked. Updates live as the LV1 sends /Notify/SceneList or /Notify/Scene/Name.',
			defaultStyle: { bgcolor: combineRgb(60, 130, 200), color: combineRgb(255, 255, 255) },
			options: [
				{
					id: 'scene',
					type: 'dropdown',
					label: 'Scene',
					default: 0,
					choices: self.scenes.size > 0
						? [...self.scenes.entries()]
							.sort(([a], [b]) => a - b)
							.map(([idx, name]) => ({ id: idx, label: `${idx + 1} — ${name}` }))
						: [{ id: 0, label: '(no scenes detected yet)' }],
				},
			],
			callback: (fb) => self.currentScene === Number(fb.options.scene),
		},
	}

	self.setFeedbackDefinitions(feedbacks)
}
