// GNOME Shell 51 native rounded background blur for the dock pill.
//
// Stock Shell.BlurEffect can blur the live framebuffer in BACKGROUND mode but
// does not expose a corner-radius property. Trying to reconstruct the desktop
// with Clutter.Clone makes overview/workspace motion cache like a screenshot.
// Trying to append a shader to Shell.BlurEffect cannot reliably clip the
// background framebuffer either. The only correct rounded path is therefore a
// blur implementation that owns both operations in the same native effect.
//
// Prefer the optional Blur GI namespace provided by gnome-rounded-blur. It is a
// ShellBlurEffect-compatible native effect with a corner-radius property. If a
// downstream Shell build grows the same property, use Shell directly. On stock
// Shell without either backend, leave the optional feature disabled instead of
// showing stale or square blur.

import Shell from 'gi://Shell';
import St from 'gi://St';

import { shellMajorVersion } from '../compat/shell.js';
import { clamp, warnOnce } from '../core/utils.js';

const BLUR_EFFECT_NAME = 'aqua-native-rounded-background-blur';
const MIN_BLUR_RADIUS = 0;
const MAX_BLUR_RADIUS = 80;
const MIN_BRIGHTNESS = 0.20;
// ShellBlurEffect/gnome-rounded-blur expose brightness as a native 0..1 float.
const MAX_BRIGHTNESS = 1.00;

async function importOptional(moduleName) {
    try {
        const module = await import(moduleName);
        return module.default ?? module;
    } catch {
        return null;
    }
}

// Dynamic import is required: GNOME 50 and stock GNOME 51 installations that do
// not have gnome-rounded-blur must still be able to load/validate the extension.
const RoundedBlur = await importOptional('gi://Blur');

function hasRoundedBackgroundBlur(namespace) {
    if (!namespace || typeof namespace.BlurEffect !== 'function' ||
        namespace.BlurMode?.BACKGROUND === undefined)
        return false;

    try {
        return namespace.BlurEffect.list_properties?.()
            .some(property => property.name === 'corner-radius') === true;
    } catch {
        return false;
    }
}

const BlurBackend = hasRoundedBackgroundBlur(RoundedBlur)
    ? RoundedBlur
    : (hasRoundedBackgroundBlur(Shell) ? Shell : null);

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function nativeDockBlurSupported() {
    return shellMajorVersion() >= 51 && BlurBackend !== null;
}

export function nativeDockBlurBackendName() {
    if (!BlurBackend) return 'unavailable';
    return BlurBackend === RoundedBlur ? 'Blur.BlurEffect' : 'Shell.BlurEffect';
}

export class NativeDockBlur {
    constructor(actor) {
        // actor is the transparent geometry-bound layer immediately underneath
        // the visible .aqua-bg pill.
        this._actor = actor;
        this._blur = null;
    }

    update(cfg) {
        const actor = this._actor;
        const enabled = cfg?.nativeBlurEnabled === true;

        if (!actor || !enabled) {
            this.disable();
            return;
        }

        if (!nativeDockBlurSupported()) {
            warnOnce(
                'native-dock-blur-backend',
                'Rounded native dock blur requires the Blur GI module ' +
                '(gnome-rounded-blur) on stock GNOME Shell 51.',
            );
            this.disable();
            return;
        }

        const resourceScale = Math.max(1,
            finiteNumber(actor.get_resource_scale?.(), 1));
        const radius = Math.round(clamp(
            finiteNumber(cfg.nativeBlurRadius, 0),
            MIN_BLUR_RADIUS,
            MAX_BLUR_RADIUS,
        ) * resourceScale);
        const brightness = clamp(
            finiteNumber(cfg.nativeBlurBrightness, 0.82),
            MIN_BRIGHTNESS,
            MAX_BRIGHTNESS,
        );
        const cornerRadius = this._renderedPillRadius(
            finiteNumber(cfg.dockRadius, 0),
            resourceScale,
        );

        try {
            actor.show();

            if (!this._blur) {
                this._blur = new BlurBackend.BlurEffect({
                    mode: BlurBackend.BlurMode.BACKGROUND,
                    radius,
                    brightness,
                    corner_radius: cornerRadius,
                });
                actor.add_effect_with_name(BLUR_EFFECT_NAME, this._blur);
            } else {
                this._blur.mode = BlurBackend.BlurMode.BACKGROUND;
                this._blur.radius = radius;
                this._blur.brightness = brightness;
                this._blur.corner_radius = cornerRadius;
                this._blur.enabled = true;
            }

            // BACKGROUND mode intentionally samples the current compositor
            // framebuffer on paint. Do not add Clone mirrors or an ACTOR-mode
            // cache: overview/workspace/window motion must remain live.
            actor.queue_redraw?.();
        } catch (error) {
            warnOnce(
                'native-dock-blur',
                `Native rounded dock blur unavailable: ${error}`,
            );
            this.disable();
        }
    }

    _renderedPillRadius(fallbackRadius, resourceScale) {
        // The visible pill is the next .aqua-bg sibling of the transparent blur
        // layer. StThemeNode returns the final rendered border radius, including
        // theme/resource scaling, so it is the exact source of truth and avoids
        // config/auto-shrink/fractional-scale drift.
        try {
            const parent = this._actor?.get_parent?.();
            const siblings = parent?.get_children?.() ?? [];
            const start = Math.max(0, siblings.indexOf(this._actor) + 1);

            for (let i = start; i < siblings.length; i++) {
                const candidate = siblings[i];
                const classes = candidate?.get_style_class_name?.() ?? '';
                if (!classes.split(/\s+/).includes('aqua-bg')) continue;

                const node = candidate.get_theme_node?.();
                const radius = node?.get_border_radius?.(St.Corner.TOPLEFT);
                if (Number.isFinite(Number(radius)) && Number(radius) >= 0)
                    return Number(radius);
            }
        } catch {
            // Fall through to the configured radius if theme-node lookup is not
            // available during an early allocation frame.
        }

        return Math.max(0, fallbackRadius * resourceScale);
    }

    disable() {
        if (this._blur && this._actor) {
            try { this._actor.remove_effect_by_name(BLUR_EFFECT_NAME); }
            catch { }
        }
        this._blur = null;
        this._actor?.hide();
    }

    destroy() {
        this.disable();
        this._actor = null;
    }
}
