// Feedbacks reflect the LV1's current state on Companion buttons.
// State is populated by main.ts's handleNotify() from the /Notify/... stream,
// AND by optimistic updates in actions.ts when the local user changes something
// (the LV1 doesn't echo our own /Set back to us — see
// lv1_confirmed_command_signatures.md "Echoes vs broadcasts").
//
// Every dropdown that accepts a Group / Channel / Aux exposes a "✎ Custom
// (expression)…" entry that reveals a paired textinput with Companion
// variable support — same pattern as actions.ts.

import {
	CompanionFeedbackDefinitions,
	CompanionInputFieldDropdown,
	CompanionInputFieldTextInput,
	combineRgb,
} from '@companion-module/base'
import type { LV1Instance } from './main.js'
import {
	channelsFor,
	buildTrackPicker,
	buildExprDropdown,
	buildNumberExprField,
	resolveTrackAsync,
	resolveIndexAsync,
	resolveNumberAsync,
	CUSTOM_EXPR,
} from './tracks.js'

type AnyOpt = CompanionInputFieldDropdown | CompanionInputFieldTextInput

export function UpdateFeedbacks(self: LV1Instance): void {
	const trackPicker: AnyOpt[] = buildTrackPicker(self, 'ch')
	const inputOpts: AnyOpt[] = buildExprDropdown(
		'inputCh',
		'Input channel',
		channelsFor(self, 0),
		'1-based input channel index.',
	)
	const auxDestOpts: AnyOpt[] = buildExprDropdown(
		'aux',
		'Aux destination',
		channelsFor(self, 2),
		'1-based aux/FX destination index.',
	)

	const feedbacks: CompanionFeedbackDefinitions = {
		channelMute: {
			type: 'boolean',
			name: 'Channel muted',
			description: 'True when the channel is muted.',
			defaultStyle: { bgcolor: combineRgb(180, 30, 30), color: combineRgb(255, 255, 255) },
			options: trackPicker,
			callback: async (fb, context) => {
				const { group, ch } = await resolveTrackAsync(fb.options, context)
				return self.channels.get(`${group}.${ch}`)?.muted ?? false
			},
		},

		channelPolarity: {
			type: 'boolean',
			name: 'Channel polarity (phase) inverted',
			description: 'True when the channel polarity is inverted.',
			defaultStyle: { bgcolor: combineRgb(150, 90, 0), color: combineRgb(255, 255, 255) },
			options: trackPicker,
			callback: async (fb, context) => {
				const { group, ch } = await resolveTrackAsync(fb.options, context)
				return self.channels.get(`${group}.${ch}`)?.polarity === true
			},
		},

		channelPhantom: {
			type: 'boolean',
			name: 'Channel +48 V phantom ON',
			description:
				'True ONLY when the console has told us phantom is on. The LV1 does not report phantom until it ' +
				'changes, so after a fresh connect this reads false — meaning "not known to be on", NOT ' +
				'"known to be off". Pair with "+48 V state unknown" if that distinction matters to you.',
			defaultStyle: { bgcolor: combineRgb(200, 60, 0), color: combineRgb(255, 255, 255) },
			options: trackPicker,
			callback: async (fb, context) => {
				const { group, ch } = await resolveTrackAsync(fb.options, context)
				return self.channels.get(`${group}.${ch}`)?.phantom === true
			},
		},

		channelPhantomUnknown: {
			type: 'boolean',
			name: 'Channel +48 V state unknown',
			description:
				'True when the console has not yet reported phantom for this channel. MEASURED: ' +
				'/Notify/PhantomState is absent from the connect flood and only arrives on change, so this is the ' +
				'honest state after a fresh connect. Use it to grey out a +48 V button rather than showing a ' +
				'confident "off" for a channel that may be live at 48 V.',
			defaultStyle: { bgcolor: combineRgb(60, 60, 60), color: combineRgb(160, 160, 160) },
			options: trackPicker,
			callback: async (fb, context) => {
				const { group, ch } = await resolveTrackAsync(fb.options, context)
				return self.channels.get(`${group}.${ch}`)?.phantom == null
			},
		},

		channelSolo: {
			type: 'boolean',
			name: 'Channel solo',
			defaultStyle: { bgcolor: combineRgb(200, 160, 30), color: combineRgb(0, 0, 0) },
			options: trackPicker,
			callback: async (fb, context) => {
				const { group, ch } = await resolveTrackAsync(fb.options, context)
				return self.channels.get(`${group}.${ch}`)?.solo ?? false
			},
		},

		anySolo: {
			type: 'boolean',
			name: 'Any track is soloed',
			description: 'True when any track is soloed.',
			defaultStyle: { bgcolor: combineRgb(200, 160, 30), color: combineRgb(0, 0, 0) },
			options: [],
			callback: () => {
				for (const s of self.channels.values()) if (s.solo) return true
				return false
			},
		},

		talkBackToOutput: {
			type: 'boolean',
			name: 'Talk Back engaged to output',
			description: 'True when this output is enabled as a TalkBack destination in the LV1 panel.',
			defaultStyle: { bgcolor: combineRgb(220, 50, 50), color: combineRgb(255, 255, 255) },
			options: buildExprDropdown('aux', 'Output', channelsFor(self, 2), '1-based output/aux index.'),
			callback: async (fb, context) => {
				const aux = await resolveIndexAsync(fb.options, 'aux', context, 0)
				return self.tbDestEnabled.get(aux) ?? false
			},
		},

		spillActive: {
			type: 'boolean',
			name: 'Spill mode active',
			description: 'True when this Spill button is engaged.',
			defaultStyle: { bgcolor: combineRgb(160, 120, 200), color: combineRgb(0, 0, 0) },
			options: [
				buildNumberExprField('bank', 'Bank (0 = Mixer 1, 1 = Mixer 2)', 0, '0 or 1. Variables OK.'),
				buildNumberExprField('idx', 'Slot (0-based)', 0, '0..31. Variables OK.'),
			],
			callback: async (fb, context) => {
				const bank = Math.round(await resolveNumberAsync(fb.options, 'bank', context, 0))
				const idx = Math.round(await resolveNumberAsync(fb.options, 'idx', context, 0))
				return self.spillStates.get(`${bank}.${idx}`) ?? false
			},
		},

		sendOn: {
			type: 'boolean',
			name: 'Send ON to aux',
			defaultStyle: { bgcolor: combineRgb(30, 130, 60), color: combineRgb(255, 255, 255) },
			options: [...inputOpts, ...auxDestOpts],
			callback: async (fb, context) => {
				const ch = await resolveIndexAsync(fb.options, 'inputCh', context, 0)
				const aux = await resolveIndexAsync(fb.options, 'aux', context, 0)
				return self.sends.get(`0.${ch}.${aux}`)?.on ?? false
			},
		},

		muteGroup: {
			type: 'boolean',
			name: 'Mute group active',
			defaultStyle: { bgcolor: combineRgb(200, 60, 60), color: combineRgb(255, 255, 255) },
			options: [buildNumberExprField('group', 'Mute group (1-8)', 1, '1..8. Variables OK.')],
			callback: async (fb, context) => {
				const grp = Math.round(await resolveNumberAsync(fb.options, 'group', context, 1)) - 1
				return self.muteGroups.get(grp) ?? false
			},
		},

		channelColor: {
			type: 'advanced',
			name: 'Channel color (from LV1 GUI)',
			description: 'Uses the channel color as button background.',
			options: trackPicker,
			callback: async (fb, context) => {
				const { group, ch } = await resolveTrackAsync(fb.options, context)
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
			description: 'True when the meter is above the threshold.',
			defaultStyle: { bgcolor: combineRgb(200, 30, 30), color: combineRgb(255, 255, 255) },
			options: [
				...trackPicker,
				buildNumberExprField('sub', 'Sub-channel (0 = L / mono, 1 = R)', 0, '0 or 1. Variables OK.'),
				buildNumberExprField('threshold', 'Threshold (dB)', -3, '−144..0. Variables OK.'),
			],
			callback: async (fb, context) => {
				const { group, ch } = await resolveTrackAsync(fb.options, context)
				const sub = Math.round(await resolveNumberAsync(fb.options, 'sub', context, 0))
				const db = self.meters.get(`${group}.${ch}.${sub}`)
				if (db == null) return false
				const threshold = await resolveNumberAsync(fb.options, 'threshold', context, -3)
				return db >= threshold
			},
		},

		flipActive: {
			type: 'boolean',
			name: 'Flip-to-faders active (any aux)',
			description: 'True when flipped to any aux. Requires "Aux Cue On Flip" enabled on the LV1.',
			defaultStyle: { bgcolor: combineRgb(220, 130, 30), color: combineRgb(0, 0, 0) },
			options: [],
			callback: () => self.currentFlipTarget != null,
		},

		flipForTarget: {
			type: 'boolean',
			name: 'Flip-to-faders active (specific aux)',
			description: 'True when flipped to this aux. Requires "Aux Cue On Flip" enabled on the LV1.',
			defaultStyle: { bgcolor: combineRgb(220, 130, 30), color: combineRgb(0, 0, 0) },
			options: buildExprDropdown('aux', 'Aux', channelsFor(self, 2), '1-based aux index.'),
			callback: async (fb, context) => {
				const t = self.currentFlipTarget
				if (!t || t.group !== 2) return false
				const aux = await resolveIndexAsync(fb.options, 'aux', context, 0)
				return t.ch === aux
			},
		},

		currentScene: {
			type: 'boolean',
			name: 'Current scene index matches',
			defaultStyle: { bgcolor: combineRgb(60, 130, 200), color: combineRgb(255, 255, 255) },
			options: [buildNumberExprField('scene', 'Scene index (0-based)', 0, '0..999. Variables OK.')],
			callback: async (fb, context) => {
				const idx = Math.round(await resolveNumberAsync(fb.options, 'scene', context, 0))
				return self.currentScene === idx
			},
		},

		currentSceneByName: {
			type: 'boolean',
			name: 'Current scene matches (pick from list)',
			description: 'True when this is the active scene.',
			defaultStyle: { bgcolor: combineRgb(60, 130, 200), color: combineRgb(255, 255, 255) },
			options: buildExprDropdown(
				'scene',
				'Scene',
				self.scenes.size > 0
					? [...self.scenes.entries()]
							.sort(([a], [b]) => a - b)
							.map(([idx, name]) => ({ id: idx, label: `${idx + 1} — ${name}` }))
					: [{ id: 0, label: '(no scenes detected yet)' }],
				'0-based scene index.',
				0,
			),
			callback: async (fb, context) => {
				const raw = fb.options.scene
				let idx: number
				if (raw === CUSTOM_EXPR) {
					idx = Math.round(await resolveNumberAsync(fb.options, 'scene_expr', context, 0))
				} else {
					idx = Number(raw)
				}
				return self.currentScene === idx
			},
		},
	}

	self.setFeedbackDefinitions(feedbacks)
}
