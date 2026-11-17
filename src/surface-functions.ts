// eMotion LV1 "user key / shortcut" functions (WCUserKeyHandler action codes, v17), as the
// LV1 Control and MiDiPLUS shortcut menus offer them. Companion Surface runs one by
// registering it on its own surface and pressing it, exactly like a surface key.
// Codes verified by assigning them to LV1 Control shortcuts: 13, 19, 24, 25, 27, 45, 46.

/** What a function needs besides its code. */
export type FunctionParam = 'none' | 'track' | 'number' | 'track+number'

export interface SurfaceFunction {
	id: number
	name: string
	param: FunctionParam
	/** Label of the number field, when the function takes one. */
	numberLabel?: string
}

export const SURFACE_FUNCTIONS: SurfaceFunction[] = [
	{ id: 1, name: 'Session: Save', param: 'none' },
	{ id: 2, name: 'Session: Open session file', param: 'none' },
	{ id: 8, name: 'Scenes: Undo', param: 'none' },
	{ id: 9, name: 'Scenes: Recall hot scene', param: 'number', numberLabel: 'Hot scene' },
	{ id: 10, name: 'Scenes: Recall scene', param: 'number', numberLabel: 'Scene' },
	{ id: 11, name: 'Scenes: Show scene menu', param: 'none' },
	{ id: 29, name: 'Scenes: Store scene', param: 'none' },
	{ id: 30, name: 'Scenes: Store new scene', param: 'none' },
	{ id: 31, name: 'Scenes: Next scene', param: 'none' },
	{ id: 32, name: 'Scenes: Previous scene', param: 'none' },
	{ id: 3, name: 'Presets: Save channel preset', param: 'track' },
	{ id: 4, name: 'Presets: Copy channel preset', param: 'track' },
	{ id: 5, name: 'Presets: Paste channel preset', param: 'track' },
	{ id: 6, name: 'Presets: Copy plugin & preset', param: 'track+number', numberLabel: 'Slot (1-8)' },
	{ id: 7, name: 'Presets: Paste plugin & preset', param: 'track+number', numberLabel: 'Slot (1-8)' },
	{ id: 18, name: 'Presets: Show channel menu', param: 'none' },
	{ id: 12, name: 'Navigation: Select channel', param: 'track' },
	{
		id: 13,
		name: 'Navigation: Edit plugin',
		param: 'track+number',
		numberLabel: 'Module (1 EQ, 2 Dynamics, 3 Filter, 4-11 = Slot 1-8)',
	},
	{ id: 14, name: 'Navigation: Previous channel', param: 'none' },
	{ id: 15, name: 'Navigation: Next channel', param: 'none' },
	{ id: 17, name: 'Navigation: Last channel', param: 'none' },
	{ id: 16, name: 'Navigation: View main window tab', param: 'number', numberLabel: 'Tab' },
	{ id: 48, name: 'Navigation: Mixer mode preset toggle', param: 'number', numberLabel: 'Mode preset' },
	{ id: 33, name: 'Navigation: Custom layer', param: 'number', numberLabel: 'Custom layer' },
	{ id: 34, name: 'Navigation: Spill link group', param: 'number', numberLabel: 'Link group' },
	{ id: 55, name: 'Navigation: INPUT / MIX layers', param: 'number', numberLabel: 'Layer' },
	{ id: 57, name: 'Navigation: Top mixer mode', param: 'number', numberLabel: 'Mode' },
	{ id: 21, name: 'Mute / Bypass: Mute channel', param: 'track' },
	{ id: 22, name: 'Mute / Bypass: Plugin bypass', param: 'track+number', numberLabel: 'Slot (1-8)' },
	{ id: 51, name: 'Mute / Bypass: Mute group', param: 'number', numberLabel: 'Mute group' },
	{ id: 26, name: 'Mute / Bypass: Mute all outputs', param: 'none' },
	{ id: 44, name: 'Mute / Bypass: Clear solo', param: 'none' },
	{ id: 23, name: 'General: Flip A/B input channel', param: 'track' },
	{ id: 49, name: 'General: Flip all preamp / local', param: 'none' },
	{ id: 28, name: 'General: Copy main mix to', param: 'number', numberLabel: 'Destination' },
	{ id: 54, name: 'General: Link ON / OFF', param: 'number', numberLabel: 'Link' },
	{ id: 20, name: 'General: Tap tempo', param: 'none' },
	{ id: 19, name: 'General: Lock', param: 'none' },
	{ id: 47, name: 'General: Keyboard', param: 'none' },
	{ id: 45, name: 'General: Alt (hold)', param: 'none' },
	{ id: 46, name: 'General: Ctrl (hold)', param: 'none' },
	{ id: 52, name: 'General: Recording start', param: 'none' },
	{ id: 53, name: 'General: Recording stop', param: 'none' },
	{ id: 58, name: 'General: Display IN / OUT meters', param: 'none' },
]

/** eMotion's shortcut code for Talk Back preset recall and for Flip Sends. */
export const FN_TB_PRESET = 25
export const FN_FLIP_SENDS = 27
