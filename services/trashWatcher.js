// Shared Trash state watcher plus per-dock visual updates.

import Gio from 'gi://Gio';

import { TimeoutGroup, logError } from '../core/utils.js';
import { trashDir, trashHasFiles } from './fileService.js';

const DEBOUNCE_MS = 250;

let sharedTrashState = null;

class TrashStateStore {
    constructor() {
        this._callbacks = new Set();
        this._timers = new TimeoutGroup();
        this._monitor = null;
        this._monitorId = 0;
        this._debounceId = 0;
        this._query = null;
        this._initialized = false;
        this._hasFiles = false;
    }

    get empty() { return this._callbacks.size === 0; }

    subscribe(callback) {
        this._callbacks.add(callback);
        if (this._callbacks.size === 1) this._start();
        if (this._initialized) {
            try { callback(this._hasFiles); }
            catch (error) { logError(error, 'trash subscriber'); }
        }

        let live = true;
        return () => {
            if (!live) return;
            live = false;
            this._callbacks.delete(callback);
            if (this._callbacks.size === 0) this._stop();
        };
    }

    _start() {
        this._timers.addOnce(0, () => this._refresh());

        let monitor = null;
        try {
            monitor = trashDir().monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitorId = monitor.connect('changed', () => this._schedule());
            this._monitor = monitor;
        } catch (error) {
            if (monitor) monitor.cancel();
            logError(error, 'trash monitor');
        }
    }

    _schedule() {
        if (this._debounceId) this._timers.remove(this._debounceId);
        this._debounceId = this._timers.addOnce(DEBOUNCE_MS, () => {
            this._debounceId = 0;
            this._refresh();
        });
    }

    _refresh() {
        this._query?.cancel();
        const query = new Gio.Cancellable();
        this._query = query;

        trashHasFiles(query).then(hasFiles => {
            if (this._query !== query || query.is_cancelled()) return;
            this._query = null;

            const changed = !this._initialized || hasFiles !== this._hasFiles;
            this._hasFiles = hasFiles;
            this._initialized = true;
            if (!changed) return;

            for (const callback of [...this._callbacks]) {
                try { callback(hasFiles); }
                catch (error) { logError(error, 'trash subscriber'); }
            }
        }).catch(error => {
            if (this._query === query) this._query = null;
            if (!query.is_cancelled()) logError(error, 'trash state');
        });
    }

    _stop() {
        this._query?.cancel();
        this._query = null;

        if (this._debounceId) {
            this._timers.remove(this._debounceId);
            this._debounceId = 0;
        }
        this._timers.removeAll();

        if (this._monitor) {
            if (this._monitorId) {
                this._monitor.disconnect(this._monitorId);
                this._monitorId = 0;
            }
            this._monitor.cancel();
            this._monitor = null;
        }

        this._initialized = false;
        this._hasFiles = false;
    }

    destroy() {
        this._stop();
        this._callbacks.clear();
    }
}

function subscribeTrashState(callback) {
    const store = (sharedTrashState ??= new TrashStateStore());
    const unsubscribe = store.subscribe(callback);
    let live = true;

    return () => {
        if (!live) return;
        live = false;
        unsubscribe();
        if (sharedTrashState === store && store.empty) {
            store.destroy();
            sharedTrashState = null;
        }
    };
}

export class TrashWatcher {
    constructor(host) {
        this._host = host;
        this._unsubscribe = null;
        this._wasFull = false;
        this._initialized = false;
    }

    enable() {
        if (!this._host.getConfig().showTrash || this._unsubscribe) return;
        this._unsubscribe = subscribeTrashState(hasFiles => this._applyState(hasFiles));
    }

    _applyState(hasFiles) {
        const item = this._host.getTrashItem();
        if (!item) return;

        this._host.setTrashFull?.(hasFiles);
        const icon = this._host.getTrashGicon(hasFiles);
        item.entry.gicon = icon;
        item.setGicon?.(icon);

        if (this._initialized && hasFiles && !this._wasFull) {
            const cfg = this._host.getConfig();
            try {
                item.bounce(cfg.bounceHeight,
                    { state: 'attention', decay: cfg.bounceDecay });
            } catch { }
            this._host.kickEngine?.();
        }

        this._wasFull = hasFiles;
        this._initialized = true;
    }

    destroy() {
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }
        this._host = null;
    }
}
