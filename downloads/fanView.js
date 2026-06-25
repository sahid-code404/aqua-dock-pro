// AquaDockPro — Downloads "fan" view.
//
// Purpose:   Build the macOS-style stack fan: cards spray up and out of the dock
//            icon, the most-recent file at the bottom. Owns its open animation
//            (cards fly from the icon) and close animation (cards retract into
//            the icon). Pure view: it's handed the file list + geometry and a
//            close() callback; it knows nothing about the watcher or the dock.
// Ownership: Owns the fan actor + its row cards (destroyed with the actor) and a
//            SelectionModel. The DownloadsStack parents/destroys the actor.
// Cost:      Built once per open; cards are St.Buttons with one icon each.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { clamp, launchUri } from '../core/utils.js';
import { iconForInfo } from './fileEnumerator.js';
import { applyTileStyle } from './tileStyle.js';
import { SelectionModel } from './keyboardNav.js';

export class FanView {
    // opts: { folder, files, overflow, cfg, mon, origin:{x,y}, close }
    constructor(opts) {
        Object.assign(this, opts);
        this._model = new SelectionModel('aqua-dl-fan-row-sel');
        this._actor = null;
        this._collapse = null;
        this._reduce = false;
    }

    get actor() { return this._actor; }

    build() {
        const { cfg, mon, files, overflow } = this;
        const reduce = !St.Settings.get().enable_animations;
        this._reduce = reduce;

        const fan = new St.Widget({
            style_class: 'aqua-dl-fan-panel',
            reactive: true, can_focus: true,
            layout_manager: new Clutter.FixedLayout(),
        });
        const originX = this.origin.x, ay = this.origin.y;

        const thumbSize = clamp(Math.round(cfg.iconSize * 0.88), 44, 96);
        const thumbH = Math.round(thumbSize * 0.72);
        const rowH = Math.max(thumbH, 32) + 20;
        const leftPad = 6, labelGap = 10, labelW = 90, labelPillW = labelW + 28;
        const rowW = leftPad + labelPillW + labelGap + thumbSize + 6;
        const iconCx = leftPad + labelPillW + labelGap + thumbSize / 2;

        const builders = files.map(info => () => this._rowCard(info, thumbSize, rowW, rowH));
        if (overflow > 0)
            builders.push(() => this._infoCard(`Open in Files · ${overflow} more`, thumbSize, rowW, rowH));
        if (builders.length === 0)
            builders.push(() => this._infoCard('Downloads is empty', thumbSize, rowW, rowH));
        const n = builders.length;

        let stepY = clamp(thumbH + 24, 50, 72);
        const availH = Math.max(140, ay - mon.y - 24);
        if (n > 1) {
            const fitStep = (availH - rowH - 40) / (n - 1);
            if (fitStep < stepY) stepY = Math.max(34, fitStep);
        }
        const dir = originX > mon.x + mon.width / 2 ? 1 : -1;
        const cells = [];
        for (let i = 0; i < n; i++) {
            const t = n > 1 ? i / (n - 1) : 0;
            cells.push({ cx: dir * 45 * Math.pow(t, 1.35), cy: -(i * stepY) });
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

        let px = clamp(Math.round(originX - bottomCx), mon.x + 8, mon.x + mon.width - panelW - 8);
        let py = clamp(Math.round(ay - 40 - bottomCy), mon.y + 8, mon.y + mon.height - panelH - 8);
        fan.set_position(px, py);
        fan.set_size(panelW, panelH);
        fan.set_style('background-color: transparent; border: none;');

        const anchorLX = originX - px, anchorLY = ay - py;
        this._collapse = { x: anchorLX, y: anchorLY };
        Main.uiGroup.add_child(fan);

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

        if (reduce) {
            fan.opacity = 0;
            fan.ease({ opacity: 255, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        }
        this._actor = fan;
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
        box.spacing = 10;
        const labelPill = new St.Bin({
            style_class: 'aqua-dl-fan-label-pill', x_expand: true,
            x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER,
        });
        const label = new St.Label({
            style_class: 'aqua-dl-fan-label', width: 90,
            x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.set_line_wrap(false);
        label.clutter_text.set_ellipsize(2);
        labelPill.set_child(label);
        box.add_child(labelPill);
        const thumb = new St.Bin({
            style_class: 'aqua-dl-fan-thumb', x_expand: false, y_expand: false,
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER,
        });
        thumb.set_size(thumbW, thumbH);
        thumb.set_pivot_point(0.5, 0.5);
        box.add_child(thumb);
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
        return { btn, label, thumb, thumbW, thumbH };
    }

    _rowCard(info, thumbSize, w, h) {
        const { btn, label, thumb, thumbW, thumbH } = this._card(thumbSize, w, h);
        label.text = info.get_display_name();
        thumb.set_child(new St.Icon({
            gicon: iconForInfo(info),
            icon_size: Math.round(Math.min(thumbW, thumbH) * 0.78),
            style_class: 'aqua-dl-fan-icon',
        }));
        btn._activate = () => { launchUri(this.folder.get_child(info.get_name()).get_uri()); this.close(); };
        btn.connect('clicked', btn._activate);
        return btn;
    }

    _infoCard(text, thumbSize, w, h) {
        const { btn, label, thumb, thumbW, thumbH } = this._card(thumbSize, w, h, 'aqua-dl-fan-more');
        label.text = text;
        thumb.set_child(new St.Icon({
            gicon: Gio.ThemedIcon.new('folder-download'),
            icon_size: Math.round(Math.min(thumbW, thumbH) * 0.72),
            style_class: 'aqua-dl-fan-icon',
        }));
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
            actor.ease({
                opacity: 0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: onDone,
            });
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
