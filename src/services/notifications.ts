// Browser notification compatibility layer. Native push operations are no-ops.

export async function registerForPushNotifications(_accessToken: string): Promise<string | null> {
    return null;
}

export async function unregisterPushNotifications(_accessToken?: string | null): Promise<void> {
    // No-op on web
}

export async function clearAppNotifications(_resetBadge: boolean = true): Promise<void> {
    // No-op on web
}

export async function syncAppBadgeCountFromUnreadConversations(_ownerUuid?: string | null): Promise<number> {
    return 0;
}

export async function setAppIconBadgeCount(_count: number): Promise<void> {
    // No-op on web
}

export function setupNotificationListeners(
    _onNotificationReceived?: (notification: unknown) => void,
    _onNotificationResponse?: (response: unknown) => void
) {
    return () => { };
}
