// AquaDockPro — a single dock item: icon + running indicator + badge + bounce.
//
// Purpose:   The visual unit on the dock. Owns one St.Icon (rendered at peak
//            magnified size and scaled DOWN only — no per-frame re-rasterise),
//            a running-indicator row, and a notification badge. Exposes the
//            magnification state (scaleTarget/scaleCurrent/vel) the AnimationEngine
//            integrates, and delegates bounce physics to the Bounce engine.
// Ownership: OWNS its child actors (auto-destroyed with the widget) and one
//            Bounce instance, cancelled via the `destroy` SIGNAL (Clutter tears
//            children down in C and never calls an overridden JS destroy()).
// Cleanup:   `destroy` signal → bounce.destroy(). No timers/signals otherwise.
// Caching:   All per-frame constants (lift prop/sign, inverse-zoom, pivots) are
//            cached in relayout(); the hot path does zero string compares.
// Cost:      setScale: 1 set_scale + 1 translation write. Indicator/badge rebuild
//            only when their inputs actually change (diffed in refresh()).

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { clamp, appWindows } from '../core/utils.js';
import { DOT_SIZE, SETTLE_EPS } from '../core/constants.js';
import { Bounce } from '../animation/bounce.js';

export const DockItem = GObject.registerClass(
class DockItem extends St.Widget {
    _init(entry, cfg) {
        super._init({
            style_class: 'aqua-item',
            reactive: false,
            x_expand: false,
            y_expand: false,
            layout_manager: new Clutter.FixedLayout(),
        });
        this.entry = entry;
        this._cfg = cfg;

        // Magnification state, integrated by the AnimationEngine.
        this.scaleTarget = 1;
        this.scaleCurrent = 1;
        this.vel = 0;

        // Lifecycle flags: while any is set, setScale() records but does not
        // write the icon transform, so the owning animation keeps full control.
        this._landing = false;
        this._pulsing = false;

        // Optional hooks set by the controller (kept null when unused so the
        // hot path stays free).
        this.onComposed = null;     // () => void, after each bounce/pulse frame
        this.onBounceSettled = null;// () => void, when a bounce comes to rest

        this._icon = new St.Icon({ gicon: entry.gicon, icon_size: cfg.renderSize });
        this._icon.set_pivot_point(0.5, 1.0);
        this.add_child(this._icon);

        this._indicator = new St.Widget({
            style_class: 'aqua-indic-row',
            layout_manager: new Clutter.FixedLayout(),
        });
        this.add_child(this._indicator);

        this._badge = new St.Label({ style_class: 'aqua-badge', visible: false });
        this.add_child(this._badge);

        this._bounce = new Bounce(
            this._icon,
            (h, sx, sy) => this._composeBounce(h, sx, sy),
            () => this.onBounceSettled?.(),
        );

        this.refresh();
        this.connect('destroy', () => this._bounce?.destroy());
    }

    label() {
        switch (this.entry.kind) {
            case 'apps': return 'Applications';
            case 'downloads': return 'Downloads';
            case 'trash': return 'Trash';
            default: return this.entry.app?.get_name?.() ?? '';
        }
    }

    // ── Geometry ────────────────────────────────────────────────────────────
    relayout(cfg, containerHeadroom) {
        this._cfg = cfg;
        this._containerHeadroom = containerHeadroom ?? cfg.headroom;
        this._refreshForce = true;

        // Cache position flags to avoid string comparisons in per-frame paths.
        const vert = cfg.vertical;
        this._vert = vert;
        this._isRight = cfg.position === 'right';

        const mainLen = cfg.cellW;
        const crossLen = this._containerHeadroom + cfg.dockH;
        if (vert) this.set_size(crossLen, mainLen);
        else this.set_size(mainLen, crossLen);

        this._icon.icon_size = cfg.renderSize;
        const restSize = cfg.iconSize;
        const restGap = Math.round((cfg.dockH - restSize) / 2);
        this._restGap = restGap;

        if (!vert) {
            const iconBottomY = this._containerHeadroom + cfg.dockH - restGap;
            this._icon.set_pivot_point(0.5, 1.0);
            this._icon.set_position(
                Math.round((mainLen - cfg.renderSize) / 2),
                iconBottomY - cfg.renderSize);
            this._restRect = {
                x: Math.round((mainLen - restSize) / 2),
                y: iconBottomY - restSize, w: restSize, h: restSize,
            };
        } else if (cfg.position === 'left') {
            const iconLeftX = restGap;
            this._icon.set_pivot_point(0.0, 0.5);
            this._icon.set_position(iconLeftX, Math.round((mainLen - cfg.renderSize) / 2));
            this._restRect = {
                x: iconLeftX, y: Math.round((mainLen - restSize) / 2),
                w: restSize, h: restSize,
            };
        } else {
            const iconRightX = this._containerHeadroom + cfg.dockH - restGap;
            this._icon.set_pivot_point(1.0, 0.5);
            this._icon.set_position(
                iconRightX - cfg.renderSize, Math.round((mainLen - cfg.renderSize) / 2));
            this._restRect = {
                x: iconRightX - restSize, y: Math.round((mainLen - restSize) / 2),
                w: restSize, h: restSize,
            };
        }

        // Per-frame constants — recomputed only here.
        this._liftProp = vert ? 'translation_x' : 'translation_y';
        this._liftSign = vert ? (cfg.position === 'left' ? 1 : -1) : -1;
        this._invZoom = cfg.invZoom;
        this._liftDenom = cfg.liftDenom;
        if (vert) {
            this._pivotY = 0.5;
            this._pivotX = cfg.position === 'left' ? 0.0 : 1.0;
        } else {
            this._pivotX = 0.5;
            this._pivotY = 1.0;
        }

        // Pre-cached for _positionBadge (avoids repeated multiplication).
        this._renderSize = cfg.renderSize;

        // Preserve current magnification lift through relayout (no 1-frame drop).
        const visualScale = this.scaleCurrent * this._invZoom;
        this._icon.set_scale(visualScale, visualScale);
        this._icon.translation_x = vert ? this._baseLift() : 0;
        this._icon.translation_y = vert ? 0 : this._baseLift();

        this._positionIndicator();
        this._positionBadge();
    }

    _positionIndicator() {
        if (!this._cfg) return;
        const cfg = this._cfg;
        const iw = this._indicW || DOT_SIZE;
        const ih = this._indicH || DOT_SIZE;
        const GAP = 4;
        const restGap = this._restGap;
        const rest = this._restRect;
        const cx = rest ? rest.x + rest.w / 2 : cfg.cellW / 2;
        const cy = rest ? rest.y + rest.h / 2 : cfg.cellW / 2;
        if (!this._vert) {
            const iconBottom = this._containerHeadroom + cfg.dockH - restGap;
            this._indicator.set_position(Math.round(cx - iw / 2), Math.round(iconBottom + GAP));
        } else if (!this._isRight) {
            this._indicator.set_position(Math.max(2, restGap - GAP - iw), Math.round(cy - ih / 2));
        } else {
            const iconRight = this._containerHeadroom + cfg.dockH - restGap;
            this._indicator.set_position(Math.round(iconRight + GAP), Math.round(cy - ih / 2));
        }
    }

    _positionBadge() {
        if (!this._badge || !this._badge.visible || !this._cfg) return;
        if (this._badgeW == null) {
            const [, w] = this._badge.get_preferred_width(-1);
            const [, h] = this._badge.get_preferred_height(-1);
            this._badgeW = w;
            this._badgeH = h;
        }
        const bw = this._badgeW, bh = this._badgeH;
        const renderSize = this._renderSize;
        const s = this.scaleCurrent * this._invZoom;
        const drawn = renderSize * s;
        const ix = this._icon.x + (this._icon.translation_x || 0);
        const iy = this._icon.y + (this._icon.translation_y || 0);
        const drawnX = ix + renderSize * this._pivotX * (1 - s);
        const drawnY = iy + renderSize * this._pivotY * (1 - s);
        const cornerX = (this._vert && this._isRight) ? drawnX : drawnX + drawn;
        const bx = Math.round(cornerX - bw * 0.6);
        const by = Math.round(drawnY - bh * 0.4);
        if (bx !== this._badgePX || by !== this._badgePY) {
            this._badge.set_position(bx, by);
            this._badgePX = bx;
            this._badgePY = by;
        }
    }

    // ── Running indicator + badge ───────────────────────────────────────────
    // notifMap: optional Map<appId, count> for O(1) lookup (built once per
    // refresh batch by the controller). Falls back to per-item lookup.
    refresh(notifMap) {
        const cfg = this._cfg;
        const app = this.entry.app;
        const running = app?.get_state?.() === Shell.AppState.RUNNING;
        const multiStyle = cfg.indicatorStyle === 'dots' || cfg.indicatorStyle === 'glow-dots';
        const count = running && multiStyle && cfg.showWindowCount
            ? clamp(Math.max(1, appWindows(app).length), 1, 4)
            : (running ? 1 : 0);

        let notif = 0;
        if (cfg.showBadges && app?.get_id && notifMap) {
            notif = notifMap.get(app.get_id()) ?? 0;
        }

        // Skip rebuild when nothing visible changed (runs for every item on
        // every window map/minimize/destroy/tray change).
        if (!this._refreshForce &&
            running === this._rRunning && count === this._rCount && notif === this._rNotif &&
            cfg.indicatorStyle === this._rStyle && cfg.indicatorColor === this._rColor &&
            cfg.showBadges === this._rBadges && cfg.badgeColor === this._rBadgeColor &&
            cfg.badgeTextColor === this._rBadgeTextColor &&
            cfg.showWindowCount === this._rWinCount &&
            cfg.indicatorSize === this._rIndSize)
            return;
        this._refreshForce = false;
        this._rRunning = running; this._rCount = count; this._rNotif = notif;
        this._rStyle = cfg.indicatorStyle; this._rColor = cfg.indicatorColor;
        this._rBadges = cfg.showBadges; this._rBadgeColor = cfg.badgeColor;
        this._rBadgeTextColor = cfg.badgeTextColor;
        this._rWinCount = cfg.showWindowCount;
        this._rIndSize = cfg.indicatorSize;

        this._indicator.visible = !!running;
        this._indicator.destroy_all_children();

        if (notif > 0) {
            this._badge.text = notif > 99 ? '99+' : String(notif);
            this._badgeW = null;
            // Apply configurable badge colours via inline style override.
            const bc = cfg.badgeColor;
            const btc = cfg.badgeTextColor;
            let style = '';
            if (bc) style += `background-color: ${bc};`;
            if (btc) style += ` color: ${btc};`;
            this._badge.set_style(style);
            this._badge.visible = true;
            this._positionBadge();
        } else {
            this._badge.visible = false;
        }
        if (!running) return;

        this._buildIndicatorDots(count);
    }

    _buildIndicatorDots(count) {
        const cfg = this._cfg;
        const vert = this._vert;
        const style = cfg.indicatorStyle;
        const sz = cfg.indicatorSize ?? DOT_SIZE;
        const ratio = sz / DOT_SIZE;
        const spacing = (style === 'dots' || style === 'glow-dots') ? 4 : 0;
        let dw = sz, dh = sz;
        if (style === 'line') [dw, dh] = [Math.round(24 * ratio), Math.max(2, Math.round(3 * ratio))];
        else if (style === 'pill') [dw, dh] = [Math.round(18 * ratio), Math.max(2, Math.round(4 * ratio))];
        else if (style === 'glow') [dw, dh] = [Math.round(28 * ratio), Math.max(3, Math.round(6 * ratio))];
        if (vert && style !== 'dots' && style !== 'glow-dots') [dw, dh] = [dh, dw];

        const step = (vert ? dh : dw) + spacing;
        const dotClass = `aqua-dot aqua-indic-${style}`;
        const dotStyle = `background-color: ${cfg.indicatorColor};`;
        for (let i = 0; i < count; i++) {
            const dot = new St.Widget({ style_class: dotClass });
            dot.set_size(dw, dh);
            dot.set_style(dotStyle);
            if (vert) dot.set_position(0, i * step);
            else dot.set_position(i * step, 0);
            this._indicator.add_child(dot);
        }
        const run = count * (vert ? dh : dw) + Math.max(0, count - 1) * spacing;
        this._indicW = vert ? dw : run;
        this._indicH = vert ? run : dh;
        this._indicator.set_size(this._indicW, this._indicH);
        this._positionIndicator();
    }

    // ── Magnification visual ────────────────────────────────────────────────
    setScale(scale) {
        if (this._landing) return;
        this.scaleCurrent = scale;
        if (this._bounce?.active || this._pulsing) return;
        const visualScale = scale * this._invZoom;
        this._icon.set_scale(visualScale, visualScale);
        if (!this._icon.get_transition(this._liftProp))
            this._icon[this._liftProp] = this._baseLift();
        if (this._badge?.visible) this._positionBadge();
    }

    _baseLift() {
        const lift = this._cfg.hoverLift * ((this.scaleCurrent - 1) * this._liftDenom);
        return this._liftSign * Math.max(0, lift);
    }

    isSettled() {
        return Math.abs(this.scaleTarget - this.scaleCurrent) < SETTLE_EPS &&
            Math.abs(this.vel) < SETTLE_EPS;
    }

    // ── Transitions ─────────────────────────────────────────────────────────
    easeToRest(duration = 200) {
        if (!this._icon || this._bounce?.active || this._pulsing || this._landing) return;
        const restScale = this._invZoom;
        this._icon.remove_all_transitions();
        this._icon.translation_x = 0;
        this._icon.translation_y = 0;
        this._icon.ease({
            scale_x: restScale, scale_y: restScale,
            [this._liftProp]: 0, duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    landIn(duration = 280) {
        if (!this._icon) return;
        const restScale = this._invZoom;
        this._icon.remove_all_transitions();
        this._icon.set_scale(restScale * 0.4, restScale * 0.4);
        this._icon.opacity = 0;
        this._landing = true;     // set before ease so the first tick skips setScale
        this._icon.ease({
            scale_x: restScale, scale_y: restScale, opacity: 255, duration,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onComplete: () => { this._landing = false; },
        });
    }

    // ── Bounce + pulse ──────────────────────────────────────────────────────
    bounce(height = 24, opts = {}) {
        if (height <= 0 || !this._icon) return;
        // Clear in-flight eases so the bounce is the sole transform driver.
        this._icon.remove_all_transitions();
        this._pulsing = false;
        this._bounce.start(height, opts);
    }

    stopBounce() { this._bounce?.stopLaunch(); }

    cancelBounce() { this._bounce?.cancel(); }

    _composeBounce(heightPx, sx, sy) {
        if (!this._icon) return;
        const magScale = this.scaleCurrent * this._invZoom;
        this._icon.set_scale(magScale * sx, magScale * sy);
        this._icon[this._liftProp] = this._baseLift() + this._liftSign * (heightPx || 0);
        if (this._badge?.visible) this._positionBadge();
        this.onComposed?.();
    }

    // Quick scale pulse (folder "expand" on file arrival): grows past the
    // magnified size and back, composing over magnification. setScale becomes
    // record-only for the pulse's lifetime so the mag loop can't fight the ease.
    pulseScale(factor = 1.18, onDone = null) {
        if (!this._icon) { onDone?.(); return; }
        const base = this.scaleCurrent * this._invZoom;
        this._icon.remove_all_transitions();
        this._pulsing = true;
        this._icon.ease({
            scale_x: base * factor, scale_y: base * factor, duration: 130,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                const b = this.scaleCurrent * this._invZoom;
                this._icon.ease({
                    scale_x: b, scale_y: b, duration: 120,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                    onComplete: () => { this._pulsing = false; onDone?.(); },
                });
            },
        });
    }
});
