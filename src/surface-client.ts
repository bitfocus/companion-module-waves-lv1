// TCP client for the Companion Surface driver (a control-surface driver that runs inside
// eMotion LV1 on the desk computer). Text protocol, one line per message:
//
//   driver → us   hello lv1ctl <protocol> <authRequired 0|1> <driverVersion>
//                 ctl <tt> <track> <group> <secType> <secIdx> <cid> <value> <flags> <text>
//                 val <tt> <track> <group> <secType> <secIdx> <cid> <rc> <value> <text>
//                 pong | ok … | err … | warn …
//   us → driver   setx / getx / fn / ping / sub / auth
//
// tt / track = the desk's track type and index (input = 0, FX = 2, Talk Back = 8, Monitor = 25…);
// group / secType / secIdx / cid address one control inside the track.

import { EventEmitter } from 'node:events'
import net from 'node:net'

export interface ControlAddress {
	tt: number
	track: number
	group: number
	secType: number
	secIdx: number
	cid: number
}

export interface ControlUpdate extends ControlAddress {
	value: number
	text: string
}

/** A value read in real-world units (dB, Hz…). */
export interface RealUpdate extends ControlAddress {
	mode: number
	value: number
	text: string
}

/** Properties of a control: plugin parameter name, range and their display texts. */
export interface ControlProps extends ControlAddress {
	min: number
	max: number
	step: number
	name: string
	minText: string
	maxText: string
}

/** A meter value: meter 16-31 = output legs (16 = left / mono, 17 = right). */
export interface MeterUpdate {
	tt: number
	track: number
	meter: number
	value: number
	clip: boolean
}

/** One of eMotion's state signals (mute groups, lock, scenes, tempo…). */
export interface EmotionSignal {
	name: string
	args: unknown[]
}

/** A message between eMotion's surfaces (InterMapper); payload starts at the command header. */
export interface InterMapMessage {
	msg: number
	src: number
	dst: number
	payload: Buffer
}

export function controlKey(a: ControlAddress): string {
	return `${a.tt}.${a.track}.${a.group}.${a.secType}.${a.secIdx}.${a.cid}`
}

function addr(a: ControlAddress): string {
	return `${a.tt} ${a.track} ${a.group} ${a.secType} ${a.secIdx} ${a.cid}`
}

/** Parse "<6 ints> …rest" into the address and the remaining fields. */
function parseAddressed(parts: string[]): ControlAddress | null {
	const n = parts.slice(0, 6).map((p) => parseInt(p, 10))
	if (n.length < 6 || n.some((v) => !Number.isFinite(v))) return null
	return { tt: n[0], track: n[1], group: n[2], secType: n[3], secIdx: n[4], cid: n[5] }
}

const MAX_INFLIGHT = 200

export interface SurfaceClientOptions {
	host: string
	port: number
	password?: string
	reconnectMs?: number
}

/**
 * Events: 'ready' (version), 'control' (ControlUpdate, from ctl and val lines),
 * 'intermap' (InterMapMessage, after `sub im 1`), 'real' (RealUpdate), 'props' (ControlProps),
 * 'signal' (EmotionSignal),
 * 'driverError' (message), 'authFailed', 'close', 'error' (Error).
 */
export class SurfaceClient extends EventEmitter {
	private sock: net.Socket | null = null
	private buf = ''
	private reconnectTimer: NodeJS.Timeout | null = null
	private pingTimer: NodeJS.Timeout | null = null
	private lastRx = 0
	private stopped = false
	private ready = false
	private pending: string[] = []
	private inflight = 0
	public version: string | null = null

	constructor(private opts: SurfaceClientOptions) {
		super()
	}

	connect(): void {
		this.stopped = false
		this.open()
	}

	disconnect(): void {
		this.stopped = true
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
		this.reconnectTimer = null
		this.teardown()
	}

	isReady(): boolean {
		return this.ready
	}

	setx(a: ControlAddress, value: number): void {
		this.write(`setx ${addr(a)} ${value}`)
	}

	getx(a: ControlAddress): void {
		this.request(`getx ${addr(a)}`)
	}

	/** Write in eMotion's real-world units (dB, Hz…): WSMixerControl mode 3. Not queued. */
	setReal(a: ControlAddress, value: number): void {
		if (this.write(`setu 3 ${addr(a)} ${value}`)) this.inflight++
	}

	/** Read in real-world units; answered with a 'real' event. */
	getReal(a: ControlAddress): void {
		this.request(`getu 3 ${addr(a)}`)
	}

	/** Ask eMotion's meter engine for a strip's meters (bit k = meter k); mask 0 stops them. */
	registerMeters(tt: number, track: number, mask: number): void {
		this.write(`meters ${tt} ${track} ${mask.toString(16)}`)
	}

	/** Control properties (name, range); answered with a 'props' event. */
	props(a: ControlAddress): void {
		this.request(`props ${addr(a)}`)
	}

	/**
	 * Reads are paced: at most MAX_INFLIGHT waiting for their answer. The driver queues 1024
	 * commands and runs 64 per eMotion tick, so a connect-time burst of thousands of reads
	 * would otherwise come back "busy" (and load the desk all at once).
	 */
	private request(line: string): void {
		if (!this.ready) return
		this.pending.push(line)
		this.pump()
	}

	private pump(): void {
		while (this.inflight < MAX_INFLIGHT && this.pending.length && this.sock) {
			this.sock.write(this.pending.shift() + '\n')
			this.inflight++
		}
	}

	/** One answer to a request arrived (val / valu / props / err). */
	private answered(): void {
		if (this.inflight > 0) this.inflight--
		this.pump()
	}

	write(line: string): boolean {
		if (!this.ready || !this.sock) return false
		this.sock.write(line + '\n')
		return true
	}

	private open(): void {
		this.teardown()
		const sock = net.connect({ host: this.opts.host, port: this.opts.port })
		this.sock = sock
		sock.setNoDelay(true)
		sock.setEncoding('latin1')
		sock.on('connect', () => {
			this.lastRx = Date.now()
			this.pingTimer = setInterval(() => {
				if (Date.now() - this.lastRx > 15000) {
					this.emit('error', new Error('Companion Surface stopped answering'))
					this.dropAndRetry()
					return
				}
				this.sock?.write('ping\n')
			}, 5000)
		})
		sock.on('data', (d: string) => {
			this.lastRx = Date.now()
			this.buf += d
			let i: number
			while ((i = this.buf.indexOf('\n')) >= 0) {
				const line = this.buf.slice(0, i).replace(/\r$/, '')
				this.buf = this.buf.slice(i + 1)
				if (line) this.onLine(line)
			}
		})
		sock.on('error', (err) => this.emit('error', err))
		sock.on('close', () => {
			if (this.sock !== sock) return
			this.dropAndRetry()
		})
	}

	private onLine(line: string): void {
		const parts = line.split(' ')
		switch (parts[0]) {
			case 'hello': {
				// hello lv1ctl <protocol> <authRequired> <version>
				this.version = parts[4] ?? null
				if (parts[3] === '1') {
					this.sock?.write(`auth ${this.opts.password ?? ''}\n`)
					return
				}
				this.markReady()
				return
			}
			case 'ok':
				if (parts[1] === 'auth') this.markReady()
				return
			case 'ctl': {
				// ctl <addr×6> <value> <flags> <text…>
				const a = parseAddressed(parts.slice(1))
				const value = parseFloat(parts[7])
				if (!a || !Number.isFinite(value)) return
				this.emit('control', { ...a, value, text: parts.slice(9).join(' ') } satisfies ControlUpdate)
				return
			}
			case 'val': {
				this.answered()
				// val <addr×6> <rc> <value> <text…>
				const a = parseAddressed(parts.slice(1))
				const rc = parseInt(parts[7], 10)
				const value = parseFloat(parts[8])
				if (!a || rc !== 0 || !Number.isFinite(value)) return
				this.emit('control', { ...a, value, text: parts.slice(9).join(' ') } satisfies ControlUpdate)
				return
			}
			case 'valu': {
				this.answered()
				// valu <mode> <addr×6> <rc> <value> <text…>
				const mode = parseInt(parts[1], 10)
				const a = parseAddressed(parts.slice(2))
				const rc = parseInt(parts[8], 10)
				const value = parseFloat(parts[9])
				if (!a || rc !== 0 || !Number.isFinite(value) || value === -12345) return
				this.emit('real', { ...a, mode, value, text: parts.slice(10).join(' ') } satisfies RealUpdate)
				return
			}
			case 'props': {
				this.answered()
				// props <addr×6> <rc> <min> <max> <step> <value> | @off='text' … | <hex>
				const a = parseAddressed(parts.slice(1))
				if (!a || parseInt(parts[7], 10) !== 0) return
				const texts = line.split(' | ')[1] ?? ''
				const at = (off: string) => (texts.match(new RegExp(`@${off}='([^']*)'`)) || [])[1] ?? ''
				this.emit('props', {
					...a,
					min: parseFloat(parts[8]),
					max: parseFloat(parts[9]),
					step: parseFloat(parts[10]),
					name: at('d0'),
					minText: at('1fd'),
					maxText: at('27d'),
				} satisfies ControlProps)
				return
			}
			case 'sig': {
				// sig <name> <json array>: one of eMotion's own state signals
				const json = line.slice(5 + parts[1].length)
				try {
					const args = JSON.parse(json) as unknown[]
					this.emit('signal', { name: parts[1], args } satisfies EmotionSignal)
				} catch {
					// ignore a malformed line
				}
				return
			}
			case 'mtr': {
				// mtr <tt> <track> <meter> <value> <clip>
				const [tt, track, meter] = parts.slice(1, 4).map((p) => parseInt(p, 10))
				const value = parseFloat(parts[4])
				if ([tt, track, meter].some((n) => !Number.isFinite(n)) || !Number.isFinite(value)) return
				this.emit('meter', { tt, track, meter, value, clip: parts[5] === '1' } satisfies MeterUpdate)
				return
			}
			case 'im': {
				// im <msg> <src> <dst> <size> <value> <hex payload>: an eMotion InterMapper message
				const [msg, src, dst] = parts.slice(1, 4).map((p) => parseInt(p, 10))
				const payload = Buffer.from(parts[6] ?? '', 'hex')
				if ([msg, src, dst].some((n) => !Number.isFinite(n))) return
				this.emit('intermap', { msg, src, dst, payload } satisfies InterMapMessage)
				return
			}
			case 'err':
				if (parts[1] !== 'auth') this.answered()
				if (parts[1] === 'auth') {
					this.emit('authFailed')
					return
				}
				this.emit('driverError', line.slice(4))
				return
			default:
				return // pong, warn …
		}
	}

	private markReady(): void {
		if (this.ready) return
		this.ready = true
		this.emit('ready', this.version)
	}

	private dropAndRetry(): void {
		const wasReady = this.ready
		this.teardown()
		if (wasReady) this.emit('close')
		if (this.stopped || this.reconnectTimer) return
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			if (!this.stopped) this.open()
		}, this.opts.reconnectMs ?? 3000)
	}

	private teardown(): void {
		this.ready = false
		this.buf = ''
		this.pending = []
		this.inflight = 0
		if (this.pingTimer) clearInterval(this.pingTimer)
		this.pingTimer = null
		const s = this.sock
		this.sock = null
		if (s) {
			s.removeAllListeners()
			s.on('error', () => {})
			s.destroy()
		}
	}
}
