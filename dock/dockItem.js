// Visual dock item widget (icon, indicator row, notification badge, and bounce).

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Atk from 'gi://Atk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { animationsEnabled, clamp, appWindowsForConfig } from '../core/utils.js';
import { _, format, ngettext } from '../core/i18n.js';
import { SETTLE_EPS } from '../core/constants.js';
import { Bounce } from '../animation/bounce.js';
import { peakTierThresholds, stableArtworkSourceSize, usePeakTier } from './iconResolution.js';
import { indicatorMetrics, indicatorPosition } from './dockLayout.js';

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

        // While an owned transition runs, setScale() records but does not write
        // the icon transform.
        this._landing = false;
        this._landingScale = null;
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
        this._stableArtwork = entry.kind === 'downloads' || entry.kind === 'folder';
        this._peakSourceSize = this._stableArtwork
            ? stableArtworkSourceSize(cfg.iconSize, cfg.placeIconSourceSize) : cfg.renderSize;
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
            icon_size: this._peakSourceSize,
            reactive: false,
            opacity: this._stableArtwork ? 255 : 0,
        });
        this._peakIcon.set_pivot_point(0, 0);
        const sourceScale = cfg.iconSize / Math.max(1, this._peakSourceSize);
        this._peakIcon.set_scale(sourceScale, sourceScale);
        this._icon.add_child(this._focusPill);
        this._icon.add_child(this._restIcon);
        this._icon.add_child(this._peakIcon);
        this._peakTierThresholds = peakTierThresholds(cfg.zoomMax);
        this._usingPeakTier = this._stableArtwork;
        if (this._stableArtwork) this._restIcon.opacity = 0;
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
        if (this._stableArtwork) return;
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
            case 'location': return this.entry.name ?? _('Location');
            case 'mount': return this.entry.name ?? _('Mounted device');
            case 'trash': return _('Trash');
            default: return this.entry.app?.get_name?.() ?? '';
        }
    }

    // ── Geometry ────────────────────────────────────────────────────────────
    relayout(cfg, containerHeadroom) {
        this._cfg = cfg;
        this._containerHeadroom = containerHeadroom ?? cfg.headroom;
        const previousIndicatorGeometry = this._rIndGeometry;

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
        this._peakSourceSize = this._stableArtwork
            ? stableArtworkSourceSize(restSize, cfg.placeIconSourceSize) : cfg.renderSize;
        this._peakIcon.icon_size = this._peakSourceSize;
        this._restIcon.set_position(0, 0);
        this._peakIcon.set_position(0, 0);
        const sourceScale = restSize / Math.max(1, this._peakSourceSize);
        this._peakIcon.set_scale(sourceScale, sourceScale);
        peakTierThresholds(cfg.zoomMax, this._peakTierThresholds);
        const restGap = Math.round((cfg.dockH - restSize) / 2);
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
        this._iconBaseX = this._restRect.x;
        this._iconBaseY = this._restRect.y;

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
        const lift = this._baseLift();
        this._icon.translation_x = vert ? lift : 0;
        this._icon.translation_y = vert ? 0 : lift;
        this._iconLift = lift;

        const indicatorGeometry = this._indicatorGeometryKey(cfg);
        if (this._rRunning && indicatorGeometry !== previousIndicatorGeometry) {
            this._indicator.destroy_all_children();
            this._indicatorMetrics = null;
            this._buildIndicatorDots(this._rCount);
            this._rIndSize = cfg.indicatorSize;
            this._rStyle = cfg.indicatorStyle;
        } else {
            this._positionIndicator();
        }
        this._rIndGeometry = indicatorGeometry;
        this._positionBadge();
    }

    _positionIndicator() {
        if (!this._cfg || !this._rRunning) return;
        const cfg = this._cfg;
        const metrics = this._indicatorMetrics ?? indicatorMetrics(
            cfg, Math.max(1, this._rCount ?? 1));
        const pos = indicatorPosition(
            cfg, metrics, this._restRect, this._containerHeadroom);
        this._indicator.set_position(pos.x, pos.y);
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
        const lift = this._iconLift ?? 0;
        const ix = this._iconBaseX + (this._vert ? lift : 0);
        const iy = this._iconBaseY + (this._vert ? 0 : lift);
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
    refresh(notifMap, activeWorkspace = undefined) {
        const cfg = this._cfg;
        const app = this.entry.app;
        const windows = app ? appWindowsForConfig(app, cfg, activeWorkspace) : null;
        const windowCount = windows?.length ?? 0;
        const running = cfg.isolateMonitors || cfg.isolateWS
            ? windowCount > 0
            : app?.get_state?.() === Shell.AppState.RUNNING;
        const multiStyle = cfg.indicatorStyle === 'dots' || cfg.indicatorStyle === 'glow-dots';
        const count = running && multiStyle && cfg.showWindowCount
            ? clamp(Math.max(1, windowCount), 1, 4)
            : (running ? 1 : 0);

        // A model-only refresh does not have a notification snapshot. Preserve
        // the last known badge in that case; a tray refresh passes a Map and
        // replaces it. This prevents favourite/app-state changes from briefly
        // clearing otherwise valid badges.
        let notif = cfg.showBadges ? (this._rNotif ?? 0) : 0;
        if (cfg.showBadges && app?.get_id && notifMap) {
            notif = notifMap.get(app.get_id()) ?? 0;
        }
        this._updateAccessibleName(running, windowCount, notif);

        this._rIndGeometry ??= this._indicatorGeometryKey(cfg);
        const indicatorChanged = running !== this._rRunning || count !== this._rCount ||
            cfg.indicatorStyle !== this._rStyle || cfg.indicatorColor !== this._rColor ||
            cfg.showWindowCount !== this._rWinCount || cfg.indicatorSize !== this._rIndSize;
        const badgeChanged = notif !== this._rNotif || cfg.showBadges !== this._rBadges ||
            cfg.badgeColor !== this._rBadgeColor ||
            cfg.badgeTextColor !== this._rBadgeTextColor;
        if (!indicatorChanged && !badgeChanged) return;

        this._rRunning = running; this._rCount = count; this._rNotif = notif;
        this._rStyle = cfg.indicatorStyle; this._rColor = cfg.indicatorColor;
        this._rBadges = cfg.showBadges; this._rBadgeColor = cfg.badgeColor;
        this._rBadgeTextColor = cfg.badgeTextColor;
        this._rWinCount = cfg.showWindowCount;
        this._rIndSize = cfg.indicatorSize;

        if (badgeChanged) {
            if (notif > 0) {
                const newText = notif > 99 ? '99+' : String(notif);
                if (newText !== this._badge.text) {
                    this._badge.text = newText;
                    this._badgeW = null;
                }
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
        }

        if (indicatorChanged) {
            this._indicator.visible = !!running;
            this._indicator.destroy_all_children();
            this._indicatorMetrics = null;
            if (running) this._buildIndicatorDots(count);
        }
    }

    _updateAccessibleName(running, windowCount, notifications) {
        const name = this.label();
        if (!this._cfg.announceItemStatus || this.entry.kind !== 'app') {
            if (this.accessible_name !== name) this.accessible_name = name;
            return;
        }
        const status = [name];
        if (running) {
            status.push(windowCount > 0
                ? format(ngettext('%d open window', '%d open windows', windowCount), windowCount)
                : _('running'));
        }
        if (notifications > 0)
            status.push(format(ngettext('%d notification', '%d notifications', notifications), notifications));
        const accessibleName = status.join(', ');
        if (this.accessible_name !== accessibleName)
            this.accessible_name = accessibleName;
    }

    _buildIndicatorDots(count) {
        const cfg = this._cfg;
        const vert = this._vert;
        const style = cfg.indicatorStyle;
        const metrics = indicatorMetrics(cfg, count);
        const dw = metrics.width;
        const dh = metrics.height;
        const spacing = metrics.spacing;

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
            this._addIndicatorGlow(
                positions, dw, dh, cfg.indicatorColor, metrics.glowPads);

        for (const [x, y] of positions) {
            const dot = new St.Widget({ style_class: dotClass });
            dot.set_size(dw, dh);
            dot.set_style(dotStyle);
            dot.set_position(x, y);
            this._indicator.add_child(dot);
        }
        this._indicatorMetrics = metrics;
        this._indicator.set_size(metrics.indicW, metrics.indicH);
        this._positionIndicator();
    }

    _indicatorGeometryKey(cfg) {
        return [
            cfg.indicatorSize,
            cfg.autoShrinkFactor ?? 1,
            cfg.shrunk === true ? 1 : 0,
            cfg.iconSize,
            cfg.cellW,
            cfg.dockH,
            cfg.indicatorStyle,
            cfg.vertical ? 1 : 0,
        ].join(':');
    }

    _addIndicatorGlow(positions, width, height, color, glowPads) {
        const layers = [
            [glowPads[0] ?? 0, 6],
            [glowPads[1] ?? 0, 12],
            [glowPads[2] ?? 0, 24],
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
        if (this._landing) {
            this._landingScale = scale;
            return;
        }
        this.scaleCurrent = scale;
        if (this._bounce?.active || this._pulsing) return;
        this._syncTextureTier(scale);
        this._icon.set_scale(scale, scale);
        const lift = this._baseLift();
        this._icon[this._liftProp] = lift;
        this._iconLift = lift;
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
        this._iconLift = 0;
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
        this._landingScale = null;
        if (!animationsEnabled()) {
            this._landing = false;
            this._icon.set_scale(restScale, restScale);
            this._icon.opacity = 255;
            this.onAnimationSettled?.();
            return;
        }
        this._icon.set_scale(restScale * 0.4, restScale * 0.4);
        this._icon.opacity = 0;
        this._landing = true;     // first engine tick must leave the ease in control
        this._icon.ease({
            scale_x: restScale, scale_y: restScale, opacity: 255, duration,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onComplete: () => {
                const pending = this._landingScale;
                this._landing = false;
                this._landingScale = null;
                if (pending !== null) this.setScale(pending);
                this.onAnimationSettled?.();
            },
        });
    }

    settleMotion() {
        if (!this._icon || this._dragging) return;
        try { this._icon.remove_all_transitions(); } catch { }
        this._bounce?.cancel();
        this._landing = false;
        this._landingScale = null;
        this._pulsing = false;
        this.vel = 0;
        this.scaleCurrent = this.scaleTarget;
        this._syncTextureTier(this.scaleCurrent, true);
        this._icon.opacity = 255;
        this._icon.set_scale(this.scaleCurrent, this.scaleCurrent);
        const lift = this._baseLift();
        this._icon.translation_x = this._vert ? lift : 0;
        this._icon.translation_y = this._vert ? 0 : lift;
        this._iconLift = lift;
        if (this._badge?.visible) this._positionBadge();
        this.onAnimationSettled?.();
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
        const lift = this._baseLift() + this._liftSign * (heightPx || 0);
        this._icon[this._liftProp] = lift;
        this._iconLift = lift;
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
