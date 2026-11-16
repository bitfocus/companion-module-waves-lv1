import os from 'node:os'
import { SomeCompanionConfigField } from '@companion-module/base'
import { getDiscoveryCache, refreshDiscovery } from './discovery-cache.js'
import { multicastInterfaces } from './zdns-discover.js'
import { SURFACE_DEFAULT_PORT } from './surface.js'

export interface ModuleConfig {
	/** Encoded "ip:port" picked from the discovered-LV1s dropdown. Empty = use custom host/port. */
	selected: string
	/** Manual override IP. Used if `selected` is empty. Blank = auto-discover first LV1. */
	host: string
	/** Manual override port. Used if `selected` is empty. 0 = auto-discover the port for `host`. */
	port: number
	/** Open a second, recorder-type connection to read the I/O patch (/Notify/IOConnections). */
	readIoPatch?: boolean
	/** 'myremote' = MyRemote protocol only (default). 'surface' = also connect to the
	 *  Companion Surface driver running inside eMotion LV1, which unlocks its actions. */
	mode?: 'myremote' | 'surface'
	/** TCP port of the Companion Surface driver (its .ini on the desk computer). */
	surfacePort?: number
	/** Password set in the Companion Surface .ini (blank = none). */
	surfacePassword?: string
	/** IP of the eMotion LV1 computer in Companion Surface mode. Blank = find the LV1 on the network. */
	surfaceHost?: string
}

const IPV4_OR_EMPTY = '/^$|^(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)$/'

/** Install page links on every IPv4 address of this (Companion's) computer. */
function installLinks(label: string): string {
	const path = `/instance/${encodeURIComponent(label || 'LV1')}/surface`
	const real: string[] = []
	const virtual: string[] = []
	for (const [name, list] of Object.entries(os.networkInterfaces())) {
		// WSL / Hyper-V / VM adapters cannot be reached from the desk: list them only as a last resort.
		const target = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|vboxnet/i.test(name) ? virtual : real
		for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) target.push(a.address)
	}
	const ips = real.length ? real : virtual.length ? virtual : ['127.0.0.1']
	return ips.map((ip) => `http://${ip}:8000${path}`).join('\n')
}

export function GetConfigFields(label = ''): SomeCompanionConfigField[] {
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

	const surfaceOnly = "$(options:mode) == 'surface'"
	const myRemoteOnly = "$(options:mode) != 'surface'"

	return [
		{
			type: 'dropdown',
			id: 'mode',
			label: 'Connect through',
			width: 12,
			default: 'myremote',
			choices: [
				{ id: 'myremote', label: 'MyRemote' },
				{ id: 'surface', label: 'Companion Surface (driver inside eMotion LV1)' },
			],
		},
		{
			type: 'static-text',
			id: 'surface_help',
			label: 'Install Companion Surface on the eMotion LV1 computer',
			width: 12,
			isVisibleExpression: surfaceOnly,
			value:
				'Open one of these links in a browser on the eMotion LV1 computer, download the installer and run it ' +
				'(close eMotion first). Then start eMotion, add "Companion Surface" in the Controls panel and save.\n\n' +
				installLinks(label) +
				'\n\nIf your Companion web interface does not use port 8000, change it in the link. ' +
				'In this mode the module talks only to Companion Surface; MyRemote is not used.',
		},
		{
			type: 'textinput',
			id: 'surfaceHost',
			label: 'eMotion LV1 computer IP',
			width: 6,
			default: '',
			tooltip: 'Leave blank to use the LV1 found on the network.',
			regex: IPV4_OR_EMPTY,
			isVisibleExpression: surfaceOnly,
		},
		{
			type: 'number',
			id: 'surfacePort',
			label: 'Companion Surface port',
			width: 3,
			default: SURFACE_DEFAULT_PORT,
			min: 1,
			max: 65535,
			isVisibleExpression: surfaceOnly,
		},
		{
			type: 'textinput',
			id: 'surfacePassword',
			label: 'Password (blank = none)',
			width: 3,
			default: '',
			isVisibleExpression: surfaceOnly,
		},
		{
			type: 'static-text',
			id: 'discovery_status',
			isVisibleExpression: myRemoteOnly,
			label: 'Discovery',
			width: 12,
			value: discoveryStatus,
		},
		{
			type: 'dropdown',
			id: 'selected',
			isVisibleExpression: myRemoteOnly,
			label: 'Discovered LV1',
			width: 12,
			default: '',
			choices: selectChoices,
		},
		{
			type: 'static-text',
			id: 'override_hint',
			isVisibleExpression: myRemoteOnly,
			label: 'Custom address (override)',
			width: 12,
			value:
				"Optional — only fill these if the LV1 isn't discoverable (e.g. routed network). Manual host with port=0 will still auto-discover the port for that IP.",
		},
		{
			type: 'textinput',
			id: 'host',
			isVisibleExpression: myRemoteOnly,
			label: 'LV1 IP (override)',
			width: 6,
			default: '',
			// Accept empty (= use auto-discovery) OR a valid dotted-quad IPv4. We can't use
			// Regex.IP here because it rejects the empty string, which would lock the Save
			// button whenever the user doesn't want a manual override.
			regex: IPV4_OR_EMPTY,
		},
		{
			type: 'number',
			id: 'port',
			isVisibleExpression: myRemoteOnly,
			label: 'LV1 port (0 = auto)',
			width: 6,
			default: 0,
			min: 0,
			max: 65535,
		},
		{
			type: 'checkbox',
			id: 'readIoPatch',
			isVisibleExpression: myRemoteOnly,
			label: 'Read I/O patch (experimental, eMotion LV1 v17+)',
			tooltip:
				'Opens a second connection that registers like Waves Tracks Live — the only client type the LV1 sends its I/O patch to. ' +
				'Fills the *_patch variables. It shows up on the LV1 as an extra recorder connection.',
			width: 12,
			default: false,
		},
	]
}
