// Lightweight, leak-free actor pool for Downloads stack views (Fan, Grid, List).
// Reuses Clutter/St actor composites across open/close cycles, eliminating actor churn.
// Strictly compliant with AGENTS.md Invariant 1 (zero stack blur).

import Clutter from 'gi://Clutter';
import St from 'gi://St';

const MAX_POOL_CAPACITY = 16;
const CONTENT_GAP = 14;
const DEFAULT_LABEL_WIDTH = 86;

/**
 * Recursively removes all transitions on an actor and all its descendants.
 * Prevents Clutter warnings and clock stalls from timelines running on detached actors.
 * @param {Clutter.Actor} actor
 */
export function stopSubtreeTransitions(actor) {
    if (!actor || actor.is_destroyed?.()) return;
    try { actor.remove_all_transitions?.(); } catch { /* intentionally ignored: actor may already be destroyed */ }
    try {
        if (typeof actor.get_children === 'function') {
            const kids = actor.get_children();
            for (let i = 0; i < kids.length; i++) {
                stopSubtreeTransitions(kids[i]);
            }
        }
    } catch { /* intentionally ignored: children traversal failed */ }
}

export class ActorPool {
    constructor(maxCapacity = MAX_POOL_CAPACITY, factory = null) {
        this._maxCapacity = maxCapacity;
        this._factory = factory;
        this._fanPool = [];
        this._panelPool = [];
    }

    /**
     * Prewarm the pool during idle time to eliminate first-open allocation stutter.
     * @param {number} [count=12] Target number of items to pre-instantiate
     */
    prewarm(count = 12) {
        if (typeof global === 'undefined' || !global.stage) return;
        const target = Math.min(count, this._maxCapacity);
        while (this._panelPool.length < target) {
            const card = this._factory?.createPanelCard ? this._factory.createPanelCard('grid') : this._createPanelCard('grid');
            this._panelPool.push(card);
        }
        while (this._fanPool.length < target) {
            const card = this._factory?.createFanCard ? this._factory.createFanCard() : this._createFanCard();
            this._fanPool.push(card);
        }
    }

    /**
     * Acquire a fan item card from the pool or create a new composite.
     * @returns {object} { btn, box, labelPill, label, gap, thumb, icon }
     */
    acquireFanItem() {
        if (this._fanPool.length > 0) {
            const card = this._fanPool.pop();
            stopSubtreeTransitions(card.btn);
            card.btn.translation_x = 0;
            card.btn.translation_y = 0;
            card.btn.set_scale?.(1.0, 1.0);
            card.btn.opacity = 255;
            card.btn.hover = false;
            return card;
        }
        return this._factory?.createFanCard ? this._factory.createFanCard() : this._createFanCard();
    }

    /**
     * Release a fan item card back to the pool.
     * Detaches delegates, transitions, and resets state.
     * @param {St.Button} btn
     */
    releaseFanItem(btn) {
        if (!btn || btn.is_destroyed?.()) return;

        try {
            stopSubtreeTransitions(btn);
            btn.translation_x = 0;
            btn.translation_y = 0;
            btn.set_scale?.(1.0, 1.0);
            btn.opacity = 255;
            btn.hover = false;

            // Remove state & selection classes
            btn.remove_style_class_name?.('aqua-dl-fan-row-sel');
            btn.remove_style_class_name?.('aqua-dl-fan-action');
            btn.remove_style_class_name?.('aqua-dl-fan-more');

            // Detach all closures to prevent memory leaks
            btn._activate = null;
            btn._openFileMenu = null;
            btn._onHover = null;
            btn._updatePillStyle = null;
            btn.accessible_name = '';

            // Reset label
            if (btn._label) {
                btn._label.text = '';
                btn._label.clutter_text?.set_ellipsize?.(2);
            }

            // Reset thumbnail child back to base icon if replaced
            if (btn._thumb && btn._icon) {
                btn._thumb.remove_all_transitions?.();
                btn._thumb.set_scale?.(1.0, 1.0);
                btn._thumb.opacity = 255;
                if (btn._thumb.get_child?.() !== btn._icon) {
                    const temp = btn._thumb.get_child?.();
                    if (temp) {
                        try { temp.destroy?.(); } catch { /* intentionally ignored: pooled row or button actor may already be destroyed */ }
                    }
                    btn._thumb.set_child?.(btn._icon);
                }
            }

            // Pool capacity check
            if (this._fanPool.length < this._maxCapacity) {
                this._fanPool.push({
                    btn,
                    box: btn._box,
                    labelPill: btn._labelPill,
                    label: btn._label,
                    gap: btn._gap,
                    thumb: btn._thumb,
                    icon: btn._icon,
                });
            } else {
                btn.destroy?.();
            }
        } catch { /* intentionally ignored: pooled row or button actor may already be destroyed */ }
    }

    /**
     * Acquire a panel (grid/list) item card from the pool or create a new composite.
     * @param {string} view 'grid' | 'list'
     * @returns {object} { row, box, labelPill, label, gap, thumb, icon }
     */
    acquirePanelItem(view) {
        if (this._panelPool.length > 0) {
            const card = this._panelPool.pop();
            stopSubtreeTransitions(card.row);
            card.row.translation_y = 0;
            card.row.set_scale?.(1.0, 1.0);
            card.row.opacity = 255;
            card.row.hover = false;
            card.row.set_style_class_name?.(`aqua-dl-row aqua-dl-row-${view}`);
            card.row.x_expand = view !== 'grid';
            if (view !== 'grid') card.row.set_width?.(-1);
            return card;
        }
        return this._factory?.createPanelCard ? this._factory.createPanelCard(view) : this._createPanelCard(view);
    }

    /**
     * Release a panel item card back to the pool.
     * @param {St.Button} row
     */
    releasePanelItem(row) {
        if (!row || row.is_destroyed?.()) return;

        try {
            stopSubtreeTransitions(row);
            row.translation_y = 0;
            row.set_scale?.(1.0, 1.0);
            row.opacity = 255;
            row.hover = false;

            row.remove_style_class_name?.('aqua-dl-row-sel');
            row.remove_style_class_name?.('aqua-dl-row-more');

            row._activate = null;
            row._openFileMenu = null;
            row._onHover = null;
            row._updatePillStyle = null;
            row.accessible_name = '';

            if (row._label) {
                row._label.text = '';
                row._label.clutter_text?.set_ellipsize?.(3);
            }

            if (row._thumb && row._icon) {
                row._thumb.remove_all_transitions?.();
                if (row._thumb.get_child?.() !== row._icon) {
                    const temp = row._thumb.get_child?.();
                    if (temp) {
                        try { temp.destroy?.(); } catch { /* intentionally ignored: pooled row or button actor may already be destroyed */ }
                    }
                    row._thumb.set_child?.(row._icon);
                }
            }

            if (this._panelPool.length < this._maxCapacity) {
                this._panelPool.push({
                    row,
                    box: row._box,
                    labelPill: row._labelPill,
                    label: row._label,
                    gap: row._gap,
                    thumb: row._thumb,
                    icon: row._icon,
                });
            } else {
                row.destroy?.();
            }
        } catch { /* intentionally ignored: pooled row or button actor may already be destroyed */ }
    }

    /**
     * Internal factory for a fan row card with permanent signal dispatchers.
     */
    _createFanCard() {
        const btn = new St.Button({
            style_class: 'aqua-dl-fan-row',
            reactive: true,
            track_hover: true,
            can_focus: true,
        });
        btn.name = 'aquaDownloadsFanItem';
        btn.set_style('background-color: transparent; border: none; box-shadow: none;');

        const box = new St.BoxLayout({ style_class: 'aqua-dl-fan-row-inner' });
        const labelPill = new St.Bin({
            style_class: 'aqua-dl-fan-label-pill',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const label = new St.Label({
            style_class: 'aqua-dl-fan-label',
            width: DEFAULT_LABEL_WIDTH,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.set_line_wrap(false);
        label.clutter_text.set_ellipsize(2);
        labelPill.set_child(label);

        const gap = new St.Widget({
            width: CONTENT_GAP,
            x_expand: false,
            reactive: false,
        });

        const thumb = new St.Bin({
            style_class: 'aqua-dl-fan-thumb',
            x_expand: false,
            y_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        thumb.set_pivot_point(0.5, 0.5);

        const icon = new St.Icon({ style_class: 'aqua-dl-fan-icon' });
        thumb.set_child(icon);

        box.add_child(thumb);
        box.add_child(gap);
        box.add_child(labelPill);
        btn.set_child(box);

        btn._box = box;
        btn._thumb = thumb;
        btn._gap = gap;
        btn._labelPill = labelPill;
        btn._label = label;
        btn._icon = icon;
        btn._thumbnailFirst = true;

        btn._isAquaDock = true;
        btn._dockBlurEnabled = false; // Strictly false per Invariant 1

        // Permanent signal wiring with dynamic dispatch delegates
        btn.set_button_mask(
            (St.ButtonMask.PRIMARY ?? St.ButtonMask.ONE) |
            (St.ButtonMask.SECONDARY ?? St.ButtonMask.THREE)
        );

        btn.connect('notify::hover', () => {
            if (btn.hover && typeof btn._onHover === 'function') {
                btn._onHover();
            }
        });

        btn.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                if (typeof btn._openFileMenu === 'function') {
                    btn._openFileMenu();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        btn.connect('clicked', (_actor, button) => {
            if (button === Clutter.BUTTON_SECONDARY) {
                btn._openFileMenu?.();
            } else if (button === Clutter.BUTTON_PRIMARY) {
                btn._activate?.();
            }
        });

        return { btn, box, labelPill, label, gap, thumb, icon };
    }

    /**
     * Internal factory for a panel row card with permanent signal dispatchers.
     */
    _createPanelCard(view) {
        const row = new St.Button({
            style_class: `aqua-dl-row aqua-dl-row-${view}`,
            reactive: true,
            track_hover: true,
            can_focus: true,
            x_expand: view !== 'grid',
        });
        row.set_style('background-color: transparent; border: none; box-shadow: none;');

        const box = new St.BoxLayout({
            style_class: 'aqua-dl-row-inner',
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
        });

        const thumb = new St.Bin({
            style_class: 'aqua-dl-fan-thumb',
            x_expand: false,
            y_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        thumb.set_pivot_point(0.5, 0.5);

        const icon = new St.Icon({ style_class: 'aqua-dl-fan-icon' });
        thumb.set_child(icon);

        const gap = new St.Widget({
            width: 12,
            x_expand: false,
            reactive: false,
        });

        const labelPill = new St.Bin({
            style_class: 'aqua-dl-fan-label-pill',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const label = new St.Label({
            style_class: 'aqua-dl-fan-label',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.set_line_wrap(false);
        label.clutter_text.set_ellipsize(3);
        labelPill.set_child(label);

        box.add_child(thumb);
        box.add_child(gap);
        box.add_child(labelPill);
        row.set_child(box);

        row._box = box;
        row._thumb = thumb;
        row._gap = gap;
        row._labelPill = labelPill;
        row._label = label;
        row._icon = icon;

        row._isAquaDock = true;
        row._dockBlurEnabled = false; // Strictly false per Invariant 1

        row.set_button_mask(
            (St.ButtonMask.PRIMARY ?? St.ButtonMask.ONE) |
            (St.ButtonMask.SECONDARY ?? St.ButtonMask.THREE)
        );

        row.connect('notify::hover', () => {
            if (row.hover && typeof row._onHover === 'function') {
                row._onHover();
            }
        });

        row.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                if (typeof row._openFileMenu === 'function') {
                    row._openFileMenu();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        row.connect('clicked', (_actor, button) => {
            if (button === Clutter.BUTTON_SECONDARY) {
                row._openFileMenu?.();
            } else if (button === Clutter.BUTTON_PRIMARY) {
                row._activate?.();
            }
        });

        return { row, box, labelPill, label, gap, thumb, icon };
    }

    /**
     * Synchronously destroy all cached actors and release resources.
     * Invoked during extension disable or DownloadsStack destruction.
     */
    clear() {
        for (const item of this._fanPool) {
            try {
                item.btn.remove_all_transitions?.();
                item.btn.destroy?.();
            } catch { /* intentionally ignored: pooled row or button actor may already be destroyed */ }
        }
        this._fanPool.length = 0;

        for (const item of this._panelPool) {
            try {
                item.row.remove_all_transitions?.();
                item.row.destroy?.();
            } catch { /* intentionally ignored: pooled row or button actor may already be destroyed */ }
        }
        this._panelPool.length = 0;
    }
}
