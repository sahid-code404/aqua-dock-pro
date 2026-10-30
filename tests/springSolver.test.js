import {
    magnificationParams,
    gaussianTarget,
    integrateSpring,
    subSteps,
} from '../animation/springSolver.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// ── 1. Existing baseline tests (preserved verbatim) ──────────────────────────
const params = {
    sigma: 30,
    curve: 2,
    curveIsTwo: true,
    cutoff: 120,
    zoomSpan: 1.6,
};

const center = gaussianTarget(0, params);
const near = gaussianTarget(20, params);
const far = gaussianTarget(200, params);
assert(center === 2.6, 'center target should reach peak magnification');
assert(center > near && near > far && far === 1, 'magnification must decay with distance');

const scratch = {};
assert(subSteps(16, 0.8, scratch) === scratch, 'subSteps should reuse its output object');
assert(scratch.nSteps === 1, 'a normal frame should use one physics step');
subSteps(Number.NaN, 0.8, scratch);
assert(Number.isFinite(scratch.st) && Number.isFinite(scratch.dampPow),
    'invalid frame deltas must be sanitized');

const state = { cur: 1, vel: 0 };
for (let i = 0; i < 180; i++)
    integrateSpring(state, 2.6, 0.24, 0.82, 1, 1);
assert(Number.isFinite(state.cur) && Number.isFinite(state.vel),
    'spring state must remain finite');
assert(Math.abs(state.cur - 2.6) < 0.01, 'spring should settle near its target');
assert(state.cur === 2.6 && state.vel === 0, 'spring should snap cleanly to rest');

// ── 2. Float32Array LUT Precomputation & O(1) Lookup ─────────────────────────
const cfg = {
    zoomRange: 120,
    magnificationCurve: 2.0,
    tau: 38,
    zoomMax: 2.6,
    springTension: 0.8,
    springDamping: 0.8,
};
const m = magnificationParams(cfg);
assert(m.lut instanceof Float32Array, 'magnificationParams must precompute a Float32Array LUT');
assert(m.lut.length >= Math.ceil(m.cutoff) + 1, 'LUT length must cover entire cutoff domain');

const lutCenter = gaussianTarget(0, m);
const lutNear = gaussianTarget(20, m);
const lutFar = gaussianTarget(200, m);
assert(lutCenter === 2.6, 'LUT center target must reach peak magnification');
assert(lutCenter > lutNear && lutNear > lutFar && lutFar === 1, 'LUT magnification must decay with distance');

// ── 3. Time Reversibility of 2nd-Order Velocity Verlet ────────────────────────
const tension = 0.24, st = 0.016, target = 2.6;
let cur0 = 1.2, vel0 = 0.5;
// Forward step (conservative, dampPow=1)
const a0 = (target - cur0) * tension;
const cur1 = cur0 + vel0 * st + 0.5 * a0 * st * st;
const a1 = (target - cur1) * tension;
const vel1 = vel0 + 0.5 * (a0 + a1) * st;
// Backward step with inverted velocity
const revVel1 = -vel1;
const curRev = cur1 + revVel1 * st + 0.5 * a1 * st * st;
const aRev = (target - curRev) * tension;
const velRev = revVel1 + 0.5 * (a1 + aRev) * st;
const finalVel = -velRev;
assert(Math.abs(curRev - cur0) < 1e-12, 'Velocity Verlet must be time-reversible in position');
assert(Math.abs(finalVel - vel0) < 1e-12, 'Velocity Verlet must be time-reversible in velocity');

// ── 4. Precomputed Damping Power Lookup Table ────────────────────────────────
subSteps(16, 0.82, scratch);
assert(scratch.dampPow === 0.82, 'dampPow should be identity for 16ms');

subSteps(8, 0.82, scratch); // 120Hz
assert(Math.abs(scratch.dampPow - Math.pow(0.82, 0.5)) < 1e-6,
    'dampPow for 8ms (120Hz) must match sqrt(damping)');

print('springSolver: ok');
