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
	strip,
} from './surface-model.js'
import { controlKey } from './surface-client.js'

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
	options: { fn: String(id), strip: '0:0', number: '1', phase: 'tap' },
})

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
			defs.push({
				variableId: `${slug}_mute`,
				name: `${label} mute (on / off / group = muted by a group, Mute All or DCA)`,
			})
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
			const ms = mute ? Math.round(mute.value) : null
			v[`${slug}_mute`] = ms == null ? '' : ms === 2 ? 'group' : ms ? 'on' : 'off'
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
