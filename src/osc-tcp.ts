// OSC-over-TCP client for the Waves LV1, ported from lv1-debugger/src/osc-tcp.js.
//
// FRAMING (reverse-engineered from real LV1 captures):
//   [ 4-byte big-endian length ] [ 8-byte proprietary header ] [ N bytes OSC payload ]
//
//   length         — declares ONLY the size of the OSC payload (does NOT include the 8-byte header)
//   header[0..3]   — uint32 BE, observed value 0x00000002 (probably "message type" or "version")
//   header[4..7]   — uint32 BE, observed value 0x00000000 (probably sequence or flags)
//
// Plus:
//   - the LV1 sends /ping h:<sysclock> i:<seq> every ~1 s. If the client doesn't respond
//     with /pong (same args), the LV1 drops the link after ~5 s
//   - registration handshake comes in two flavours (MyMon vs MyFOH) — see `register()`
//   - `/Notify/Meters` (~2.4 KB at ~0.8 Hz) and `/Notify/NetworkCongestion`/`/Notify/TempoBlink`
//     are high-volume; the caller filters them out for UI display

import net from 'net'
import { EventEmitter } from 'events'
import { encodeMessage, decodePacket, OscArg, OscMessage } from './osc.js'

const DEFAULT_HEADER = Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00])
const HEADER_LEN = 8

export type HandshakeStyle = 'myfoh' | 'mymon'

export interface OscTcpClientOptions {
	host: string
	port: number
	deviceName?: string
	uuid?: string
	handshakeStyle?: HandshakeStyle
	autoReconnect?: boolean
	reconnectMs?: number
	header?: Buffer
}

export class OscTcpClient extends EventEmitter {
	private host: string
	private port: number
	private deviceName: string
	private uuid: string
	private handshakeStyle: HandshakeStyle
	private autoReconnect: boolean
	private reconnectMs: number
	private txHeader: Buffer
	private socket: net.Socket | null = null
	private rxBuf: Buffer = Buffer.alloc(0)
	private destroyed = false
	private connected = false

	constructor(opts: OscTcpClientOptions) {
		super()
		this.host = opts.host
		this.port = opts.port
		this.deviceName = opts.deviceName ?? 'companion'
		this.uuid = opts.uuid ?? randomUuid()
		this.handshakeStyle = opts.handshakeStyle ?? 'myfoh'
		this.autoReconnect = opts.autoReconnect ?? true
		this.reconnectMs = opts.reconnectMs ?? 3000
		this.txHeader = Buffer.from(opts.header ?? DEFAULT_HEADER)
	}

	isConnected(): boolean {
		return this.connected
	}

	connect(): void {
		if (this.socket) return
		this.destroyed = false
		const sock = new net.Socket()
		this.socket = sock

		sock.on('connect', () => {
			// M4: clear the connect-deadline once the TCP handshake completes.
			sock.setTimeout(0)
			this.connected = true
			this.emit('connect', { host: this.host, port: this.port })
			// Run the handshake immediately. Caller listens for 'registered' to know when /Set/ is safe.
			this.register().catch((err) => this.emit('error', err))
		})

		sock.on('data', (chunk) => {
			this.rxBuf = Buffer.concat([this.rxBuf, chunk])
			this.drain()
		})

		sock.on('error', (err) => this.emit('error', err))

		// M4: bound the TCP connect itself. Without this, a firewalled/silently-dropping
		// host hangs at the OS default (tens of seconds) with status stuck Connecting.
		sock.setTimeout(5000)
		sock.on('timeout', () => {
			if (!this.connected) {
				this.emit('error', new Error(`TCP connect timed out after 5 s (${this.host}:${this.port})`))
				sock.destroy()
			}
		})

		sock.on('close', (hadError) => {
			this.connected = false
			this.socket = null
			this.rxBuf = Buffer.alloc(0)
			this.emit('close', { hadError })
			if (this.autoReconnect && !this.destroyed) {
				setTimeout(() => this.connect(), this.reconnectMs)
			}
		})

		sock.connect(this.port, this.host)
	}

	disconnect(): void {
		this.destroyed = true
		this.autoReconnect = false
		if (this.socket) this.socket.destroy()
	}

	updateTarget(host: string, port: number): void {
		const changed = host !== this.host || port !== this.port
		this.host = host
		this.port = port
		if (changed && this.socket) {
			// Force reconnect with new target. The 'close' handler will auto-reconnect if enabled.
			this.socket.destroy()
		}
	}

	localIP(): string {
		if (this.socket && this.socket.localAddress) {
			const a = this.socket.localAddress
			if (a && a !== '0.0.0.0' && a !== '::') return a.replace(/^::ffff:/, '')
		}
		return '127.0.0.1'
	}

	// Send a single OSC message, framed with the 8-byte LV1 header.
	send(address: string, args: OscArg[] = []): void {
		if (!this.connected || !this.socket) {
			this.emit('error', new Error(`send(${address}) while not connected`))
			return
		}
		const packet = encodeMessage(address, args)
		const len = Buffer.alloc(4)
		len.writeUInt32BE(packet.length, 0)
		const frame = Buffer.concat([len, this.txHeader, packet])
		this.socket.write(frame)
		this.emit('sent', { address, args })
	}

	// Send several OSC messages inside ONE TCP write. The LV1 requires this for the
	// /handshake + /device_name batch in the MyFOH-style handshake and for the
	// /Get/Aux/Tracks + /YourHostIP batch in the MyMon-style.
	sendBatch(messages: { address: string; args?: OscArg[] }[]): void {
		if (!this.connected || !this.socket) {
			this.emit('error', new Error('sendBatch while not connected'))
			return
		}
		const frames = messages.map(({ address, args = [] }) => {
			const packet = encodeMessage(address, args)
			const len = Buffer.alloc(4)
			len.writeUInt32BE(packet.length, 0)
			return Buffer.concat([len, this.txHeader, packet])
		})
		this.socket.write(Buffer.concat(frames))
		for (const m of messages) this.emit('sent', { address: m.address, args: m.args ?? [] })
	}

	// Wait for the first incoming packet matching predicate. Resolves null on timeout.
	private async waitFor(predicate: (m: OscMessage) => boolean, timeoutMs: number): Promise<OscMessage | null> {
		return new Promise<OscMessage | null>((resolve) => {
			const onPacket = ({ decoded }: { decoded: OscMessage }) => {
				try {
					if (predicate(decoded)) {
						this.off('packet', onPacket)
						clearTimeout(timer)
						resolve(decoded)
					}
				} catch {
					/* predicate threw — keep waiting */
				}
			}
			const timer = setTimeout(() => {
				this.off('packet', onPacket)
				resolve(null)
			}, timeoutMs)
			this.on('packet', onPacket)
		})
	}

	// Run the registration handshake. Emits 'registered' on success.
	async register(): Promise<void> {
		try {
			if (this.handshakeStyle === 'myfoh') {
				// iPad MyFOH style: batch /handshake + /device_name in one TCP write.
				// MyRemote ControlPanel shows TYPE = MyFOH.
				this.sendBatch([
					{
						address: '/handshake',
						args: [
							{ type: 'i', value: 1 },
							{ type: 'i', value: -1 },
							{ type: 'i', value: 1 },
						],
					},
					{
						address: '/device_name',
						args: [
							{ type: 's', value: this.deviceName },
							{ type: 's', value: this.uuid },
						],
					},
				])
				const ack = await this.waitFor(
					(p) => p?.address === '/handshake' && p.args?.[0]?.type === 'i' && p.args[0].value === 1,
					3000,
				)
				if (!ack) {
					// M2: no ACK means we are NOT registered. Don't fall through and emit
					// 'registered' — that would drive Status=Ok over a half-open link.
					this.emit('error', new Error('No /handshake ACK after 3 s'))
					return
				}
				this.emit('registered', { style: 'myfoh' })
			} else {
				// iPhone MyMon style. MyRemote ControlPanel shows TYPE = MyMon.
				const ip = this.localIP()
				this.sendBatch([
					{ address: '/Get/Aux/Tracks', args: [] },
					{ address: '/YourHostIP', args: [{ type: 's', value: ip }] },
				])
				await this.waitFor((p) => p?.address === '/Notify/CurrentSessionID', 3000)
				this.send('/handshake', [
					{ type: 'i', value: 1 },
					{ type: 'i', value: -1 },
					{ type: 'i', value: 0 },
				])
				const ack = await this.waitFor(
					(p) => p?.address === '/handshake' && p.args?.[0]?.type === 'i' && p.args[0].value === 1,
					3000,
				)
				if (!ack) {
					// M2: no ACK = not registered, do not emit 'registered' or set Status=Ok.
					this.emit('error', new Error('No /handshake ACK after 3 s'))
					return
				}
				this.send('/device_name', [
					{ type: 's', value: this.deviceName },
					{ type: 's', value: this.uuid },
				])
				this.emit('registered', { style: 'mymon' })
			}
		} catch (err) {
			this.emit('error', err)
		}
	}

	// ─── Frame reassembly ─────────────────────────────────────────────────

	private drain(): void {
		while (this.rxBuf.length >= 4 + HEADER_LEN) {
			const size = this.rxBuf.readUInt32BE(0)
			if (size === 0 || size > 16 * 1024 * 1024) {
				// Resync — drop one byte and try again.
				this.rxBuf = this.rxBuf.slice(1)
				continue
			}
			const total = 4 + HEADER_LEN + size
			if (this.rxBuf.length < total) return
			const header = this.rxBuf.slice(4, 4 + HEADER_LEN)
			const packet = this.rxBuf.slice(4 + HEADER_LEN, total)
			this.rxBuf = this.rxBuf.slice(total)

			let decoded: OscMessage
			try {
				decoded = decodePacket(packet)
			} catch (err) {
				this.emit('decode-error', { err, packet, header })
				continue
			}

			this.emit('packet', { decoded, raw: packet, header })

			// Auto-pong: keep the LV1's link alive by echoing the ping args back as /pong.
			if (decoded.address === '/ping') {
				try {
					this.send('/pong', decoded.args)
				} catch (e) {
					this.emit('error', new Error('auto-pong failed: ' + (e as Error).message))
				}
			}
		}
	}
}

function randomUuid(): string {
	// 8-4-4-4-12 uppercase hex, like "1AC2D917-4918-4EAE-BE3C-375E290240F3".
	const hex = '0123456789ABCDEF'
	let s = ''
	for (let i = 0; i < 36; i++) {
		if (i === 8 || i === 13 || i === 18 || i === 23) s += '-'
		else s += hex[Math.floor(Math.random() * 16)]
	}
	return s
}
