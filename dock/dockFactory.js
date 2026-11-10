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
        this._separatorPool = [];
    }

    get items() { return this._items; }
    get chips() { return this._chips; }

    // Reconcile to `entries`. Returns true if the chip structure changed (caller
    // must relayout); false if it was a pure in-place refresh.
    sync(entries, cfg) {
        if (!this._container) return false;
        if (this._isSameLayout(entries)) {
            const touched = [];
            try {
                for (let i = 0; i < entries.length; i++) {
                    const e = entries[i];
                    if (e.kind === 'separator' || e.kind === 'spacer') continue;
                    const item = this._chips[i]?.item;
                    if (!item) continue;
                    item._chip = this._chips[i];
                    touched.push({
                        item,
                        previousEntry: item.entry,
                        previousGicon: item.gicon,
                        previousCfg: item._cfg,
                    });
                    item._cfg = cfg;
                    item.entry = e;
                    if (!sameIcon(item.gicon, e.gicon)) item.setGicon(e.gicon);
                    item.refresh();
                }
            } catch (error) {
                // A model-only refresh should be just as transactional as a full
                // rebuild. Restore every item already touched so callers never
                // observe a dock containing a mixture of old and new entries.
                for (let i = touched.length - 1; i >= 0; i--) {
                    const { item, previousEntry, previousGicon, previousCfg } = touched[i];
                    try {
                        item._cfg = previousCfg;
                        item.entry = previousEntry;
                        if (!sameIcon(item.gicon, previousGicon)) item.setGicon(previousGicon);
                        item.refresh();
                    } catch {}
                }
                throw error;
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
            if (chips[i].entry?.key !== entries[i].key ||
                chips[i].entry?.kind !== entries[i].kind) return false;
        return true;
    }

    _recycleSeparator(sep) {
        if (!sep) return;
        try {
            sep.remove_all_transitions?.();
            const parent = sep.get_parent?.();
            if (parent?.remove_child) parent.remove_child(sep);
            sep.style_class = '';
            if (typeof sep.set_style === 'function') sep.set_style(null);
            if (this._separatorPool.length < 16) {
                this._separatorPool.push(sep);
            } else {
                sep.destroy?.();
            }
        } catch {
            try { sep.destroy?.(); } catch {}
        }
    }

    _rebuild(entries, cfg) {
        const oldByKey = new Map(this._items.map(item => [item.entry.key, item]));
        const nextItems = [];
        const nextChips = [];
        const createdActors = [];
        const reused = [];
        const reusedSeparators = [];

        try {
            // Build the replacement structure first. Existing DockItems are not
            // mutated until every new actor has been created successfully, so a
            // constructor/factory failure cannot leave the old layout half-new.
            for (const entry of entries) {
                if (entry.kind === 'separator' || entry.kind === 'spacer') {
                    const styleClass = entry.kind === 'spacer' ? 'aqua-spacer' : 'aqua-separator';
                    let sep = this._separatorPool.pop();
                    if (sep) {
                        reusedSeparators.push(sep);
                        sep.style_class = styleClass;
                        if (typeof sep.set_style === 'function') sep.set_style(null);
                        sep.visible = true;
                    } else {
                        sep = new St.Widget({
                            style_class: styleClass,
                            reactive: false,
                        });
                        createdActors.push(sep);
                    }
                    if (sep.get_parent?.() !== this._container)
                        this._container.add_child(sep);
                    nextChips.push({ entry, actor: sep, item: null, w: SEP_TOTAL });
                    continue;
                }
                let item = oldByKey.get(entry.key);
                if (item) {
                    oldByKey.delete(entry.key);
                    reused.push({
                        item,
                        entry,
                        previousEntry: item.entry,
                        previousGicon: item.gicon,
                        previousCfg: item._cfg,
                    });
                } else {
                    item = new DockItem(entry, cfg);
                    createdActors.push(item);
                    this._container.add_child(item);
                    this._onItemCreated?.(item);
                }
                nextItems.push(item);
                const chip = { entry, actor: item, item, w: cfg.cellW };
                item._chip = chip;
                nextChips.push(chip);
            }

            // Commit metadata/icon refreshes only after construction succeeded.
            // If a reused item refresh throws, restore every reused item before
            // returning control to the still-valid old chip structure.
            try {
                for (const record of reused) {
                    const { item, entry } = record;
                    item._cfg = cfg;
                    item.entry = entry;
                    if (!sameIcon(item.gicon, entry.gicon)) item.setGicon(entry.gicon);
                    item.refresh();
                }
            } catch (error) {
                for (let i = reused.length - 1; i >= 0; i--) {
                    const { item, previousEntry, previousGicon, previousCfg } = reused[i];
                    try {
                        item._cfg = previousCfg;
                        item.entry = previousEntry;
                        if (!sameIcon(item.gicon, previousGicon)) item.setGicon(previousGicon);
                        item.refresh();
                    } catch {}
                }
                throw error;
            }
        } catch (error) {
            for (let i = createdActors.length - 1; i >= 0; i--) {
                try { createdActors[i].destroy(); } catch {}
            }
            for (const sep of reusedSeparators) {
                this._recycleSeparator(sep);
            }
            throw error;
        }

        // Destroy items that vanished and recycle outgoing separators.
        for (const item of oldByKey.values()) {
            try { item.destroy(); } catch {}
        }
        for (const chip of this._chips) {
            if (!chip.item && chip.actor)
                this._recycleSeparator(chip.actor);
        }

        this._items = nextItems;
        this._chips = nextChips;
    }

    destroyAll() {
        for (const chip of this._chips) {
            try { chip.actor.destroy(); } catch {}
        }
        for (const sep of this._separatorPool) {
            try { sep.destroy?.(); } catch {}
        }
        this._separatorPool = [];
        this._items = [];
        this._chips = [];
        this._container = null;
        this._onItemCreated = null;
    }
}
