// GNOME Shell 51 native dock backdrop blur with a rounded GPU clip.
//
// Shell.BlurEffect performs the actual background blur. Stock Shell 51 does
// not expose a corner-radius property on that effect, so a tiny Clutter shader
// is applied after it solely to alpha-mask the result to the dock pill's live
// rounded rectangle. The mask performs no blur and has no animation loop.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Shell from 'gi://Shell';

import { shellMajorVersion } from '../compat/shell.js';
import { clamp, warnOnce } from '../core/utils.js';

const BLUR_EFFECT_NAME = 'aqua-native-background-blur';
const ROUND_MASK_EFFECT_NAME = 'aqua-native-blur-round-mask';
const MIN_BLUR_RADIUS = 0;
const MAX_BLUR_RADIUS = 80;
const MIN_BRIGHTNESS = 0.20;
const MAX_BRIGHTNESS = 1.20;

// Some downstream Shell blur implementations add native rounded-corner
// support. Prefer it when present; stock GNOME Shell 51 falls back to the mask
// below. Feature detection keeps this safe if upstream gains the property later.
const HAS_NATIVE_CORNER_RADIUS = Boolean(
    Shell.BlurEffect?.list_properties?.()
        .some(property => property.name === 'corner-radius')
);

const ROUND_MASK_DECLARATIONS = `
uniform float aqua_width;
uniform float aqua_height;
uniform float aqua_corner_radius;

float aqua_rounded_rect_coverage(vec2 point, vec2 size, float radius) {
    radius = clamp(radius, 0.0, min(size.x, size.y) * 0.5);
    vec2 half_size = size * 0.5;
    vec2 q = abs(point - half_size) - (half_size - vec2(radius));
    float distance_to_edge = length(max(q, vec2(0.0))) +
        min(max(q.x, q.y), 0.0) - radius;
    // Coordinates are in logical pixels, so this gives roughly a one-pixel
    // antialiased transition instead of a jagged binary clip.
    return 1.0 - smoothstep(-0.75, 0.75, distance_to_edge);
}
`;

const ROUND_MASK_POST = `
vec2 aqua_size = vec2(max(aqua_width, 1.0), max(aqua_height, 1.0));
vec2 aqua_point = cogl_tex_coord0_in.xy * aqua_size;
cogl_color_out *= aqua_rounded_rect_coverage(
    aqua_point, aqua_size, aqua_corner_radius);
`;

function createRoundMaskEffect() {
    const snippet = new Cogl.Snippet(
        Cogl.SnippetHook.FRAGMENT,
        ROUND_MASK_DECLARATIONS,
        ROUND_MASK_POST,
    );
    return Clutter.ShaderEffect.new_with_snippet(snippet);
}

function setUniform(effect, name, value) {
    // set_uniform_value() takes an explicit GValue. The float-array helper is
    // the introspection-friendly API intended for languages such as GJS.
    effect?.set_uniform_float?.(name, 1, 1, [Number(value)]);
}

export function nativeDockBlurSupported() {
    return shellMajorVersion() >= 51 &&
        typeof Shell.BlurEffect === 'function' &&
        Shell.BlurMode?.BACKGROUND !== undefined;
}

export class NativeDockBlur {
    constructor(actor) {
        this._actor = actor;
        this._blur = null;
        this._roundMask = null;
        this._cornerRadius = 0;
        this._actorSignalIds = [];

        // Magnification changes the pill allocation frame-by-frame. Updating
        // only these three shader uniforms on allocation notifications keeps the
        // rounded clip exact without adding another animation or polling loop.
        if (actor) {
            for (const property of ['width', 'height']) {
                this._actorSignalIds.push(actor.connect(
                    `notify::${property}`,
                    () => this._syncRoundMaskGeometry(),
                ));
            }
        }
    }

    update(cfg) {
        const actor = this._actor;
        const enabled = cfg?.nativeBlurEnabled === true;
        if (!actor || !enabled || !nativeDockBlurSupported()) {
            this.disable();
            return;
        }

        const resourceScale = Math.max(1, Number(actor.get_resource_scale?.() ?? 1));
        const radius = Math.round(clamp(
            Number(cfg.nativeBlurRadius) || 0,
            MIN_BLUR_RADIUS,
            MAX_BLUR_RADIUS,
        ) * resourceScale);
        const brightness = clamp(
            Number(cfg.nativeBlurBrightness) || 0.82,
            MIN_BRIGHTNESS,
            MAX_BRIGHTNESS,
        );
        const cornerRadius = Math.max(0, Number(cfg.dockRadius) || 0);
        this._cornerRadius = cornerRadius;

        try {
            if (!this._blur) {
                this._blur = new Shell.BlurEffect({
                    mode: Shell.BlurMode.BACKGROUND,
                    radius,
                    brightness,
                });
                actor.add_effect_with_name(BLUR_EFFECT_NAME, this._blur);
            } else {
                this._blur.radius = radius;
                this._blur.brightness = brightness;
                this._blur.mode = Shell.BlurMode.BACKGROUND;
                this._blur.enabled = true;
            }

            if (HAS_NATIVE_CORNER_RADIUS) {
                // GJS maps kebab-case GObject properties to snake_case fields.
                this._blur.corner_radius = cornerRadius * resourceScale;
                this._removeRoundMask();
                return;
            }

            if (!this._roundMask) {
                this._roundMask = createRoundMaskEffect();
                actor.add_effect_with_name(ROUND_MASK_EFFECT_NAME, this._roundMask);
            }
            this._syncRoundMaskGeometry();
            this._roundMask.enabled = true;
        } catch (error) {
            // Blur is purely optional. A compositor/GPU-specific failure must
            // never take the dock down with it; disable only this visual path.
            warnOnce('native-dock-blur', `Native dock blur unavailable: ${error}`);
            this.disable();
        }
    }

    _syncRoundMaskGeometry() {
        if (!this._roundMask || !this._actor) return;
        setUniform(this._roundMask, 'aqua_width', this._actor.width);
        setUniform(this._roundMask, 'aqua_height', this._actor.height);
        setUniform(this._roundMask, 'aqua_corner_radius', this._cornerRadius);
    }

    _removeRoundMask() {
        if (!this._roundMask || !this._actor) return;
        try { this._actor.remove_effect_by_name(ROUND_MASK_EFFECT_NAME); }
        catch { }
        this._roundMask = null;
    }

    disable() {
        this._removeRoundMask();
        if (!this._blur || !this._actor) return;
        try { this._actor.remove_effect_by_name(BLUR_EFFECT_NAME); }
        catch { }
        this._blur = null;
    }

    destroy() {
        this.disable();
        if (this._actor) {
            for (const id of this._actorSignalIds) {
                try { this._actor.disconnect(id); } catch { }
            }
        }
        this._actorSignalIds = [];
        this._actor = null;
    }
}
