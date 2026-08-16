// Read helpers counting GNOME message-tray notifications per app.

import { messageTraySources, notificationSourceApp } from '../compat/shell.js';

let cachedSources = [];
let cachedCounts = [];
let cachedMap = new Map();

function sourceCount(source) {
    return typeof source?.count === 'number'
        ? source.count
        : (source?.notifications?.length ?? 0);
}

export function clearNotificationCache() {
    cachedSources = [];
    cachedCounts = [];
    cachedMap = new Map();
}

// Build a Map<appId, count> from all tray sources in a single pass. When
// several docks refresh from the same Shell event, source identity/counts are
// checked first so only the first dock resolves app IDs and allocates a new map.
export function buildNotificationMap() {
    let sources;
    try { sources = messageTraySources(); }
    catch { sources = []; }

    const counts = new Array(sources.length);
    let unchanged = sources.length === cachedSources.length;
    for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        const count = sourceCount(source);
        counts[i] = count;
        if (unchanged && (source !== cachedSources[i] || count !== cachedCounts[i]))
            unchanged = false;
    }
    if (unchanged) return cachedMap;

    const map = new Map();
    for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        const count = counts[i];
        if (!src || count <= 0) continue;

        let srcId = null;
        const app = notificationSourceApp(src);
        if (app?.get_id) {
            srcId = app.get_id();
        } else if (src.policy?.id && src.policy.id !== 'generic') {
            const pid = src.policy.id;
            srcId = pid.endsWith('.desktop') ? pid : `${pid}.desktop`;
        }
        if (srcId) map.set(srcId, (map.get(srcId) ?? 0) + count);
    }

    cachedSources = sources.slice();
    cachedCounts = counts;
    cachedMap = map;
    return map;
}
