// Module-level discovery cache. Scans (passive listening for the LV1 announcements) run:
//   - in the background while a module instance exists: every 10 s until an LV1 is found,
//     then every 30 s — Companion only reads the config fields when the dialog opens, so
//     the list must already be there by then
//   - on demand via the "Scan for LV1s" action (the user binds it to a Companion button)
//   - automatically as a fallback when connecting without a selection

import { discover, DiscoverHandle, DiscoveryEntry } from './zdns-discover.js'

let cache: DiscoveryEntry[] = []
let cacheTimestamp = 0
let initialScanStarted = false
let scanInFlight: Promise<DiscoveryEntry[]> | null = null
let scanHandle: DiscoverHandle | null = null
let backgroundUsers = 0
let backgroundTimer: NodeJS.Timeout | null = null

/** An LV1 that stopped announcing leaves the list after this long. */
const CACHE_EXPIRY_MS = 90_000
const RESCAN_EMPTY_MS = 10_000
const RESCAN_FOUND_MS = 30_000

export function getDiscoveryCache(): { entries: DiscoveryEntry[]; ageMs: number } {
	return { entries: cache, ageMs: cacheTimestamp ? Date.now() - cacheTimestamp : -1 }
}

/** Run a discovery now. If one is already in flight, returns the same promise.
 *  `onDiagnostic` reports which interfaces were joined and any bind failure —
 *  pass the instance logger so a socket that never bound is visible instead of
 *  looking identical to "no LV1 on the network". */
export async function refreshDiscovery(
	timeoutMs = 5000,
	onDiagnostic?: (level: 'info' | 'warn' | 'error', message: string) => void,
): Promise<DiscoveryEntry[]> {
	if (scanInFlight) return scanInFlight
	const handle = discover({ timeoutMs, onDiagnostic })
	scanHandle = handle
	scanInFlight = handle.done
		.then((results) => {
			if (results.length > 0) {
				cache = results
				cacheTimestamp = Date.now()
			} else if (cacheTimestamp && Date.now() - cacheTimestamp > CACHE_EXPIRY_MS) {
				cache = []
				cacheTimestamp = 0
			}
			return results
		})
		.finally(() => {
			scanInFlight = null
			scanHandle = null
		})
	return scanInFlight
}

/** Cancel any in-flight discovery scan. Safe to call when nothing is running. */
export function cancelDiscovery(): void {
	scanHandle?.stop()
}

/** Trigger one initial discovery the first time a module instance loads. Idempotent. */
export function ensureInitialScan(): void {
	if (initialScanStarted) return
	initialScanStarted = true
	void refreshDiscovery()
}

function scheduleBackgroundScan(): void {
	if (backgroundUsers <= 0) return
	backgroundTimer = setTimeout(
		() => {
			backgroundTimer = null
			if (backgroundUsers <= 0) return
			void refreshDiscovery().finally(scheduleBackgroundScan)
		},
		cache.length ? RESCAN_FOUND_MS : RESCAN_EMPTY_MS,
	)
}

/** Keep the cache fresh in the background while an instance exists. Pair with stopBackgroundDiscovery(). */
export function startBackgroundDiscovery(): void {
	backgroundUsers++
	if (backgroundUsers === 1 && !backgroundTimer) scheduleBackgroundScan()
}

/** One instance less; the background scans stop with the last one. */
export function stopBackgroundDiscovery(): void {
	backgroundUsers = Math.max(0, backgroundUsers - 1)
	if (backgroundUsers > 0) return
	if (backgroundTimer) clearTimeout(backgroundTimer)
	backgroundTimer = null
}

/** Lookup a discovered entry by the encoded key used in the dropdown (`ip:port`). */
export function findInCache(key: string): DiscoveryEntry | null {
	if (!key) return null
	const [ip, portStr] = key.split(':')
	const port = parseInt(portStr, 10)
	if (!ip || !port) return null
	return cache.find((e) => e.addresses[0] === ip && e.port === port) ?? null
}
