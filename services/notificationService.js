// Extension-wide GNOME message-tray notification state and subscriptions.

import {
    messageTray,
    messageTraySources,
    notificationSourceApp,
} from '../compat/shell.js';
import { TimeoutGroup, logError } from '../core/utils.js';

const FALLBACK_PROBE_MS = 2500;

let cachedSources = [];
let cachedCounts = [];
let cachedIds = [];
let cachedMap = new Map();
let sharedHub = null;

function sourceCount(source) {
    return typeof source?.count === 'number'
        ? source.count
        : (source?.notifications?.length ?? 0);
}

function sourceId(source) {
    const app = notificationSourceApp(source);
    if (app?.get_id) return app.get_id();
    if (source?.policy?.id && source.policy.id !== 'generic') {
        const pid = source.policy.id;
        return pid.endsWith('.desktop') ? pid : `${pid}.desktop`;
    }
    return null;
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
    cachedIds = [];
    cachedMap = new Map();
}

// Build a Map<appId, count> from all tray sources in a single pass. Source
// identity/count/app-ID caching makes repeated probes cheap when Shell state is
// stable while still noticing a source whose policy/app identity changes.
export function buildNotificationMap(sourceSnapshot = null) {
    let sources = sourceSnapshot;
    if (!sources) {
        try { sources = messageTraySources(); }
        catch { sources = []; }
    }

    const counts = new Array(sources.length);
    const ids = new Array(sources.length);
    let unchanged = sources.length === cachedSources.length;
    for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        const count = sourceCount(source);
        const id = sourceId(source);
        counts[i] = count;
        ids[i] = id;
        if (unchanged && (source !== cachedSources[i] ||
            count !== cachedCounts[i] || id !== cachedIds[i]))
            unchanged = false;
    }
    if (unchanged) return cachedMap;

    const map = new Map();
    for (let i = 0; i < sources.length; i++) {
        const count = counts[i];
        const id = ids[i];
        if (!id || count <= 0) continue;
        map.set(id, (map.get(id) ?? 0) + count);
    }

    cachedSources = sources.slice();
    cachedCounts = counts;
    cachedIds = ids;
    cachedMap = map;
    return map;
}

class NotificationHub {
    constructor() {
        this._callbacks = new Set();
        this._tray = messageTray();
        this._trayIds = [];
        this._sourceSignals = new Map();
        this._baseReliable = Boolean(this._tray);
        this._reliable = this._baseReliable;
        this._map = buildNotificationMap();
        this._timers = new TimeoutGroup();
        this._fallbackId = 0;

        if (this._tray) this._connect();
    }

    get empty() { return this._callbacks.size === 0; }
    get map() { return this._map; }
    get reliable() { return this._reliable; }

    subscribe(callback) {
        this._callbacks.add(callback);
        this._syncFallbackProbe();
        let live = true;
        return () => {
            if (!live) return;
            live = false;
            this._callbacks.delete(callback);
            this._syncFallbackProbe();
        };
    }

    probe() {
        this._refresh(true, true);
        return this._map;
    }

    _connect() {
        const changed = () => this._refresh(true, true);
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
        if (!addedId || !removedId) this._baseReliable = false;

        try {
            for (const source of messageTraySources()) this._watchSource(source);
        } catch {
            this._baseReliable = false;
        }
        this._updateReliability();
        this._syncFallbackProbe();
    }

    _watchSource(source) {
        if (!source || this._sourceSignals.has(source)) return;
        const ids = [];
        const changed = () => this._refresh(true, true);
        let countId = 0;
        let addedId = 0;
        let removedId = 0;
        try { countId = source.connect('notify::count', changed); } catch { }
        try { addedId = source.connect('notification-added', changed); } catch { }
        try { removedId = source.connect('notification-removed', changed); } catch { }
        if (countId) ids.push(countId);
        if (addedId) ids.push(addedId);
        if (removedId) ids.push(removedId);
        const reliable = Boolean(countId || (addedId && removedId));
        this._sourceSignals.set(source, { ids, reliable });
        this._updateReliability();
    }

    _unwatchSource(source) {
        const record = this._sourceSignals.get(source);
        if (!record) return;
        this._sourceSignals.delete(source);
        for (const id of record.ids) {
            try { source.disconnect(id); } catch { }
        }
        this._updateReliability();
    }

    _reconcileSources(sources) {
        const live = new Set(sources ?? []);
        for (const source of [...this._sourceSignals.keys()]) {
            if (!live.has(source)) this._unwatchSource(source);
        }
        for (const source of sources ?? []) this._watchSource(source);
        this._updateReliability();
    }

    _updateReliability() {
        if (!this._baseReliable) {
            this._reliable = false;
            return;
        }
        for (const record of this._sourceSignals.values()) {
            if (!record.reliable) {
                this._reliable = false;
                return;
            }
        }
        this._reliable = true;
    }

    _syncFallbackProbe() {
        const shouldProbe = !this._reliable && this._callbacks.size > 0;
        if (!shouldProbe) {
            if (this._fallbackId) {
                this._timers.remove(this._fallbackId);
                this._fallbackId = 0;
            }
            return;
        }
        if (this._fallbackId) return;
        this._fallbackId = this._timers.addOnce(FALLBACK_PROBE_MS, () => {
            this._fallbackId = 0;
            if (this._callbacks.size === 0) return;
            this._refresh(true, true);
            this._syncFallbackProbe();
        });
    }

    _refresh(notify, reconcile = false) {
        const previous = this._map;
        let sources = null;
        if (reconcile) {
            try {
                sources = messageTraySources();
                this._reconcileSources(sources);
            } catch {
                sources = null;
            }
        }
        const next = buildNotificationMap(sources);
        this._map = next;
        this._syncFallbackProbe();
        if (!notify || sameMap(previous, next)) return;

        for (const callback of [...this._callbacks]) {
            try { callback(); }
            catch (error) { logError(error, 'notification subscriber'); }
        }
    }

    destroy() {
        this._timers.removeAll();
        this._fallbackId = 0;
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
        this._baseReliable = false;
        this._reliable = false;
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
