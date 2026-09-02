// GNOME Shell 51 native dock blur with an exact rounded GPU mask.
//
// Stock Shell.BlurEffect has no corner-radius property. Its BACKGROUND mode
// also paints the blurred framebuffer before later actor effects, so stacking a
// ShaderEffect on the same actor cannot clip the blur itself. Instead we mirror
// only the real desktop backdrop (wallpaper + windows) into a small pill-sized
// actor, blur that mirror with Shell.BlurEffect in ACTOR mode, then apply the
// rounded shader to the outer actor. The dock is never part of the mirror, so
// there is no recursive clone. The shader performs clipping only; Shell still
// performs the blur.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { shellMajorVersion } from '../compat/shell.js';
import { clamp, warnOnce } from '../core/utils.js';

const BLUR_EFFECT_NAME = 'aqua-native-backdrop-blur';
const ROUND_MASK_EFFECT_NAME = 'aqua-native-blur-round-mask';
const MIN_BLUR_RADIUS = 0;
const MAX_BLUR_RADIUS = 80;
const MIN_BRIGHTNESS = 0.20;
const MAX_BRIGHTNESS = 1.20;

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
    const snippet = Cogl.Snippet.new(
        Cogl.SnippetHook.FRAGMENT,
        ROUND_MASK_DECLARATIONS,
        ROUND_MASK_POST,
    );
    return Clutter.ShaderEffect.new_with_snippet(snippet);
}

function setUniform(effect, name, value) {
    effect?.set_uniform_float?.(name, 1, [Number(value)]);
}

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function nativeDockBlurSupported() {
    return shellMajorVersion() >= 51 &&
        typeof Shell.BlurEffect === 'function' &&
        Shell.BlurMode?.ACTOR !== undefined &&
        typeof Clutter.Clone === 'function' &&
        typeof Clutter.ShaderEffect?.new_with_snippet === 'function';
}

export class NativeDockBlur {
    constructor(actor) {
        // actor is a transparent sibling immediately behind the visible pill.
        // It owns the final rounded mask; an inner actor owns Shell.BlurEffect.
        this._actor = actor;
        this._capture = null;
        this._backgroundClone = null;
        this._windowClone = null;
        this._backgroundSource = null;
        this._windowSource = null;
        this._blur = null;
        this._roundMask = null;
        this._cornerRadius = 0;
        this._actorSignalIds = [];
        this._parentSignalIds = [];
        this._sourceSignalIds = [];

        if (actor) {
            actor.set_clip_to_allocation(true);
            const sync = () => {
                this._syncBackdropGeometry();
                this._syncRoundMaskGeometry();
            };

            for (const property of ['x', 'y', 'width', 'height']) {
                this._actorSignalIds.push(actor.connect(
                    `notify::${property}`,
                    sync,
                ));
            }

            const parent = actor.get_parent?.();
            if (parent) {
                for (const property of ['x', 'y', 'translation-x', 'translation-y']) {
                    this._parentSignalIds.push(parent.connect(
                        `notify::${property}`,
                        () => this._syncBackdropGeometry(),
                    ));
                }
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

        const resourceScale = Math.max(1, finiteNumber(actor.get_resource_scale?.(), 1));
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
        this._cornerRadius = Math.max(0, finiteNumber(cfg.dockRadius, 0));

        try {
            this._ensureBackdropMirror();
            actor.show();
            this._capture.show();
            this._syncBackdropGeometry();

            if (!this._blur) {
                this._blur = new Shell.BlurEffect({
                    mode: Shell.BlurMode.ACTOR,
                    radius,
                    brightness,
                });
                this._capture.add_effect_with_name(BLUR_EFFECT_NAME, this._blur);
            } else {
                this._blur.radius = radius;
                this._blur.brightness = brightness;
                this._blur.mode = Shell.BlurMode.ACTOR;
                this._blur.enabled = true;
            }

            if (!this._roundMask) {
                this._roundMask = createRoundMaskEffect();
                actor.add_effect_with_name(ROUND_MASK_EFFECT_NAME, this._roundMask);
            }

            this._syncRoundMaskGeometry();
            this._roundMask.enabled = true;
            this._capture.queue_redraw?.();
            actor.queue_redraw?.();
        } catch (error) {
            warnOnce('native-dock-blur', `Native rounded dock blur unavailable: ${error}`);
            this.disable();
        }
    }

    _ensureBackdropMirror() {
        if (this._capture && this._backgroundClone && this._windowClone)
            return;

        const backgroundSource = Main.layoutManager?._backgroundGroup ?? null;
        const windowSource = global.window_group ?? null;
        if (!backgroundSource || !windowSource)
            throw new Error('GNOME Shell backdrop actors are unavailable');

        this._backgroundSource = backgroundSource;
        this._windowSource = windowSource;

        this._capture = new Clutter.Actor({
            reactive: false,
            layout_manager: new Clutter.FixedLayout(),
        });
        this._capture.set_clip_to_allocation(true);

        this._backgroundClone = new Clutter.Clone({
            source: backgroundSource,
            reactive: false,
        });
        this._windowClone = new Clutter.Clone({
            source: windowSource,
            reactive: false,
        });

        this._capture.add_child(this._backgroundClone);
        this._capture.add_child(this._windowClone);
        this._actor.add_child(this._capture);

        const sync = () => this._syncBackdropGeometry();
        for (const source of [backgroundSource, windowSource]) {
            for (const property of ['x', 'y', 'width', 'height']) {
                this._sourceSignalIds.push([
                    source,
                    source.connect(`notify::${property}`, sync),
                ]);
            }
        }
    }

    _syncBackdropGeometry() {
        if (!this._actor || !this._capture ||
            !this._backgroundClone || !this._windowClone)
            return;

        const width = Math.max(1, finiteNumber(this._actor.width, 1));
        const height = Math.max(1, finiteNumber(this._actor.height, 1));
        this._capture.set_position(0, 0);
        this._capture.set_size(width, height);
        this._capture.set_clip(0, 0, width, height);

        const actorPosition = this._actor.get_transformed_position?.() ?? [0, 0];
        const actorX = finiteNumber(actorPosition[0], 0);
        const actorY = finiteNumber(actorPosition[1], 0);

        for (const [clone, source] of [
            [this._backgroundClone, this._backgroundSource],
            [this._windowClone, this._windowSource],
        ]) {
            if (!clone || !source) continue;

            const sourcePosition = source.get_transformed_position?.() ?? [0, 0];
            const sourceSize = source.get_transformed_size?.() ?? source.get_size?.() ?? [1, 1];
            const sourceX = finiteNumber(sourcePosition[0], 0);
            const sourceY = finiteNumber(sourcePosition[1], 0);
            const sourceWidth = Math.max(1, finiteNumber(sourceSize[0], 1));
            const sourceHeight = Math.max(1, finiteNumber(sourceSize[1], 1));

            clone.set_position(sourceX - actorX, sourceY - actorY);
            clone.set_size(sourceWidth, sourceHeight);
        }
    }

    _syncRoundMaskGeometry() {
        if (!this._roundMask || !this._actor) return;
        setUniform(this._roundMask, 'aqua_width', this._actor.width);
        setUniform(this._roundMask, 'aqua_height', this._actor.height);
        setUniform(this._roundMask, 'aqua_corner_radius', this._cornerRadius);
        this._roundMask.queue_repaint?.();
    }

    _removeEffects() {
        if (this._roundMask && this._actor) {
            try { this._actor.remove_effect_by_name(ROUND_MASK_EFFECT_NAME); }
            catch { }
        }
        this._roundMask = null;

        if (this._blur && this._capture) {
            try { this._capture.remove_effect_by_name(BLUR_EFFECT_NAME); }
            catch { }
        }
        this._blur = null;
    }

    disable() {
        this._removeEffects();
        this._capture?.hide();
        this._actor?.hide();
    }

    destroy() {
        this.disable();

        if (this._actor) {
            for (const id of this._actorSignalIds) {
                try { this._actor.disconnect(id); } catch { }
            }
        }
        this._actorSignalIds = [];

        const parent = this._actor?.get_parent?.();
        if (parent) {
            for (const id of this._parentSignalIds) {
                try { parent.disconnect(id); } catch { }
            }
        }
        this._parentSignalIds = [];

        for (const [source, id] of this._sourceSignalIds) {
            try { source.disconnect(id); } catch { }
        }
        this._sourceSignalIds = [];

        try { this._capture?.destroy(); } catch { }
        this._capture = null;
        this._backgroundClone = null;
        this._windowClone = null;
        this._backgroundSource = null;
        this._windowSource = null;
        this._actor = null;
    }
}
