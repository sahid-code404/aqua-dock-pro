// Chip/item factory reconciling tracker entries with live DockItem actors.

import St from 'gi://St';

import { sameIcon } from '../core/utils.js';
import { SEP_W, SEP_PAD } from '../core/constants.js';
import { DockItem } from './dockItem.js';

const SEP_TOTAL = SEP_W + SEP_PAD * 2;

export class DockFactory {
    // onItemCreated(item): controller hook to wire per-item callbacks.
    constructor(container, onItemCreated = null) {
        this._container = container;
        this._onItemCreated = onItemCreated;
        this._items = [];   // DockItem[] (no separators)
        this._chips = [];   // { entry, actor, item, w }[]
    }

    get items() { return this._items; }
    get chips() { return this._chips; }

    // Reconcile to `entries`. Returns true if the chip structure changed (caller
    // must relayout); false if it was a pure in-place refresh.
    sync(entries, cfg) {
        if (this._isSameLayout(entries)) {
            for (let i = 0; i < entries.length; i++) {
                const e = entries[i];
                if (e.kind === 'separator') continue;
                const item = this._chips[i]?.item;
                if (!item) continue;
                item.entry = e;
                if (!sameIcon(item.gicon, e.gicon)) item.setGicon(e.gicon);
                item.refresh();
            }
            return false;
        }
        this._rebuild(entries, cfg);
        return true;
    }

    _isSameLayout(entries) {
        if (entries.length !== this._chips.length) return false;
        const chips = this._chips;
        for (let i = 0, len = entries.length; i < len; i++)
            if (chips[i].entry?.key !== entries[i].key) return false;
        return true;
    }

    _rebuild(entries, cfg) {
        const oldByKey = new Map(this._items.map(item => [item.entry.key, item]));
        const nextItems = [];
        const nextChips = [];

        for (const entry of entries) {
            if (entry.kind === 'separator') {
                const sep = new St.Widget({ style_class: 'aqua-separator' });
                this._container.add_child(sep);
                nextChips.push({ entry, actor: sep, item: null, w: SEP_TOTAL });
                continue;
            }
            let item = oldByKey.get(entry.key);
            if (item) {
                oldByKey.delete(entry.key);
                item.entry = entry;
                if (!sameIcon(item.gicon, entry.gicon)) item.setGicon(entry.gicon);
                item.refresh();
            } else {
                item = new DockItem(entry, cfg);
                this._container.add_child(item);
                this._onItemCreated?.(item);
            }
            nextItems.push(item);
            nextChips.push({ entry, actor: item, item, w: cfg.cellW });
        }

        // Destroy items that vanished and any old separators.
        for (const item of oldByKey.values()) {
            try { item.destroy(); } catch { }
        }
        for (const chip of this._chips) {
            if (!chip.item) {
                try { chip.actor.destroy(); } catch { }
            }
        }

        this._items = nextItems;
        this._chips = nextChips;
    }

    destroyAll() {
        for (const chip of this._chips) {
            try { chip.actor.destroy(); } catch { }
        }
        this._items = [];
        this._chips = [];
    }
}
