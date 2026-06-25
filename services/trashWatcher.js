// AquaDockPro — Trash full/empty state + bounce-on-fill.
//
// Purpose:   Watch the trash directory and keep the dock's Trash icon in sync
//            (full vs empty glyph), bouncing it for attention the moment it goes
//            from empty → full. Reads are debounced so a bulk delete doesn't
//            thrash the icon.
// Ownership: OWNS the directory monitor + its signal and the debounce timer.
//            destroy() releases all.
// Cost:      Idle except on trash change; one debounced stat per burst.

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
    }

    enable() {
        if (!this._host.getConfig().showTrash) return;
        this._wasFull = trashHasFiles();
        // Initial icon sync — the tracker seeds from trashHasFiles() too, but
        // it runs before the dock items exist so the icon actor may still show
        // the wrong glyph.  A deferred _refresh fixes that.
        this._timers.addOnce(0, () => this._refresh());
        if (this._monitor) return;
        try {
            this._monitor = trashDir().monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitorId = this._monitor.connect('changed', () => this._schedule());
        } catch (e) { logError(e, 'trash monitor'); }
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
        const has = trashHasFiles();
        // Keep the tracker in sync so re-syncs produce the right icon.
        this._host.setTrashFull?.(has);
        const icon = this._host.getTrashGicon(has);
        item.entry.gicon = icon;
        if (item._icon) item._icon.gicon = icon;
        if (has && !this._wasFull) {
            const cfg = this._host.getConfig();
            try { item.bounce(cfg.bounceHeight, { state: 'attention', decay: cfg.bounceDecay }); } catch { }
            this._host.kickEngine?.();
        }
        this._wasFull = has;
    }

    destroy() {
        if (this._debounceId) { this._timers.remove(this._debounceId); this._debounceId = 0; }
        this._timers.removeAll();
        if (this._monitor) {
            if (this._monitorId) { try { this._monitor.disconnect(this._monitorId); } catch { } this._monitorId = 0; }
            try { this._monitor.cancel(); } catch { }
            this._monitor = null;
        }
        this._host = null;
    }
}
