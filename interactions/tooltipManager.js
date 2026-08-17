// Hover tooltip label lifecycle and placement.


import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { logError, TimeoutGroup } from '../core/utils.js';

export class TooltipManager {
    constructor(getConfig, getHoverItem = null, getMonitor = null) {
        this._getConfig = getConfig;
        this._getHoverItem = getHoverItem;
        this._getMonitor = getMonitor;
        this._label = new St.Label({ style_class: 'aqua-tooltip', visible: false });
        Main.uiGroup.add_child(this._label);
        this._timers = new TimeoutGroup();
        this._shown = false;
        this._showId = 0;
        this._pendingItem = null;
        this._pendingGeom = null;
        this._w = null;
        this._h = null;
        this._mon = null;
        this._x = NaN;
        this._y = NaN;
    }

    get shown() { return this._shown; }

    invalidateMonitor() { this._mon = null; }

    style() {
        const cfg = this._getConfig();
        if (!cfg.showTooltip) {
            this.hide();
            return;
        }
        const radius = cfg.tooltipRadius ?? 9;
        const bg = cfg.highContrast ? 'rgba(0,0,0,0.98)'
            : (cfg.tooltipBg || 'rgba(32,32,36,0.92)');
        const fg = cfg.highContrast ? '#ffffff'
            : (cfg.tooltipFg || 'rgba(242,242,244,1.0)');
        const bw = cfg.highContrast ? Math.max(2, cfg.tooltipBorderWidth ?? 1)
            : (cfg.tooltipBorderWidth ?? cfg.borderWidth ?? 1);
        const bc = cfg.highContrast ? '#ffffff'
            : (cfg.tooltipBorderColor ?? cfg.borderColor ?? 'rgba(255,255,255,0.16)');
        const border = bw > 0 ? `${bw}px solid ${bc}` : 'none';
        this._label.set_style(
            `background-color: ${bg}; color: ${fg}; border-radius: ${radius}px; ` +
            `border: ${border}; font-size: ${(10 * (cfg.interfaceTextScale ?? 1)).toFixed(2)}pt;`);
        this._w = null;   // border/padding shift the metrics
    }

    scheduleShow(item, geom) {
        if (!this._getConfig().showTooltip) { this.hide(); return; }
        if (!item) { this.hide(); return; }
        if (this._shown) { this.show(item, geom); return; }

        // Keep one timer, but always point it at the latest icon. This avoids a
        // stale tooltip when the pointer crosses icons before the delay ends.
        this._pendingItem = item;
        this._pendingGeom = geom;
        if (this._showId) return;
        const delay = this._getConfig().tooltipDelay ?? 100;
        this._showId = this._timers.addOnce(delay, () => {
            this._showId = 0;
            const nextItem = this._pendingItem;
            const nextGeom = this._pendingGeom;
            this._pendingItem = null;
            this._pendingGeom = null;
            if (nextItem && this._getConfig().showTooltip &&
                (!this._getHoverItem || this._getHoverItem() === nextItem))
                this.show(nextItem, nextGeom);
        });
    }

    show(item, geom) {
        if (!item || !this._getConfig().showTooltip) return;
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
            const mon = this._mon ?? (this._mon = this._getMonitor?.());
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
            if (nx !== this._x || ny !== this._y) {
                this._label.set_position(nx, ny);
                this._x = nx;
                this._y = ny;
            }
        } catch (e) { logError(e, 'tooltip.position'); }
    }

    cancel() {
        if (this._showId) { this._timers.remove(this._showId); this._showId = 0; }
        this._pendingItem = null;
        this._pendingGeom = null;
    }

    hide() {
        this.cancel();
        this._shown = false;
        try { this._label.hide(); } catch { }
    }

    destroy() {
        this._timers.removeAll();
        this._showId = 0;
        this._pendingItem = null;
        this._pendingGeom = null;
        this._x = NaN;
        this._y = NaN;
        if (this._label) { try { this._label.destroy(); } catch { } this._label = null; }
        this._getConfig = this._getHoverItem = this._getMonitor = null;
    }
}
