// Ready-made buttons for the Companion Surface mode, built from what the desk reported: strips
// (mute, solo, fader moves and fades, plugin switches), Mute All, mute groups, scenes, eMotion
// functions, Talk Back and flips. Names and values on the buttons follow the desk live.

import { combineRgb, type CompanionPresetAction, type CompanionPresetFeedback } from '@companion-module/base'
import type { LV1Instance } from './main.js'
import type { Preset } from './preset-structure.js'
import {
	MUTE_ALL,
	MUTE_GROUPS,
	RACK_SLOTS,
	RACK_TYPES,
	STRIP_TYPES,
	SURFACE_MIXERS,
	SURFACE_TRACK_TYPES,
	input,
	muteGroupAddress,
	pan,
	strip,
} from './surface-model.js'
import { controlKey } from './surface-client.js'
import { trackColorHex } from './surface-parity.js'
import {
	FN_FLIP_SENDS,
	FN_TB_PRESET,
	HOT_SCENE_CHOICES,
	MIXER_VIEW_CHOICES,
	MODULE_CHOICES,
	SURFACE_FUNCTIONS,
	TAB_CHOICES,
	TOP_MODE_CHOICES,
} from './surface-functions.js'

/** MyRemote's own user keys live on eMotion's surface 5. */
const MYREMOTE_SURFACE = 5

/** A user key definition as text: short label ("Mon 1") and the whole function ("Flip Sends: Mixer 1: Mon 1"). */
function userKeyText(
	self: LV1Instance,
	d: { action: number; sel: number; tt: number; ti: number } | undefined,
): { short: string; full: string } {
	if (!d || d.action <= 0) return { short: '', full: '' }
	const m = self.surfaceModel
	const trackName = (tt: number, ti: number) => {
		const t = SURFACE_TRACK_TYPES.find((x) => x.tt === tt)
		const fallback = t ? (t.max === 1 ? t.label : `${t.label} ${ti + 1}`) : `${tt}:${ti + 1}`
		return ti >= 0 ? m.name(tt, ti) || fallback : ''
	}
	if (d.action === FN_FLIP_SENDS) {
		const mixer = SURFACE_MIXERS.find((x) => x.selection === d.sel)?.label ?? `Mixer ${d.sel + 1}`
		const aux = trackName(d.tt, d.ti)
		return { short: aux, full: `Flip Sends: ${mixer}: ${aux}` }
	}
	if (d.action === FN_TB_PRESET) {
		const preset = d.sel === 0 ? 'All' : `Preset ${d.sel}`
		return { short: `TB ${d.sel === 0 ? 'All' : d.sel}`, full: `Talk Back: ${preset}` }
	}
	const fn = SURFACE_FUNCTIONS.find((f) => f.id === d.action)
	const name = fn?.name ?? `Function ${d.action}`
	const pick = (list: { id: string; label: string }[], v: number) => list.find((c) => c.id === String(v))?.label ?? ''
	const parts: string[] = []
	switch (fn?.target) {
		case 'track':
		case 'aux':
			parts.push(trackName(d.tt, d.ti))
			break
		case 'module':
			parts.push(trackName(d.tt, d.ti), pick(MODULE_CHOICES, d.sel))
			break
		case 'muteGroup':
			if (d.ti >= 0) parts.push(`MG ${d.ti + 1}`)
			break
		case 'mixer':
			parts.push(pick(MIXER_VIEW_CHOICES, d.sel))
			break
		case 'topMode':
			parts.push(pick(MIXER_VIEW_CHOICES, d.sel), pick(TOP_MODE_CHOICES, d.ti))
			break
		case 'tab':
			parts.push(pick(TAB_CHOICES, d.sel))
			break
		case 'hotScene':
			parts.push(pick(HOT_SCENE_CHOICES, d.sel))
			break
		case 'scene':
			if (d.sel >= 0) parts.push(m.sceneList[d.sel] || `Scene ${d.sel + 1}`)
			break
	}
	const detail = parts.filter(Boolean).join(' ')
	return { short: detail || name.replace(/^[^:]*:\s*/, ''), full: detail ? `${name}: ${detail}` : name }
}

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const RED = combineRgb(200, 0, 0)
const AMBER = combineRgb(200, 120, 0)
const YELLOW = combineRgb(220, 180, 0)
const GREEN = combineRgb(0, 140, 0)
const BLUE = combineRgb(0, 120, 200)

function button(
	category: string,
	name: string,
	text: string,
	down: CompanionPresetAction[],
	feedbacks: CompanionPresetFeedback[] = [],
	up: CompanionPresetAction[] = [],
	size: 'auto' | '7' | '14' | '18' | '24' = '14',
): Preset {
	return {
		type: 'simple',
		category,
		name,
		style: { text, size, color: WHITE, bgcolor: BLACK },
		steps: [{ down, up }],
		feedbacks,
	}
}

const fn = (id: number) => ({
	actionId: 'surfaceFunction',
	options: { fn: String(id), strip: '0:0', module: '4', view: '0', phase: 'tap' },
})

/** Modifier keys held on the eMotion computer (real key presses: Ctrl and Alt together work). */
const HOLD_KEYS = [
	{ key: 'ctrl', label: 'Ctrl' },
	{ key: 'alt', label: 'Alt' },
]
const keyAction = (key: string, mode: 'down' | 'up' | 'toggle') => ({ actionId: 'surfaceKey', options: { key, mode } })

/** The VU of a flip button: a thin vertical gauge on the right edge, green / yellow / red. */
const flipMeter = {
	id: 'vu',
	name: 'VU',
	type: 'gauge' as const,
	x: 92.4,
	y: 0,
	width: 7.6,
	height: 100,
	value: { isExpression: true as const, value: '$(local:meter)' },
	min: 0,
	max: 100,
	orientation: 'vertical' as const,
	roundedEnds: true,
	fillEnabled: true,
	multiColour: true,
	fillWidth: 100,
	trackWidth: 100,
	trackStyle: 'transparent' as const,
	trackAmount: 7,
	markerEnabled: false,
	stops: [
		{ value: 0, color: 0x00ff00, gradient: false },
		{ value: 66, color: 0xffff00, gradient: false },
		{ value: 85, color: 0xff0000, gradient: false },
	],
}

export function surfacePresets(self: LV1Instance): Record<string, Preset> {
	const presets: Record<string, Preset> = {}
	const label = self.label

	for (const mixer of SURFACE_MIXERS) {
		for (const t of SURFACE_TRACK_TYPES.filter((x) => x.tt === 2 || x.tt === 25)) {
			for (const tr of self.surfaceModel.list(t.tt)) {
				const aux = `${t.tt}:${tr.track}`
				presets[`flip_${mixer.id}_${t.slug}${tr.track + 1}`] = {
					type: 'layered',
					category: `Flip ${mixer.label}`,
					name: `Flip ${mixer.label} to ${t.label} ${tr.track + 1}`,
					elements: [
						{ id: 'box0', name: 'Background', type: 'box', x: 0, y: 0, width: 100, height: 100, color: BLACK },
						flipMeter,
						{
							id: 'text0',
							name: 'Text',
							type: 'text',
							x: 0,
							y: 0,
							width: 100,
							height: 100,
							text: `${mixer.label}\n$(${label}:${t.slug}${tr.track + 1}_name)`,
							fontsize: 29.4,
							fontsizeAllowShrink: true,
							color: WHITE,
							halign: 'center',
							valign: 'center',
						},
					],
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
							styleOverrides: [
								{ elementId: 'box0', elementProperty: 'color', override: BLUE },
								{ elementId: 'text0', elementProperty: 'color', override: WHITE },
							],
						},
					],
					localVariables: [
						{
							variableType: 'feedback',
							variableName: 'meter',
							feedbackId: 'surfaceMeter',
							options: { strip: aux, leg: 'max' },
						},
					],
				}
			}
		}
	}

	for (let p = 1; p <= 8; p++) {
		presets[`tb_preset_${p}`] = {
			type: 'simple',
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

	// ── One example strip (Channel 1): mute, solo, fader moves / fades, plugin switches. Users copy
	// these and pick their own strip in the action. ──
	for (const t of SURFACE_TRACK_TYPES) {
		if (t.tt !== 0) continue
		for (const tr of self.surfaceModel.list(t.tt).slice(0, 1)) {
			const slug = slugOf(t, tr.track)
			const id = `${t.tt}:${tr.track}`
			const name = `$(${label}:${slug}_name)`
			const level = `$(${label}:${slug}_fader)`
			const who = `${t.label} ${tr.track + 1}`
			presets[`mute_${slug}`] = button(
				'Channel 1 (example)',
				`Mute ${who}`,
				`MUTE\n${name}`,
				[{ actionId: 'surfaceMute', options: { strip: id, state: 'toggle', state_expr: '' } }],
				[{ feedbackId: 'surfaceMuted', options: { strip: id }, style: { bgcolor: RED, color: WHITE } }],
			)
			presets[`solo_${slug}`] = button(
				'Channel 1 (example)',
				`Solo ${who}`,
				`SOLO\n${name}`,
				[{ actionId: 'surfaceSolo', options: { strip: id, state: 'toggle', state_expr: '' } }],
				[{ feedbackId: 'surfaceSoloed', options: { strip: id }, style: { bgcolor: YELLOW, color: BLACK } }],
			)
			const fader = (mode: string, db: string, fadeMs: string) => ({
				actionId: 'surfaceFader',
				options: { strip: id, mode, db, fade: fadeMs !== '', fadeMs: fadeMs || '1000', curve: 'ease' },
			})
			presets[`fadein_${slug}`] = button(
				'Channel 1 (example)',
				`${who}: fade in to 0 dB (2 s)`,
				`${name}\nFADE IN\n${level}`,
				[fader('set', '0', '2000')],
			)
			presets[`fadeout_${slug}`] = button(
				'Channel 1 (example)',
				`${who}: fade out to −∞ (2 s)`,
				`${name}\nFADE OUT\n${level}`,
				[fader('set', '-144', '2000')],
			)
			presets[`up_${slug}`] = button('Channel 1 (example)', `${who}: +1 dB`, `${name}\n+1 dB\n${level}`, [
				fader('inc', '1', ''),
			])
			presets[`down_${slug}`] = button('Channel 1 (example)', `${who}: −1 dB`, `${name}\n−1 dB\n${level}`, [
				fader('dec', '1', ''),
			])

			if (!RACK_TYPES.includes(t.tt)) continue
			const slots = Array.from(
				{ length: RACK_SLOTS },
				(_, i) => self.surfaceModel.slots.get(`${t.tt}.${tr.track}.${i}`)?.name ?? '',
			)
			const plugin = (pluginName: string, param: string, text: string, key: string) => {
				if (!slots.includes(pluginName)) return
				const read = [...self.surfaceModel.plugins.values()].some((p) => p.name === pluginName && p.params.size > 0)
				if (!read) return
				const opt = {
					strip: id,
					plugin: pluginName,
					[`param_${pluginName.replace(/[^A-Za-z0-9]/g, '_')}`]: param,
					side: 'both',
				}
				presets[`${key}_${slug}`] = button(
					'Channel 1 (example)',
					`${who}: ${pluginName} ${param}`,
					`${text}\n${name}`,
					[
						{
							actionId: 'surfacePluginParam',
							options: { ...opt, mode: 'toggle', value: '0', fade: false, fadeMs: '1000', curve: 'linear' },
						},
					],
					[
						{
							feedbackId: 'surfacePluginState',
							options: { ...opt, text: 'On' },
							style: { bgcolor: GREEN, color: WHITE },
						},
					],
				)
			}
			plugin('EMO-F2', 'HpfOn', 'HPF', 'hpf')
			plugin('EMO-D5', 'Gate On', 'GATE', 'gate')
			plugin('EMO-D5', 'Comp On', 'COMP', 'comp')
			const eqSlot = slots.indexOf('EMO-Q4')
			if (eqSlot >= 0) {
				presets[`eq_${slug}`] = button(
					'Channel 1 (example)',
					`${who}: EQ (EMO-Q4) in / out`,
					`EQ\n${name}`,
					[
						{
							actionId: 'surfaceSlotBypass',
							options: { strip: id, slot: String(eqSlot), state: 'toggle', state_expr: '' },
						},
					],
					[
						{
							feedbackId: 'surfaceSlotBypassed',
							options: { strip: id, slot: String(eqSlot) },
							style: { bgcolor: GREEN, color: WHITE },
							isInverted: true,
						},
					],
				)
			}
		}
	}

	// ── Mute All and mute groups ──
	presets.mute_all = button(
		'Mute All / groups',
		'Mute All',
		'MUTE\nALL',
		[{ actionId: 'surfaceMuteAll', options: { state: 'toggle', state_expr: '' } }],
		[{ feedbackId: 'surfaceMuteAll', options: {}, style: { bgcolor: RED, color: WHITE } }],
		[],
		'18',
	)
	for (let g = 0; g < MUTE_GROUPS; g++) {
		presets[`mute_group_${g + 1}`] = button(
			'Mute All / groups',
			`Mute group ${g + 1}`,
			`MUTE\nGROUP ${g + 1}`,
			[{ actionId: 'surfaceMuteGroup', options: { group: String(g), state: 'toggle', state_expr: '' } }],
			[{ feedbackId: 'surfaceMuteGroup', options: { group: String(g) }, style: { bgcolor: RED, color: WHITE } }],
		)
	}

	// ── Scenes ──
	presets.scene_current = button(
		'Scenes',
		'Current scene (amber = unsaved changes)',
		`SCENE $(${label}:scene)\n$(${label}:scene_name)`,
		[fn(11)],
		[{ feedbackId: 'surfaceSceneDirty', options: {}, style: { bgcolor: AMBER, color: WHITE } }],
	)
	presets.scene_next = button('Scenes', 'Next scene', 'NEXT\nSCENE', [fn(31)])
	presets.scene_prev = button('Scenes', 'Previous scene', 'PREV\nSCENE', [fn(32)])
	presets.scene_store = button(
		'Scenes',
		'Store scene',
		'STORE\nSCENE',
		[fn(29)],
		[{ feedbackId: 'surfaceSceneDirty', options: {}, style: { bgcolor: AMBER, color: WHITE } }],
	)
	presets.scene_store_new = button('Scenes', 'Store new scene', 'STORE\nNEW', [fn(30)])
	presets.scene_undo = button('Scenes', 'Scene undo', 'SCENE\nUNDO', [fn(8)])

	// ── eMotion ──
	presets.emotion_lock = button(
		'eMotion',
		'Lock',
		'LOCK',
		[fn(19)],
		[{ feedbackId: 'surfaceLock', options: {}, style: { bgcolor: RED, color: WHITE } }],
		[],
		'18',
	)
	presets.emotion_clear_solo = button(
		'eMotion',
		'Clear Solo (lit while any solo is on)',
		'CLEAR\nSOLO',
		[fn(44)],
		[{ feedbackId: 'surfaceSoloActive', options: {}, style: { bgcolor: YELLOW, color: BLACK } }],
	)
	presets.emotion_tap = button('eMotion', 'Tap Tempo', `TAP\n$(${label}:tempo) BPM`, [fn(20)])
	presets.emotion_rec_start = button(
		'eMotion',
		'Recording start',
		'REC\nSTART',
		[fn(52)],
		[{ feedbackId: 'surfaceRecording', options: {}, style: { bgcolor: RED, color: WHITE } }],
	)
	presets.emotion_rec_stop = button(
		'eMotion',
		'Recording stop',
		'REC\nSTOP',
		[fn(53)],
		[{ feedbackId: 'surfaceRecording', options: {}, style: { bgcolor: RED, color: WHITE } }],
	)
	presets.emotion_save = button(
		'eMotion',
		'Save session (amber = unsaved changes)',
		'SAVE\nSESSION',
		[fn(1)],
		[{ feedbackId: 'surfaceSessionDirty', options: {}, style: { bgcolor: AMBER, color: WHITE } }],
	)
	presets.emotion_prev_ch = button('eMotion', 'Previous channel', 'PREV\nCHANNEL', [fn(14)])
	presets.emotion_next_ch = button('eMotion', 'Next channel', 'NEXT\nCHANNEL', [fn(15)])
	presets.emotion_selected = button('eMotion', 'Selected channel', `SELECTED\n$(${label}:selected_channel)`, [fn(18)])
	// Alt / Ctrl: held while the button is held (momentary), or latched by one push and released by the next (toggle).
	for (const k of HOLD_KEYS) {
		const held = [{ feedbackId: 'surfaceKeyHeld', options: { key: k.key }, style: { bgcolor: BLUE, color: WHITE } }]
		presets[`emotion_${k.key}_momentary`] = button(
			'eMotion',
			`${k.label} (momentary)`,
			`${k.label.toUpperCase()}\nMOMENTARY`,
			[keyAction(k.key, 'down')],
			held,
			[keyAction(k.key, 'up')],
		)
		presets[`emotion_${k.key}_toggle`] = button(
			'eMotion',
			`${k.label} (toggle)`,
			`${k.label.toUpperCase()}\nTOGGLE`,
			[keyAction(k.key, 'toggle')],
			held,
		)
	}

	presets.tb_talk = {
		type: 'simple',
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

	// ── Talk Back destinations: one button per FX / Monitor bus ──
	for (const t of SURFACE_TRACK_TYPES.filter((x) => x.tt === 2 || x.tt === 25)) {
		for (const tr of self.surfaceModel.list(t.tt)) {
			const aux = `${t.tt}:${tr.track}`
			presets[`tb_to_${t.slug}${tr.track + 1}`] = button(
				'Talk Back',
				`Talk Back to ${t.label} ${tr.track + 1}`,
				`TB TO\n$(${label}:${t.slug}${tr.track + 1}_name)`,
				[{ actionId: 'surfaceTbAssign', options: { aux, state: 'toggle', state_expr: '' } }],
				[{ feedbackId: 'surfaceTbAssigned', options: { aux }, style: { bgcolor: AMBER, color: WHITE } }],
			)
		}
	}

	// ── MyRemote's own user keys (as set up for MyRemote in eMotion): pressed while the button is held ──
	for (let k = 1; k <= 16; k++) {
		presets[`myremote_key_${k}`] = button(
			'User keys (MyRemote)',
			`MyRemote user key ${k}`,
			`USER\nKEY ${k}`,
			[{ actionId: 'surfaceMyRemoteKey', options: { key: String(k), phase: 'down' } }],
			[],
			[{ actionId: 'surfaceMyRemoteKey', options: { key: String(k), phase: 'up' } }],
		)
	}

	// ── Spill ──
	for (const m of SURFACE_MIXERS.filter((x) => x.id !== 'all')) {
		presets[`spill_${m.id}`] = button('Mixer', `Spill (${m.label})`, `SPILL\n${m.label.toUpperCase()}`, [
			{ actionId: 'surfaceSpill', options: { mixer: m.id } },
		])
	}

	// ── INPUTS / MIX layers of each mixer (80-channel mode) ──
	for (const m of SURFACE_MIXERS.filter((x) => x.id !== 'all')) {
		for (const layer of ['inputs', 'mix'] as const) {
			presets[`mixlayer_${m.id}_${layer}`] = button(
				'Mixer mode presets',
				`${m.label}: ${layer === 'mix' ? 'MIX' : 'INPUTS'} layers`,
				`${m.id === 'm1' ? 'MX1' : 'MX2'}\n${layer === 'mix' ? 'MIX' : 'INPUTS'}`,
				[{ actionId: 'surfaceMixLayer', options: { mixer: m.id, layer } }],
				[{ feedbackId: 'surfaceMixLayer', options: { mixer: m.id, layer }, style: { bgcolor: BLUE, color: WHITE } }],
			)
		}
	}

	// ── Modes presets of each mixer, with the session's names ──
	for (const m of SURFACE_MIXERS.filter((x) => x.id !== 'all')) {
		self.surfaceModel.modeNames.forEach((name, i) => {
			presets[`mode_${m.id}_${i + 1}`] = button(
				'Mixer mode presets',
				`${m.label}: ${name}`,
				`${m.id === 'm1' ? 'MX1' : 'MX2'}\n$(${label}:mode_preset_${i + 1}_name)`,
				[{ actionId: 'surfaceModePreset', options: { mixer: m.id, preset: String(i + 1) } }],
				[
					{
						feedbackId: 'surfaceModePreset',
						options: { mixer: m.id, preset: String(i + 1) },
						style: { bgcolor: BLUE, color: WHITE },
					},
				],
			)
		})
	}

	// ── Scenes of the session, by name ──
	self.surfaceModel.sceneList.forEach((_name, i) => {
		presets[`scene_${i + 1}`] = button(
			'Scenes',
			`Scene ${i + 1}`,
			`$(${label}:scene_${i + 1}_name)`,
			[{ actionId: 'surfaceSceneRecallList', options: { scene: String(i) } }],
			[{ feedbackId: 'surfaceSceneIs', options: { scene: String(i) }, style: { bgcolor: BLUE, color: WHITE } }],
		)
	})

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
			defs.push({ variableId: `${slug}_color`, name: `${label} colour (#rrggbb)` })
			if (t.tt === 0) {
				defs.push({ variableId: `${slug}_ingain`, name: `${label} preamp gain (dB)` })
				defs.push({ variableId: `${slug}_trim`, name: `${label} digital trim (dB)` })
				defs.push({ variableId: `${slug}_phantom`, name: `${label} +48 V (on / off)` })
				defs.push({ variableId: `${slug}_polarity`, name: `${label} polarity inverted (on / off)` })
			}
			if (!STRIP_TYPES.includes(t.tt)) continue
			defs.push({ variableId: `${slug}_pan`, name: `${label} pan / balance` })
			defs.push({ variableId: `${slug}_width`, name: `${label} stereo width` })
			defs.push({ variableId: `${slug}_rotate`, name: `${label} stereo rotation (°)` })
			if (self.surfaceVuAll) {
				defs.push({ variableId: `${slug}_vu`, name: `${label} VU, left / mono (dB)` })
				defs.push({ variableId: `${slug}_vu_r`, name: `${label} VU, right (dB)` })
			}
			defs.push({ variableId: `${slug}_fader`, name: `${label} fader (dB)` })
			defs.push({
				variableId: `${slug}_mute`,
				name: `${label} mute (on / off / group = muted by a group, Mute All or DCA)`,
			})
			defs.push({ variableId: `${slug}_solo`, name: `${label} solo (on / off)` })
		}
	}
	for (const m of SURFACE_MIXERS)
		defs.push({
			variableId: m.variable,
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
		{ variableId: 'scene_count', name: 'Number of scenes in the session' },
		{
			variableId: 'mixer1_layers',
			name: 'Mixer 1 INPUT / MIX layers shown (INPUTS, MIX; empty outside 80-channel mode)',
		},
		{
			variableId: 'mixer2_layers',
			name: 'Mixer 2 INPUT / MIX layers shown (INPUTS, MIX; empty outside 80-channel mode)',
		},
		{ variableId: 'mixer1_mode_preset', name: 'Mixer 1 Modes preset (name)' },
		{ variableId: 'mixer2_mode_preset', name: 'Mixer 2 Modes preset (name)' },
		...Array.from({ length: 8 }, (_, i) => ({
			variableId: `mode_preset_${i + 1}_name`,
			name: `Modes preset ${i + 1} name`,
		})),
		{ variableId: 'channels_total', name: 'Input channels on the desk' },
		{ variableId: 'auxes_total', name: 'Aux buses (FX + Monitor) on the desk' },
		{ variableId: 'console_version', name: 'eMotion LV1 version' },
		{ variableId: 'page', name: 'Page eMotion shows (Mixer 1, Channel…)' },
		{ variableId: 'current_mixer', name: 'Mixer shown (1 / 2, blank on other pages)' },
		{ variableId: 'current_layer_index', name: 'Layer of the mixer shown (1 = first)' },
		{ variableId: 'flip_active', name: 'A mixer is flipped to an aux (yes / no)' },
		{ variableId: 'flip_name', name: 'Aux the shown mixer is flipped to (blank = none)' },
	)
	for (let g = 0; g < MUTE_GROUPS; g++) defs.push({ variableId: `mg_${g + 1}`, name: `Mute group ${g + 1} (on / off)` })
	for (let k = 1; k <= 16; k++)
		defs.push(
			{ variableId: `userkey_${k}_name`, name: `MyRemote user key ${k}: short label (e.g. "Mon 1")` },
			{
				variableId: `userkey_${k}_function`,
				name: `MyRemote user key ${k}: function (e.g. "Flip Sends: Mixer 1: Mon 1")`,
			},
			{ variableId: `userkey_${k}_assigned`, name: `MyRemote user key ${k}: assigned (on / off)` },
		)
	self.surfaceModel.sceneList.forEach((name, i) =>
		defs.push({ variableId: `scene_${i + 1}_name`, name: `Scene ${i + 1} name (${name || 'no name'})` }),
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
			v[`${slug}_color`] = trackColorHex(self, t.tt, tr.track)
			if (t.tt === 0) {
				const bank = self.surfaceInputBank(tr.track)
				const num = (x: number | undefined) => (x == null ? '' : x.toFixed(1))
				const onOff = (x: number | null) => (x == null ? '' : x >= 0.5 ? 'on' : 'off')
				v[`${slug}_ingain`] = num(m.real.get(controlKey(input.gain(tr.track, bank, 0))))
				v[`${slug}_trim`] = num(m.real.get(controlKey(input.trim(tr.track, 0))))
				v[`${slug}_phantom`] = onOff(
					self.surfaceControls.get(controlKey(input.phantom(tr.track, bank, 0)))?.value ?? null,
				)
				v[`${slug}_polarity`] = onOff(self.surfaceControls.get(controlKey(input.polarity(tr.track, 0)))?.value ?? null)
			}
			if (!STRIP_TYPES.includes(t.tt)) continue
			const real = (
				a: { tt: number; track: number; group: number; secType: number; secIdx: number; cid: number },
				digits: number,
			) => {
				const x = m.real.get(controlKey(a))
				return x == null ? '' : x.toFixed(digits)
			}
			v[`${slug}_pan`] = real(pan.pan(t.tt, tr.track), 1)
			v[`${slug}_width`] = real(pan.width(t.tt, tr.track), 2)
			v[`${slug}_rotate`] = real(pan.rotate(t.tt, tr.track), 1)
			if (self.surfaceVuAll) {
				const legs = m.meters.get(`${t.tt}.${tr.track}`)?.legs ?? []
				const db = (x: number | undefined) => (x == null ? '' : x <= -144 ? '-inf' : x.toFixed(1))
				v[`${slug}_vu`] = db(legs[0])
				v[`${slug}_vu_r`] = db(legs[1] ?? legs[0])
			}
			const db = m.real.get(controlKey(strip.fader(t.tt, tr.track)))
			v[`${slug}_fader`] = db == null ? '' : db <= -144 ? '-inf' : db.toFixed(1)
			const mute = self.surfaceControls.get(controlKey(strip.mute(t.tt, tr.track)))
			const solo = self.surfaceControls.get(controlKey(strip.solo(t.tt, tr.track)))
			const ms = mute ? Math.round(mute.value) : null
			v[`${slug}_mute`] = ms == null ? '' : ms === 2 ? 'group' : ms ? 'on' : 'off'
			v[`${slug}_solo`] = solo ? (solo.value >= 0.5 ? 'on' : 'off') : ''
		}
	}
	for (const mx of SURFACE_MIXERS) {
		const f = m.flips.get(mx.surface)
		v[mx.variable] = f?.on ? m.name(f.tt, f.track) : ''
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
	if (g.scene != null && !v.scene_name) v.scene_name = m.sceneList[g.scene] ?? ''
	v.scene_count = m.sceneList.length ? String(m.sceneList.length) : ''
	const modeName = (view: number) => {
		const id = m.modePresets.get(view)
		return id ? (m.modeNames[id - 1] ?? String(id)) : ''
	}
	const layers = (view: number) => {
		const l = m.mixLayers.get(view)
		return l?.active ? (l.mix ? 'MIX' : 'INPUTS') : ''
	}
	v.mixer1_layers = layers(0)
	v.mixer2_layers = layers(1)
	v.mixer1_mode_preset = modeName(0)
	v.mixer2_mode_preset = modeName(1)
	m.modeNames.forEach((name, i) => (v[`mode_preset_${i + 1}_name`] = name))
	m.sceneList.forEach((name, i) => (v[`scene_${i + 1}_name`] = name))
	v.channels_total = String(m.list(0).length)
	v.auxes_total = String(m.list(2).length + m.list(25).length)
	v.console_version = m.appVersion
	v.page = g.page
	const shown = SURFACE_MIXERS.find((x) => x.label === g.page)
	v.current_mixer = shown && shown.id !== 'all' ? String(shown.surface + 1) : ''
	const layer = shown ? m.layers.get(shown.surface) : undefined
	v.current_layer_index = layer != null ? String(layer + 1) : ''
	v.flip_active = yesNo(SURFACE_MIXERS.some((x) => m.flips.get(x.surface)?.on))
	const shownFlip = shown ? m.flips.get(shown.surface) : undefined
	v.flip_name = shownFlip?.on ? m.name(shownFlip.tt, shownFlip.track) : ''
	for (let k = 1; k <= 16; k++) {
		const d = m.userKeys.get(`${MYREMOTE_SURFACE}.${k - 1}`)
		const text = userKeyText(self, d)
		v[`userkey_${k}_name`] = text.short
		v[`userkey_${k}_function`] = text.full
		v[`userkey_${k}_assigned`] = d ? (d.action > 0 ? 'on' : 'off') : ''
	}
	for (let gi = 0; gi < MUTE_GROUPS; gi++) {
		const mg = self.surfaceControls.get(controlKey(muteGroupAddress(gi)))
		v[`mg_${gi + 1}`] = mg ? (mg.value >= 0.5 ? 'on' : 'off') : ''
	}
	return v
}
