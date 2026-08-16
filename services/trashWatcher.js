// Trash directory monitor for full/empty state and attention bounce.

import Gio from 'gi://Gio';

import { TimeoutGroup, logError } from '../core/utils.js';
import { trashDir, trashHasFiles } from './fileService.js';

const DEBOUNCE_MS = 250;

export class TrashWatcher {
    // host: { getConfig, getTrashItem, getTrashGicon, kickEngine, setTrashFull }
    constructor(host) {
        this._host = host;
        this._timers = new TimeoutGroup();
        this._monitor = null;
        this._monitorId = 0;
        this._debounceId = 0;
        this._wasFull = false;
        this._initialized = false;
        this._query = null;
    }

    enable() {
        if (!this._host.getConfig().showTrash) return;
        if (this._monitor) return;
        // Query after the first actor sync even if monitoring is unavailable.
        this._timers.addOnce(0, () => this._refresh());
        let monitor = null;
        try {
            monitor = trashDir().monitor_directory(Gio.FileMonitorFlags.NONE, null);
            const monitorId = monitor.connect('changed', () => this._schedule());
            this._monitor = monitor;
            this._monitorId = monitorId;
        } catch (e) {
            try { monitor?.cancel(); } catch { }
            logError(e, 'trash monitor');
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
        const item = this._host.getTrashItem();
        if (!item) return;
        this._query?.cancel();
        const query = new Gio.Cancellable();
        this._query = query;
        trashHasFiles(query).then(has => {
            if (this._query !== query || query.is_cancelled() || !this._host) return;
            this._query = null;
            const liveItem = this._host.getTrashItem();
            if (!liveItem) return;
            this._host.setTrashFull?.(has);
            const icon = this._host.getTrashGicon(has);
            liveItem.entry.gicon = icon;
            liveItem.setGicon?.(icon);
            if (this._initialized && has && !this._wasFull) {
                const cfg = this._host.getConfig();
                try {
                    liveItem.bounce(cfg.bounceHeight,
                        { state: 'attention', decay: cfg.bounceDecay });
                } catch { }
                this._host.kickEngine?.();
            }
            this._wasFull = has;
            this._initialized = true;
        }).catch(error => {
            if (this._query === query) this._query = null;
            if (!query.is_cancelled()) logError(error, 'trash state');
        });
    }

    destroy() {
        if (this._debounceId) { this._timers.remove(this._debounceId); this._debounceId = 0; }
        this._query?.cancel();
        this._query = null;
        this._timers.removeAll();
        if (this._monitor) {
            if (this._monitorId) { try { this._monitor.disconnect(this._monitorId); } catch { } this._monitorId = 0; }
            try { this._monitor.cancel(); } catch { }
            this._monitor = null;
        }
        this._host = null;
    }
}
