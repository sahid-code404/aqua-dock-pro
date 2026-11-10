// Pure numerical kernels for hover magnification (Gaussian falloff and spring integration).

import { clamp } from '../core/utils.js';
import { SETTLE_EPS } from '../core/constants.js';

export function resetSpringSolverCache() {
    // Preserved for test compatibility.
}

/**
 * Derives magnification constants and precomputes a 1D lookup table
 * from a configuration snapshot.
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

/**
 * Computes the target magnification scale factor for an icon at a given pixel distance from the cursor.
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

/**
 * Calculates the number of physics sub-steps and the per-step damping power for a frame delta.
 *
 * @param {number} dtMs - Elapsed frame duration in milliseconds.
 * @param {number} damping - Damping coefficient in the range [0.2, 1.0].
 * @param {object} [out={}] - Optional reusable output object.
 * @returns {{ nSteps: number, st: number, dampPow: number }} Populated step count, normalized step size, and damping power.
 */
export function subSteps(dtMs, damping, out = {}) {
    dtMs = Number.isFinite(dtMs) ? clamp(dtMs, 0.1, 64) : 16;
    const nSteps = Math.max(1, Math.ceil(dtMs / 16));
    const st = (dtMs / nSteps) / 16;
    out.nSteps = nSteps;
    out.st = st;
    out.dampPow = st === 1 ? damping : Math.pow(damping, st);
    return out;
}

/**
 * Advances a single icon spring state towards the target scale.
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
