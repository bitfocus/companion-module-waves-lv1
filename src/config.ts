import { SomeCompanionConfigField } from '@companion-module/base'
import { getDiscoveryCache, refreshDiscovery } from './discovery-cache.js'
import { multicastInterfaces } from './zdns-discover.js'

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

	// Name the interfaces we scan on. When the list comes back empty the operator's
	// only real question is whether we are even listening on the cable the desk is
	// patched into — "scanning…" does not answer that, and a FOH machine whose Wi-Fi
	// holds the default route while Ethernet holds the desk is the normal case.
	const ifaces = multicastInterfaces()
	const ifaceList = ifaces.length
		? ifaces.map((i) => `${i.name} ${i.address}`).join(', ')
		: 'none found — check this machine has an active network interface'

	const discoveryStatus =
		entries.length === 0
			? `⏳ No LV1s discovered yet. A scan is running in the background — close this dialog and reopen it in a few seconds.\n\n` +
				`Scanning on: ${ifaceList}\n\n` +
				`The LV1 must be on one of those subnets for auto-discovery to reach it. If it is not (routed network, VPN, Companion in Docker), leave the dropdown alone and type the LV1's IP into "LV1 IP (override)" below — with port 0 the module still finds the port itself.`
			: `✓ ${entries.length} LV1${entries.length > 1 ? 's' : ''} discovered (cached ${ageStr}). A fresh scan was just kicked off — close and reopen this dialog to see updated results.\n\n` +
				`Scanning on: ${ifaceList}`

	const selectChoices = [
		{
			id: '',
			label: entries.length ? '— pick one or use custom IP below —' : '— none discovered, use custom IP below —',
		},
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
				"Optional — only fill these if the LV1 isn't discoverable (e.g. routed network). Manual host with port=0 will still auto-discover the port for that IP.",
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'LV1 IP (override)',
			width: 6,
			default: '',
			// Accept empty (= use auto-discovery) OR a valid dotted-quad IPv4. We can't use
			// Regex.IP here because it rejects the empty string, which would lock the Save
			// button whenever the user doesn't want a manual override.
			regex: '/^$|^(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)$/',
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
