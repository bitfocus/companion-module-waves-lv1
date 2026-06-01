import { SomeCompanionConfigField } from '@companion-module/base'
import { getDiscoveryCache, refreshDiscovery } from './discovery-cache.js'

export interface ModuleConfig {
	/** Encoded "ip:port" picked from the discovered-LV1s dropdown. Empty = use custom host/port. */
	selected: string
	/** Manual override IP. Used if `selected` is empty. Blank = auto-discover first LV1. */
	host: string
	/** Manual override port. Used if `selected` is empty. 0 = auto-discover the port for `host`. */
	port: number
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	const { entries, ageMs } = getDiscoveryCache()

	// Kick off a fresh discovery in the background every time the config dialog opens.
	// Companion's getConfigFields is synchronous so we can't await — but the next time
	// the user opens this dialog, the cache will reflect the latest scan.
	void refreshDiscovery()

	const ageStr = ageMs >= 0 ? `${Math.round(ageMs / 1000)} s ago` : 'never'
	const discoveryStatus =
		entries.length === 0
			? '⏳ No LV1s discovered yet. A scan is running in the background — close this dialog and reopen it in a few seconds to see results.'
			: `✓ ${entries.length} LV1${entries.length > 1 ? 's' : ''} discovered (cached ${ageStr}). A fresh scan was just kicked off — close and reopen this dialog to see updated results.`

	const selectChoices = [
		{ id: '', label: entries.length ? '— pick one or use custom IP below —' : '— none discovered, use custom IP below —' },
		...entries.map((e) => ({
			id: `${e.addresses[0] || ''}:${e.port || ''}`,
			label: `${e.host || 'unknown'}  —  ${e.addresses[0] || '?'}:${e.port ?? '?'}`,
		})),
	]

	return [
		{
			type: 'static-text',
			id: 'discovery_status',
			label: 'Discovery',
			width: 12,
			value: discoveryStatus,
		},
		{
			type: 'dropdown',
			id: 'selected',
			label: 'Discovered LV1',
			width: 12,
			default: '',
			choices: selectChoices,
		},
		{
			type: 'static-text',
			id: 'override_hint',
			label: 'Custom address (override)',
			width: 12,
			value:
				'Optional — only fill these if the LV1 isn\'t discoverable (e.g. routed network). Manual host with port=0 will still auto-discover the port for that IP.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'LV1 IP (override)',
			width: 6,
			default: '',
		},
		{
			type: 'number',
			id: 'port',
			label: 'LV1 port (0 = auto)',
			width: 6,
			default: 0,
			min: 0,
			max: 65535,
		},
	]
}
