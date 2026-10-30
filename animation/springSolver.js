// Pure numerical kernels for hover magnification (Gaussian falloff and spring integration).

import { clamp } from '../core/utils.js';
import { SETTLE_EPS } from '../core/constants.js';

// Precomputed damping power cache for integer and common fractional frame intervals.
let _cachedDamping = -1;
let _dampLut = null;
const _fractionalDampCache = new Map();

/**
 * Precomputes or retrieves cached damping power (damping^st) for frame sub-steps.
 * Eliminates per-frame Math.pow() evaluations during animation ticks.
 *
 * @param {number} damping - Damping coefficient in [0.2, 1.0].
 * @param {number} dtMs - Clamped frame duration in milliseconds [0.1, 64].
 * @param {number} st - Normalized step size (1 == 16ms).
 * @returns {number} Damping power factor for the sub-step.
 */
function getDampPow(damping, dtMs, st) {
    if (st === 1) return damping;

    if (_cachedDamping !== damping) {
        _cachedDamping = damping;
        _dampLut = new Float32Array(65);
        for (let i = 1; i <= 64; i++) {
            const n = Math.max(1, Math.ceil(i / 16));
            const s = (i / n) / 16;
            _dampLut[i] = s === 1 ? damping : Math.pow(damping, s);
        }
        _fractionalDampCache.clear();
    }

    const dtRound = Math.round(dtMs);
    if (Math.abs(dtMs - dtRound) < 1e-4) {
        return _dampLut[dtRound];
    }

    let val = _fractionalDampCache.get(st);
    if (val === undefined) {
        val = Math.pow(damping, st);
        if (_fractionalDampCache.size < 16) {
            _fractionalDampCache.set(st, val);
        }
    }
    return val;
}

// Derive the frame-invariant magnification constants from a config snapshot.
// Computed once per layout (not per frame) and cached on the layout result.
/**
 * Derives frame-invariant magnification constants and precomputes a 1D lookup table (LUT)
 * from a configuration snapshot. Computed once per layout pass to eliminate per-frame allocations.
 *
 * @param {object} cfg - Layout configuration snapshot.
 * @param {number} cfg.zoomRange - Cursor influence radius in pixels.
 * @param {number} cfg.magnificationCurve - Exponential power controlling falloff sharpness.
 * @param {number} cfg.tau - Time constant for motion smoothing.
 * @param {number} cfg.zoomMax - Peak magnification multiplier.
 * @param {number} cfg.springTension - Normalized spring tension.
 * @param {number} cfg.springDamping - Normalized spring damping coefficient.
 * @returns {{ sigma: number, curve: number, curveIsTwo: boolean, cutoff: number, zoomSpan: number, tension: number, damping: number, lut: Float32Array }} Precomputed magnification constants and Float32Array LUT.
 */
export function magnificationParams(cfg) {
    const sigma = Math.max(1, cfg.zoomRange / 2.5);
    const curve = clamp(cfg.magnificationCurve, 0.5, 5.0);
    const smooth = clamp(38 / Math.max(5, cfg.tau), 0.25, 2.5);
    const curveIsTwo = Math.abs(curve - 2) < 1e-9;
    const cutoff = sigma * Math.pow(14, 1 / curve);
    const zoomSpan = cfg.zoomMax - 1;

    // Precompute 1D Float32Array lookup table for distance indices 0 to Math.ceil(cutoff) + 1.
    // Beyond cutoff, magnification is 1.0.
    const maxIndex = Math.ceil(cutoff) + 1;
    const lut = new Float32Array(maxIndex + 1);
    const invSigma = 1 / sigma;
    for (let d = 0; d <= maxIndex; d++) {
        if (d >= cutoff) {
            lut[d] = 1.0;
        } else {
            const r = d * invSigma;
            const rp = curveIsTwo ? r * r : Math.pow(r, curve);
            lut[d] = 1 + zoomSpan * Math.exp(-rp * 0.5);
        }
    }

    return {
        sigma,
        curve,
        curveIsTwo,
        cutoff,
        zoomSpan,
        tension: cfg.springTension * 0.22 * smooth,
        damping: clamp(cfg.springDamping, 0.2, 1.0),
        lut,
    };
}

// Target scale for an icon whose centre is `dist` px from the (clamped) cursor.
// Returns a value in [1, zoomMax]. `m` is the object from magnificationParams.
/**
 * Computes the target magnification scale factor for an icon at a given pixel distance from the cursor.
 * Uses the precomputed 1D Float32Array LUT for O(1) evaluation in hot pointer motion paths.
 *
 * @param {number} dist - Distance in pixels from the cursor to the item center.
 * @param {object} m - Magnification parameters returned by {@link magnificationParams}.
 * @returns {number} Target magnification scale in the range [1, zoomMax].
 */
export function gaussianTarget(dist, m) {
    if (dist <= 0) return 1 + m.zoomSpan;
    if (!Number.isFinite(dist) || dist >= m.cutoff) return 1;
    if (!m.lut) {
        const r = dist / m.sigma;
        const rp = m.curveIsTwo ? r * r : Math.pow(r, m.curve);
        return 1 + m.zoomSpan * Math.exp(-rp / 2);
    }
    const d = Math.round(dist);
    return d >= m.cutoff ? 1 : m.lut[d];
}

// Number of fixed ~16ms physics sub-steps for a frame delta, and the per-step
// damping power. Sub-stepping keeps the spring stable when a frame is long
// (e.g. after a stall) without changing its tuned feel.
/**
 * Calculates the number of physics sub-steps and the per-step damping power for a frame delta.
 * Sub-stepping ensures numerical stability during frame drops without altering tuned spring dynamics.
 *
 * @param {number} dtMs - Elapsed frame duration in milliseconds.
 * @param {number} damping - Damping coefficient in the range [0.2, 1.0].
 * @param {object} [out={}] - Optional reusable output object to avoid allocations.
 * @returns {{ nSteps: number, st: number, dampPow: number }} Populated step count, normalized step size, and damping power.
 */
export function subSteps(dtMs, damping, out = {}) {
    dtMs = Number.isFinite(dtMs) ? clamp(dtMs, 0.1, 64) : 16;
    const nSteps = Math.max(1, Math.ceil(dtMs / 16));
    const st = (dtMs / nSteps) / 16;       // normalized step (1 == 16ms)
    out.nSteps = nSteps;
    out.st = st;
    out.dampPow = getDampPow(damping, dtMs, st);
    return out;
}

// Advance one icon's spring toward `target`. Mutates `state` ({cur, vel}) in
// place to avoid per-frame allocation. Snaps to target when within SETTLE_EPS.
/**
 * Advances a single icon spring state towards the target scale using Velocity Verlet numerical integration.
 * Mutates state in-place to ensure zero allocation churn in the animation frame loop.
 *
 * @param {{ cur: number, vel: number }} state - Spring state object with current position and velocity.
 * @param {number} target - Target scale value.
 * @param {number} tension - Effective spring stiffness/tension.
 * @param {number} dampPow - Per-step damping power factor.
 * @param {number} st - Normalized time step size (1 == 16ms).
 * @param {number} nSteps - Number of integration sub-steps.
 * @returns {void}
 */
export function integrateSpring(state, target, tension, dampPow, st, nSteps) {
    let cur = state.cur;
    let vel = state.vel;
    const halfSt = 0.5 * st;
    const halfStSq = halfSt * st;
    for (let k = 0; k < nSteps; k++) {
        const a0 = (target - cur) * tension;
        const curNext = cur + vel * st + a0 * halfStSq;
        const a1 = (target - curNext) * tension;
        vel = (vel + (a0 + a1) * halfSt) * dampPow;
        cur = curNext;
    }
    if (Math.abs(cur - target) < SETTLE_EPS && Math.abs(vel) < SETTLE_EPS) {
        cur = target;
        vel = 0;
    }
    state.cur = cur;
    state.vel = vel;
}
