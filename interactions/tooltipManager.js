// AquaDockPro — hover tooltip.
//
// Purpose:   Own the single app-name tooltip label: its actor, styling, the
//            show-delay timer, and placement. It anchors to the hovered icon's
//            LIVE transformed box so it tracks the icon as it magnifies — the
//            controller calls position() from the engine's per-frame hook, so
//            there's no dedicated timer and zero cost once the icon settles.
// Ownership: OWNS the St.Label (parented to Main.uiGroup) and the show timer.
//            destroy() removes both.
// Cost:      position() is two transform reads + one set_position, allocation-
//            free, dirty-checked against the last position.


import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { logError, TimeoutGroup } from '../core/utils.js';

export class TooltipManager {
    constructor(getConfig) {
        this._getConfig = getConfig;
        this._label = new St.Label({ style_class: 'aqua-tooltip', visible: false });
        Main.uiGroup.add_child(this._label);
        this._timers = new TimeoutGroup();
        this._shown = false;
        this._showId = 0;
        this._w = null;
        this._h = null;
        this._mon = null;
    }

    get shown() { return this._shown; }

    invalidateMonitor() { this._mon = null; }

    style() {
        const cfg = this._getConfig();
        const radius = cfg.tooltipRadius ?? 9;
        const bg = cfg.tooltipBg || 'rgba(32,32,36,0.92)';
        const fg = cfg.tooltipFg || 'rgba(242,242,244,1.0)';
        const bw = cfg.tooltipBorderWidth ?? cfg.borderWidth ?? 1;
        const bc = cfg.tooltipBorderColor ?? cfg.borderColor ?? 'rgba(255,255,255,0.16)';
        const border = bw > 0 ? `${bw}px solid ${bc}` : 'none';
        this._label.set_style(
            `background-color: ${bg}; color: ${fg}; border-radius: ${radius}px; border: ${border};`);
        this._w = null;   // border/padding shift the metrics
    }

    scheduleShow(item, geom) {
        if (this._shown) { this.show(item, geom); return; }
        if (this._showId) return;
        const delay = this._getConfig().tooltipDelay ?? 100;
        this._showId = this._timers.addOnce(delay, () => {
            this._showId = 0;
            this.show(item, geom);
        });
    }

    show(item, geom) {
        if (!item) return;
        this._label.text = item.label();
        this._w = null;
        this._label.opacity = 255;
        this._label.show();
        const parent = this._label.get_parent();
        if (parent) parent.set_child_above_sibling(this._label, null);
        this._shown = true;
        this.position(item, geom);
    }

    // Anchor to the icon's live on-screen box (post scale + lift).
    position(item, geom) {
        if (!this._shown || !geom) return;
        try {
            const icon = item?._icon;
            if (!icon) return;
            const [ix, iy] = icon.get_transformed_position();
            const [iw, ih] = icon.get_transformed_size();
            if (!isFinite(ix) || !isFinite(iy) || iw <= 0 || ih <= 0) return;

            if (this._w == null) {
                [, this._w] = this._label.get_preferred_width(-1);
                [, this._h] = this._label.get_preferred_height(-1);
                if (!this._w || !this._h) return;
            }
            const tw = this._w, th = this._h;
            const mon = this._mon ?? (this._mon = Main.layoutManager.primaryMonitor);
            if (!mon) return;

            const gap = 12;
            let tx, ty;
            if (!geom.vert) {
                tx = ix + iw * 0.5 - tw * 0.5;
                ty = iy - th - gap;
            } else if (geom.side === 'left') {
                tx = ix + iw + gap;
                ty = iy + ih * 0.5 - th * 0.5;
            } else {
                tx = ix - tw - gap;
                ty = iy + ih * 0.5 - th * 0.5;
            }
            const monR = mon.x + mon.width, monB = mon.y + mon.height;
            tx = Math.max(mon.x + 4, Math.min(tx, monR - tw - 4));
            ty = Math.max(mon.y + 4, Math.min(ty, monB - th - 4));

            const nx = Math.round(tx), ny = Math.round(ty);
            if (nx !== this._label.x || ny !== this._label.y) this._label.set_position(nx, ny);
        } catch (e) { logError(e, 'tooltip.position'); }
    }

    cancel() {
        if (this._showId) { this._timers.remove(this._showId); this._showId = 0; }
    }

    hide() {
        this.cancel();
        this._shown = false;
        try { this._label.hide(); } catch { }
    }

    destroy() {
        this._timers.removeAll();
        this._showId = 0;
        if (this._label) { try { this._label.destroy(); } catch { } this._label = null; }
        this._getConfig = null;
    }
}
