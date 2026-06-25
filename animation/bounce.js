// AquaDockPro — physics-driven icon bounce.
//
// Purpose:   One engine drives every bounce (launch / attention / minimize /
//            downloads) as a damped ballistic projectile integrated on the
//            icon's frame clock (refresh-rate independent). It NEVER owns the
//            full icon transform — each frame it hands (heightPx, squashX,
//            squashY) to a `compose` callback so hover-magnification keeps
//            tracking the cursor while the icon bounces. Extracted from the
//            reference's DockItem god-method so the item stays small and the
//            physics is independently testable.
// Ownership: OWNS one FrameScheduler (its own timeline). cancel()/destroy()
//            stops + releases it; the owning DockItem calls cancel() on destroy.
// Cleanup:   cancel() is idempotent and detaches the actor binding.
// Cost:      Active only while bouncing; integrates in fixed 2ms sub-steps and
//            paints one pose per frame. Zero cost at rest (scheduler stopped).

import { clamp } from '../core/utils.js';
import { FrameScheduler } from './frameScheduler.js';

const GRAVITY = 1900;                       // px/s²
const RESTITUTION = Math.sqrt(0.90);        // default velocity restitution
const IMPACT_EPS = 230;                     // px/s below which a bounce dies
const ATTENTION_PAUSE_MS = 120;             // pause between attention bursts
const SUB_STEP_S = 0.002;                   // 2ms fixed integration slice

export class Bounce {
    // actor: the icon actor (frame-clock source). compose(heightPx, sx, sy):
    // recomposes the icon transform from magnification × this bounce pose.
    // onSettle(): optional, fired once when a bounce fully comes to rest (lets
    // the dock restart its magnification loop, which idles while bouncing).
    constructor(actor, compose, onSettle = null) {
        this._actor = actor;
        this._compose = compose;
        this._onSettle = onSettle;
        this._scheduler = new FrameScheduler(actor, dt => this._frame(dt));

        this._active = false;
        this._state = 'once';     // 'launch' | 'attention' | 'once'
        this._peak = 0;
        this._v0 = 0;
        this._v = 0;
        this._y = 0;
        this._gravity = GRAVITY;
        this._restitution = RESTITUTION;
        this._squash = 0.08;
        this._launchActive = null; // () => bool, for repeating launch bounce
        this._burstsLeft = 0;
        this._pauseLeft = 0;
    }

    get active() {
        return this._active;
    }

    // height px; opts: { state, repeat, decay, softness }.
    start(height = 24, opts = {}) {
        if (height <= 0 || !this._actor) return;
        this._state = opts.state ?? 'once';
        this._peak = height;
        this._launchActive = opts.repeat ?? null;
        this._burstsLeft = this._state === 'attention' ? 3 : 0;
        this._pauseLeft = 0;

        // Softer arc for launch; firmer for feedback bounces.
        const soft = clamp(opts.softness ?? (this._state === 'launch' ? 0.45 : 0.15), 0, 1);
        this._gravity = GRAVITY * (1 - 0.30 * soft);
        this._squash = 0.08 * (1 - 0.35 * soft);

        // Velocity restitution = √decay, so each peak is `decay`× the previous
        // in height.
        const decay = clamp(opts.decay ?? 0.90, 0.30, 0.95);
        this._restitution = Math.sqrt(decay);

        this._launchProjectile(height);
        this._active = true;
        this._scheduler.start();
    }

    // Stop a *launch* loop; the current arc finishes and settles itself.
    stopLaunch() {
        this._launchActive = null;
        if (this._state === 'launch') this._state = 'once';
    }

    // Hard cancel — used on item destroy.
    cancel() {
        this._launchActive = null;
        this._burstsLeft = 0;
        this._pauseLeft = 0;
        this._active = false;
        this._scheduler.stop();
    }

    destroy() {
        this.cancel();
        this._scheduler.destroy();
        this._scheduler = null;
        this._actor = null;
        this._compose = null;
    }

    _launchProjectile(height) {
        this._v0 = Math.sqrt(2 * this._gravity * height);
        this._v = -this._v0;     // upward (screen-negative on the lift axis)
        this._y = 0;             // height above the resting line, px
    }

    _frame(dtMs) {
        if (!this._actor) { this._active = false; return false; }
        let dt = dtMs / 1000;
        dt = Math.min(dt, 0.05);
        if (dt <= 0) return true;

        // Inter-burst pause (attention): hold at rest, keep magnifying.
        if (this._pauseLeft > 0) {
            this._pauseLeft -= dt;
            if (this._pauseLeft > 0) { this._compose(0, 1, 1); return true; }
            this._launchProjectile(this._peak);
        }

        // Fixed sub-steps so the exact impact instant is caught between frames.
        let remaining = dt;
        while (remaining > 0) {
            const h = Math.min(SUB_STEP_S, remaining);
            remaining -= h;
            const ended = this._step(h);
            if (ended === 'stop') {                // bounce fully settled
                this._onSettle?.();
                return false;
            }
            if (ended === 'pause') return true;    // entering attention pause
        }

        // Velocity-driven squash/stretch, strongest low and fast near the floor.
        const v = clamp(Math.abs(this._v) / Math.max(1, this._v0), 0, 1);
        const lowness = 1 - clamp(this._y / Math.max(1, this._peak), 0, 1);
        const grounded = v * lowness;
        const amp = this._squash;
        const s = v * amp;
        const sx = 1 - s + grounded * (amp * 2);   // narrow aloft → wide near floor
        const sy = 1 + s - grounded * (amp * 2);
        this._compose(this._y, sx, sy);
        return true;
    }

    // Advance one fixed sub-step. Returns 'stop' (settled), 'pause' (attention
    // gap), or false (continue this frame).
    _step(h) {
        this._v += this._gravity * h;
        this._y -= this._v * h;
        if (this._y > 0) return false;             // still airborne

        this._y = 0;
        const speed = Math.abs(this._v);
        if (speed > IMPACT_EPS) {
            this._v = -speed * this._restitution;  // rebound
            return false;
        }

        // Arc spent — state-machine decision.
        this._v = 0;
        if (this._state === 'launch' && this._launchActive?.()) {
            this._launchProjectile(this._peak);     // loop launch
            return false;
        }
        if (this._state === 'attention' && this._burstsLeft > 1) {
            this._burstsLeft--;
            this._pauseLeft = ATTENTION_PAUSE_MS / 1000;
            this._compose(0, 1, 1);
            return 'pause';
        }
        this._compose(0, 1, 1);                      // settle
        this._active = false;
        return 'stop';
    }
}
