// eMotion LV1 "user key / shortcut" functions (WCUserKeyHandler action codes, v17), as the
// LV1 Control and MiDiPLUS shortcut menus offer them. Companion Surface runs one by
// registering it on its own surface and pressing it, exactly like a surface key.
// Codes verified by assigning them to LV1 Control shortcuts: 13, 19, 24, 25, 27, 45, 46.
//
// What each function takes comes from eMotion's own user-key menu (WCUserKeyHandler: the
// submenu builder at rva 0x373470, the track / slot / aux menus at 0x378870 and 0x377fc0,
// the tab names at 0x699f0, the slot texts at 0x69270, the top bay modes at 0x3744c0). A user
// key stores Action, SelectionIndex and a target track (TrackType, TrackIndex); -1 = unused.

/** What a function takes besides its code, as eMotion's user-key menu offers it. */
export type FunctionTarget =
	| 'none' // nothing, or what is selected in eMotion
	| 'track' // a strip: TrackType / TrackIndex
	| 'module' // a strip and its EQ, Dynamics, Filter or plugin slot: SelectionIndex (MODULE_CHOICES)
	| 'aux' // an FX / Monitor bus: TrackType / TrackIndex
	| 'muteGroup' // a mute group: TrackType 13, TrackIndex 0-7
	| 'mixer' // Mixer 1 / Mixer 2: SelectionIndex 0 / 1
	| 'topMode' // Mixer 1 / 2 (SelectionIndex) and a top bay mode (TrackIndex, TOP_MODE_CHOICES)
	| 'tab' // a main window tab: SelectionIndex (TAB_CHOICES)
	| 'hotScene' // hot scene 1-8: SelectionIndex 0-7
	| 'scene' // a scene of the session: SelectionIndex = its place in the scene list (0 = first)

export interface SurfaceFunction {
	id: number
	name: string
	target: FunctionTarget
}

export const SURFACE_FUNCTIONS: SurfaceFunction[] = [
	{ id: 1, name: 'Session: Save', target: 'none' },
	{ id: 2, name: 'Session: Open session file', target: 'none' },
	{ id: 8, name: 'Scenes: Undo', target: 'none' },
	{ id: 9, name: 'Scenes: Recall hot scene', target: 'hotScene' },
	{ id: 10, name: 'Scenes: Recall scene', target: 'scene' },
	{ id: 11, name: 'Scenes: Show scene menu', target: 'none' },
	{ id: 29, name: 'Scenes: Store scene', target: 'none' },
	{ id: 30, name: 'Scenes: Store new scene', target: 'none' },
	{ id: 31, name: 'Scenes: Next scene', target: 'none' },
	{ id: 32, name: 'Scenes: Previous scene', target: 'none' },
	{ id: 3, name: 'Presets: Save channel preset (selected channel)', target: 'none' },
	{ id: 4, name: 'Presets: Copy channel preset (selected channel)', target: 'none' },
	{ id: 5, name: 'Presets: Paste channel preset (selected channel)', target: 'none' },
	{ id: 6, name: 'Presets: Copy plugin & preset (selected)', target: 'none' },
	{ id: 7, name: 'Presets: Paste plugin & preset (selected)', target: 'none' },
	{ id: 18, name: 'Presets: Show channel menu', target: 'none' },
	{ id: 12, name: 'Navigation: Select channel', target: 'track' },
	{ id: 13, name: 'Navigation: Edit plugin', target: 'module' },
	{ id: 14, name: 'Navigation: Previous channel', target: 'none' },
	{ id: 15, name: 'Navigation: Next channel', target: 'none' },
	{ id: 17, name: 'Navigation: Last channel', target: 'none' },
	{ id: 16, name: 'Navigation: View main window tab', target: 'tab' },
	{ id: 57, name: 'Navigation: Top mixer mode', target: 'topMode' },
	{ id: 48, name: 'Navigation: Mixer mode preset toggle', target: 'mixer' },
	{ id: 33, name: 'Navigation: Custom layer', target: 'mixer' },
	{ id: 34, name: 'Navigation: Spill link group', target: 'mixer' },
	{ id: 55, name: 'Navigation: INPUT / MIX layers', target: 'mixer' },
	{ id: 21, name: 'Mute / Bypass: Mute channel', target: 'track' },
	{ id: 22, name: 'Mute / Bypass: Plugin bypass', target: 'module' },
	{ id: 51, name: 'Mute / Bypass: Mute group', target: 'muteGroup' },
	{ id: 26, name: 'Mute / Bypass: Mute all outputs', target: 'none' },
	{ id: 44, name: 'Mute / Bypass: Clear solo', target: 'none' },
	{ id: 23, name: 'General: Flip A/B input channel (selected channel)', target: 'none' },
	{ id: 49, name: 'General: Flip all preamp / local', target: 'none' },
	{ id: 28, name: 'General: Copy main mix to', target: 'aux' },
	{ id: 54, name: 'General: Link ON / OFF', target: 'mixer' },
	{ id: 20, name: 'General: Tap tempo', target: 'none' },
	{ id: 19, name: 'General: Lock', target: 'none' },
	{ id: 47, name: 'General: Keyboard', target: 'none' },
	{ id: 45, name: 'General: Alt (hold)', target: 'none' },
	{ id: 46, name: 'General: Ctrl (hold)', target: 'none' },
	{ id: 52, name: 'General: Recording start', target: 'none' },
	{ id: 53, name: 'General: Recording stop', target: 'none' },
	{ id: 58, name: 'General: Display IN / OUT meters', target: 'none' },
]

/** Edit plugin / Plugin bypass: eMotion's module list (its slot texts 1-11). */
export const MODULE_CHOICES = [
	{ id: '1', label: 'EQ' },
	{ id: '2', label: 'Dynamics' },
	{ id: '3', label: 'Filter' },
	...Array.from({ length: 8 }, (_, i) => ({ id: String(i + 4), label: `Plugin slot ${i + 1}` })),
]

/** Functions that act on one mixer view. */
export const MIXER_VIEW_CHOICES = [
	{ id: '0', label: 'Mixer 1' },
	{ id: '1', label: 'Mixer 2' },
]

/** View main window tab, in the order of eMotion's top bar. */
export const TAB_CHOICES = [
	{ id: '0', label: 'MIXER1' },
	{ id: '1', label: 'MIXER2' },
	{ id: '10', label: 'ALL' },
	{ id: '2', label: 'CHANNEL' },
	{ id: '3', label: 'SHOW' },
	{ id: '4', label: 'PATCH' },
	{ id: '5', label: 'SETUP' },
]

/** Top mixer mode: the top bay modes, in the order of eMotion's menu. */
export const TOP_MODE_CHOICES = [
	{ id: '0', label: 'INPUT' },
	{ id: '2', label: 'RACK' },
	{ id: '5', label: 'FX 1-8' },
	{ id: '6', label: 'MON 1-8' },
	{ id: '7', label: 'MON 9-16' },
	{ id: '14', label: 'MON 17-24' },
	{ id: '3', label: 'ROUTE GRP' },
	{ id: '4', label: 'ROUTE MAIN' },
	{ id: '8', label: 'CHANNEL' },
	{ id: '9', label: 'DUGAN' },
	{ id: '13', label: 'eMo IEM' },
	{ id: '1', label: 'DYNEQ' },
]

export const HOT_SCENE_CHOICES = Array.from({ length: 8 }, (_, i) => ({ id: String(i), label: `Hot scene ${i + 1}` }))

export const MUTE_GROUP_CHOICES = Array.from({ length: 8 }, (_, i) => ({ id: String(i), label: `Mute group ${i + 1}` }))

/** eMotion's shortcut code for Talk Back preset recall and for Flip Sends. */
export const FN_TB_PRESET = 25
export const FN_FLIP_SENDS = 27
