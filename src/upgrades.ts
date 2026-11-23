import type { CompanionMigrationAction, CompanionStaticUpgradeScript } from '@companion-module/base'
import type { ModuleConfig } from './config.js'
import { SURFACE_DEFAULT_PORT } from './surface.js'
import { SURFACE_FUNCTIONS } from './surface-functions.js'

/** 2.0.0: connection mode and Companion Surface port for connections created before they existed. */
const v130SurfaceDefaults: CompanionStaticUpgradeScript<ModuleConfig> = (_context, props) => {
	const config = props.config
	if (!config || (config.mode && config.surfacePort))
		return { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }
	return {
		updatedConfig: {
			...config,
			mode: config.mode ?? 'myremote',
			surfacePort: config.surfacePort || SURFACE_DEFAULT_PORT,
		},
		updatedActions: [],
		updatedFeedbacks: [],
	}
}

/** An option's plain value as text ('' for expressions and anything that is not a string or number). */
function optionValue(opt: unknown): string {
	const v =
		opt && typeof opt === 'object' && 'value' in opt && !(opt as { isExpression?: boolean }).isExpression
			? opt.value
			: opt
	return typeof v === 'string' || typeof v === 'number' ? String(v) : ''
}

/**
 * 2.1.2: "eMotion function" lost its free "Number" field for dropdowns with eMotion's own lists.
 * The number was sent as is, so it becomes the same choice (Mute group: it meant group N).
 */
const v212FunctionDropdowns: CompanionStaticUpgradeScript<ModuleConfig> = (_context, props) => {
	const updatedActions: CompanionMigrationAction[] = []
	for (const action of props.actions) {
		if (action.actionId !== 'surfaceFunction' || action.options.number === undefined) continue
		const n = parseInt(optionValue(action.options.number), 10)
		const fnId = optionValue(action.options.fn)
		const f = SURFACE_FUNCTIONS.find((x) => String(x.id) === fnId)
		delete action.options.number
		const set = (key: string, value: string) => {
			action.options[key] = { isExpression: false, value }
		}
		if (f && Number.isFinite(n)) {
			if (f.target === 'module') set('module', String(n))
			else if (f.target === 'mixer' || f.target === 'topMode') set('view', String(n))
			else if (f.target === 'tab') set('tab', String(n))
			else if (f.target === 'hotScene') set('hotScene', String(n))
			else if (f.target === 'scene') set('scene', String(n))
			else if (f.target === 'muteGroup') set('muteGroup', String(Math.max(0, n - 1)))
		}
		updatedActions.push(action)
	}
	return { updatedConfig: null, updatedActions, updatedFeedbacks: [] }
}

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig>[] = [v130SurfaceDefaults, v212FunctionDropdowns]
