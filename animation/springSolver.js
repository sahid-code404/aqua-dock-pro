// AquaDockPro — magnification math and the per-icon spring integrator.
//
// Purpose:   The two pure numerical kernels behind hover magnification:
//            (1) the Gaussian falloff that maps cursor distance → target scale,
//            (2) a sub-stepped damped-spring integrator that moves each icon's
//            current scale toward that target smoothly and frame-rate-independently.
//            Kept pure (no actors, no allocation) so the engine can call them in
//            a tight loop and so they are unit-testable in isolation.
// Ownership: Stateless functions. Per-icon state (cur/vel) lives on the DockItem.
// Cost:      gaussianTarget: 1 exp + maybe 1 pow. integrateSpring: nSteps cheap
//            FLOPs (nSteps is 1 at ≤16ms frames). No allocation on any path.

import { clamp } from '../core/utils.js';
import { SETTLE_EPS } from '../core/constants.js';

// Derive the frame-invariant magnification constants from a config snapshot.
// Computed once per layout (not per frame) and cached on the layout result.
export function magnificationParams(cfg) {
    const sigma = Math.max(1, cfg.zoomRange / 2.5);
    const curve = clamp(cfg.magnificationCurve, 0.5, 5.0);
    const smooth = clamp(38 / Math.max(5, cfg.tau), 0.25, 2.5);
    return {
        sigma,
        curve,
        curveIsTwo: Math.abs(curve - 2) < 1e-9,
        // Beyond this distance the Gaussian is < ~1e-6 of its peak: treat as 1.
        cutoff: sigma * Math.pow(14, 1 / curve),
        zoomSpan: cfg.zoomMax - 1,
        tension: cfg.springTension * 0.22 * smooth,
        damping: clamp(cfg.springDamping, 0.2, 1.0),
    };
}

// Target scale for an icon whose centre is `dist` px from the (clamped) cursor.
// Returns a value in [1, zoomMax]. `m` is the object from magnificationParams.
export function gaussianTarget(dist, m) {
    if (dist > m.cutoff) return 1;
    const r = dist / m.sigma;
    const rp = m.curveIsTwo ? r * r : Math.pow(r, m.curve);
    return 1 + m.zoomSpan * Math.exp(-rp / 2);
}

// Number of fixed ~16ms physics sub-steps for a frame delta, and the per-step
// damping power. Sub-stepping keeps the spring stable when a frame is long
// (e.g. after a stall) without changing its tuned feel.
export function subSteps(dtMs, damping) {
    const nSteps = Math.max(1, Math.ceil(dtMs / 16));
    const st = (dtMs / nSteps) / 16;       // normalized step (1 == 16ms)
    return { nSteps, st, dampPow: Math.pow(damping, st) };
}

// Advance one icon's spring toward `target`. Mutates `state` ({cur, vel}) in
// place to avoid per-frame allocation. Snaps to target when within SETTLE_EPS.
export function integrateSpring(state, target, tension, dampPow, st, nSteps) {
    let cur = state.cur;
    let vel = state.vel;
    for (let k = 0; k < nSteps; k++) {
        const accel = (target - cur) * tension;
        vel = (vel + accel * st) * dampPow;
        cur += vel * st;
    }
    if (Math.abs(cur - target) < SETTLE_EPS) {
        cur = target;
        vel = 0;
    }
    state.cur = cur;
    state.vel = vel;
}
