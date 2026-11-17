// Base 2.x lists presets in sections: each preset here keeps the name of its section next to it.

import type {
	CompanionPresetDefinition,
	CompanionPresetDefinitions,
	CompanionPresetSection,
} from '@companion-module/base'
import type { LV1Instance, ModuleSchema } from './main.js'

/** A preset, with the section it is listed in. */
export type Preset = CompanionPresetDefinition<ModuleSchema> & { category: string }

/** Publish the presets, one section per category, in the order they were added. */
export function publishPresets(self: LV1Instance, presets: Record<string, Preset>): void {
	const sections = new Map<string, string[]>()
	const defs: CompanionPresetDefinitions<ModuleSchema> = {}
	for (const [id, preset] of Object.entries(presets)) {
		const { category, ...def } = preset
		defs[id] = def
		const ids = sections.get(category)
		if (ids) ids.push(id)
		else sections.set(category, [id])
	}
	const structure: CompanionPresetSection<ModuleSchema>[] = [...sections].map(([name, ids]) => ({
		id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
		name,
		definitions: ids,
	}))
	self.setPresetDefinitions(structure, defs)
}
