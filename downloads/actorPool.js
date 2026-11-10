// Actor pool for Downloads stack views (Fan, Grid, List).

import Clutter from 'gi://Clutter';
import St from 'gi://St';

const MAX_POOL_CAPACITY = 16;
const CONTENT_GAP = 14;
const DEFAULT_LABEL_WIDTH = 86;

export function stopSubtreeTransitions(actor) {
    if (!actor || actor.is_destroyed?.()) return;
    try { actor.remove_all_transitions?.(); } catch {}
    try {
        if (typeof actor.get_children === 'function') {
            const kids = actor.get_children();
            for (let i = 0; i < kids.length; i++) {
                stopSubtreeTransitions(kids[i]);
            }
        }
    } catch {}
}

export class ActorPool {
    constructor(maxCapacity = MAX_POOL_CAPACITY, factory = null) {
        this._maxCapacity = maxCapacity;
        this._factory = factory;
        this._fanPool = [];
        this._panelPool = [];
    }

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

    acquireFanItem() {
        if (this._fanPool.length > 0) {
            const card = this._fanPool.pop();
            card.btn.translation_x = 0;
            card.btn.translation_y = 0;
            card.btn.set_scale?.(1.0, 1.0);
            card.btn.opacity = 255;
            card.btn.hover = false;
            return card;
        }
        return this._factory?.createFanCard ? this._factory.createFanCard() : this._createFanCard();
    }

    releaseFanItem(btn) {
        if (!btn || btn.is_destroyed?.()) return;

        try {
            stopSubtreeTransitions(btn);
            btn.translation_x = 0;
            btn.translation_y = 0;
            btn.set_scale?.(1.0, 1.0);
            btn.opacity = 255;
            btn.hover = false;

            btn.remove_style_class_name?.('aqua-dl-fan-row-sel');
            btn.remove_style_class_name?.('aqua-dl-fan-action');
            btn.remove_style_class_name?.('aqua-dl-fan-more');

            btn._activate = null;
            btn._openFileMenu = null;
            btn._onHover = null;
            btn._updatePillStyle = null;
            btn._appliedStyleKey = null;
            btn._appliedHover = null;
            btn._dockBlurEnabled = false;
            btn.accessible_name = '';

            if (btn._label) {
                btn._label.text = '';
                btn._label.clutter_text?.set_ellipsize?.(2);
            }

            if (btn._labelPill) {
                btn._labelPill._dockBlurEnabled = false;
                const kids = btn._labelPill.get_children?.() ?? [];
                for (const k of kids) {
                    if (k !== btn._label) {
                        try { k.destroy?.(); } catch {}
                    }
                }
            }

            if (btn._thumb) {
                btn._thumb.remove_all_transitions?.();
                btn._thumb.set_scale?.(1.0, 1.0);
                btn._thumb.opacity = 255;
                const currentChild = btn._thumb.get_child?.();
                if (currentChild && currentChild !== btn._icon) {
                    try { btn._thumb.remove_child?.(currentChild); } catch {}
                    try { currentChild.destroy?.(); } catch {}
                }
                if (!btn._icon || btn._icon.is_destroyed?.()) {
                    btn._icon = new St.Icon({
                        style_class: 'aqua-dl-fan-icon',
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                }
                if (btn._thumb.get_child?.() !== btn._icon) {
                    btn._thumb.set_child?.(btn._icon);
                }
            }

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
        } catch {}
    }

    acquirePanelItem(view) {
        if (this._panelPool.length > 0) {
            const card = this._panelPool.pop();
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
            row._appliedStyleKey = null;
            row._appliedHover = null;
            row._dockBlurEnabled = false;
            row.accessible_name = '';

            if (row._label) {
                row._label.text = '';
                row._label.remove_style_class_name?.('aqua-dl-fan-more');
                row._label.clutter_text?.set_ellipsize?.(3);
            }

            if (row._thumb) {
                row._thumb.remove_all_transitions?.();
                const currentChild = row._thumb.get_child?.();
                if (currentChild && currentChild !== row._icon) {
                    try { row._thumb.remove_child?.(currentChild); } catch {}
                    try { currentChild.destroy?.(); } catch {}
                }
                if (!row._icon || row._icon.is_destroyed?.()) {
                    row._icon = new St.Icon({
                        style_class: 'aqua-dl-fan-icon',
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                }
                if (row._thumb.get_child?.() !== row._icon) {
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
        } catch {}
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
        const labelPill = new St.Widget({
            name: 'aquaDownloadsFanPill',
            style_class: 'aqua-dl-fan-label-pill',
            layout_manager: new Clutter.BinLayout(),
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
        labelPill.add_child(label);

        if (typeof labelPill.set_child !== 'function') {
            labelPill.set_child = (c) => {
                labelPill.remove_all_children();
                if (c) labelPill.add_child(c);
            };
        }
        if (typeof labelPill.get_child !== 'function') {
            labelPill.get_child = () => label;
        }

        labelPill.name = 'aquaDownloadsFanPill';
        labelPill._isAquaDock = true;
        labelPill._blurType = 'popup';
        labelPill._dockBlurEnabled = false;
        labelPill._dockBg = labelPill;
        labelPill._dockContent = label;
        labelPill._dockContentParent = labelPill;
        labelPill._dockBlurRegion = label;

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
        btn._dockBlurEnabled = false;

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
        row._dockBlurEnabled = false;

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
            } catch {}
        }
        this._fanPool.length = 0;

        for (const item of this._panelPool) {
            try {
                item.row.remove_all_transitions?.();
                item.row.destroy?.();
            } catch {}
        }
        this._panelPool.length = 0;
    }
}
