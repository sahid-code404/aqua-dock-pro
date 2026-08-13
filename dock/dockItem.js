// Visual dock item widget (icon, indicator row, notification badge, and bounce).

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Atk from 'gi://Atk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { animationsEnabled, clamp, appWindowsForConfig } from '../core/utils.js';
import { _ } from '../core/i18n.js';
import { DOT_SIZE, SETTLE_EPS } from '../core/constants.js';
import { Bounce } from '../animation/bounce.js';
import { peakTierThresholds, usePeakTier } from './iconResolution.js';

export const DockItem = GObject.registerClass({
    GTypeName: 'AquaDockProDockItem',
},
class DockItem extends St.Widget {
    _init(entry, cfg) {
        super._init({
            style_class: 'aqua-item',
            reactive: true,
            can_focus: true,
            accessible_role: Atk.Role.PUSH_BUTTON,
            x_expand: false,
            y_expand: false,
            layout_manager: new Clutter.FixedLayout(),
        });
        this.entry = entry;
        this.accessible_name = this.label();
        this._cfg = cfg;
        // refresh() runs once before the controller's first relayout, so seed
        // orientation from the complete settings snapshot for that first build.
        this._vert = cfg.vertical;
        this._isRight = cfg.position === 'right';

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
        this.onComposed = null;          // () => void, after each bounce/pulse frame
        this.onAnimationSettled = null;  // () => void, when an owned transform ends

        // Scaling one peak-size texture down at rest softens it, while scaling a
        // rest-size texture up softens the magnified state. Keep both native
        // resolutions and transform their shared wrapper. Only the closer tier
        // is painted; Shell's normal icon filtering and HiDPI resource scale are
        // left untouched.
        this._gicon = entry.gicon;
        this._icon = new St.Widget({
            style_class: 'aqua-icon-stack',
            reactive: false,
            layout_manager: new Clutter.FixedLayout(),
            clip_to_allocation: false,
        });
        this._icon.set_pivot_point(0.5, 1.0);
        this._focusPill = new St.Widget({
            style_class: 'aqua-focus-pill',
            reactive: false,
            visible: false,
        });
        this._restIcon = new St.Icon({
            gicon: this._gicon,
            icon_size: cfg.iconSize,
            reactive: false,
        });
        this._peakIcon = new St.Icon({
            gicon: this._gicon,
            icon_size: cfg.renderSize,
            reactive: false,
            opacity: 0,
        });
        this._peakIcon.set_pivot_point(0, 0);
        this._peakIcon.set_scale(cfg.invZoom, cfg.invZoom);
        this._icon.add_child(this._focusPill);
        this._icon.add_child(this._restIcon);
        this._icon.add_child(this._peakIcon);
        this._peakTierThresholds = peakTierThresholds(cfg.zoomMax);
        this._usingPeakTier = false;
        this.add_child(this._icon);

        this._indicator = new St.Widget({
            style_class: 'aqua-indic-row',
            layout_manager: new Clutter.FixedLayout(),
        });
        // Halo children deliberately extend beyond the core indicator box.
        this._indicator.set_clip_to_allocation(false);
        this.add_child(this._indicator);

        this._badge = new St.Label({ style_class: 'aqua-badge', visible: false });
        this.add_child(this._badge);

        this._bounce = new Bounce(
            this._icon,
            (h, sx, sy) => this._composeBounce(h, sx, sy),
            () => this.onAnimationSettled?.(),
        );

        this.connect('key-focus-in', () => this._focusPill?.show());
        this.connect('key-focus-out', () => this._focusPill?.hide());
        this.refresh();
        this.connect('destroy', () => {
            this._bounce?.destroy();
            this._bounce = null;
            this.onComposed = null;
            this.onAnimationSettled = null;
        });
    }

    get gicon() { return this._gicon; }

    setGicon(gicon) {
        this._gicon = gicon;
        if (this._restIcon) this._restIcon.gicon = gicon;
        if (this._peakIcon) this._peakIcon.gicon = gicon;
    }

    _syncTextureTier(scale, force = false) {
        const peak = usePeakTier(
            scale, this._peakTierThresholds, this._usingPeakTier, force);
        if (peak === this._usingPeakTier) return;
        this._usingPeakTier = peak;
        this._restIcon.opacity = peak ? 0 : 255;
        this._peakIcon.opacity = peak ? 255 : 0;
    }

    label() {
        switch (this.entry.kind) {
            case 'apps': return _('Applications');
            case 'downloads': return _('Downloads');
            case 'folder': return this.entry.name ?? _('Folder');
            case 'mount': return this.entry.name ?? _('Mounted device');
            case 'trash': return _('Trash');
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

        const restSize = cfg.iconSize;
        this._icon.set_size(restSize, restSize);
        const mainPad = Math.max(5, Math.round(restSize * 0.11));
        const crossPad = Math.max(3, Math.round(restSize * 0.07));
        const pillX = vert ? -crossPad : -mainPad;
        const pillY = vert ? -mainPad : -crossPad;
        this._focusPill.set_position(pillX, pillY);
        this._focusPill.set_size(
            restSize - pillX * 2,
            restSize - pillY * 2);
        this._restIcon.icon_size = restSize;
        this._peakIcon.icon_size = cfg.renderSize;
        this._restIcon.set_position(0, 0);
        this._peakIcon.set_position(0, 0);
        this._peakIcon.set_scale(cfg.invZoom, cfg.invZoom);
        peakTierThresholds(cfg.zoomMax, this._peakTierThresholds);
        const restGap = Math.round((cfg.dockH - restSize) / 2);
        this._restGap = restGap;

        if (!vert) {
            const iconBottomY = this._containerHeadroom + cfg.dockH - restGap;
            this._icon.set_pivot_point(0.5, 1.0);
            this._icon.set_position(
                Math.round((mainLen - restSize) / 2),
                iconBottomY - restSize);
            this._restRect = {
                x: Math.round((mainLen - restSize) / 2),
                y: iconBottomY - restSize, w: restSize, h: restSize,
            };
        } else if (cfg.position === 'left') {
            const iconLeftX = restGap;
            this._icon.set_pivot_point(0.0, 0.5);
            this._icon.set_position(iconLeftX, Math.round((mainLen - restSize) / 2));
            this._restRect = {
                x: iconLeftX, y: Math.round((mainLen - restSize) / 2),
                w: restSize, h: restSize,
            };
        } else {
            const iconRightX = this._containerHeadroom + cfg.dockH - restGap;
            this._icon.set_pivot_point(1.0, 0.5);
            this._icon.set_position(
                iconRightX - restSize, Math.round((mainLen - restSize) / 2));
            this._restRect = {
                x: iconRightX - restSize, y: Math.round((mainLen - restSize) / 2),
                w: restSize, h: restSize,
            };
        }

        // Per-frame constants — recomputed only here.
        this._liftProp = vert ? 'translation_x' : 'translation_y';
        this._liftSign = vert ? (cfg.position === 'left' ? 1 : -1) : -1;
        this._liftDenom = cfg.liftDenom;
        if (vert) {
            this._pivotY = 0.5;
            this._pivotX = cfg.position === 'left' ? 0.0 : 1.0;
        } else {
            this._pivotX = 0.5;
            this._pivotY = 1.0;
        }

        // Pre-cached for _positionBadge (avoids repeated property reads).
        this._baseIconSize = restSize;

        // Preserve current magnification lift through relayout (no 1-frame drop).
        this._icon.set_scale(this.scaleCurrent, this.scaleCurrent);
        this._syncTextureTier(this.scaleCurrent, true);
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
        const baseSize = this._baseIconSize;
        const s = this.scaleCurrent;
        const drawn = baseSize * s;
        const ix = this._icon.x + (this._icon.translation_x || 0);
        const iy = this._icon.y + (this._icon.translation_y || 0);
        const drawnX = ix + baseSize * this._pivotX * (1 - s);
        const drawnY = iy + baseSize * this._pivotY * (1 - s);
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
        this.accessible_name = this.label();
        const app = this.entry.app;
        const windows = app ? appWindowsForConfig(app, cfg) : [];
        const running = cfg.isolateMonitors || cfg.isolateWS
            ? windows.length > 0
            : app?.get_state?.() === Shell.AppState.RUNNING;
        const multiStyle = cfg.indicatorStyle === 'dots' || cfg.indicatorStyle === 'glow-dots';
        const count = running && multiStyle && cfg.showWindowCount
            ? clamp(Math.max(1, windows.length), 1, 4)
            : (running ? 1 : 0);

        // A model-only refresh does not have a notification snapshot. Preserve
        // the last known badge in that case; a tray refresh passes a Map and
        // replaces it. This prevents favourite/app-state changes from briefly
        // clearing otherwise valid badges.
        let notif = cfg.showBadges ? (this._rNotif ?? 0) : 0;
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
            const newText = notif > 99 ? '99+' : String(notif);
            if (newText !== this._badge.text) {
                this._badge.text = newText;
                this._badgeW = null; // invalidate layout cache only when text changes
            }
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
        const positions = [];
        for (let i = 0; i < count; i++) {
            positions.push(vert ? [0, i * step] : [i * step, 0]);
        }

        // Shell's CSS shadows are unreliable on moving dock actors. A few faint,
        // static layers provide a soft falloff without involving Mutter's shadow
        // renderer or doing any work during magnification.
        if (style === 'glow' || style === 'glow-dots')
            this._addIndicatorGlow(positions, dw, dh, cfg.indicatorColor, style);

        for (const [x, y] of positions) {
            const dot = new St.Widget({ style_class: dotClass });
            dot.set_size(dw, dh);
            dot.set_style(dotStyle);
            dot.set_position(x, y);
            this._indicator.add_child(dot);
        }
        const run = count * (vert ? dh : dw) + Math.max(0, count - 1) * spacing;
        this._indicW = vert ? dw : run;
        this._indicH = vert ? run : dh;
        this._indicator.set_size(this._indicW, this._indicH);
        this._positionIndicator();
    }

    _addIndicatorGlow(positions, width, height, color, style) {
        const shortEdge = Math.min(width, height);
        const dotGlow = style === 'glow-dots';
        const outerPad = dotGlow
            ? Math.min(6, Math.max(3, Math.round(shortEdge * 0.55)))
            : Math.min(7, Math.max(4, Math.round(shortEdge * 0.65)));
        const middlePad = Math.max(2, Math.round(outerPad * 0.6));
        const innerPad = Math.max(1, Math.round(outerPad * 0.3));
        const layers = [
            [outerPad, 6],
            [middlePad, 12],
            [innerPad, 24],
        ];

        // Add every halo before the solid indicators so overlapping glows can
        // blend naturally without tinting a neighbouring dot's core.
        for (const [padding, opacity] of layers) {
            const haloW = width + padding * 2;
            const haloH = height + padding * 2;
            const radius = Math.ceil(Math.min(haloW, haloH) / 2);
            const haloStyle =
                `background-color: ${color}; border-radius: ${radius}px;`;
            for (const [x, y] of positions) {
                const halo = new St.Widget({ reactive: false, opacity });
                halo.set_size(haloW, haloH);
                halo.set_position(x - padding, y - padding);
                halo.set_style(haloStyle);
                this._indicator.add_child(halo);
            }
        }
    }

    // ── Magnification visual ────────────────────────────────────────────────
    setScale(scale) {
        if (this._landing) return;
        this.scaleCurrent = scale;
        if (this._bounce?.active || this._pulsing) return;
        this._syncTextureTier(scale);
        this._icon.set_scale(scale, scale);
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
        const restScale = 1;
        this._icon.remove_all_transitions();
        this._icon.translation_x = 0;
        this._icon.translation_y = 0;
        if (!animationsEnabled()) {
            this._syncTextureTier(1, true);
            this._icon.set_scale(restScale, restScale);
            return;
        }
        this._icon.ease({
            scale_x: restScale, scale_y: restScale,
            [this._liftProp]: 0, duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._syncTextureTier(1, true),
        });
    }

    landIn(duration = 280) {
        if (!this._icon) return;
        const restScale = 1;
        this._icon.remove_all_transitions();
        this._syncTextureTier(1, true);
        if (!animationsEnabled()) {
            this._landing = false;
            this._icon.set_scale(restScale, restScale);
            this._icon.opacity = 255;
            this.onAnimationSettled?.();
            return;
        }
        this._icon.set_scale(restScale * 0.4, restScale * 0.4);
        this._icon.opacity = 0;
        this._landing = true;     // set before ease so the first tick skips setScale
        this._icon.ease({
            scale_x: restScale, scale_y: restScale, opacity: 255, duration,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onComplete: () => {
                this._landing = false;
                this.onAnimationSettled?.();
            },
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
        const magScale = this.scaleCurrent;
        this._syncTextureTier(this.scaleCurrent);
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
        const base = this.scaleCurrent;
        this._icon.remove_all_transitions();
        if (!animationsEnabled()) {
            this._pulsing = false;
            this._icon.set_scale(base, base);
            onDone?.();
            return;
        }
        this._pulsing = true;
        this._icon.ease({
            scale_x: base * factor, scale_y: base * factor, duration: 130,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                const b = this.scaleCurrent;
                this._icon.ease({
                    scale_x: b, scale_y: b, duration: 120,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                    onComplete: () => { this._pulsing = false; onDone?.(); },
                });
            },
        });
    }
});
