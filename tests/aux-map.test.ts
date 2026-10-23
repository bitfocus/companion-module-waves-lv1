import assert from 'node:assert/strict'
import test from 'node:test'
import type { OscArg } from '../src/osc.ts'
import { AuxMap, parseAuxTracks } from '../src/aux-map.ts'

const i = (value: number): OscArg => ({ type: 'i', value })
const s = (value: string): OscArg => ({ type: 's', value })
const T: OscArg = { type: 'T', value: true }

/** /Aux/Tracks as captured from eMotion LV1 v17.6.26.456 (8 FX + 24 Mon). */
function v17AuxTracks(): OscArg[] {
	const args: OscArg[] = [i(32)]
	for (let n = 0; n < 8; n++) args.push(i(n), i(2), s(`Fx ${n + 1}`))
	for (let n = 0; n < 24; n++) args.push(i(n), i(25), s(`Mon ${n + 1}`))
	return args
}

/** /Aux/Tracks as captured from v16 (8 FX + 16 Mon, every aux in group 2). */
function v16AuxTracks(): OscArg[] {
	const args: OscArg[] = [i(24)]
	for (let n = 0; n < 24; n++) args.push(i(n), i(2), s(n < 8 ? `Fx ${n + 1}` : `Mon ${n - 7}`))
	return args
}

void test('v17: monitors map between (2, combined) and (25, local)', () => {
	const map = new AuxMap()
	map.set(parseAuxTracks(v17AuxTracks()))
	assert.equal(map.size, 32)
	assert.equal(map.splitMonitors, true)
	assert.deepEqual(map.toWire(2, 3), [2, 3]) // Fx 4 unchanged
	assert.deepEqual(map.toWire(2, 8), [25, 0]) // Mon 1
	assert.deepEqual(map.toWire(2, 31), [25, 23]) // Mon 24
	assert.deepEqual(map.fromWire(25, 23), [2, 31])
	assert.deepEqual(map.fromWire(2, 7), [2, 7])
	assert.deepEqual(map.toWire(0, 79), [0, 79]) // inputs never change
})

void test('v16: every mapping is the identity', () => {
	const map = new AuxMap()
	map.set(parseAuxTracks(v16AuxTracks()))
	assert.equal(map.splitMonitors, false)
	for (let n = 0; n < 24; n++) {
		assert.deepEqual(map.toWire(2, n), [2, n])
		assert.deepEqual(map.fromWire(2, n), [2, n])
	}
})

void test('outgoing: track commands are rewritten, the send plane keeps the combined index', () => {
	const map = new AuxMap()
	map.set(parseAuxTracks(v17AuxTracks()))
	// Mon 24 fader — verified live that only [25, 23, …] moves it.
	assert.deepEqual(map.translateOutgoing('/Set/Track/Out/Gain', [i(2), i(31), { type: 'd', value: -10 }]), [
		i(25),
		i(23),
		{ type: 'd', value: -10 },
	])
	// Ch 80 → Mon 1 send: source is an input, aux stays combined (8).
	const send = [i(0), i(79), i(8), T]
	assert.equal(map.translateOutgoing('/Set/Aux/Send/On', send), send)
	// Route Ch 80 → Mon 1: destination pair is translated too.
	assert.deepEqual(map.translateOutgoing('/SetInternalAsgn', [i(0), i(79), i(2), i(8), i(1)]), [
		i(0),
		i(79),
		i(25),
		i(0),
		i(1),
	])
	// Unrelated addresses are left alone.
	const get = [i(25)]
	assert.equal(map.translateOutgoing('/Get/Sends', get), get)
})

void test('incoming: notifications fold monitors back, whitelisted addresses only', () => {
	const map = new AuxMap()
	map.set(parseAuxTracks(v17AuxTracks()))
	const mute = map.translateIncoming({ address: '/Notify/Track/Out/Mute', args: [i(25), i(23), i(1), T] })
	assert.deepEqual(mute.args, [i(2), i(31), i(1), T])
	const ia = map.translateIncoming({ address: '/Notify/InternalAssign', args: [i(8), i(0), i(25), i(23), i(1), i(1)] })
	assert.deepEqual(ia.args, [i(8), i(0), i(2), i(31), i(1), i(1)])
	// /Notify/Sends leads with a combined aux index (25 = Mon 18) — must not be touched.
	const sends = { address: '/Notify/Sends', args: [i(25), i(114), i(0), i(0)] }
	assert.equal(map.translateIncoming(sends), sends)
})
