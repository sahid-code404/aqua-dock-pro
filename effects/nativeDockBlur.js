// GNOME Shell 51 native dock blur with an exact rounded GPU mask.
//
// Stock Shell.BlurEffect has no corner-radius property. Its BACKGROUND mode
// also paints the blurred framebuffer before later actor effects, so stacking a
// ShaderEffect on the same actor cannot clip the blur itself. Instead we mirror
// the real Shell backdrop into a small pill-sized actor, blur that mirror with
// Shell.BlurEffect in ACTOR mode, then apply the rounded shader to the outer
// actor. The dock itself is never part of the mirror, so there is no recursive
// clone. The shader performs clipping only; Shell still performs the blur.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
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

// Properties whose changes alter what a cloned backdrop looks like without
// necessarily repainting the underlying surface itself (overview/workspace
// motion is the important example). One generic notify handler per actor keeps
// the watcher count bounded instead of connecting to every property separately.
const LIVE_NOTIFY_PROPERTIES = new Set([
    'x', 'y', 'width', 'height', 'allocation',
    'translation-x', 'translation-y',
    'scale-x', 'scale-y',
    'rotation-angle-z',
    'opacity', 'visible',
]);

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

function hasSignal(object, signalName) {
    const gtype = object?.constructor?.$gtype;
    if (!gtype) return false;
    try { return GObject.signal_lookup(signalName, gtype) > 0; }
    catch { return false; }
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
        this._overviewClone = null;
        this._backgroundSource = null;
        this._windowSource = null;
        this._overviewSource = null;
        this._blur = null;
        this._roundMask = null;
        this._cornerRadius = 0;
        this._actorSignalIds = [];
        this._parentSignalIds = [];
        this._sourceGeometrySignalIds = [];
        this._sourceRootSignalIds = [];
        this._liveSignalIds = [];

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

        // pillStyle() stores its CSS radius in logical CSS pixels while St's
        // rendered geometry is resource-scaled. Use the same resource scale for
        // the mask so its corner curve lands on the exact pixels of the visible
        // pill instead of becoming too square on HiDPI/fractional-scale setups.
        this._cornerRadius = Math.max(0,
            finiteNumber(cfg.dockRadius, 0) * resourceScale);

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
            this._queueBackdropRepaint();
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
        // The live GNOME overview is not part of global.window_group. Mirror it
        // separately so workspace/search/app-grid motion behind the dock is not
        // frozen to the pre-overview desktop frame.
        const overviewSource = Main.layoutManager?.overviewGroup ?? null;
        if (!backgroundSource || !windowSource)
            throw new Error('GNOME Shell backdrop actors are unavailable');

        this._backgroundSource = backgroundSource;
        this._windowSource = windowSource;
        this._overviewSource = overviewSource;

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

        if (overviewSource) {
            this._overviewClone = new Clutter.Clone({
                source: overviewSource,
                reactive: false,
            });
            this._capture.add_child(this._overviewClone);
        }

        this._actor.add_child(this._capture);

        const sync = () => {
            this._syncBackdropGeometry();
            this._queueBackdropRepaint();
        };
        for (const source of [backgroundSource, windowSource, overviewSource]) {
            if (!source) continue;
            for (const property of ['x', 'y', 'width', 'height']) {
                this._sourceGeometrySignalIds.push([
                    source,
                    source.connect(`notify::${property}`, sync),
                ]);
            }

            // New top-level windows/workspace views must be added to the live
            // repaint watcher tree. These are root-only structure watches; the
            // full descendants are rebuilt below.
            for (const signalName of ['child-added', 'child-removed']) {
                if (!hasSignal(source, signalName)) continue;
                this._sourceRootSignalIds.push([
                    source,
                    source.connect(signalName, () => {
                        this._rebuildLiveWatchers();
                        this._queueBackdropRepaint();
                    }),
                ]);
            }
        }

        this._rebuildLiveWatchers();
    }

    _rebuildLiveWatchers() {
        for (const [object, id] of this._liveSignalIds) {
            try { object.disconnect(id); } catch { }
        }
        this._liveSignalIds = [];

        const queue = () => this._queueBackdropRepaint();
        const roots = [
            this._backgroundSource,
            this._windowSource,
            this._overviewSource,
        ].filter(Boolean);

        const seen = new Set();
        const stack = [...roots];
        while (stack.length > 0) {
            const object = stack.pop();
            if (!object || seen.has(object)) continue;
            seen.add(object);

            // Surface content changes (scrolling, video, terminal text, etc.)
            // are exposed by Mutter's MetaSurfaceActor repaint-scheduled signal.
            // update-scheduled catches the earlier update phase too, while the
            // generic notify handler catches overview/workspace transforms.
            for (const signalName of ['repaint-scheduled', 'update-scheduled', 'size-changed']) {
                if (!hasSignal(object, signalName)) continue;
                try {
                    this._liveSignalIds.push([
                        object,
                        object.connect(signalName, queue),
                    ]);
                } catch { }
            }

            try {
                this._liveSignalIds.push([
                    object,
                    object.connect('notify', (_actor, pspec) => {
                        if (LIVE_NOTIFY_PROPERTIES.has(pspec?.name))
                            queue();
                    }),
                ]);
            } catch { }

            const children = object.get_children?.() ?? [];
            for (const child of children)
                stack.push(child);
        }
    }

    _queueBackdropRepaint() {
        // Watchers stay installed while the mirror exists, but hidden/disabled
        // blur must not create repaint work.
        if (!this._actor?.visible || !this._capture?.visible)
            return;
        this._backgroundClone?.queue_redraw?.();
        this._windowClone?.queue_redraw?.();
        this._overviewClone?.queue_redraw?.();
        this._capture?.queue_redraw?.();
        this._actor?.queue_redraw?.();
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
            [this._overviewClone, this._overviewSource],
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

        for (const [source, id] of this._sourceGeometrySignalIds) {
            try { source.disconnect(id); } catch { }
        }
        this._sourceGeometrySignalIds = [];

        for (const [source, id] of this._sourceRootSignalIds) {
            try { source.disconnect(id); } catch { }
        }
        this._sourceRootSignalIds = [];

        for (const [object, id] of this._liveSignalIds) {
            try { object.disconnect(id); } catch { }
        }
        this._liveSignalIds = [];

        try { this._capture?.destroy(); } catch { }
        this._capture = null;
        this._backgroundClone = null;
        this._windowClone = null;
        this._overviewClone = null;
        this._backgroundSource = null;
        this._windowSource = null;
        this._overviewSource = null;
        this._actor = null;
    }
}
