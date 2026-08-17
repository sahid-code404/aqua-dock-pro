import { gaussianTarget, integrateSpring, subSteps } from '../animation/springSolver.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

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

print('springSolver: ok');
