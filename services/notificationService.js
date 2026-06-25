// AquaDockPro — message-tray notification counting.
//
// Purpose:   Translate GNOME's message-tray sources into per-app notification
//            counts for dock badges. Pure read helpers over Main.messageTray;
//            the dock subscribes to tray source changes elsewhere and calls
//            these to recompute a badge number.
// Ownership: Stateless functions. They read the live tray; they own nothing.
// Cost:      O(sources). Called on tray change / window events, never per frame.
//            buildNotificationMap() iterates sources ONCE and returns a Map for
//            O(1) per-item lookup, avoiding the O(sources × items) blowup.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Build a Map<appId, count> from all tray sources in a single pass.
// Callers iterate dock items and do map.get(appId) — O(1) per item
// instead of O(sources) per item.
//
// GNOME 50 compatibility: the Source class may or may not have an `app`
// property depending on the notification daemon type. We try, in order:
//   1. src.app?.get_id()          — GtkNotificationDaemonAppSource
//   2. src._app?.get_id()         — some legacy daemon subclasses
//   3. src.policy?.id + ".desktop" — NotificationApplicationPolicy
export function buildNotificationMap() {
    const map = new Map();
    try {
        const sources = Main.messageTray?.getSources?.() ?? [];
        for (const src of sources) {
            if (!src) continue;

            // Resolve the desktop app ID from whichever path is available.
            let srcId = null;
            const app = src.app ?? src._app ?? null;
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
