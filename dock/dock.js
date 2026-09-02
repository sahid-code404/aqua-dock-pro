// Dock chrome actor hierarchy and GNOME Shell stage registration.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { animationsEnabled, clamp } from '../core/utils.js';
import { overviewDash } from '../compat/shell.js';
import { NativeDockBlur } from '../effects/nativeDockBlur.js';

const NATIVE_BLUR_KEYS = Object.freeze([
    'native-blur-enabled',
    'native-blur-radius',
    'native-blur-brightness',
]);

export class DockChrome {
    constructor() {
        this._container = null;
        this._bg = null;
        this._magZone = null;
        this._strip = null;
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
        this._dockRadius = 0;
        this._nativeBlur = null;
        this._nativeBlurSettings = null;
        this._nativeBlurSettingIds = [];

        try {
            this._container = new St.Widget({
                reactive: true,
                track_hover: true,
                layout_manager: new Clutter.FixedLayout(),
            });
            this._container.set_clip_to_allocation(false);

            this._bg = new St.Widget({ style_class: 'aqua-bg' });
            this._container.add_child(this._bg);

            // Resolve settings from the owning extension at runtime rather than
            // constructing Gio.Settings directly, so extension-local compiled
            // schemas work on both GNOME 50 and 51. These three keys are handled
            // entirely by DockChrome and therefore never force a dock relayout.
            const extension = Extension.lookupByURL(import.meta.url);
            this._nativeBlurSettings = extension?.getSettings() ?? null;
            this._nativeBlur = new NativeDockBlur(this._bg);
            if (this._nativeBlurSettings) {
                for (const key of NATIVE_BLUR_KEYS) {
                    this._nativeBlurSettingIds.push(
                        this._nativeBlurSettings.connect(
                            `changed::${key}`,
                            () => this._syncNativeBlur(),
                        ),
                    );
                }
            }

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
    get magZone() { return this._magZone; }
    get strip() { return this._strip; }
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
        if (this._bg.opacity !== 255) this._bg.opacity = 255;
        // Size may change because of monitor scale, auto-shrink, orientation or
        // item count. Refresh mask uniforms after allocation changes.
        this._syncNativeBlur();
    }

    applyPillStyle(style) {
        if (style !== this._bgStyleCache) {
            this._bg.set_style(style);
            this._autohideHandle.set_style(style);
            this._bgStyleCache = style;

            // pillStyle() is the single source of truth for the final runtime
            // radius, including auto-shrink. Reuse that exact value for blur
            // clipping so the glass edge cannot drift away from the dock edge.
            const match = /border-radius\s*:\s*([0-9.]+)px/i.exec(style ?? '');
            if (match) this._dockRadius = Math.max(0, Number(match[1]) || 0);
        }
        this._syncNativeBlur();
    }

    _syncNativeBlur() {
        const settings = this._nativeBlurSettings;
        if (!this._nativeBlur || !settings || !this._bg) {
            this._nativeBlur?.disable();
            return;
        }
        this._nativeBlur.update({
            nativeBlurEnabled: settings.get_boolean('native-blur-enabled'),
            nativeBlurRadius: settings.get_int('native-blur-radius'),
            nativeBlurBrightness: settings.get_double('native-blur-brightness'),
            dockRadius: this._dockRadius,
        });
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
            if (this._handleClipCache !== null) {
                try { this._autohideHandle.remove_clip(); } catch { }
                this._handleClipCache = null;
            }
            return;
        }
        this._applyRect(this._autohideHandle, handle.x, handle.y, handle.w, handle.h);
        const clip = handle.clip;
        const clipKey = clip ? `${clip.x}:${clip.y}:${clip.w}:${clip.h}` : '';
        if (clipKey === this._handleClipCache) return;
        if (clip)
            this._autohideHandle.set_clip(clip.x, clip.y, clip.w, clip.h);
        else
            this._autohideHandle.remove_clip();
        this._handleClipCache = clipKey;
    }

    setAutohideHandleVisible(visible, animate = true) {
        const handle = this._autohideHandle;
        if (!handle) return;
        if (visible && this._handleVisible && handle.visible && handle.opacity === 255)
            return;
        if (!visible && !this._handleVisible && !handle.visible)
            return;
        this._handleVisible = visible;
        try { handle.remove_all_transitions(); } catch { }

        if (visible) {
            handle.show();
            if (animate && animationsEnabled()) {
                handle.ease({
                    opacity: 255,
                    duration: 140,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } else {
                handle.opacity = 255;
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
        } else {
            handle.opacity = 0;
            handle.hide();
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

        this._dash = dash;
        this._dashWasVisible = dash.visible;
        this._dashHeight = dash.height;
        this._dashOpacity = dash.opacity;
        this._dashReactive = dash.reactive;
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
                try { this._dash.disconnect(id); } catch { }
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
        } catch { }
        this._dash = null;
        this._dashCfg = null;
        this._dashHeight = null;
    }

    destroy() {
        this.restoreDash();

        if (this._nativeBlurSettings) {
            for (const id of this._nativeBlurSettingIds) {
                try { this._nativeBlurSettings.disconnect(id); } catch { }
            }
        }
        this._nativeBlurSettingIds = [];
        this._nativeBlurSettings = null;
        this._nativeBlur?.destroy();
        this._nativeBlur = null;

        for (const key of ['_magZone', '_strip', '_autohideHandle', '_edgeZone', '_strut', '_container']) {
            const actor = this[key];
            if (!actor) continue;
            try { Main.layoutManager.removeChrome(actor); } catch { }
            try { actor.destroy(); } catch { }
            this[key] = null;
        }
        this._bg = null;
        this._handleVisible = false;
        this._handleClipCache = null;
        this._dockRadius = 0;
    }
}
