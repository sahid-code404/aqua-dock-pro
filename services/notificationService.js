// Extension-wide GNOME message-tray notification state and subscriptions.

import {
    messageTray,
    messageTraySources,
    notificationSourceApp,
} from '../compat/shell.js';

let cachedSources = [];
let cachedCounts = [];
let cachedMap = new Map();
let sharedHub = null;

function sourceCount(source) {
    return typeof source?.count === 'number'
        ? source.count
        : (source?.notifications?.length ?? 0);
}

function sameMap(a, b) {
    if (a === b) return true;
    if (!a || !b || a.size !== b.size) return false;
    for (const [key, value] of a)
        if (b.get(key) !== value) return false;
    return true;
}

function resetSnapshot() {
    cachedSources = [];
    cachedCounts = [];
    cachedMap = new Map();
}

// Build a Map<appId, count> from all tray sources in a single pass. Source
// identity/count caching makes repeated probes cheap when Shell state is stable.
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

class NotificationHub {
    constructor() {
        this._callbacks = new Set();
        this._tray = messageTray();
        this._trayIds = [];
        this._sourceSignals = new Map();
        this._reliable = Boolean(this._tray);
        this._map = buildNotificationMap();

        if (this._tray) this._connect();
    }

    get empty() { return this._callbacks.size === 0; }
    get map() { return this._map; }
    get reliable() { return this._reliable; }

    subscribe(callback) {
        this._callbacks.add(callback);
        let live = true;
        return () => {
            if (!live) return;
            live = false;
            this._callbacks.delete(callback);
        };
    }

    probe() {
        this._refresh(true);
        return this._map;
    }

    _connect() {
        const changed = () => this._refresh(true);
        let addedId = 0;
        let removedId = 0;
        try {
            addedId = this._tray.connect('source-added', (_tray, source) => {
                this._watchSource(source);
                changed();
            });
        } catch { }
        try {
            removedId = this._tray.connect('source-removed', (_tray, source) => {
                this._unwatchSource(source);
                changed();
            });
        } catch { }
        if (addedId) this._trayIds.push(addedId);
        if (removedId) this._trayIds.push(removedId);
        if (!addedId || !removedId) this._reliable = false;

        try {
            for (const source of messageTraySources()) this._watchSource(source);
        } catch {
            this._reliable = false;
        }
    }

    _watchSource(source) {
        if (!source || this._sourceSignals.has(source)) return;
        const ids = [];
        const changed = () => this._refresh(true);
        let countId = 0;
        let addedId = 0;
        let removedId = 0;
        try { countId = source.connect('notify::count', changed); } catch { }
        try { addedId = source.connect('notification-added', changed); } catch { }
        try { removedId = source.connect('notification-removed', changed); } catch { }
        if (countId) ids.push(countId);
        if (addedId) ids.push(addedId);
        if (removedId) ids.push(removedId);
        if (!countId && !(addedId && removedId)) this._reliable = false;
        if (ids.length) this._sourceSignals.set(source, ids);
    }

    _unwatchSource(source) {
        const ids = this._sourceSignals.get(source);
        if (!ids) return;
        this._sourceSignals.delete(source);
        for (const id of ids) {
            try { source.disconnect(id); } catch { }
        }
    }

    _refresh(notify) {
        const previous = this._map;
        const next = buildNotificationMap();
        this._map = next;
        if (!notify || sameMap(previous, next)) return;

        for (const callback of [...this._callbacks]) {
            try { callback(); }
            catch { }
        }
    }

    destroy() {
        for (const source of [...this._sourceSignals.keys()])
            this._unwatchSource(source);
        this._sourceSignals.clear();

        if (this._tray) {
            for (const id of this._trayIds) {
                try { this._tray.disconnect(id); } catch { }
            }
        }
        this._trayIds = [];
        this._callbacks.clear();
        this._tray = null;
        this._map = new Map();
    }
}

function acquireHub() {
    return (sharedHub ??= new NotificationHub());
}

function releaseHub(hub) {
    if (sharedHub !== hub || !hub.empty) return;
    hub.destroy();
    sharedHub = null;
    resetSnapshot();
}

export function subscribeNotificationChanges(callback) {
    const hub = acquireHub();
    const unsubscribe = hub.subscribe(callback);
    let live = true;
    return () => {
        if (!live) return;
        live = false;
        unsubscribe();
        releaseHub(hub);
    };
}

export function currentNotificationMap(probe = false) {
    if (!sharedHub) return buildNotificationMap();
    return probe ? sharedHub.probe() : sharedHub.map;
}

export function notificationSignalsReliable() {
    return sharedHub?.reliable ?? false;
}

export function clearNotificationCache() {
    if (sharedHub) {
        sharedHub.destroy();
        sharedHub = null;
    }
    resetSnapshot();
}
