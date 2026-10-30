// Dock chrome actor hierarchy and GNOME Shell stage registration.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { animationsEnabled, clamp } from '../core/utils.js';
import { overviewDash } from '../compat/shell.js';
import { pillStyle } from './dockLayout.js';

export class DockChrome {
    constructor() {
        this._container = null;
        this._blurRegion = null;
        this._bg = null;
        this._magZone = null;
        this._strip = null;
        this._handleBlurRegion = null;
        this._autohideHandle = null;
        this._edgeZone = null;
        this._strut = null;
        this._handleVisible = false;
        this._bgStyleCache = null;
        this._handleClipCache = null;
        this._dash = null;
        this._dashWasVisible = true;
        this._dashOpacity = 255;
        this._dashReactive = true;
        this._dashCfg = null;
        this._dashNotifyIds = null;

        try {
            this._container = new St.Widget({
                name: 'aquaDockContainer',
                reactive: true,
                track_hover: true,
                layout_manager: new Clutter.FixedLayout(),
            });
            this._container.set_clip_to_allocation(false);
            this._container._isAquaDock = true;

            this._blurRegion = new St.Widget({
                name: 'aqua-dock-blur-region',
                style_class: 'aqua-blur-region',
                reactive: false,
            });
            this._container.add_child(this._blurRegion);

            this._bg = new St.Widget({ style_class: 'aqua-bg' });
            this._container.add_child(this._bg);

            this._container._dockBg = this._bg;
            this._container._dockBlurRegion = this._blurRegion;
            this._container._dockContent = this._container;
            this._container._dockContentParent = this._container;
            this._container._dockBlurEnabled = true;
            this._container._dockRadius = 28;
            this._bg._dockRadius = 28;
            this._bg.get_dock_radius = () => this._bg._dockRadius;

            // Dynamic invisible zone covering magnified icon overflow above the
            // pill. Zero-sized at rest, so clicks pass through to the desktop.
            this._magZone = new St.Widget({ reactive: true, opacity: 0 });
            Main.layoutManager.addChrome(this._magZone, {
                affectsStruts: false,
                trackFullscreen: true,
            });

            // Thin reactive strip at the very screen edge — the autohide reveal
            // trigger. Fullscreen tracking also removes it from the input region,
            // so it cannot sit on top of a fullscreen application's controls.
            this._strip = new St.Widget({ reactive: true, opacity: 0 });
            Main.layoutManager.addChrome(this._strip, {
                affectsStruts: false,
                trackFullscreen: true,
            });

            // Blur region behind autohide handle
            this._handleBlurRegion = new St.Widget({
                name: 'aqua-autohide-blur-region',
                style_class: 'aqua-blur-region',
                reactive: false,
                visible: false,
                opacity: 0,
            });
            Main.layoutManager.addChrome(this._handleBlurRegion, {
                affectsStruts: false,
                trackFullscreen: true,
            });

            // A clipped copy of the pill's screen-facing border remains visible
            // while the real container is offscreen. The full-edge invisible strip
            // still owns reveal input, so this visual never steals application
            // clicks.
            this._autohideHandle = new St.Widget({
                style_class: 'aqua-autohide-handle',
                reactive: false,
                visible: false,
                opacity: 0,
            });
            Main.layoutManager.addChrome(this._autohideHandle, {
                affectsStruts: false,
                trackFullscreen: true,
            });

            // Invisible reactive zone filling the edge-margin gap between the pill
            // and the screen edge, so hovering the gap keeps the dock revealed.
            this._edgeZone = new St.Widget({ reactive: true, opacity: 0 });
            Main.layoutManager.addChrome(this._edgeZone, {
                affectsStruts: false,
                trackFullscreen: true,
            });

            // Strut reserves screen space so maximized windows clear the dock.
            this._strut = new St.Widget({ reactive: false, opacity: 0 });
            Main.layoutManager.addChrome(this._strut, {
                affectsStruts: true,
                trackFullscreen: true,
            });

            Main.layoutManager.addChrome(this._container, {
                affectsStruts: false,
                trackFullscreen: false,
            });
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    get container() { return this._container; }
    get bg() { return this._bg; }
    get blurRegion() { return this._blurRegion; }
    get magZone() { return this._magZone; }
    get strip() { return this._strip; }
    get autohideHandle() { return this._autohideHandle; }
    get handleBlurRegion() { return this._handleBlurRegion; }
    get edgeZone() { return this._edgeZone; }
    get strut() { return this._strut; }

    raiseAboveOverview() {
        const parent = this._container?.get_parent();
        if (parent) parent.set_child_above_sibling(this._container, null);
    }

    _applyRect(actor, x, y, width, height) {
        if (!actor) return;
        if (actor.x !== x || actor.y !== y) actor.set_position(x, y);
        if (actor.width !== width || actor.height !== height) actor.set_size(width, height);
    }

    applyContainer(geom, hidden) {
        this._applyRect(
            this._container,
            hidden ? geom.hiddenX : geom.x,
            hidden ? geom.hiddenY : geom.y,
            geom.width,
            geom.height);
    }

    // Seed the pill rect; the engine takes over per-frame via setPill().
    applyPill(geom) {
        this._applyRect(this._bg, geom.bg.x, geom.bg.y, geom.bg.w, geom.bg.h);
        if (this._blurRegion)
            this._applyRect(this._blurRegion, geom.bg.x, geom.bg.y, geom.bg.w, geom.bg.h);
        if (this._bg.opacity !== 255) this._bg.opacity = 255;
    }

    applyPillStyle(style, cfg = null) {
        if (cfg) {
            this._container._dockBlurEnabled = (cfg.blurEffect !== false);
            const radius = cfg.dockRadius ?? 28;
            this._container._dockRadius = radius;
            this._bg._dockRadius = radius;
            this._bg.get_dock_radius = () => this._bg._dockRadius;
            this._autohideHandle._dockRadius = radius;
            if (this._blurRegion) {
                this._blurRegion._dockRadius = radius;
                this._blurRegion.set_style(`border-radius: ${radius}px;`);
            }
            if (this._handleBlurRegion) {
                this._handleBlurRegion._dockRadius = radius;
                this._handleBlurRegion.set_style(`border-radius: ${radius}px;`);
            }
        }
        if (style !== this._bgStyleCache) {
            this._bg.set_style(style);
            const handleStyle = cfg ? pillStyle(cfg, false) : style;
            this._autohideHandle.set_style(handleStyle);
            this._bgStyleCache = style;
        }
    }

    applyAccessibility(cfg) {
        for (const actor of [this._container, this._autohideHandle]) {
            if (!actor) continue;
            if (cfg.highContrast) actor.add_style_class_name('aqua-high-contrast');
            else actor.remove_style_class_name('aqua-high-contrast');
        }
    }

    applyStrut(strut) {
        if (!strut) {
            if (this._strut.width !== 0 || this._strut.height !== 0)
                this._strut.set_size(0, 0);
            return;
        }
        this._applyRect(this._strut, strut.x, strut.y, strut.w, strut.h);
    }

    applyStrip(strip) {
        this._applyRect(this._strip, strip.x, strip.y, strip.w, strip.h);
    }

    applyAutohideHandle(handle) {
        if (!handle) {
            if (this._autohideHandle.width !== 0 || this._autohideHandle.height !== 0)
                this._autohideHandle.set_size(0, 0);
            if (this._handleBlurRegion && (this._handleBlurRegion.width !== 0 || this._handleBlurRegion.height !== 0))
                this._handleBlurRegion.set_size(0, 0);
            if (this._handleClipCache !== null) {
                try { this._autohideHandle.remove_clip(); } catch { /* intentionally ignored: autohide handle or blur region may already be unclipped or destroyed */ }
                try { this._handleBlurRegion?.remove_clip(); } catch { /* intentionally ignored: autohide handle or blur region may already be unclipped or destroyed */ }
                this._handleClipCache = null;
            }
            return;
        }
        this._applyRect(this._autohideHandle, handle.x, handle.y, handle.w, handle.h);
        if (this._handleBlurRegion)
            this._applyRect(this._handleBlurRegion, handle.x, handle.y, handle.w, handle.h);
        const clip = handle.clip;
        const clipKey = clip ? `${clip.x}:${clip.y}:${clip.w}:${clip.h}` : '';
        if (clipKey === this._handleClipCache) return;
        if (clip) {
            this._autohideHandle.set_clip(clip.x, clip.y, clip.w, clip.h);
            this._handleBlurRegion?.set_clip(clip.x, clip.y, clip.w, clip.h);
        } else {
            this._autohideHandle.remove_clip();
            this._handleBlurRegion?.remove_clip();
        }
        this._handleClipCache = clipKey;
    }

    setAutohideHandleVisible(visible, animate = true) {
        const handle = this._autohideHandle;
        const blurHandle = this._handleBlurRegion;
        if (!handle) return;
        if (visible && this._handleVisible && handle.visible && handle.opacity === 255)
            return;
        if (!visible && !this._handleVisible && !handle.visible)
            return;
        this._handleVisible = visible;
        try { handle.remove_all_transitions(); } catch { /* intentionally ignored: autohide handle actor may already be destroyed */ }
        try { blurHandle?.remove_all_transitions(); } catch { /* intentionally ignored: autohide handle actor may already be destroyed */ }

        if (visible) {
            handle.show();
            blurHandle?.show();
            if (animate && animationsEnabled()) {
                handle.ease({
                    opacity: 255,
                    duration: 140,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                blurHandle?.ease({
                    opacity: 255,
                    duration: 140,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } else {
                handle.opacity = 255;
                if (blurHandle) blurHandle.opacity = 255;
            }
            return;
        }

        if (animate && animationsEnabled() && handle.visible && handle.opacity > 0) {
            handle.ease({
                opacity: 0,
                duration: 90,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!this._handleVisible) handle.hide();
                },
            });
            blurHandle?.ease({
                opacity: 0,
                duration: 90,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!this._handleVisible) blurHandle?.hide();
                },
            });
        } else {
            handle.opacity = 0;
            handle.hide();
            if (blurHandle) {
                blurHandle.opacity = 0;
                blurHandle.hide();
            }
        }
    }

    applyEdgeZone(edgeZone) {
        this._applyRect(this._edgeZone, edgeZone.x, edgeZone.y, edgeZone.w, edgeZone.h);
    }

    hideEdgeZone() {
        if (this._edgeZone.width !== 0 || this._edgeZone.height !== 0)
            this._edgeZone.set_size(0, 0);
    }

    applyMagZoneConst() {
        // The animation engine owns this actor while magnification is active,
        // so compare its live size instead of keeping a separate stale cache.
        if (this._magZone.width !== 0 || this._magZone.height !== 0)
            this._magZone.set_size(0, 0);
    }

    // ── Dash management ─────────────────────────────────────────────────────
    // Hide the GNOME dash but reserve its space so the overview layout stays
    // at the default position (workspace previews don't shift down).
    hideDash(cfg) {
        const dash = overviewDash();
        if (!dash) throw new Error('GNOME overview dash is unavailable');

        if (this._dashNotifyIds) {
            for (const id of this._dashNotifyIds) {
                try { (this._dash ?? dash).disconnect(id); } catch { /* intentionally ignored: dash signal handler may already be disconnected */ }
            }
            this._dashNotifyIds = null;
        }

        if (this._dash !== dash) {
            this._dash = dash;
            this._dashWasVisible = dash.visible;
            this._dashHeight = dash.height;
            this._dashOpacity = dash.opacity;
            this._dashReactive = dash.reactive;
        }
        this._dashCfg = cfg;
        this._dashNotifyIds = [];

        try {
            // Initial ownership must be strict: if any Dash property cannot be
            // applied, restore the captured baseline and let ExtensionManager's
            // bounded retry path observe the failure.
            this._enforceDash(cfg, true);
            this._dashNotifyIds.push(
                dash.connect('notify::opacity', () => this._enforceDash()));
            this._dashNotifyIds.push(
                dash.connect('notify::reactive', () => this._enforceDash()));
        } catch (error) {
            this.restoreDash();
            throw error;
        }
    }

    _enforceDash(cfg = null, strict = false) {
        const dash = this._dash;
        if (!dash) return false;
        if (cfg) this._dashCfg = cfg;
        const current = this._dashCfg;
        try {
            dash.opacity = 0;
            dash.reactive = false;
            dash.add_style_class_name('aqua-dash-hidden');
            const gap = clamp((current?.dockH ?? 48) + (current?.edgeMargin ?? 0) + 42, 90, 170);
            dash.set_height(gap);
            return true;
        } catch (error) {
            /* intentionally ignored: dash actor properties may fail to apply during overview transition */
            if (strict) throw error;
            return false;
        }
    }

    // Re-assert the dash override (GNOME sometimes resets properties during
    // overview transitions).
    enforceDashGap(cfg) {
        return this._enforceDash(cfg);
    }

    // Restore the dash to its original state when the extension is disabled.
    restoreDash() {
        if (!this._dash) return;
        // Disconnect monitors.
        if (this._dashNotifyIds) {
            for (const id of this._dashNotifyIds) {
                try { this._dash?.disconnect(id); } catch { /* intentionally ignored: dash signal handler may already be disconnected */ }
            }
            this._dashNotifyIds = null;
        }
        try {
            this._dash.remove_style_class_name('aqua-dash-hidden');
            this._dash.set_height(this._dashHeight ?? -1);
            this._dash.opacity = this._dashOpacity ?? 255;
            this._dash.reactive = this._dashReactive ?? true;
            if (this._dashWasVisible) this._dash.show();
            else this._dash.hide();
        } catch { /* intentionally ignored: stock dash actor may be disposed during Shell shutdown */ }
        this._dash = null;
        this._dashCfg = null;
        this._dashHeight = null;
    }

    destroy() {
        this.restoreDash();
        for (const key of ['_magZone', '_strip', '_handleBlurRegion', '_autohideHandle', '_edgeZone', '_strut', '_container']) {
            const actor = this[key];
            if (!actor) continue;
            try { Main.layoutManager.removeChrome(actor); } catch { /* intentionally ignored: chrome actor may already be removed or destroyed */ }
            try { actor.destroy(); } catch { /* intentionally ignored: chrome actor may already be removed or destroyed */ }
            this[key] = null;
        }
        this._blurRegion = null;
        this._bg = null;
        this._handleVisible = false;
        this._handleClipCache = null;
    }
}
