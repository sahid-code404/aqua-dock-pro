// Downloads fan view.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { animationsEnabled, clamp, launchUri } from '../core/utils.js';
import { _, format, ngettext } from '../core/i18n.js';
import { iconForInfo } from './fileEnumerator.js';
import { FileItemMenu } from './fileItemMenu.js';
import { aboveDockY, fanOrientation, sideFanX } from './fanGeometry.js';
import { applyTileStyle } from './tileStyle.js';
import { SelectionModel } from './keyboardNav.js';
import { buildPlaceIcon } from './placeIcon.js';
import { isBmsDockBlurActive, registerBmsTarget, unregisterBmsTarget, setupBackgroundCorners } from '../dock/dockBlur.js';

const LABEL_WIDTH = 86;
const CONTENT_GAP = 14;

// Configurable fan animation profile (revertible test mode)
// Animates pills along the display edge side arc without 3D diagonal flight layering
export const FAN_ANIM = {
    open: {
        duration: 180,                              // Smooth 180ms horizontal slide-in
        stagger: 18,                               // 18ms sequential stagger from bottom to top
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,  // macOS-style deceleration into resting slots
        fadeDuration: 150,                          // Clean opacity ramp
    },
    close: {
        duration: 150,                              // Snappy 150ms slide-out towards display edge
        stagger: 14,                               // 14ms reverse stagger from top to bottom
        mode: Clutter.AnimationMode.EASE_IN_QUAD,   // Smooth acceleration towards edge
        fadeDuration: 130,                          // Clean opacity fade
    },
    slideDistance: 36,                              // Horizontal slide distance along display edge side arc (px)
};

export class FanView {
    // opts: { folder, files, overflow, cfg, mon, origin:{x,y}, close }
    constructor(opts) {
        Object.assign(this, opts);
        this._model = new SelectionModel('aqua-dl-fan-row-sel');
        this._actor = null;
        this._collapse = null;
        this._orientation = null;
        this._slideOffset = 0;
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
        const { cfg, mon, files, overflow } = this;
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

        const builders = files.map(info => () => this._rowCard(info, thumbSize, rowW, rowH));
        if (overflow > 0)
            builders.push(() => this._infoCard(format(
                ngettext('Open in Files · %d more item', 'Open in Files · %d more items', overflow),
                overflow), thumbSize, rowW, rowH));
        if (builders.length === 0)
            builders.push(() => this._infoCard(format(_('%s is empty'), this.title),
                thumbSize, rowW, rowH));
        const n = builders.length;

        const pillH = Math.max(thumbH, 28);
        const minStep = pillH + 6;
        let stepY = clamp(thumbH + 24, minStep, 72);
        const availH = Math.max(140, ay - mon.y - 24);
        if (n > 1) {
            const fitStep = (availH - rowH - 40) / (n - 1);
            if (fitStep < stepY) stepY = Math.max(minStep, fitStep);
        }
        const cells = [];
        for (let i = 0; i < n; i++) {
            const t = n > 1 ? i / (n - 1) : 0;
            cells.push({
                cx: orientation.curveSign * 45 * Math.pow(t, 1.35),
                cy: -(i * stepY),
            });
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
        const py = clamp(Math.round(targetY), mon.y + 8, mon.y + mon.height - panelH - 8);
        fan.set_position(px, py);
        fan.set_size(panelW, panelH);
        fan.set_style('background-color: transparent; border: none;');

        fan.name = 'aquaDownloadsFan';
        fan._isAquaDock = true;
        fan._dockBlurEnabled = false;

        const blurActive = Boolean(cfg.blurEffect && isBmsDockBlurActive());
        this._blurActive = blurActive;

        Main.uiGroup.add_child(fan);

        const anchorLX = originX - px, anchorLY = ay - py;
        this._collapse = { x: anchorLX, y: anchorLY };
        this._orientation = orientation;
        const slideOffset = (orientation.curveSign || 1) * (FAN_ANIM.slideDistance ?? 36);
        this._slideOffset = slideOffset;
        this._fileMenu.bind(fan);

        const radius = cfg.dlItemRadius ?? clamp(cfg.dockRadius ?? 16, 6, 28);
        const pillLocalX = this._thumbnailFirst
            ? leftPad + thumbSize + labelGap
            : leftPad;
        const pillLocalY = Math.round((rowH - pillH) / 2);

        const rows = [];
        const blurRegions = [];
        this._blurRegions = blurRegions;

        builders.forEach((make, i) => {
            const row = make();
            const c = cells[i];
            const fx = localX(c), fy = localY(c);
            row.set_position(fx, fy);
            row.set_size(rowW, rowH);
            row.set_pivot_point(iconCx / rowW, 0.5);
            fan.add_child(row);
            rows.push(row);

            const blurRegion = new St.Widget({
                name: 'aqua-downloads-fan-blur-region',
                style_class: 'aqua-blur-region',
                reactive: false,
            });
            blurRegion._dockRadius = radius;
            blurRegion.set_style(`border-radius: ${radius}px;`);
            row._blurRegion = blurRegion;
            row._dockBlurRegion = blurRegion;
            blurRegions.push(blurRegion);

            Main.uiGroup.insert_child_below(blurRegion, fan);

            blurRegion.set_position(px + fx + pillLocalX, py + fy + pillLocalY);
            blurRegion.set_size(labelPillW, pillH);
            blurRegion.opacity = 0;

            row._isAquaDock = true;
            row._dockBlurEnabled = blurActive;
            row._dockBg = blurRegion;
            row._dockContent = blurRegion;
            row._dockContentParent = blurRegion;
            row._dockBlurRegion = blurRegion;
            row._dockRadius = radius;
            row.get_dock_radius = () => radius;
            blurRegion._isAquaDock = true;
            blurRegion._dockBlurEnabled = blurActive;
            blurRegion._dockRadius = radius;
            blurRegion.get_dock_radius = () => radius;
            setupBackgroundCorners(blurRegion, () => radius);

            if (blurActive) {
                registerBmsTarget(row, () => radius);
            } else {
                blurRegion.hide();
            }

            if (reduce) return;
            const initTx = slideOffset;
            const initTy = 0;
            row.translation_x = initTx;
            row.translation_y = initTy;
            row.opacity = 0;
            const delay = i * FAN_ANIM.open.stagger;
            row.ease({
                translation_x: 0, translation_y: 0,
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

            if (blurActive) {
                blurRegion.translation_x = initTx;
                blurRegion.translation_y = initTy;
                blurRegion.ease({
                    translation_x: 0, translation_y: 0,
                    duration: FAN_ANIM.open.duration,
                    delay,
                    mode: FAN_ANIM.open.mode,
                });
                blurRegion.ease({
                    opacity: 255,
                    duration: FAN_ANIM.open.fadeDuration,
                    delay,
                    mode: FAN_ANIM.open.mode,
                });
            }
        });

        fan.connect('destroy', () => {
            rows.forEach(r => unregisterBmsTarget(r));
            blurRegions.forEach(br => {
                try { br.destroy(); } catch { }
            });
        });

        this._model.setRows(rows);
        if (rows.length) this._model.select(0);
        fan._blurRegion = this.blurRegion;
        fan._blurRegions = blurRegions;

        if (reduce) {
            fan.opacity = 255;
            if (blurActive) blurRegions.forEach(br => br.opacity = 255);
        }
        return fan;
    }

    _card(thumbSize, w, h, extraClass = '') {
        const thumbW = thumbSize, thumbH = Math.round(thumbSize * 0.72);
        const thumbRadius = Math.round(Math.min(thumbW, thumbH) * 0.22);
        const radius = this.cfg.dlItemRadius ?? clamp(this.cfg.dockRadius ?? 16, 6, 28);
        const pillH = Math.max(thumbH, 28);
        const labelPillW = this._labelPillWidth ?? (LABEL_WIDTH + 28);

        const btn = new St.Button({
            style_class: `aqua-dl-fan-row ${extraClass}`.trim(),
            reactive: true, track_hover: true, can_focus: true, width: w, height: h,
        });
        btn.name = 'aquaDownloadsFanItem';
        btn.set_style('background-color: transparent; border: none; box-shadow: none;');

        const box = new St.BoxLayout({ style_class: 'aqua-dl-fan-row-inner' });
        const labelPill = new St.Bin({
            style_class: 'aqua-dl-fan-label-pill', x_expand: true,
            x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER,
        });
        labelPill.set_size(labelPillW, pillH);
        labelPill._dockRadius = radius;
        labelPill.get_dock_radius = () => radius;
        setupBackgroundCorners(labelPill, () => radius);

        const label = new St.Label({
            style_class: 'aqua-dl-fan-label', width: this._labelWidth ?? LABEL_WIDTH,
            x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER,
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
            style_class: 'aqua-dl-fan-thumb', x_expand: false, y_expand: false,
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER,
        });
        thumb.set_size(thumbW, thumbH);
        thumb.set_pivot_point(0.5, 0.5);

        if (this._thumbnailFirst) {
            box.add_child(thumb);
            box.add_child(gap);
            box.add_child(labelPill);
        } else {
            box.add_child(labelPill);
            box.add_child(gap);
            box.add_child(thumb);
        }
        btn.set_child(box);
        btn._thumb = thumb;
        btn._labelPill = labelPill;

        btn._isAquaDock = true;
        btn._dockBlurEnabled = this._blurActive;
        btn._dockRadius = radius;
        btn.get_dock_radius = () => radius;

        btn._updatePillStyle = hover =>
            applyTileStyle(this.cfg, labelPill, label, thumb, thumbRadius, hover, '6px 14px', this._blurActive);
        btn._updatePillStyle(false);

        btn.connect('notify::hover', () => {
            if (!btn.hover) return;
            const idx = this._model.rows.indexOf(btn);
            if (idx >= 0) this._model.select(idx);
        });
        return { btn, labelPill, label, thumb, thumbW, thumbH };
    }

    _rowCard(info, thumbSize, w, h) {
        const { btn, labelPill, label, thumb, thumbW, thumbH } = this._card(thumbSize, w, h);
        const file = this.folder.get_child(info.get_name());
        label.text = info.get_display_name();
        btn.accessible_name = label.text;
        thumb.set_child(new St.Icon({
            gicon: iconForInfo(info),
            icon_size: Math.round(Math.min(thumbW, thumbH) * 0.78),
            style_class: 'aqua-dl-fan-icon',
        }));
        btn._activate = () => { launchUri(file.get_uri()); this.close(); };
        this._fileMenu.attach(btn, file, btn._activate, labelPill);
        return btn;
    }

    _infoCard(text, thumbSize, w, h) {
        const { btn, label, thumb, thumbW, thumbH } = this._card(thumbSize, w, h, 'aqua-dl-fan-more');
        label.text = text;
        btn.accessible_name = text;
        const iconSize = Math.round(Math.min(thumbW, thumbH) * 0.72);
        thumb.set_child(buildPlaceIcon(
            this.gicon ?? Gio.ThemedIcon.new('folder-download'),
            iconSize,
            this.cfg.placeIconSourceSize,
            'aqua-dl-fan-icon'));
        btn._activate = () => { launchUri(this.folder.get_uri()); this.close(); };
        btn.connect('clicked', btn._activate);
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
            actor.remove_all_transitions();
            actor.opacity = 255;
        } catch { }
        for (const br of this.blurRegions) {
            try {
                br.remove_all_transitions();
                br.translation_x = 0;
                br.translation_y = 0;
                br.set_scale(1, 1);
                if (this._blurActive) br.opacity = 255;
            } catch { }
        }
        for (const row of this._model.rows) {
            try {
                row.remove_all_transitions();
                row.translation_x = 0;
                row.translation_y = 0;
                row.set_scale(1, 1);
                row.opacity = 255;
            } catch { }
        }
    }

    // onDone() is called when the close animation finishes (or immediately if
    // animations are off). The DownloadsStack then destroys the actor.
    animateClose(onDone) {
        const actor = this._actor;
        if (!actor) { onDone(); return; }
        for (const br of this.blurRegions) {
            try { br.remove_all_transitions(); } catch { }
        }
        if (this._reduce || !animationsEnabled()) {
            onDone();
            return;
        }
        const slideOffset = this._slideOffset ?? ((this._orientation?.curveSign || 1) * (FAN_ANIM.slideDistance ?? 36));
        const kids = this._model.rows;
        const n = kids.length;
        if (this._blurActive) {
            this.blurRegions.forEach((br, i) => {
                const delay = (n - 1 - i) * FAN_ANIM.close.stagger;
                br.ease({
                    translation_x: slideOffset,
                    translation_y: 0,
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
            tile.ease({
                translation_x: slideOffset,
                translation_y: 0,
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
            onComplete: onDone,
        });
    }
}
