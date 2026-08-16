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

const LABEL_WIDTH = 86;
const CONTENT_GAP = 14;

export class FanView {
    // opts: { folder, files, overflow, cfg, mon, origin:{x,y}, close }
    constructor(opts) {
        Object.assign(this, opts);
        this._model = new SelectionModel('aqua-dl-fan-row-sel');
        this._actor = null;
        this._collapse = null;
        this._reduce = false;
        this._fileMenu = new FileItemMenu(opts.mon, opts.cfg);
    }

    get actor() { return this._actor; }

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

        let stepY = clamp(thumbH + 24, 50, 72);
        const availH = Math.max(140, ay - mon.y - 24);
        if (n > 1) {
            const fitStep = (availH - rowH - 40) / (n - 1);
            if (fitStep < stepY) stepY = Math.max(34, fitStep);
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

        const anchorLX = originX - px, anchorLY = ay - py;
        this._collapse = { x: anchorLX, y: anchorLY };
        Main.uiGroup.add_child(fan);
        this._fileMenu.bind(fan);

        const rows = [];
        builders.forEach((make, i) => {
            const row = make();
            const c = cells[i];
            const fx = localX(c), fy = localY(c);
            row.set_position(fx, fy);
            row.set_size(rowW, rowH);
            row.set_pivot_point(iconCx / rowW, 0.5);
            fan.add_child(row);
            rows.push(row);
            if (reduce) return;
            row.translation_x = anchorLX - (fx + iconCx);
            row.translation_y = anchorLY - (fy + rowH / 2);
            row.scale_x = 0.55; row.scale_y = 0.55;
            row.opacity = 0;
            const delay = i * 16;
            row.ease({
                translation_x: 0, translation_y: 0, scale_x: 1, scale_y: 1,
                duration: 280, delay, mode: Clutter.AnimationMode.EASE_OUT_BACK,
            });
            row.ease({ opacity: 255, duration: 200, delay, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        });
        this._model.setRows(rows);
        if (rows.length) this._model.select(0);

        if (reduce) fan.opacity = 255;
        return fan;
    }

    _card(thumbSize, w, h, extraClass = '') {
        const thumbW = thumbSize, thumbH = Math.round(thumbSize * 0.72);
        const thumbRadius = Math.round(Math.min(thumbW, thumbH) * 0.22);
        const btn = new St.Button({
            style_class: `aqua-dl-fan-row ${extraClass}`.trim(),
            reactive: true, track_hover: true, can_focus: true, width: w, height: h,
        });
        btn.set_style('background-color: transparent; border: none; box-shadow: none;');
        const box = new St.BoxLayout({ style_class: 'aqua-dl-fan-row-inner' });
        const labelPill = new St.Bin({
            style_class: 'aqua-dl-fan-label-pill', x_expand: true,
            x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER,
        });
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
        btn._updatePillStyle = hover =>
            applyTileStyle(this.cfg, labelPill, label, thumb, thumbRadius, hover, '6px 14px');
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

    // onDone() is called when the close animation finishes (or immediately if
    // animations are off). The DownloadsStack then destroys the actor.
    animateClose(onDone) {
        const actor = this._actor;
        if (!actor) { onDone(); return; }
        if (this._reduce || !this._collapse) {
            onDone();
            return;
        }
        const kids = actor.get_children();
        const n = kids.length;
        kids.forEach((tile, i) => {
            const cx = tile.x + tile.width / 2, cy = tile.y + tile.height / 2;
            const delay = (n - 1 - i) * 18;
            tile.ease({
                translation_x: this._collapse.x - cx, translation_y: this._collapse.y - cy,
                scale_x: 0.4, scale_y: 0.4, duration: 240, delay,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
            });
            tile.ease({ opacity: 0, duration: 180, delay: delay + 40, mode: Clutter.AnimationMode.EASE_IN_QUAD });
        });
        actor.ease({
            opacity: 0, duration: 260 + n * 18, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: onDone,
        });
    }
}
