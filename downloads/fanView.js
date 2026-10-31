// Downloads fan view.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { animationsEnabled, clamp, launchUri, deepFreeze } from '../core/utils.js';
import { _, format } from '../core/i18n.js';
import { getCachedThemedIcon } from '../services/fileService.js';
import { iconForInfo } from './fileEnumerator.js';
import { FileItemMenu } from './fileItemMenu.js';
import { aboveDockY, fanOrientation, sideFanX, FAN_CELL_OFFSETS, getFanCellOffsets } from './fanGeometry.js';
import { getRowStyles } from './tileStyle.js';
import { SelectionModel } from './keyboardNav.js';
import { buildPlaceIcon } from './placeIcon.js';
import { ActorPool, stopSubtreeTransitions } from './actorPool.js';
import { isBmsStackBlurActive, registerBmsTarget, unregisterBmsTarget, setupBackgroundCorners } from '../dock/dockBlur.js';

const LABEL_WIDTH = 86;
const CONTENT_GAP = 14;

// Reversible macOS-style swift fan animation profile
export const FAN_ANIM = deepFreeze({
    open: {
        duration: 220,
        stagger: 9,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        fadeDuration: 160,
    },
    close: {
        duration: 160,
        stagger: 6,
        mode: Clutter.AnimationMode.EASE_IN_CUBIC,
        fadeDuration: 130,
    },
});

export class FanView {
    // opts: { folder, files, overflow, cfg, mon, origin:{x,y}, close, pool }
    constructor(opts) {
        Object.assign(this, opts);
        this.pool = opts.pool ?? null;
        this._fallbackPool = null;
        this._model = new SelectionModel('aqua-dl-fan-row-sel');
        this._actor = null;
        this._collapse = null;
        this._reduce = false;
        this._fileMenu = new FileItemMenu(opts.mon, opts.cfg);
        this._blurRegions = [];
        this._blurActive = false;
        this._labelPillWidth = null;
    }

    get actor() { return this._actor; }
    get blurRegion() { return this._blurRegions?.[0] ?? null; }
    get blurRegions() { return this._blurRegions ?? []; }

    build() {
        const { cfg, mon, files } = this;
        const reduce = !animationsEnabled();
        this._reduce = reduce;

        const fan = new St.Widget({
            style_class: 'aqua-dl-fan-panel',
            reactive: true, can_focus: true,
            layout_manager: new Clutter.FixedLayout(),
        });
        this._actor = fan;
        if (cfg.highContrast) fan.add_style_class_name('aqua-high-contrast');
        const originX = this.origin.x, ay = this.origin.y;

        const thumbSize = clamp(Math.round(cfg.iconSize * 0.88), 44, 96);
        const thumbH = Math.round(thumbSize * 0.72);
        const rowH = Math.max(thumbH, 32) + 20;
        const leftPad = 6, labelGap = CONTENT_GAP;
        const labelW = Math.round(LABEL_WIDTH * Math.min(cfg.interfaceTextScale ?? 1, 1.6));
        const labelPillW = labelW + 28;
        this._labelWidth = labelW;
        this._labelPillWidth = labelPillW;
        const rowW = leftPad + labelPillW + labelGap + thumbSize + 6;
        const orientation = fanOrientation(cfg.position, originX, mon);
        this._thumbnailFirst = orientation.thumbnailFirst;
        const iconCx = this._thumbnailFirst
            ? leftPad + thumbSize / 2
            : leftPad + labelPillW + labelGap + thumbSize / 2;
        this._iconCx = iconCx;
        this._rowH = rowH;

        const builders = files.map(info => () => this._rowCard(info, thumbSize, rowW, rowH));
        if (builders.length > 0)
            builders.push(() => this._actionCard(_('Open in Files'), thumbSize, rowW, rowH));
        else
            builders.push(() => this._infoCard(format(_('%s is empty'), this.title),
                thumbSize, rowW, rowH));
        const n = builders.length;

        const topInset = mon.topInset ?? 0;
        let stepY = clamp(thumbH + 14, 42, 56);
        const availH = Math.max(140, ay - (mon.y + topInset) - 32);
        if (n > 1) {
            const fitStep = (availH - rowH - 32) / (n - 1);
            if (fitStep < stepY) stepY = Math.max(30, fitStep);
        }
        const offsets = FAN_CELL_OFFSETS[n] ?? getFanCellOffsets(n);
        const cells = new Array(n);
        const curveMax = clamp(Math.round(mon.width * 0.018), 36, 56);
        const curveMul = orientation.curveSign * curveMax;
        for (let i = 0; i < n; i++) {
            const off = offsets[i];
            cells[i] = {
                cx: curveMul * off.x,
                cy: off.y * stepY,
            };
        }
        const P = 16;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const c of cells) {
            const rx = c.cx - iconCx, ry = c.cy - rowH / 2;
            minX = Math.min(minX, rx); maxX = Math.max(maxX, rx + rowW);
            minY = Math.min(minY, ry); maxY = Math.max(maxY, ry + rowH);
        }
        const panelW = Math.round(maxX - minX + 2 * P);
        const panelH = Math.round(maxY - minY + 2 * P);
        const bottomCx = cells[0].cx - minX + P;
        const bottomCy = cells[0].cy - minY + P;
        const localX = c => Math.round(c.cx - iconCx - minX + P);
        const localY = c => Math.round(c.cy - rowH / 2 - minY + P);

        const sideX = sideFanX(cfg.position, originX, cfg.dockH, panelW);
        const targetX = sideX ?? originX - bottomCx;
        const targetY = cfg.vertical
            ? ay - bottomCy
            : aboveDockY(ay, bottomCy + rowH / 2);
        const px = clamp(Math.round(targetX), mon.x + 8, mon.x + mon.width - panelW - 8);
        const py = clamp(Math.round(targetY), mon.y + topInset + 8, mon.y + mon.height - panelH - 8);
        fan.set_position(px, py);
        fan.set_size(panelW, panelH);
        fan.set_style('background-color: transparent; border: none;');

        fan.name = 'aquaDownloadsFan';
        fan._isAquaDock = true;
        fan._dockBlurEnabled = false;

        const radius = cfg.dlItemRadius ?? clamp(cfg.dockRadius ?? 16, 6, 28);
        const blurActive = isBmsStackBlurActive(cfg);
        this._blurActive = blurActive;

        const dockContainer = this.dockContainer;
        if (dockContainer && typeof Main.uiGroup?.insert_child_below === 'function') {
            Main.uiGroup.insert_child_below(fan, dockContainer);
        } else if (Main.uiGroup?.add_child) {
            Main.uiGroup.add_child(fan);
        }

        const anchorLX = originX - px, anchorLY = ay - py;
        this._collapse = { x: anchorLX, y: anchorLY };
        this._fileMenu.bind(fan);

        const rows = [];
        this._blurRegions = [];

        builders.forEach((make, i) => {
            const row = make();
            const c = cells[i];
            const fx = localX(c), fy = localY(c);
            row.set_position(fx, fy);
            row.set_size(rowW, rowH);
            row.set_pivot_point(iconCx / rowW, 0.5);
            fan.add_child(row);
            rows.push(row);

            row._isAquaDock = true;
            row._dockBlurEnabled = false;

            if (blurActive && row._labelPill) {
                registerBmsTarget(row._labelPill, () => radius);
            }

            if (reduce) return;
            const initTx = anchorLX - (fx + iconCx);
            const initTy = anchorLY - (fy + rowH / 2);
            row.set_pivot_point(iconCx / rowW, 0.5);
            row.translation_x = initTx;
            row.translation_y = initTy;
            row.set_scale(0.25, 0.25);
            row.opacity = 0;
            const delay = i * FAN_ANIM.open.stagger;
            row.ease({
                translation_x: 0, translation_y: 0,
                scale_x: 1.0, scale_y: 1.0,
                duration: FAN_ANIM.open.duration,
                delay,
                mode: FAN_ANIM.open.mode,
            });
            row.ease({
                opacity: 255,
                duration: FAN_ANIM.open.fadeDuration,
                delay,
                mode: FAN_ANIM.open.mode,
            });

        });

        this._model.setRows(rows);
        if (rows.length) this._model.select(0);
        fan._blurRegion = null;
        fan._blurRegions = [];

        fan.connect('destroy', () => {
            for (const r of this._model?.rows ?? []) {
                if (r._labelPill) {
                    try { unregisterBmsTarget(r._labelPill); } catch { /* intentionally ignored: BMS target cleanup fallback */ }
                }
            }
        });

        if (reduce) {
            fan.opacity = 255;
            rows.forEach(r => {
                r.set_scale(1, 1);
                r.translation_x = 0;
                r.translation_y = 0;
                r.opacity = 255;
            });
        }
        return fan;
    }

    _getPool() {
        return this.pool ?? (this._fallbackPool ??= new ActorPool(16));
    }

    _card(thumbSize, w, h, extraClass = '') {
        const thumbW = thumbSize, thumbH = Math.round(thumbSize * 0.72);
        const thumbRadius = Math.round(Math.min(thumbW, thumbH) * 0.22);
        const radius = this.cfg.dlItemRadius ?? clamp(this.cfg.dockRadius ?? 16, 6, 28);
        const pillH = Math.max(thumbH, 28);
        const labelPillW = this._labelPillWidth ?? (LABEL_WIDTH + 28);

        const card = this._getPool().acquireFanItem();
        const { btn, box, labelPill, label, gap, thumb, icon } = card;

        btn.set_size(w, h);
        if (extraClass) btn.add_style_class_name(extraClass);
        labelPill.set_size(labelPillW, pillH);
        labelPill.width = labelPillW;
        labelPill.height = pillH;
        labelPill._dockRadius = radius;
        labelPill.get_dock_radius = () => radius;

        labelPill.name = 'aquaDownloadsFanPill';
        labelPill._isAquaDock = true;
        labelPill._blurType = 'popup';
        labelPill._dockBlurEnabled = this._blurActive;
        labelPill._dockBg = labelPill;
        labelPill._dockContent = label;
        labelPill._dockContentParent = labelPill;
        labelPill._dockBlurRegion = label;
        setupBackgroundCorners(labelPill, () => radius);

        label.width = this._labelWidth ?? LABEL_WIDTH;
        thumb.set_size(thumbW, thumbH);
        thumb.width = thumbW;
        thumb.height = thumbH;

        if (btn._thumbnailFirst !== this._thumbnailFirst) {
            box.remove_all_children();
            if (this._thumbnailFirst) {
                box.add_child(thumb);
                box.add_child(gap);
                box.add_child(labelPill);
            } else {
                box.add_child(labelPill);
                box.add_child(gap);
                box.add_child(thumb);
            }
            btn._thumbnailFirst = this._thumbnailFirst;
        }

        btn._isAquaDock = true;
        btn._dockBlurEnabled = false; // Strictly false per Invariant 1
        btn._dockRadius = radius;
        btn.get_dock_radius = () => radius;

        const rowStyles = getRowStyles(this.cfg, thumbRadius, '6px 14px', this._blurActive, 0, labelPill);
        if (btn._appliedStyleKey !== rowStyles.key) {
            btn._appliedStyleKey = rowStyles.key;
            label.set_style(rowStyles.normal.label);
            labelPill.set_style(rowStyles.normal.pill);
            thumb.set_style(rowStyles.normal.thumb);
            btn._appliedHover = false;
        }

        btn._updatePillStyle = hover => {
            if (btn._appliedHover === hover) return;
            btn._appliedHover = hover;
            const s = hover ? rowStyles.hover : rowStyles.normal;
            labelPill.set_style(s.pill);
            thumb.set_style(s.thumb);
        };
        btn._updatePillStyle(false);

        btn._onHover = () => {
            const idx = this._model.rows.indexOf(btn);
            if (idx >= 0) this._model.select(idx);
        };

        return { btn, labelPill, label, thumb, thumbW, thumbH, icon };
    }

    _rowCard(info, thumbSize, w, h) {
        const { btn, labelPill, label, thumb, thumbW, thumbH, icon } = this._card(thumbSize, w, h, '');
        const file = this.folder.get_child(info.get_name());
        const displayName = info.get_display_name();
        label.text = displayName;
        btn.accessible_name = displayName;

        const iconSize = Math.round(Math.min(thumbW, thumbH) * 0.78);
        const gicon = iconForInfo(info);
        if (icon && !icon.is_destroyed?.()) {
            icon.gicon = gicon;
            icon.icon_size = iconSize;
            icon.set_size(iconSize, iconSize);
            if (thumb.get_child() !== icon) thumb.set_child(icon);
        } else {
            const newIcon = new St.Icon({
                gicon,
                icon_size: iconSize,
                style_class: 'aqua-dl-fan-icon',
            });
            newIcon.set_size(iconSize, iconSize);
            btn._icon = newIcon;
            thumb.set_child(newIcon);
        }

        btn._activate = () => { launchUri(file.get_uri()); this.close(); };
        btn._openFileMenu = () => { this._fileMenu.openFor(labelPill, file); };
        return btn;
    }

    _actionCard(text, thumbSize, w, h) {
        const { btn, label, thumb, thumbW, thumbH } = this._card(thumbSize, w, h, 'aqua-dl-fan-action');
        label.text = text;
        btn.accessible_name = text;
        label.clutter_text.set_ellipsize(0);
        const folderGicon = this.gicon ?? getCachedThemedIcon('folder', true);
        const iconSize = Math.round(Math.min(thumbW, thumbH) * 0.78);
        const iconActor = buildPlaceIcon(
            folderGicon,
            iconSize,
            this.cfg.placeIconSourceSize,
            'aqua-dl-fan-icon');
        iconActor.set_size(iconSize, iconSize);
        thumb.set_child(iconActor);
        btn._activate = () => { launchUri(this.folder.get_uri()); this.close(); };
        btn._openFileMenu = null;
        return btn;
    }

    _infoCard(text, thumbSize, w, h) {
        const { btn, label, thumb, thumbW, thumbH } = this._card(thumbSize, w, h, 'aqua-dl-fan-more');
        label.text = text;
        btn.accessible_name = text;
        const iconSize = Math.round(Math.min(thumbW, thumbH) * 0.72);
        const iconActor = buildPlaceIcon(
            this.gicon ?? getCachedThemedIcon('folder-download'),
            iconSize,
            this.cfg.placeIconSourceSize,
            'aqua-dl-fan-icon');
        iconActor.set_size(iconSize, iconSize);
        thumb.set_child(iconActor);
        btn._activate = () => { launchUri(this.folder.get_uri()); this.close(); };
        btn._openFileMenu = null;
        return btn;
    }

    handleKey(ev) {
        const sym = ev.get_key_symbol();
        const rows = this._model.rows;
        if (sym === Clutter.KEY_Escape) { this.close(); return Clutter.EVENT_STOP; }
        if (!rows.length) return Clutter.EVENT_PROPAGATE;
        const i = this._model.index;
        const menuKey = sym === Clutter.KEY_Menu ||
            (sym === Clutter.KEY_F10 &&
                ((ev.get_state?.() ?? 0) & Clutter.ModifierType.SHIFT_MASK));
        if (menuKey && this._model.current?._openFileMenu) {
            this._model.current._openFileMenu();
            return Clutter.EVENT_STOP;
        }
        if (sym === Clutter.KEY_Up) { this._model.select(i < 0 ? 0 : i + 1); return Clutter.EVENT_STOP; }
        if (sym === Clutter.KEY_Down) { this._model.select(i < 0 ? rows.length - 1 : i - 1); return Clutter.EVENT_STOP; }
        if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter || sym === Clutter.KEY_space) {
            this._model.activateCurrent();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    settleAnimations() {
        const actor = this._actor;
        if (!actor) return;
        try {
            stopSubtreeTransitions(actor);
            actor.opacity = 255;
        } catch { /* intentionally ignored: stack view row or blur actor may already be destroyed */ }
        for (const br of this.blurRegions) {
            try {
                br.remove_all_transitions();
                br.translation_x = 0;
                br.translation_y = 0;
                br.set_scale(1, 1);
                if (this._blurActive) br.opacity = 255;
            } catch { /* intentionally ignored: stack view row or blur actor may already be destroyed */ }
        }
        for (const row of this._model.rows) {
            try {
                stopSubtreeTransitions(row);
                row.translation_x = 0;
                row.translation_y = 0;
                row.set_scale(1, 1);
                row.opacity = 255;
            } catch { /* intentionally ignored: stack view row or blur actor may already be destroyed */ }
        }
    }

    /**
     * Detach all rows from the view container and release them to the pool.
     * Prevents Clutter from recursively destroying pooled actors when view.actor.destroy() runs.
     */
    releaseRows() {
        const pool = this.pool ?? this._fallbackPool;
        const rows = this._model?.rows ?? [];
        for (const row of rows) {
            try {
                stopSubtreeTransitions(row);
                row.translation_x = 0;
                row.translation_y = 0;
                row.set_scale(1.0, 1.0);
                row.opacity = 255;
                if (row._labelPill) {
                    try { unregisterBmsTarget(row._labelPill); } catch { /* intentionally ignored: BMS target cleanup fallback */ }
                }
                const parent = row.get_parent?.();
                if (parent) parent.remove_child(row);
            } catch { /* intentionally ignored: stack view row or blur actor may already be destroyed */ }
            pool?.releaseFanItem(row);
        }
        this._model?.setRows([]);
    }

    // onDone() is called when the close animation finishes (or immediately if
    // animations are off). The DownloadsStack then destroys the actor.
    animateClose(onDone) {
        const actor = this._actor;
        if (!actor) { onDone(); return; }
        stopSubtreeTransitions(actor);
        for (const br of this.blurRegions) {
            try { br.remove_all_transitions(); } catch { /* intentionally ignored: stack view row or blur actor may already be destroyed */ }
        }
        if (this._reduce || !this._collapse || !animationsEnabled()) {
            this.releaseRows();
            onDone();
            return;
        }
        const kids = this._model.rows;
        const n = kids.length;
        const iconCx = this._iconCx ?? (this._thumbnailFirst
            ? 6 + 56 / 2
            : 6 + (this._labelPillWidth ?? 114) + CONTENT_GAP + 56 / 2);
        const rowH = this._rowH ?? 60;
        if (this._blurActive) {
            this.blurRegions.forEach((br, i) => {
                const tile = kids[i];
                if (!tile) return;
                const delay = (n - 1 - i) * FAN_ANIM.close.stagger;
                br.remove_all_transitions();
                br.ease({
                    translation_x: this._collapse.x - (tile.x + iconCx),
                    translation_y: this._collapse.y - (tile.y + rowH / 2),
                    scale_x: 0.25,
                    scale_y: 0.25,
                    duration: FAN_ANIM.close.duration,
                    delay,
                    mode: FAN_ANIM.close.mode,
                });
                br.ease({
                    opacity: 0,
                    duration: FAN_ANIM.close.fadeDuration,
                    delay,
                    mode: FAN_ANIM.close.mode,
                });
            });
        }
        kids.forEach((tile, i) => {
            const delay = (n - 1 - i) * FAN_ANIM.close.stagger;
            tile.remove_all_transitions();
            tile.ease({
                translation_x: this._collapse.x - (tile.x + iconCx),
                translation_y: this._collapse.y - (tile.y + rowH / 2),
                scale_x: 0.25,
                scale_y: 0.25,
                duration: FAN_ANIM.close.duration,
                delay,
                mode: FAN_ANIM.close.mode,
            });
            tile.ease({
                opacity: 0,
                duration: FAN_ANIM.close.fadeDuration,
                delay,
                mode: FAN_ANIM.close.mode,
            });
        });
        actor.ease({
            opacity: 0,
            duration: FAN_ANIM.close.duration + n * FAN_ANIM.close.stagger,
            mode: FAN_ANIM.close.mode,
            onComplete: () => {
                if (this._isClosed) return;
                this._isClosed = true;
                this.releaseRows();
                onDone();
            },
        });
    }
}
