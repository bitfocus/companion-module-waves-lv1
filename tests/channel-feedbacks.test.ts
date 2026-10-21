import assert from 'node:assert/strict'
import test from 'node:test'
import { channelFeedbacksForDelta } from '../src/channel-feedbacks.ts'

void test('phantom changes refresh both value and unknown-state feedbacks', () => {
	assert.deepEqual(channelFeedbacksForDelta({ phantom: false }), ['channelPhantom', 'channelPhantomUnknown'])
})

void test('combined changes refresh polarity and both phantom feedbacks', () => {
	assert.deepEqual(channelFeedbacksForDelta({ polarity: false, phantom: true }), [
		'channelPolarity',
		'channelPhantom',
		'channelPhantomUnknown',
	])
})

void test('polarity changes refresh only polarity feedback', () => {
	assert.deepEqual(channelFeedbacksForDelta({ polarity: true }), ['channelPolarity'])
})
