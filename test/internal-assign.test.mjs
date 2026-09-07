/* eslint-disable n/no-unpublished-import -- test-only compiled module */
import assert from 'node:assert/strict'
import test from 'node:test'
import { isTalkBackDestinationNotification } from '../dist/internal-assign.js'

test('only the fixed TalkBack source owns type-2 destination notifications', () => {
	assert.equal(isTalkBackDestinationNotification(8, 0, 2), true)
})

test('ordinary internal routes never change the TalkBack destination state', () => {
	// Live trace: Input → FX1 has the same type=2 selector.
	assert.equal(isTalkBackDestinationNotification(0, 0, 2), false)
	assert.equal(isTalkBackDestinationNotification(0, 17, 2), false)
	assert.equal(isTalkBackDestinationNotification(1, 0, 2), false)
})

test('TalkBack source packets with another selector are not destinations', () => {
	assert.equal(isTalkBackDestinationNotification(8, 0, 7), false)
})
