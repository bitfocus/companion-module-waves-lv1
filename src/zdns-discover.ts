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

export interface DiscoverOptions {
	timeoutMs?: number
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

	try {
		socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
	} catch {
		// dgram construction can throw on hardened platforms — resolve empty
		queueMicrotask(finish)
		return { stop: finish, done }
	}

	socket.on('error', () => finish())

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
		const ifaces = os.networkInterfaces()
		let joinedAny = false
		for (const list of Object.values(ifaces)) {
			if (!list) continue
			for (const iface of list) {
				if (iface.family !== 'IPv4' || iface.internal) continue
				try {
					socket.addMembership(MCAST_ADDR, iface.address)
					joinedAny = true
				} catch {
					/* some Windows ifaces refuse multicast — ignore */
				}
			}
		}
		if (!joinedAny) {
			try {
				socket.addMembership(MCAST_ADDR)
			} catch {
				/* ignore */
			}
		}
	})

	timer = setTimeout(finish, timeoutMs)

	return { stop: finish, done }
}
