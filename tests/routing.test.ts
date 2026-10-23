import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeRouteMask, isTalkBackDest } from '../src/routing.ts'
import { parseIOConnections, rowLabel, rowTrack } from '../src/io-connections.ts'

void test('route mask: values read live from /Channels on v17', () => {
	// Channel 80 default: LR only.
	assert.deepEqual(decodeRouteMask(1099511627776n), [{ group: 3, idx: 0 }])
	// After /SetInternalAsgn Ch80 → Group 1: bits 24 + 40.
	assert.deepEqual(decodeRouteMask(1099528404992n), [
		{ group: 1, idx: 0 },
		{ group: 3, idx: 0 },
	])
	// Matrix 1 + LR (bits 32 + 40).
	assert.deepEqual(decodeRouteMask(1103806595072n), [
		{ group: 6, idx: 0 },
		{ group: 3, idx: 0 },
	])
	// Link/DCA 16, mute group 8, Mono, Center.
	assert.deepEqual(decodeRouteMask((1n << 15n) | (1n << 23n) | (1n << 41n) | (1n << 42n)), [
		{ group: 12, idx: 15 },
		{ group: 13, idx: 7 },
		{ group: 5, idx: 0 },
		{ group: 4, idx: 0 },
	])
	assert.deepEqual(decodeRouteMask(0n), [])
})

void test('talkback destination needs the TalkBack strip as source (issue #21)', () => {
	assert.equal(isTalkBackDest(8, 0, 2), true)
	assert.equal(isTalkBackDest(0, 79, 2), false) // Input → FX 1 send
	assert.equal(isTalkBackDest(1, 0, 2), false) // Group → aux
	assert.equal(isTalkBackDest(8, 0, 1), false) // TalkBack → Group bus
})

void test('IOConnections: empty list as sent for a Generic I/O patch', () => {
	assert.deepEqual(parseIOConnections([{ type: 'i', value: 0 }]), [])
	assert.equal(parseIOConnections([]), null)
})

void test('IOConnections: rows resolve the mixer key regardless of field order', () => {
	const row = (...strs: Array<string | number>) =>
		strs.map((v) => (typeof v === 'number' ? { type: 'i' as const, value: v } : { type: 's' as const, value: v }))
	const rows = parseIOConnections([
		{ type: 'i', value: 2 },
		...row('Mixer_Ch_22', 1, 'IONIC 24-1', 22, 'Analog_Mic/Line_23', 0, '00:1c:d1:01:82:66'),
		...row('IONIC 24-1', 0, 'Mixer_Mon_3', 18, 'Analog_Phones_1L', 0, ''),
	])
	assert.ok(rows)
	assert.equal(rows.length, 2)
	assert.deepEqual(rowTrack(rows[0]), { group: 0, ch: 21 })
	assert.equal(rowLabel(rows[0]), 'IONIC 24-1 Analog_Mic/Line_23')
	assert.deepEqual(rowTrack(rows[1]), { group: 25, ch: 2 })
	assert.equal(rowLabel(rows[1]), 'IONIC 24-1 Analog_Phones_1L')
})
