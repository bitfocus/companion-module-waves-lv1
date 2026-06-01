// Module-level discovery cache. Discovery does NOT run on a timer — it's triggered
// explicitly:
//   - once when the first module instance loads (so the user has results on first config-open)
//   - on demand via the "Scan for LV1s" action (the user binds it to a Companion button)
//   - automatically as a fallback when connecting without a selection
//
// The config dropdown reads from this cache. After a scan, the user reopens the config
// dialog to see the fresh list.

import { discover, DiscoveryEntry } from './zdns-discover.js'

let cache: DiscoveryEntry[] = []
let cacheTimestamp = 0
let initialScanStarted = false
let scanInFlight: Promise<DiscoveryEntry[]> | null = null

export function getDiscoveryCache(): { entries: DiscoveryEntry[]; ageMs: number } {
	return { entries: cache, ageMs: cacheTimestamp ? Date.now() - cacheTimestamp : -1 }
}

/** Run a discovery now. If one is already in flight, returns the same promise. */
export async function refreshDiscovery(timeoutMs = 5000): Promise<DiscoveryEntry[]> {
	if (scanInFlight) return scanInFlight
	scanInFlight = discover({ timeoutMs })
		.then((results) => {
			if (results.length > 0) {
				cache = results
				cacheTimestamp = Date.now()
			}
			return results
		})
		.finally(() => {
			scanInFlight = null
		})
	return scanInFlight
}

/** Trigger one initial discovery the first time a module instance loads. Idempotent. */
export function ensureInitialScan(): void {
	if (initialScanStarted) return
	initialScanStarted = true
	void refreshDiscovery()
}

/** Lookup a discovered entry by the encoded key used in the dropdown (`ip:port`). */
export function findInCache(key: string): DiscoveryEntry | null {
	if (!key) return null
	const [ip, portStr] = key.split(':')
	const port = parseInt(portStr, 10)
	if (!ip || !port) return null
	return cache.find((e) => e.addresses[0] === ip && e.port === port) ?? null
}
