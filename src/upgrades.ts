import type { CompanionStaticUpgradeScript } from '@companion-module/base'
import type { ModuleConfig } from './config.js'
import { SURFACE_DEFAULT_PORT } from './surface.js'

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

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig>[] = [v130SurfaceDefaults]
