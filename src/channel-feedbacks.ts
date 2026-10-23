export type ChannelFeedbackDelta = {
	polarity?: boolean | null
	phantom?: boolean | null
}

export function channelFeedbacksForDelta(delta: ChannelFeedbackDelta): string[] {
	const feedbacks: string[] = []
	if (delta.polarity != null) feedbacks.push('channelPolarity')
	if (delta.phantom != null) feedbacks.push('channelPhantom', 'channelPhantomUnknown')
	return feedbacks
}
