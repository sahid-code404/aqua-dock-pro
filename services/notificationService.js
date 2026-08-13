// Read helpers counting GNOME message-tray notifications per app.

import { messageTraySources, notificationSourceApp } from '../compat/shell.js';

// Build a Map<appId, count> from all tray sources in a single pass.
// Callers iterate dock items and do map.get(appId) — O(1) per item
// instead of O(sources) per item.
//
// GNOME 50 compatibility: the Source class may or may not have an `app`
// property depending on the notification daemon type. We try, in order:
//   1. public/fallback app resolution at the compatibility boundary
//   2. src.policy?.id + ".desktop" — NotificationApplicationPolicy
export function buildNotificationMap() {
    const map = new Map();
    try {
        const sources = messageTraySources();
        for (const src of sources) {
            if (!src) continue;

            // Resolve the desktop app ID from whichever path is available.
            let srcId = null;
            const app = notificationSourceApp(src);
            if (app?.get_id) {
                srcId = app.get_id();
            } else if (src.policy?.id && src.policy.id !== 'generic') {
                const pid = src.policy.id;
                srcId = pid.endsWith('.desktop') ? pid : `${pid}.desktop`;
            }
            if (!srcId) continue;

            const c = (typeof src.count === 'number')
                ? src.count
                : (src.notifications?.length ?? 0);
            if (c > 0) map.set(srcId, (map.get(srcId) ?? 0) + c);
        }
    } catch { }
    return map;
}
