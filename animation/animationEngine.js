// Frame loop engine for magnification and background pill spreading.
// Computes icon scales per frame and self-stops when animations settle.

import Clutter from 'gi://Clutter';

import { animationsEnabled, clamp, logError } from '../core/utils.js';
import { magnifiedOverflow } from '../dock/dockLayout.js';
import { smoothFactor } from './easing.js';
import { gaussianTarget, integrateSpring, subSteps } from './springSolver.js';
import { FrameScheduler } from './frameScheduler.js';

export class AnimationEngine {
    constructor() {
        this._scheduler = null;
        this._container = null;
        this._model = null;

        this._pointerX = 0;
        this._pointerY = 0;
        this._pointerInside = false;

        // Pill spread state (along the main axis).
        this._bgBaseX = 0; this._bgBaseW = 1;
        this._bgTargetX = 0; this._bgTargetW = 1;
        this._bgCurrentX = 0; this._bgCurrentW = 1;
        this._bgLastA = NaN; this._bgLastB = NaN;
        this._bgSnap = false;

        // Cached stage→local mapping inputs.
        this._ptPX = NaN; this._ptPY = NaN; this._ptCX = NaN; this._ptCY = NaN;
        this._ptHave = false; this._ptLX = 0; this._ptLY = 0;

        this._magZoneActive = false;
        this._scratch = { cur: 0, vel: 0 };
        this._stepScratch = { nSteps: 1, st: 1, dampPow: 1 };
        this._lastDt = 16;
        this._heldItem = null;   // pinned to peak zoom while its menu is open
        this._frameHook = null;  // optional () => void run at the end of each frame
        this._suspended = false; // a drag owns the chip translations
        this._animate = true;

        // Frame-loop invariants, cached on setModel() to avoid property lookups
        // on the model/cfg/geom objects every tick.
        this._vert = false;
        this._cellW = 1;
        this._zoomMax = 1;
        this._transProp = 'translation_x';
        this._cachedChips = null;
        this._cachedItems = null;
        this._cachedCfg = null;
        this._cachedGeom = null;
        this._cachedBg = null;
        this._cachedMagZone = null;
        this._cachedMagConst = null;
    }

    attach(container) {
        this._container = container;
        this._scheduler = new FrameScheduler(container, dt => this._frame(dt));
    }

    // Autohide uses this to avoid sliding the entire dock while its pill is
    // still contracting. The scheduler is stopped as soon as it settles.
    get animating() { return this._scheduler?.isRunning() ?? false; }

    // Keep the menu item magnified while its menu is open.
    setHeldItem(item) { this._heldItem = item; }

    // Keep the tooltip aligned while the icon magnifies.
    setFrameHook(fn) { this._frameHook = fn; }

    // Called after every relayout. Seeds pill spread from current icon scales so
    // a rebuild while magnified doesn't flash shrink-then-expand.
    setModel(model) {
        this._model = model;
        const geom = model.geom;
        this._bgBaseX = geom.bgBaseX;
        this._bgBaseW = geom.bgBaseW;
        this._bgTargetX = geom.bgBaseX;
        this._bgTargetW = geom.bgBaseW;

        // Cache frame-loop invariants so _frame()/_applySpread() avoid
        // property chain lookups on every tick.
        const cfg = model.cfg;
        this._vert = cfg.vertical;
        this._cellW = cfg.cellW;
        this._zoomMax = cfg.zoomMax;
        this._transProp = cfg.vertical ? 'translation_y' : 'translation_x';
        this._cachedChips = model.chips;
        this._cachedItems = model.items;
        this._cachedCfg = cfg;
        this._cachedGeom = geom;
        this._cachedBg = model.bg;
        this._cachedMagZone = model.magZone;
        this._cachedMagConst = geom.magZone;
        this._mzX = this._mzY = this._mzW = this._mzH = NaN;

        const fresh = !model.items.length;
        if (fresh) {
            this._bgCurrentX = geom.bgBaseX;
            this._bgCurrentW = geom.bgBaseW;
        } else {
            let spread = 0;
            const cellW = this._cellW;
            for (const chip of model.chips)
                if (chip.item) spread += cellW * (chip.item.scaleCurrent - 1);
            this._bgCurrentX = geom.bgBaseX - spread / 2;
            this._bgCurrentW = geom.bgBaseW + spread;
        }
        this._bgLastA = this._bgLastB = NaN;
        this._bgSnap = fresh;
        this._magZoneActive = false;
        this._animate = animationsEnabled();

        // Reduced motion is a hard no-motion state. Never preserve a magnified
        // model across relayouts; flatten it before anything can be painted.
        if (!this._animate) {
            this.snapToRest();
            this._bgSnap = false;
            return;
        }

        // Apply the spread once now so a rebuild never shows a one-frame snap.
        this._applySpread(this._bgSnap);
        this._bgSnap = false;
    }

    setPointer(x, y, inside) {
        this._pointerX = x;
        this._pointerY = y;
        this._pointerInside = inside;
    }

    kick() {
        if (!this._scheduler || this._suspended) return;

        // Reduced Motion is deliberately not an alternate magnification mode.
        // Stop the frame clock and pin every icon/pill transform to resting
        // geometry synchronously instead of following pointer targets without
        // spring interpolation.
        this._animate = animationsEnabled();
        if (!this._animate) {
            this._scheduler.stop();
            if (this._model) {
                this.snapToRest();
                this._frameHook?.();
            }
            return;
        }

        this._scheduler.start();
    }

    stop() {
        if (this._scheduler) this._scheduler.stop();
    }

    // While suspended, a drag (reorder / drop-to-pin) owns chip translations and
    // the engine neither runs nor writes them.
    setSuspended(b) {
        this._suspended = b;
        if (b) this.stop();
    }

    // Snap everything flat immediately (used at drop-to-pin start and whenever
    // Reduce Motion is enabled).
    snapToRest() {
        if (!this._model) return;
        const items = this._cachedItems;
        const chips = this._cachedChips;
        const prop = this._transProp;
        for (const item of items) {
            item.vel = 0;
            item.scaleTarget = 1;
            item.scaleCurrent = 1;
            item.setScale(1);
        }
        for (const chip of chips) {
            try {
                chip.actor.remove_transition(prop);
                chip.actor[prop] = 0;
                chip.spreadOffset = 0;
            } catch { }
        }
        this._bgCurrentX = this._bgTargetX = this._bgBaseX;
        this._bgCurrentW = this._bgTargetW = this._bgBaseW;
        this._bgLastA = this._bgLastB = NaN;
        const magZone = this._cachedMagZone;
        if (magZone) {
            try { magZone.set_size(0, 0); } catch { }
            this._magZoneActive = false;
        }
        this._applySpread(true);
    }

    // Smoothly collapse magnification back to rest (used at reorder start so the
    // dock de-magnifies softly). Skips items a drag has claimed.
    demagnify(duration = 220) {
        this.stop();
        if (!this._model) return;
        if (!animationsEnabled()) { this.snapToRest(); return; }
        const items = this._cachedItems;
        const chips = this._cachedChips;
        const vert = this._vert;
        const prop = this._transProp;
        for (const it of items) {
            if (it._landing || it._dragging) continue;
            it.vel = 0; it.scaleTarget = 1; it.scaleCurrent = 1;
            it.easeToRest(duration);
        }
        for (const chip of chips) {
            try {
                chip.spreadOffset = NaN;
                chip.actor.remove_transition(prop);
                chip.actor.ease({ [prop]: 0, duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            } catch { }
        }
        this._bgCurrentX = this._bgTargetX = this._bgBaseX;
        this._bgCurrentW = this._bgTargetW = this._bgBaseW;
        const bg = this._cachedBg;
        const params = vert
            ? { y: Math.round(this._bgBaseX), height: Math.round(this._bgBaseW) }
            : { x: Math.round(this._bgBaseX), width: Math.round(this._bgBaseW) };
        try { bg.ease({ ...params, duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD }); } catch { }
        this._bgLastA = this._bgLastB = NaN;
        const magZone = this._cachedMagZone;
        if (magZone) { magZone.set_size(0, 0); this._magZoneActive = false; }
    }

    _frame(dt) {
        if (!this._model || this._suspended) return false;
        if (!this._animate) {
            this.snapToRest();
            this._frameHook?.();
            return false;
        }
        this._lastDt = dt;
        const chips = this._cachedChips;
        const cfg = this._cachedCfg;
        const geom = this._cachedGeom;

        // Cached stage→local pointer mapping.
        let haveLocal = false, lx = 0, ly = 0;
        if (this._pointerInside) {
            const cx = this._container.x, cy = this._container.y;
            if (this._ptPX === this._pointerX && this._ptPY === this._pointerY &&
                this._ptCX === cx && this._ptCY === cy) {
                haveLocal = this._ptHave; lx = this._ptLX; ly = this._ptLY;
            } else {
                try {
                    const p = this._container.transform_stage_point(this._pointerX, this._pointerY);
                    if (p?.[0]) { haveLocal = true; lx = p[1]; ly = p[2]; }
                } catch (e) { logError(e, 'transform_stage_point'); }
                this._ptPX = this._pointerX; this._ptPY = this._pointerY;
                this._ptCX = cx; this._ptCY = cy;
                this._ptHave = haveLocal; this._ptLX = lx; this._ptLY = ly;
            }
        }

        const vert = this._vert;
        const mainCoord = haveLocal ? (vert ? ly : lx) : 0;
        const crossCoord = haveLocal ? (vert ? lx : ly) : 0;

        let magMain = mainCoord;
        if (haveLocal && geom.firstItemCenter !== undefined)
            magMain = clamp(magMain, geom.firstItemCenter, geom.lastItemCenter);

        const m = cfg.mag;
        const inBand = haveLocal &&
            crossCoord >= geom.band.low && crossCoord <= geom.band.high;
        const step = subSteps(dt, m.damping, this._stepScratch);
        const nSteps = step.nSteps;
        const st = step.st;
        const dampPow = step.dampPow;

        const s = this._scratch;
        const zoomMax = this._zoomMax;
        const cellW = this._cellW;
        let total = 0;
        let maxScale = 1;
        let anyUnsettled = false;
        for (const chip of chips) {
            const item = chip.item;
            if (!item) {
                chip.extra = 0;
                continue;
            }
            let target = 1;
            if (inBand)
                target = gaussianTarget(Math.abs(magMain - chip.center), m);
            // Right-click menu holds its icon at peak zoom until the menu closes.
            if (item === this._heldItem) target = zoomMax;
            item.scaleTarget = target;
            if (item._landing) {
                // The landing ease owns the actor transform, but DockItem records
                // the latest target so it can hand off without a stale-scale jump.
                item.vel = 0;
                item.setScale(target);
            } else if (item.vel !== 0 || item.scaleCurrent !== target) {
                s.cur = item.scaleCurrent;
                s.vel = item.vel;
                integrateSpring(s, target, m.tension, dampPow, st, nSteps);
                item.vel = s.vel;
                item.setScale(s.cur);
                if (s.vel !== 0 || s.cur !== target) anyUnsettled = true;
            }

            const scale = item.scaleCurrent;
            chip.extra = cellW * (scale - 1);
            total += chip.extra;
            if (scale > maxScale) maxScale = scale;
        }

        this._applySpread(false, total, maxScale);
        if (this._frameHook) this._frameHook();

        // Items settled check was done inline above; only pill spread remains.
        if (!anyUnsettled &&
            Math.abs(this._bgTargetX - this._bgCurrentX) <= 0.5 &&
            Math.abs(this._bgTargetW - this._bgCurrentW) <= 0.5)
            return false;
        return true;
    }

    _applySpread(snap, total = null, maxScale = 1) {
        const chips = this._cachedChips;
        const vert = this._vert;
        if (total === null) {
            total = 0;
            const cellW = this._cellW;
            for (const chip of chips) {
                const scale = chip.item?.scaleCurrent ?? 1;
                chip.extra = chip.item ? cellW * (scale - 1) : 0;
                if (scale > maxScale) maxScale = scale;
                total += chip.extra;
            }
        }
        const shift = -total / 2;
        let prefix = 0;
        const prop = this._transProp;
        for (const chip of chips) {
            const off = chip.item ? shift + prefix + chip.extra / 2 : shift + prefix;
            if (chip.spreadOffset !== off) {
                chip.actor[prop] = off;
                chip.spreadOffset = off;
            }
            prefix += chip.extra;
        }
        this._bgTargetX = this._bgBaseX + shift;
        this._bgTargetW = this._bgBaseW + total;

        if (snap) {
            this._bgCurrentX = this._bgTargetX;
            this._bgCurrentW = this._bgTargetW;
        } else {
            const dw = this._bgTargetW - this._bgCurrentW;
            // Expanding: smooth with tau=70 for snappy hover response.
            // Contracting: track the actual icon spread directly — the
            // icons' own springs already provide smooth deceleration, so
            // adding a second heavy smoother produces frame-skipping
            // jitter. Use only a minimal tau=20 softener to absorb
            // sub-pixel rounding noise from Math.round().
            const tau = dw > 0.5 ? 70 : 20;
            const k = smoothFactor(this._lastDt, tau);
            this._bgCurrentX += (this._bgTargetX - this._bgCurrentX) * k;
            this._bgCurrentW += dw * k;
            // Snap to target once within sub-pixel distance so the tail
            // doesn't leave the frame loop running for invisible motion.
            if (Math.abs(this._bgTargetX - this._bgCurrentX) < 0.3 &&
                Math.abs(this._bgTargetW - this._bgCurrentW) < 0.3) {
                this._bgCurrentX = this._bgTargetX;
                this._bgCurrentW = this._bgTargetW;
            }
        }

        const bg = this._cachedBg;
        if (vert) {
            const top = Math.round(this._bgCurrentX);
            const h = Math.round(this._bgCurrentX + this._bgCurrentW) - top;
            if (top !== this._bgLastA) { bg.set_y(top); this._bgLastA = top; }
            if (h !== this._bgLastB) { bg.set_height(h); this._bgLastB = h; }
        } else {
            const left = Math.round(this._bgCurrentX);
            const w = Math.round(this._bgCurrentX + this._bgCurrentW) - left;
            if (left !== this._bgLastA) { bg.set_x(left); this._bgLastA = left; }
            if (w !== this._bgLastB) { bg.set_width(w); this._bgLastB = w; }
        }

        this._updateMagZone(maxScale);
    }

    // Resize the click-catching zone to cover icon overflow above the pill.
    // Collapses to 0×0 when icons are at rest.
    _updateMagZone(maxScale) {
        const magZone = this._cachedMagZone;
        const mc = this._cachedMagConst;
        if (!magZone) return;

        if (maxScale <= 1.005) {
            if (this._magZoneActive) { magZone.set_size(0, 0); this._magZoneActive = false; }
            return;
        }
        const oh = magnifiedOverflow(mc, maxScale);
        if (oh <= 2) {
            if (this._magZoneActive) { magZone.set_size(0, 0); this._magZoneActive = false; }
            return;
        }
        this._magZoneActive = true;
        const geom = this._cachedGeom;
        const sx = geom.x, sy = geom.y;
        const mainPad = mc.mainPad;
        const mainStart = -mainPad;
        const mainLength = geom.mainLen + mainPad * 2;
        let mx, my, mw, mh;
        if (mc.side === 'left') {
            mx = sx + mc.dockH; my = sy + mainStart; mw = oh; mh = mainLength;
        } else if (mc.side === 'right') {
            mx = sx - oh; my = sy + mainStart; mw = oh; mh = mainLength;
        } else {
            mx = sx + mainStart; my = sy - oh; mw = mainLength; mh = oh;
        }
        // Only write actor properties when they actually changed.
        if (mx !== this._mzX || my !== this._mzY) { magZone.set_position(mx, my); this._mzX = mx; this._mzY = my; }
        if (mw !== this._mzW || mh !== this._mzH) { magZone.set_size(mw, mh); this._mzW = mw; this._mzH = mh; }
    }

    destroy() {
        if (this._scheduler) { this._scheduler.destroy(); this._scheduler = null; }
        this._container = null;
        this._model = null;
        this._cachedChips = null;
        this._cachedItems = null;
        this._cachedCfg = null;
        this._cachedGeom = null;
        this._cachedBg = null;
        this._cachedMagZone = null;
        this._cachedMagConst = null;
        this._heldItem = null;
        this._frameHook = null;
        this._scratch = null;
        this._stepScratch = null;
    }
}
