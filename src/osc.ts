// Minimal OSC 1.0 encoder/decoder, ported from lv1-debugger/src/osc.js.
// We can't use osc-min: the LV1 wraps every OSC packet in a custom 8-byte
// header that osc-min doesn't understand, and our framing layer needs raw
// control over the bytes.
//
// OSC packet = address (string) + type tag (",ifs...") + arguments
// All blocks are padded to multiples of 4 bytes.

export type OscArg =
	| { type: 'i'; value: number }
	| { type: 'f'; value: number }
	| { type: 'h'; value: bigint | number }
	| { type: 'd'; value: number }
	| { type: 's'; value: string }
	| { type: 'b'; value: Buffer }
	| { type: 'T'; value?: boolean }
	| { type: 'F'; value?: boolean }
	| { type: 'N'; value?: null }
	| { type: 'I'; value?: number }

export interface OscMessage {
	address: string
	args: OscArg[]
}

function padTo4(len: number): number {
	return (4 - (len % 4)) % 4
}

function encodeString(str: string): Buffer {
	const buf = Buffer.from(str + '\0', 'utf8')
	const pad = padTo4(buf.length)
	return pad ? Buffer.concat([buf, Buffer.alloc(pad)]) : buf
}

function encodeBlob(data: Buffer): Buffer {
	const head = Buffer.alloc(4)
	head.writeInt32BE(data.length, 0)
	const pad = padTo4(data.length)
	return pad ? Buffer.concat([head, data, Buffer.alloc(pad)]) : Buffer.concat([head, data])
}

export function encodeMessage(address: string, args: OscArg[] = []): Buffer {
	const tag = ',' + args.map((a) => a.type).join('')
	const parts: Buffer[] = [encodeString(address), encodeString(tag)]
	for (const a of args) {
		switch (a.type) {
			case 'i': {
				const b = Buffer.alloc(4)
				b.writeInt32BE(a.value | 0, 0)
				parts.push(b)
				break
			}
			case 'f': {
				const b = Buffer.alloc(4)
				b.writeFloatBE(a.value, 0)
				parts.push(b)
				break
			}
			case 'h': {
				const b = Buffer.alloc(8)
				b.writeBigInt64BE(typeof a.value === 'bigint' ? a.value : BigInt(a.value), 0)
				parts.push(b)
				break
			}
			case 'd': {
				const b = Buffer.alloc(8)
				b.writeDoubleBE(a.value, 0)
				parts.push(b)
				break
			}
			case 's':
				parts.push(encodeString(String(a.value)))
				break
			case 'b':
				parts.push(encodeBlob(Buffer.isBuffer(a.value) ? a.value : Buffer.from(a.value as unknown as Uint8Array)))
				break
			case 'T':
			case 'F':
			case 'N':
			case 'I':
				break
			default:
				throw new Error('Unsupported OSC type tag: ' + (a as { type: string }).type)
		}
	}
	return Buffer.concat(parts)
}

function readString(buf: Buffer, offset: number): [string, number] {
	let end = offset
	while (end < buf.length && buf[end] !== 0) end++
	if (end >= buf.length) throw new Error('OSC string not null-terminated')
	const str = buf.slice(offset, end).toString('utf8')
	const total = end - offset + 1
	const padded = total + padTo4(total)
	return [str, padded]
}

export function decodeMessage(buf: Buffer): OscMessage {
	let off = 0
	const [address, aLen] = readString(buf, off)
	off += aLen
	if (off >= buf.length) return { address, args: [] }
	const [tag, tLen] = readString(buf, off)
	off += tLen
	if (!tag.startsWith(',')) return { address, args: [] }
	const types = tag.slice(1)
	const args: OscArg[] = []
	for (const t of types) {
		switch (t) {
			case 'i':
				args.push({ type: 'i', value: buf.readInt32BE(off) })
				off += 4
				break
			case 'f':
				args.push({ type: 'f', value: buf.readFloatBE(off) })
				off += 4
				break
			case 'h':
				args.push({ type: 'h', value: buf.readBigInt64BE(off) })
				off += 8
				break
			case 'd':
				args.push({ type: 'd', value: buf.readDoubleBE(off) })
				off += 8
				break
			case 's': {
				const [s, l] = readString(buf, off)
				args.push({ type: 's', value: s })
				off += l
				break
			}
			case 'b': {
				const blen = buf.readInt32BE(off)
				off += 4
				const data = buf.slice(off, off + blen)
				args.push({ type: 'b', value: data })
				off += blen + padTo4(blen)
				break
			}
			case 'T':
				args.push({ type: 'T', value: true })
				break
			case 'F':
				args.push({ type: 'F', value: false })
				break
			case 'N':
				args.push({ type: 'N', value: null })
				break
			case 'I':
				args.push({ type: 'I', value: Infinity })
				break
			default:
				// Unknown — skip silently; the wire is sometimes ahead of our parser.
				break
		}
	}
	return { address, args }
}

export function decodePacket(buf: Buffer): OscMessage {
	// We never see bundles on this protocol (the LV1 sends individual frames), so a
	// best-effort decode is enough — if the first 7 bytes look like "#bundle" the caller
	// can handle it; for our purposes we treat everything as a single message.
	return decodeMessage(buf)
}

// Helper for callers that just want to read a single arg's numeric value.
export function intArg(m: OscMessage, idx: number): number | undefined {
	const a = m.args[idx]
	if (!a) return undefined
	if (a.type === 'i' || a.type === 'f') return a.value as number
	if (a.type === 'd') return a.value as number
	return undefined
}

export function stringArg(m: OscMessage, idx: number): string | undefined {
	const a = m.args[idx]
	return a && a.type === 's' ? (a.value as string) : undefined
}

export function boolArg(m: OscMessage, idx: number): boolean | undefined {
	const a = m.args[idx]
	if (!a) return undefined
	if (a.type === 'T') return true
	if (a.type === 'F') return false
	return undefined
}
