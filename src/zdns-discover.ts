// Discover Waves LV1 services on the LAN via the custom "/zDNS" multicast
// protocol (UDP 225.1.1.1:13337). Standard mDNS / bonjour does NOT work for the
// LV1 — only this custom announcement does. Ported from lv1-debugger/src/zdns-discover.js.
//
// Each /zDNS packet is OSC-formatted and carries:
//   - service type (e.g. "_waveslv113._tcp")
//   - instance uuid
//   - hostname
//   - listening port
//   - every IPv4 + IPv6 address on every NIC of the LV1 host
//
// We rank the advertised IPv4s so the caller can pick the LAN address most
// likely to actually route to the LV1 (preferring 192.168.x.x / 10.x.x.x over
// WSL/Docker 172.x and APIPA 169.254.x).

import dgram from 'dgram'
import os from 'os'
import { decodePacket } from './osc.js'

const MCAST_ADDR = '225.1.1.1'
const MCAST_PORT = 13337

export interface DiscoveryEntry {
	service: string // e.g. "_waveslv113._tcp"
	uuid: string | null
	host: string | null
	port: number | null
	addresses: string[] // IPv4 addresses, ranked best-first
	ipv6: string[]
	source: string // IP the announcement actually arrived from
}

function ipv4Like(s: string): boolean {
	return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s)
}
function ipv6Like(s: string): boolean {
	return s.includes(':')
}

// Higher = better. The LV1 advertises every NIC it has — we want the real LAN one.
function rankIp(ip: string): number {
	if (/^127\./.test(ip)) return -100
	if (/^169\.254\./.test(ip)) return -50
	if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return 30 // Docker / WSL / Hyper-V
	if (/^192\.168\.56\./.test(ip)) return 20 // VirtualBox host-only
	if (/^192\.168\./.test(ip)) return 100 // typical home/studio LAN
	if (/^10\./.test(ip)) return 90 // corporate LAN
	return 40
}

interface ZDNSParsed {
	service: string
	uuid: string | null
	host: string | null
	port: number | null
	ipv4s: string[]
	ipv6s: string[]
}

function parseZDNS(buf: Buffer): ZDNSParsed | null {
	let msg
	try {
		msg = decodePacket(buf)
	} catch {
		return null
	}
	if (!msg || msg.address !== '/zDNS' || !Array.isArray(msg.args)) return null
	const args = msg.args
	if (args.length < 2 || args[0].type !== 's') return null

	const service = args[0].value
	const uuid = args[1] && args[1].type === 's' ? args[1].value : null

	let host: string | null = null
	let port: number | null = null
	const ipv4s: string[] = []
	const ipv6s: string[] = []
	for (let i = 2; i < args.length; i++) {
		const a = args[i]
		if (a.type === 's') {
			const v = a.value
			if (ipv4Like(v)) ipv4s.push(v)
			else if (ipv6Like(v)) ipv6s.push(v)
			else if (host == null && v.length > 0) host = v
		} else if (a.type === 'i' && port == null) {
			const n = a.value
			if (n > 1024 && n < 65536) port = n
		}
	}
	return { service, uuid, host, port, ipv4s, ipv6s }
}

/** The non-internal IPv4 interfaces a scan will join the multicast group on.
 *  Exported so the config dialog can NAME them: when discovery finds nothing,
 *  the operator's only real question is whether we are even listening on the
 *  cable the desk is patched into. "Scanning…" does not answer that. */
export function multicastInterfaces(): { name: string; address: string }[] {
	const out: { name: string; address: string }[] = []
	for (const [name, list] of Object.entries(os.networkInterfaces())) {
		if (!list) continue
		for (const iface of list) {
			if (iface.family !== 'IPv4' || iface.internal) continue
			out.push({ name, address: iface.address })
		}
	}
	return out
}

export interface DiscoverOptions {
	timeoutMs?: number
	/** Progress / failure reporting. Without this a bind failure is invisible:
	 *  the scan just returns zero entries and looks identical to "no LV1 on the
	 *  LAN", which is the single hardest thing to debug about this module. */
	onDiagnostic?: (level: 'info' | 'warn' | 'error', message: string) => void
	/** If set, only return entries whose host IP list contains this IP. Used when the user
	 *  knows the LV1's IP but not its (session-varying) port. */
	filterHostIp?: string
	/** If set, only return entries matching this service type (default: any _waveslv113._tcp). */
	filterService?: string
	onFound?: (entry: DiscoveryEntry) => void
}

export interface DiscoverHandle {
	stop: () => void
}

/** Returned by `discover()` so callers can cancel an in-flight scan
 *  (e.g. on module `destroy()` or `configUpdated`). Awaiting `done`
 *  always resolves to the entries collected so far. */
export interface DiscoverHandle {
	stop: () => void
	done: Promise<DiscoveryEntry[]>
}

export function discover(opts: DiscoverOptions = {}): DiscoverHandle {
	const timeoutMs = opts.timeoutMs ?? 6000
	const wantService = opts.filterService ?? '_waveslv113._tcp'
	const filterIp = opts.filterHostIp

	let socket: dgram.Socket | null = null
	let timer: NodeJS.Timeout | null = null
	let resolved = false
	let resolveFn: (v: DiscoveryEntry[]) => void = () => {}
	const found = new Map<string, DiscoveryEntry>()

	const done = new Promise<DiscoveryEntry[]>((resolve) => {
		resolveFn = resolve
	})

	const finish = () => {
		if (resolved) return
		resolved = true
		if (timer) {
			clearTimeout(timer)
			timer = null
		}
		if (socket) {
			try {
				socket.close()
			} catch {
				/* ignore */
			}
			socket = null
		}
		resolveFn([...found.values()])
	}

	const diag = opts.onDiagnostic ?? (() => {})

	try {
		socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
	} catch (err) {
		// dgram construction can throw on hardened platforms — resolve empty
		diag('error', `Discovery socket could not be created: ${(err as Error).message}`)
		queueMicrotask(finish)
		return { stop: finish, done }
	}

	socket.on('error', (err: NodeJS.ErrnoException) => {
		// ⛔ This used to be `() => finish()`. A silent failure here is
		// indistinguishable from "no LV1 on the network" — the scan returns zero
		// entries either way. EADDRINUSE in particular means something else already
		// holds UDP 13337 (a second Companion, a Waves tool, another LV1 utility),
		// which is a fixable problem the operator can only fix if they are told.
		const code = err.code ?? err.message
		if (code === 'EADDRINUSE') {
			diag(
				'error',
				`Discovery cannot listen on UDP ${MCAST_PORT}: another process on this machine already holds it (EADDRINUSE). ` +
					`Close any other LV1 tool or duplicate Companion instance, or set the LV1 IP manually to skip discovery.`,
			)
		} else {
			diag('error', `Discovery socket error (${code}) — treating as no LV1 found.`)
		}
		finish()
	})

	socket.on('message', (buf, rinfo) => {
		const z = parseZDNS(buf)
		if (!z) return
		if (z.service !== wantService) return
		if (filterIp && !z.ipv4s.includes(filterIp)) return

		const addresses = [...z.ipv4s].sort((a, b) => rankIp(b) - rankIp(a))
		const key = `${z.service}|${z.host}|${z.port}`
		if (found.has(key)) return
		const entry: DiscoveryEntry = {
			service: z.service,
			uuid: z.uuid,
			host: z.host,
			port: z.port,
			addresses,
			ipv6: z.ipv6s,
			source: rinfo.address,
		}
		found.set(key, entry)
		opts.onFound?.(entry)
	})

	socket.bind(MCAST_PORT, () => {
		if (!socket) return
		try {
			socket.setBroadcast(true)
		} catch {
			/* ignore */
		}
		// Join the multicast group on every non-internal IPv4 interface so we
		// catch the announcement regardless of which NIC the LV1 lives on.
		//
		// One socket with N memberships is the correct shape here, and it matters:
		// the LV1 beacons out EVERY interface it has, but a listener that joins
		// only the default route hears just one of them. On a FOH machine whose
		// Wi-Fi carries the internet (and the default route) while Ethernet carries
		// the desk, joining only the default would hear nothing, forever.
		const joined: string[] = []
		const refused: string[] = []
		for (const { name, address } of multicastInterfaces()) {
			try {
				socket.addMembership(MCAST_ADDR, address)
				joined.push(`${name} (${address})`)
			} catch {
				// Some Windows interfaces refuse multicast; a virtual adapter that is
				// up but unroutable also lands here. Not fatal on its own.
				refused.push(`${name} (${address})`)
			}
		}
		if (!joined.length) {
			try {
				socket.addMembership(MCAST_ADDR)
				joined.push('default route only')
			} catch (err) {
				diag(
					'error',
					`Could not join multicast group ${MCAST_ADDR} on ANY interface (${(err as Error).message}). ` +
						`Discovery cannot work here — set the LV1 IP manually.`,
				)
			}
		}
		if (joined.length) {
			diag('info', `Discovery listening on ${MCAST_ADDR}:${MCAST_PORT} via ${joined.join(', ')}`)
		}
		if (refused.length) {
			diag('warn', `Interfaces that refused multicast (ignored): ${refused.join(', ')}`)
		}
	})

	timer = setTimeout(finish, timeoutMs)

	return { stop: finish, done }
}
