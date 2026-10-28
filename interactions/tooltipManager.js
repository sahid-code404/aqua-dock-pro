// Hover tooltip label lifecycle, pure rounded pill bubble placement, and Blur My Shell integration.

import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { logError, TimeoutGroup, SignalGroup } from '../core/utils.js';
import {
    isBmsDockBlurActive,
    registerBmsTarget,
    unregisterBmsTarget,
    setupBackgroundCorners,
} from '../dock/dockBlur.js';

export function parseCssColor(str, defaultRgba = [0.125, 0.125, 0.141, 0.92]) {
    if (!str || typeof str !== 'string') return defaultRgba;
    const s = str.trim().toLowerCase();
    if (s === 'transparent' || s === 'none') return [0, 0, 0, 0];
    if (s === 'white') return [1, 1, 1, 1];
    if (s === 'black') return [0, 0, 0, 1];
    if (s.startsWith('#')) {
        const hex = s.slice(1);
        if (/^[0-9a-f]+$/i.test(hex)) {
            if (hex.length === 3 || hex.length === 4) {
                const r = parseInt(hex[0] + hex[0], 16) / 255;
                const g = parseInt(hex[1] + hex[1], 16) / 255;
                const b = parseInt(hex[2] + hex[2], 16) / 255;
                const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1.0;
                return [r, g, b, a];
            } else if (hex.length === 6 || hex.length === 8) {
                const r = parseInt(hex.slice(0, 2), 16) / 255;
                const g = parseInt(hex.slice(2, 4), 16) / 255;
                const b = parseInt(hex.slice(4, 6), 16) / 255;
                const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1.0;
                return [r, g, b, a];
            }
        }
    }
    // Match comma-separated or space-separated rgb/rgba, including optional percentage values
    const match = s.match(/rgba?\s*\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/);
    if (match) {
        const parseVal = (v, max = 255) => {
            if (!v) return 0;
            if (v.endsWith('%')) return parseFloat(v) / 100;
            return parseFloat(v) / max;
        };
        const r = parseVal(match[1], 255);
        const g = parseVal(match[2], 255);
        const b = parseVal(match[3], 255);
        const a = match[4] !== undefined ? parseVal(match[4], 1) : 1.0;
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && Number.isFinite(a)) {
            return [
                Math.max(0, Math.min(1, r)),
                Math.max(0, Math.min(1, g)),
                Math.max(0, Math.min(1, b)),
                Math.max(0, Math.min(1, a)),
            ];
        }
    }
    return defaultRgba;
}

export class TooltipManager {
    constructor(getConfig, getHoverItem = null, getMonitor = null, actors = null) {
        this._getConfig = getConfig;
        this._getHoverItem = getHoverItem;
        this._getMonitor = getMonitor;
        this._signals = new SignalGroup();

        // Outer container hosting the pill bubble
        this._container = actors?.container ?? new St.Widget({
            name: 'aquaTooltip',
            style_class: 'aqua-tooltip-container',
            visible: false,
            reactive: false,
        });

        // Pill-shaped bubble container for the tooltip label
        this._bubble = actors?.bubble ?? new St.Bin({
            name: 'aquaTooltipBubble',
            style_class: 'aqua-tooltip-bubble',
            reactive: false,
            x_align: 2, // Clutter.ActorAlign.CENTER
            y_align: 2,
        });

        this._label = actors?.label ?? new St.Label({
            style_class: 'aqua-tooltip',
            reactive: false,
            x_align: 2, // Clutter.ActorAlign.CENTER
            y_align: 2,
        });
        const ct = this._label?.clutter_text ||
            (typeof this._label?.get_clutter_text === 'function' ? this._label.get_clutter_text() : null);
        if (ct) {
            try {
                ct.set_line_wrap?.(false);
                ct.set_ellipsize?.(0);
                ct.set_x_align?.(2);
            } catch { }
        }
        if (typeof this._bubble.set_child === 'function') {
            this._bubble.set_child(this._label);
        }

        if (typeof this._container.add_child === 'function') {
            this._container.add_child(this._bubble);
        }

        // Underlying blur region actor for Blur My Shell integration
        this._blurRegion = actors?.blurRegion ?? new St.Widget({
            name: 'aqua-tooltip-blur-region',
            style_class: 'aqua-blur-region',
            visible: false,
            reactive: false,
        });

        // Target properties for Blur My Shell discovery via resolveAquaDockTarget
        this._container._isAquaDock = true;
        this._container._dockBg = this._blurRegion;
        this._container._dockContent = this._container;
        this._container._dockBlurRegion = this._blurRegion;
        Object.defineProperty(this._container, '_dockContentParent', {
            get: () => this._container.get_parent?.() ?? Main.uiGroup,
            configurable: true,
            enumerable: true,
        });
        this._container._dockBlurEnabled = false;
        this._container._dockRadius = 6;
        this._container.get_dock_radius = () => (this._radius ?? 6);
        this._blurRegion._dockRadius = 6;
        this._blurRegion.get_dock_radius = () => (this._radius ?? 6);
        this._bubble._dockRadius = 6;
        this._bubble.get_dock_radius = () => (this._radius ?? 6);
        setupBackgroundCorners(this._blurRegion, () => (this._radius ?? 6));
        setupBackgroundCorners(this._bubble, () => (this._radius ?? 6));

        if (Main.uiGroup?.add_child) {
            Main.uiGroup.add_child(this._container);
            if (typeof Main.uiGroup.insert_child_below === 'function') {
                Main.uiGroup.insert_child_below(this._blurRegion, this._container);
            } else {
                Main.uiGroup.add_child(this._blurRegion);
            }
        }

        if (Main.extensionManager) {
            this._signals.connect(
                Main.extensionManager,
                'extension-state-changed',
                () => this.style()
            );
        }

        this._timers = new TimeoutGroup();
        this._shown = false;
        this._showId = 0;
        this._pendingItem = null;
        this._pendingGeom = null;
        this._lastGeom = null;
        this._blurActive = false;
        this._radius = 6;
        this._side = 'bottom';
        this._normalBg = 'rgba(32, 32, 36, 0.92)';
        this._borderWidth = 1;
        this._w = null;
        this._h = null;
        this._mon = null;
        this._x = NaN;
        this._y = NaN;
    }

    get shown() { return this._shown; }
    get container() { return this._container; }
    get bubble() { return this._bubble; }
    get label() { return this._label; }
    get blurRegion() { return this._blurRegion; }
    get blurActive() { return this._blurActive; }
    get side() { return this._side; }

    invalidateMonitor() {
        this._mon = null;
        this._w = null;
        this._h = null;
    }

    _removeTransitions() {
        try { this._container?.remove_all_transitions?.(); } catch { }
        try { this._bubble?.remove_all_transitions?.(); } catch { }
        try { this._label?.remove_all_transitions?.(); } catch { }
        try { this._blurRegion?.remove_all_transitions?.(); } catch { }
        try { this._container?._aquaDockSurface?.background?.remove_all_transitions?.(); } catch { }
        try { this._container?._aquaDockSurface?.background_group?.remove_all_transitions?.(); } catch { }
    }

    _notifyGeometry(actor) {
        if (!actor) return;
        const props = ['position', 'size', 'x', 'y', 'width', 'height'];
        for (const prop of props) {
            if (typeof actor.notify === 'function') {
                try { actor.notify(prop); } catch { }
            } else if (typeof actor.emit === 'function') {
                try { actor.emit(`notify::${prop}`); } catch { }
            }
        }
    }

    _syncGeometry(actor, x, y, w, h) {
        if (!actor) return;
        try { actor.remove_all_transitions?.(); } catch { }
        if (typeof actor.set_position === 'function') {
            actor.set_position(x, y);
        } else {
            actor.x = x;
            actor.y = y;
        }
        actor.x = x;
        actor.y = y;

        if (typeof actor.set_size === 'function') {
            actor.set_size(w, h);
        } else {
            actor.width = w;
            actor.height = h;
        }
        actor.width = w;
        actor.height = h;

        this._notifyGeometry(actor);
    }

    _calculateDimensions(mon) {
        try { this._label.set_size?.(-1, -1); } catch { }
        try { this._bubble.set_size?.(-1, -1); } catch { }

        let lw = 0, lh = 0;
        if (typeof this._label.get_preferred_width === 'function') {
            [, lw] = this._label.get_preferred_width(-1);
            [, lh] = this._label.get_preferred_height(-1);
        }

        let bw = 0, bh = 0;
        if (typeof this._bubble.get_preferred_width === 'function') {
            [, bw] = this._bubble.get_preferred_width(-1);
            [, bh] = this._bubble.get_preferred_height(-1);
        }

        const radius = this._radius ?? 6;
        // Comfortable horizontal (12px each side) and vertical (5px each side) padding
        const padX = 24;
        const padY = 10;
        const bwWidth = Math.max(0, this._borderWidth ?? 1);
        const borderPad = bwWidth * 2;

        // Natural sizing: ensure bubble never squishes or truncates full label text
        let targetW = Math.max(bw || 0, (lw || 0) + padX + borderPad);
        let targetH = Math.max(bh || 0, (lh || 0) + padY + borderPad);

        // Minimum dimensions to accommodate corner radii
        const minW = Math.max(28, radius * 2);
        const minH = Math.max(18, radius * 2);
        targetW = Math.max(targetW, minW);
        targetH = Math.max(targetH, minH);

        // Constrain only by monitor boundaries with margin, without premature clamping
        const maxW = mon ? Math.max(minW, mon.width - 16) : targetW;
        const ct = this._label?.clutter_text ||
            (typeof this._label?.get_clutter_text === 'function' ? this._label.get_clutter_text() : null);
        if (targetW > maxW) {
            targetW = maxW;
            try { ct?.set_ellipsize?.(3); } catch { } // PANGO_ELLIPSIZE_END
        } else {
            try { ct?.set_ellipsize?.(0); } catch { } // PANGO_ELLIPSIZE_NONE
        }

        return [Math.round(targetW), Math.round(targetH)];
    }

    style() {
        const cfg = this._getConfig?.() ?? {};
        if (!cfg.showTooltip) {
            this.hide();
            return;
        }
        const radius = cfg.tooltipRadius ?? 6;
        this._radius = radius;
        this._container._dockRadius = radius;
        this._blurRegion._dockRadius = radius;
        this._bubble._dockRadius = radius;
        setupBackgroundCorners(this._blurRegion, () => radius);
        setupBackgroundCorners(this._bubble, () => radius);

        const blurActive = Boolean(cfg.blurEffect && isBmsDockBlurActive() && !cfg.highContrast);
        const normalBg = cfg.highContrast ? 'rgba(0,0,0,0.98)'
            : (cfg.tooltipBg || 'rgba(32,32,36,0.92)');
        const bg = cfg.highContrast ? 'rgba(0,0,0,0.98)'
            : (blurActive ? 'transparent' : normalBg);
        const fg = cfg.highContrast ? '#ffffff'
            : (cfg.tooltipFg || 'rgba(242,242,244,1.0)');
        const bw = cfg.highContrast ? Math.max(2, cfg.tooltipBorderWidth ?? 1)
            : (cfg.tooltipBorderWidth ?? cfg.borderWidth ?? 1);
        const bc = cfg.highContrast ? '#ffffff'
            : (cfg.tooltipBorderColor ?? cfg.borderColor ?? 'rgba(255,255,255,0.16)');
        const border = bw > 0 ? `${bw}px solid ${bc}` : 'none';

        this._bubble.set_style(
            `background-color: ${bg}; border-radius: ${radius}px; ` +
            `border: ${border}; padding: 5px 12px;`);
        this._label.set_style(
            `color: ${fg}; font-size: ${(10 * (cfg.interfaceTextScale ?? 1)).toFixed(2)}pt; font-weight: 500; text-align: center;`);

        this._blurRegion.set_style(`border-radius: ${radius}px;`);

        this._normalBg = normalBg;
        this._borderWidth = bw;

        if (blurActive !== this._blurActive) {
            this._blurActive = blurActive;
            this._container._dockBlurEnabled = blurActive;
            if (blurActive) {
                registerBmsTarget(this._container, () => radius);
                if (this._shown && this._blurRegion) this._blurRegion.show();
            } else {
                unregisterBmsTarget(this._container);
                if (this._blurRegion) this._blurRegion.hide();
                try {
                    for (const cls of ['transparent-dash', 'light-dash', 'dark-dash']) {
                        this._bubble?.remove_style_class_name?.(cls);
                        this._container?.remove_style_class_name?.(cls);
                        this._blurRegion?.remove_style_class_name?.(cls);
                    }
                } catch { }
            }
        }

        if (this._container?._aquaDockSurface) {
            this._container._aquaDockSurface.update_corner_radius?.();
        }

        this._w = null;   // border/padding shift the metrics
        this._h = null;
        if (this._shown && this._getHoverItem) {
            const item = this._getHoverItem();
            if (item && this._lastGeom) {
                this.position(item, this._lastGeom);
            }
        }
    }

    scheduleShow(item, geom) {
        if (!this._getConfig?.()?.showTooltip) { this.hide(); return; }
        if (!item) { this.hide(); return; }
        if (this._shown) {
            this.cancel();
            this.show(item, geom);
            return;
        }

        // Keep one timer, but always point it at the latest icon. This avoids a
        // stale tooltip when the pointer crosses icons before the delay ends.
        this._pendingItem = item;
        this._pendingGeom = geom;
        if (this._showId) return;
        const delay = this._getConfig?.()?.tooltipDelay ?? 100;
        this._showId = this._timers.addOnce(delay, () => {
            this._showId = 0;
            const nextItem = this._pendingItem;
            const nextGeom = this._pendingGeom;
            this._pendingItem = null;
            this._pendingGeom = null;
            if (nextItem && this._getConfig?.()?.showTooltip &&
                (!this._getHoverItem || this._getHoverItem() === nextItem))
                this.show(nextItem, nextGeom);
        });
    }

    show(item, geom) {
        if (!item || !this._getConfig?.()?.showTooltip) return;
        const labelText = item?.label?.() ?? '';
        if (!labelText || !labelText.trim()) { this.hide(); return; }

        this.cancel();
        this._removeTransitions();

        this._label.text = labelText;
        const ct = this._label?.clutter_text ||
            (typeof this._label?.get_clutter_text === 'function' ? this._label.get_clutter_text() : null);
        if (ct) {
            try {
                ct.set_line_wrap?.(false);
                ct.set_ellipsize?.(0);
                ct.set_x_align?.(2);
            } catch { }
        }

        this._w = null;
        this._h = null;

        if (!this._shown) {
            const parent = this._container.get_parent?.();
            if (parent?.set_child_above_sibling) {
                if (this._blurActive && this._blurRegion) {
                    const bmsGroup = this._container?._aquaDockSurface?.background_group;
                    parent.set_child_above_sibling(this._blurRegion, null);
                    if (bmsGroup && typeof parent.set_child_below_sibling === 'function') {
                        parent.set_child_below_sibling(bmsGroup, this._blurRegion);
                    }
                    parent.set_child_above_sibling(this._container, this._blurRegion);
                } else {
                    parent.set_child_above_sibling(this._container, null);
                }
            }
        }

        this._shown = true;
        this.position(item, geom);

        this._bubble.opacity = 255;
        this._container.opacity = 255;
        this._container.show();
        if (this._blurActive && this._blurRegion) {
            this._blurRegion.opacity = 255;
            this._blurRegion.show();
            if (this._container?._aquaDockSurface?.background_group) {
                this._container._aquaDockSurface.background_group.show?.();
            }
        }
    }

    // Anchor to the icon's live on-screen box (post scale + lift).
    position(item, geom) {
        if (!this._shown || !geom) return;
        try {
            const icon = item?._icon;
            if (!icon) return;
            const [ix, iy] = typeof icon.get_transformed_position === 'function'
                ? icon.get_transformed_position() : [icon.x ?? 0, icon.y ?? 0];
            const [iw, ih] = typeof icon.get_transformed_size === 'function'
                ? icon.get_transformed_size() : [icon.width ?? 48, icon.height ?? 48];
            if (!isFinite(ix) || !isFinite(iy) || iw <= 0 || ih <= 0) {
                this.hide();
                return;
            }

            const mon = this._mon ?? (this._mon = this._getMonitor?.());
            if (!mon) return;

            this._lastGeom = geom;
            const side = geom.side || (geom.vert ? 'left' : 'bottom');
            this._side = side;

            if (this._w == null || this._h == null) {
                const [targetW, targetH] = this._calculateDimensions(mon);
                this._w = targetW;
                this._h = targetH;
            }

            const bw = this._w;
            const bh = this._h;
            if (!bw || !bh) return;

            const gap = 8;
            const cx = ix + iw * 0.5;
            const cy = iy + ih * 0.5;

            let tx, ty;
            if (side === 'bottom') {
                tx = cx - bw * 0.5;
                ty = iy - bh - gap;
            } else if (side === 'top') {
                tx = cx - bw * 0.5;
                ty = iy + ih + gap;
            } else if (side === 'left') {
                tx = ix + iw + gap;
                ty = cy - bh * 0.5;
            } else { // 'right'
                tx = ix - bw - gap;
                ty = cy - bh * 0.5;
            }

            const monR = mon.x + mon.width, monB = mon.y + mon.height;
            tx = Math.max(mon.x + 4, Math.min(tx, monR - bw - 4));
            ty = Math.max(mon.y + 4, Math.min(ty, monB - bh - 4));

            const nx = Math.round(tx), ny = Math.round(ty);

            this._removeTransitions();

            this._bubble.set_size(bw, bh);
            this._bubble.set_position(0, 0);

            this._syncGeometry(this._container, nx, ny, bw, bh);
            if (this._blurRegion) {
                this._syncGeometry(this._blurRegion, nx, ny, bw, bh);
            }

            this._x = nx;
            this._y = ny;

            const surface = this._container._aquaDockSurface;
            if (surface?.background) {
                try { surface.background.remove_all_transitions?.(); } catch { }
                try { surface.background_group?.remove_all_transitions?.(); } catch { }
                if (typeof surface.background.set_position === 'function') {
                    surface.background.set_position(nx, ny);
                } else {
                    surface.background.x = nx;
                    surface.background.y = ny;
                }
                if (typeof surface.background.set_size === 'function') {
                    surface.background.set_size(bw, bh);
                } else {
                    surface.background.width = bw;
                    surface.background.height = bh;
                }
            }

            if (surface) {
                surface.clear_pending_update();
                surface.update_size();
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
        this._removeTransitions();
        this._shown = false;
        this._w = null;
        this._h = null;
        this._x = NaN;
        this._y = NaN;
        try { this._container.hide(); } catch { }
        try { this._blurRegion?.hide(); } catch { }
        if (this._container?._aquaDockSurface?.background_group) {
            try { this._container._aquaDockSurface.background_group.hide(); } catch { }
        }
        this._notifyGeometry(this._container);
        if (this._blurRegion) {
            this._notifyGeometry(this._blurRegion);
        }
        if (this._container?._aquaDockSurface) {
            this._container._aquaDockSurface.clear_pending_update();
            this._container._aquaDockSurface.update_size();
        }
    }

    destroy() {
        this.cancel();
        this._removeTransitions();
        this._shown = false;
        this._signals.disconnectAll();
        if (this._blurActive && this._container) {
            unregisterBmsTarget(this._container);
            this._blurActive = false;
        }
        try {
            for (const cls of ['transparent-dash', 'light-dash', 'dark-dash']) {
                this._bubble?.remove_style_class_name?.(cls);
                this._container?.remove_style_class_name?.(cls);
                this._blurRegion?.remove_style_class_name?.(cls);
            }
        } catch { }
        this._timers.removeAll();
        this._showId = 0;
        this._pendingItem = null;
        this._pendingGeom = null;
        this._lastGeom = null;
        this._x = NaN;
        this._y = NaN;
        this._normalBg = null;
        if (this._blurRegion) {
            try { this._blurRegion.destroy(); } catch { }
            this._blurRegion = null;
        }
        if (this._container) {
            try { this._container.destroy(); } catch { }
            this._container = null;
        }
        this._bubble = null;
        this._label = null;
        this._getConfig = this._getHoverItem = this._getMonitor = null;
    }
}
