/**
 * /Notify/InternalAssign type 2 is shared by ordinary internal routes and
 * TalkBack destinations. Only the dedicated TalkBack source (group 8,
 * channel 0) is a TalkBack destination notification.
 */
export function isTalkBackDestinationNotification(group: number, channel: number, type: number): boolean {
	return type === 2 && group === 8 && channel === 0
}
