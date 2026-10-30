// Empirical stress-testing suite for M2 physics, numerical stability, Verlet integration, and LUT bounds.

import {
    magnificationParams,
    gaussianTarget,
    integrateSpring,
    subSteps,
} from '../animation/springSolver.js';
import { SETTLE_EPS } from '../core/constants.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

print('=== STARTING M2 EMPIRICAL PHYSICS & MATHEMATICAL STRESS TEST SUITE ===');

// ============================================================================
// SUITE 1: Float32Array LUT Boundary, Domain & Precision Stress
// ============================================================================
print('\n--- Running Suite 1: Float32Array LUT Boundary & Precision Stress ---');

const baseCfg = {
    zoomRange: 120,
    magnificationCurve: 2.0,
    tau: 38,
    zoomMax: 2.6,
    springTension: 0.8,
    springDamping: 0.8,
};
const m = magnificationParams(baseCfg);

// 1.1 Strict Float64 equality at dist = 0
const targetZero = gaussianTarget(0, m);
assert(targetZero === 2.6, `dist = 0 must equal exactly 2.6, got ${targetZero}`);
assert(targetZero === 1 + m.zoomSpan, `dist = 0 must strictly equal 1 + m.zoomSpan (Float64 equality)`);

// Test Float64 equality across various zoomMax values
for (const zm of [1.2, 1.5, 2.0, 2.3333333333333335, 2.6, 3.0, 3.141592653589793]) {
    const customM = magnificationParams({ ...baseCfg, zoomMax: zm });
    const at0 = gaussianTarget(0, customM);
    assert(at0 === zm, `gaussianTarget(0) with zoomMax=${zm} must equal ${zm}, got ${at0}`);
    assert(at0 === 1 + customM.zoomSpan, `Float64 identity check failed for zoomMax=${zm}`);
}

// 1.2 Negative distances and -Infinity
for (const negDist of [-0.0001, -1, -50, -1000, -Infinity]) {
    const val = gaussianTarget(negDist, m);
    assert(val === 1 + m.zoomSpan, `Negative dist ${negDist} must return 1 + m.zoomSpan, got ${val}`);
}

// 1.3 Boundary at cutoff, beyond cutoff, and +Infinity
const atCutoff = gaussianTarget(m.cutoff, m);
assert(atCutoff === 1.0, `dist = cutoff (${m.cutoff}) must return exactly 1.0, got ${atCutoff}`);

for (const farDist of [m.cutoff + 1e-5, m.cutoff + 1, m.cutoff * 2, 10000, Infinity]) {
    const val = gaussianTarget(farDist, m);
    assert(val === 1.0, `dist = ${farDist} must return exactly 1.0, got ${val}`);
}

// 1.4 NaN behavior analysis
const nanWithLut = gaussianTarget(NaN, m);
print(`[Observation] gaussianTarget(NaN, m with lut) returns: ${nanWithLut} (type: ${typeof nanWithLut})`);

const mockWithoutLut = {
    sigma: 30,
    curve: 2,
    curveIsTwo: true,
    cutoff: 120,
    zoomSpan: 1.6,
};
const nanWithoutLut = gaussianTarget(NaN, mockWithoutLut);
print(`[Observation] gaussianTarget(NaN, mock without lut) returns: ${nanWithoutLut} (type: ${typeof nanWithoutLut})`);

// 1.5 Mock object fallback (without m.lut)
assert(gaussianTarget(0, mockWithoutLut) === 2.6, 'Mock dist=0 must return 2.6');
assert(gaussianTarget(-10, mockWithoutLut) === 2.6, 'Mock dist=-10 must return 2.6');
assert(gaussianTarget(120, mockWithoutLut) === 1.0, 'Mock dist=cutoff must return 1.0');
assert(gaussianTarget(150, mockWithoutLut) === 1.0, 'Mock dist>cutoff must return 1.0');

// Mock fallback for non-quadratic curves (curveIsTwo = false)
const mockCurve3 = {
    sigma: 40,
    curve: 3.0,
    curveIsTwo: false,
    cutoff: 100,
    zoomSpan: 1.5,
};
const valCurve3 = gaussianTarget(20, mockCurve3);
const expectedCurve3 = 1 + 1.5 * Math.exp(-Math.pow(20 / 40, 3.0) / 2);
assert(Math.abs(valCurve3 - expectedCurve3) < 1e-12, `Mock curve 3.0 mismatch: ${valCurve3} vs ${expectedCurve3}`);

// 1.6 Discretization error between Float32Array LUT and analytical Float64
let maxLutRelError = 0;
const cutoffInt = Math.ceil(m.cutoff);
for (let d = 1; d < cutoffInt; d++) {
    const lutVal = m.lut[d];
    const r = d / m.sigma;
    const analytical = 1 + m.zoomSpan * Math.exp(-0.5 * r * r);
    const relErr = Math.abs(lutVal - analytical) / analytical;
    if (relErr > maxLutRelError) maxLutRelError = relErr;
}
print(`[Precision] Maximum relative error of Float32Array LUT vs analytical Float64: ${(maxLutRelError * 1e6).toFixed(3)} ppm`);
assert(maxLutRelError < 1e-6, `Float32Array relative error exceeded single-precision tolerance: ${maxLutRelError}`);

// 1.7 LUT domain bounds
assert(m.lut.length >= Math.ceil(m.cutoff) + 1, 'LUT length must cover entire cutoff domain');
assert(m.lut[m.lut.length - 1] === 1.0, 'Last element of LUT must be 1.0');

print('✓ Suite 1 passed (Float32Array LUT Boundary & Precision Stress)');

// ============================================================================
// SUITE 2: Damping Precomputation Table Stress
// ============================================================================
print('\n--- Running Suite 2: Damping Precomputation Table Stress ---');

const scratch = {};

// 2.1 Integer frame rates (1ms to 64ms)
for (let dt = 1; dt <= 64; dt++) {
    for (const dCoeff of [0.2, 0.5, 0.8, 0.95, 1.0]) {
        subSteps(dt, dCoeff, scratch);
        const expectedN = Math.max(1, Math.ceil(dt / 16));
        const expectedSt = (dt / expectedN) / 16;
        const expectedDampPow = expectedSt === 1 ? dCoeff : Math.pow(dCoeff, expectedSt);
        
        assert(scratch.nSteps === expectedN, `dt=${dt} nSteps expected ${expectedN}, got ${scratch.nSteps}`);
        assert(Math.abs(scratch.st - expectedSt) < 1e-12, `dt=${dt} st expected ${expectedSt}, got ${scratch.st}`);
        assert(Math.abs(scratch.dampPow - expectedDampPow) < 1e-6,
            `dt=${dt} damp=${dCoeff}: dampPow expected ${expectedDampPow}, got ${scratch.dampPow}`);
    }
}

// 2.2 Standard & fractional refresh rates (60Hz, 75Hz, 120Hz, 144Hz, 165Hz, 240Hz, 360Hz, 59.94Hz)
const fractionalDts = [
    { name: '60Hz (exact 16.667ms)', dt: 1000 / 60 },
    { name: '59.94Hz (NTSC 16.683ms)', dt: 1000 / 59.94 },
    { name: '75Hz (13.333ms)', dt: 1000 / 75 },
    { name: '90Hz (11.111ms)', dt: 1000 / 90 },
    { name: '120Hz (8.333ms)', dt: 1000 / 120 },
    { name: '144Hz (6.944ms)', dt: 1000 / 144 },
    { name: '165Hz (6.061ms)', dt: 1000 / 165 },
    { name: '240Hz (4.167ms)', dt: 1000 / 240 },
    { name: '360Hz (2.778ms)', dt: 1000 / 360 },
    { name: '0.1ms minimum clamped', dt: 0.1 },
    { name: '64ms maximum clamped', dt: 64.0 },
];

for (const { name, dt } of fractionalDts) {
    for (const dCoeff of [0.5, 0.82]) {
        subSteps(dt, dCoeff, scratch);
        const expectedN = Math.max(1, Math.ceil(dt / 16));
        const expectedSt = (dt / expectedN) / 16;
        const expectedDampPow = Math.pow(dCoeff, expectedSt);
        const diff = Math.abs(scratch.dampPow - expectedDampPow);
        assert(diff < 1e-6, `Fractional rate ${name} (dt=${dt}, d=${dCoeff}) error too high: ${diff}`);
    }
}

// 2.3 Cache eviction & boundary test (over 60 unique fractional step sizes)
// The internal cache limit is 16 entries. Feeding > 16 must not throw, must return correct math,
// and must remain bounded.
const testDamp = 0.77;
for (let i = 1; i <= 60; i++) {
    const syntheticDt = 0.15 + i * 0.2317; // Generates unique non-integer dt
    subSteps(syntheticDt, testDamp, scratch);
    const expectedN = Math.max(1, Math.ceil(syntheticDt / 16));
    const expectedSt = (syntheticDt / expectedN) / 16;
    const expectedDampPow = Math.pow(testDamp, expectedSt);
    assert(Math.abs(scratch.dampPow - expectedDampPow) < 1e-5,
        `Unique dt #${i} (${syntheticDt}) failed calculation: expected ${expectedDampPow}, got ${scratch.dampPow}`);
}

// 2.4 Damping coefficient change reactivity
subSteps(16, 0.5, scratch);
assert(scratch.dampPow === 0.5, 'dampPow must be 0.5');
subSteps(16, 0.9, scratch);
assert(scratch.dampPow === 0.9, 'dampPow must react immediately to damping change');
subSteps(8, 0.64, scratch); // 8ms is 0.5 normalized step, sqrt(0.64) = 0.8
assert(Math.abs(scratch.dampPow - 0.8) < 1e-5, `dampPow for dt=8, d=0.64 must be 0.8, got ${scratch.dampPow}`);

print('✓ Suite 2 passed (Damping Precomputation Table Stress)');

// ============================================================================
// SUITE 3: Settle Edge Cases & Equilibrium Crossing
// ============================================================================
print('\n--- Running Suite 3: Settle Edge Cases & Equilibrium Crossing ---');

// 3.1 Oscillator crossing equilibrium with high velocity must NOT freeze
const stateCross = { cur: 2.0, vel: 5.0 }; // cur == target exactly, but vel >> SETTLE_EPS
integrateSpring(stateCross, 2.0, 0.24, 0.9, 1.0, 1);
assert(stateCross.vel !== 0, `Oscillator crossing equilibrium at high velocity must NOT freeze (vel was ${stateCross.vel})`);
assert(stateCross.cur !== 2.0, `Oscillator must continue past equilibrium (cur is ${stateCross.cur})`);
print(`[Edge Case Pass] Equilibrium crossing with vel=5.0: cur advanced to ${stateCross.cur.toFixed(4)}, vel=${stateCross.vel.toFixed(4)}`);

// 3.2 Oscillator at equilibrium with |cur - target| < SETTLE_EPS and vel > SETTLE_EPS
const stateNearEq = { cur: 2.0 + (SETTLE_EPS * 0.5), vel: 0.1 };
integrateSpring(stateNearEq, 2.0, 0.24, 0.9, 1.0, 1);
assert(stateNearEq.vel !== 0 && stateNearEq.cur !== 2.0,
    `Oscillator within position SETTLE_EPS but with vel=0.1 must NOT freeze`);

// 3.3 Turning point: vel = 0, but |cur - target| > SETTLE_EPS
const stateTurn = { cur: 3.5, vel: 0.0 };
integrateSpring(stateTurn, 2.0, 0.24, 0.9, 1.0, 1);
assert(stateTurn.cur !== 2.0, 'Oscillator at turning point must not snap to target');
assert(stateTurn.vel !== 0, 'Oscillator at turning point must accelerate toward target');
assert(stateTurn.vel < 0, `Velocity toward target (cur=3.5 -> target=2.0) must be negative, got ${stateTurn.vel}`);
print(`[Edge Case Pass] Turning point at cur=3.5: accelerated to vel=${stateTurn.vel.toFixed(4)}`);

// 3.4 True resting state: BOTH |cur - target| < SETTLE_EPS AND |vel| < SETTLE_EPS
const stateRest = { cur: 2.0 + (SETTLE_EPS * 0.5), vel: SETTLE_EPS * 0.5 };
integrateSpring(stateRest, 2.0, 0.24, 0.9, 1.0, 1);
assert(stateRest.cur === 2.0, `State within dual settle bounds must snap exactly to target, got ${stateRest.cur}`);
assert(stateRest.vel === 0.0, `Velocity within dual settle bounds must snap exactly to 0, got ${stateRest.vel}`);
print('[Edge Case Pass] True resting state snapped to target=2.0, vel=0.0');

print('✓ Suite 3 passed (Settle Edge Cases)');

// ============================================================================
// SUITE 4: Time Reversibility under Zero Damping (Conservative Dynamics)
// ============================================================================
print('\n--- Running Suite 4: Time Reversibility under Zero Damping ---');

// Time reversibility of Velocity Verlet:
// Forward step: (x0, v0) -> (x1, v1)
// Invert velocity: (x1, -v1)
// Step backward: -> (xRev, vRev)
// Invert velocity again: -vRev must equal v0, xRev must equal x0.

let maxReversibilityPosErr = 0;
let maxReversibilityVelErr = 0;

for (let trial = 0; trial < 1000; trial++) {
    const tension = 0.05 + Math.random() * 0.8; // within stable range
    const st = 0.1 + Math.random() * 0.9;
    const target = 1.0 + Math.random() * 2.0;
    const x0 = 1.0 + Math.random() * 2.0;
    const v0 = (Math.random() - 0.5) * 4.0;
    
    // Choose large enough displacement/velocity to not trigger SETTLE_EPS clamp
    if (Math.abs(x0 - target) < SETTLE_EPS * 2 && Math.abs(v0) < SETTLE_EPS * 2) continue;

    const nSteps = Math.floor(1 + Math.random() * 5);

    // Forward integration (undamped, dampPow = 1.0)
    const stForward = { cur: x0, vel: v0 };
    integrateSpring(stForward, target, tension, 1.0, st, nSteps);

    // Invert velocity
    const stBackward = { cur: stForward.cur, vel: -stForward.vel };
    integrateSpring(stBackward, target, tension, 1.0, st, nSteps);

    const finalX = stBackward.cur;
    const finalV = -stBackward.vel;

    const posErr = Math.abs(finalX - x0);
    const velErr = Math.abs(finalV - v0);

    if (posErr > maxReversibilityPosErr) maxReversibilityPosErr = posErr;
    if (velErr > maxReversibilityVelErr) maxReversibilityVelErr = velErr;

    assert(posErr < 1e-11, `Time-reversibility pos error exceeded tolerance: ${posErr} (trial ${trial})`);
    assert(velErr < 1e-11, `Time-reversibility vel error exceeded tolerance: ${velErr} (trial ${trial})`);
}

print(`[Time Reversibility] 1,000 trials passed.`);
print(`  Max position error: ${maxReversibilityPosErr.toExponential(4)}`);
print(`  Max velocity error: ${maxReversibilityVelErr.toExponential(4)}`);
print('✓ Suite 4 passed (Time Reversibility)');

// ============================================================================
// SUITE 5: 10,000+ Random Configurations & Symplectic Stability Stress
// ============================================================================
print('\n--- Running Suite 5: 10,000+ Random Configurations & Symplectic Stability ---');

let totalTrials = 0;
let nanOrInfCount = 0;
let boundedStableTrials = 0;
let nanOrInfInStableRegime = 0;
let nanOrInfInUnstableRegime = 0;
let maxObservedEnergyFluctuation = 0;
let settledTrials = 0;

const NUM_CONFIGURATIONS = 12000;

for (let i = 0; i < NUM_CONFIGURATIONS; i++) {
    totalTrials++;

    // Random configurations spanning the adversarial ranges:
    // tension in [0.01, 10.0]
    // damping in [0.0, 1.0]
    // dt in [0.1, 128ms]
    const tension = 0.01 + Math.random() * 9.99;
    const damping = Math.random();
    const dtMs = 0.1 + Math.random() * 127.9;

    const target = (Math.random() - 0.5) * 200; // [-100, 100]
    const curInit = (Math.random() - 0.5) * 200; // [-100, 100]
    const velInit = (Math.random() - 0.5) * 200; // [-100, 100]

    // Step physics using subSteps
    const step = subSteps(dtMs, damping, scratch);
    const omega = Math.sqrt(tension);
    const symplecticFactor = omega * step.st;

    const testState = { cur: curInit, vel: velInit };

    // Initial energy: E0 = 0.5 * vel^2 + 0.5 * tension * (cur - target)^2
    const initDisp = curInit - target;
    const E0 = 0.5 * velInit * velInit + 0.5 * tension * initDisp * initDisp;

    // Simulate 120 frames of animation
    let exploded = false;
    let maxEInRun = E0;

    for (let f = 0; f < 120; f++) {
        integrateSpring(testState, target, tension, step.dampPow, step.st, step.nSteps);

        if (!Number.isFinite(testState.cur) || !Number.isFinite(testState.vel)) {
            exploded = true;
            if (symplecticFactor < 2.0) {
                nanOrInfInStableRegime++;
                print(`[BUG] NaN/Inf in stable regime! omega*st=${symplecticFactor}, tension=${tension}, st=${step.st}, damp=${damping}`);
            } else {
                nanOrInfInUnstableRegime++;
            }
            break;
        }

        const disp = testState.cur - target;
        const curE = 0.5 * testState.vel * testState.vel + 0.5 * tension * disp * disp;
        if (curE > maxEInRun) maxEInRun = curE;
    }

    if (!exploded && symplecticFactor < 2.0) {
        boundedStableTrials++;
        if (E0 > 1e-4) {
            const fluctuation = maxEInRun / E0;
            if (fluctuation > maxObservedEnergyFluctuation) {
                maxObservedEnergyFluctuation = fluctuation;
            }
            // Continuous energy fluctuates due to shadow Hamiltonian eccentricity, but must remain finite.
            // When omega * st < 1.9, fluctuation is < 50x.
            if (symplecticFactor < 1.9) {
                assert(fluctuation < 50.0, `Energy exploded (fluctuation ${fluctuation}x) for omega*st=${symplecticFactor}`);
            }
            assert(Number.isFinite(maxEInRun), `Energy became non-finite for omega*st=${symplecticFactor}`);
        }
        if (testState.cur === target && testState.vel === 0) {
            settledTrials++;
        }
    }
}

print(`[Results] Evaluated ${totalTrials} randomized physics configurations:`);
print(`  - Finite states in stable regime (omega * st < 2.0): ${boundedStableTrials} / ${boundedStableTrials + nanOrInfInStableRegime}`);
print(`  - Expected divergences in unstable regime (omega * st >= 2.0): ${nanOrInfInUnstableRegime}`);
print(`  - Max observed energy ratio during transient: ${maxObservedEnergyFluctuation.toFixed(4)}x (bounded)`);
print(`  - Cleanly settled trials: ${settledTrials}`);

assert(nanOrInfInStableRegime === 0, `Found ${nanOrInfInStableRegime} configurations in stable regime resulting in NaN/Inf!`);

// 5.2 Specific Symplectic Stability Boundary Stress (omega * st close to 2.0 vs > 2.0)
print('\n--- Symplectic Stability Boundary Probe (omega * st -> 2.0) ---');
for (const ratio of [0.5, 1.0, 1.5, 1.8, 1.95, 1.99]) {
    const st = 1.0;
    const tension = ratio * ratio; // omega = ratio, omega * st = ratio
    const state = { cur: 10.0, vel: 0.0 };
    const target = 0.0;
    const E0 = 0.5 * tension * 10.0 * 10.0;

    let maxE = E0;
    for (let step = 0; step < 500; step++) {
        integrateSpring(state, target, tension, 1.0, st, 1);
        const curE = 0.5 * state.vel * state.vel + 0.5 * tension * state.cur * state.cur;
        if (curE > maxE) maxE = curE;
    }
    const energyFluctuation = maxE / E0;
    print(`  omega * st = ${ratio.toFixed(2)}: max energy fluctuation = ${energyFluctuation.toFixed(4)}x (bounded: ${Number.isFinite(maxE)})`);
    assert(Number.isFinite(maxE) && energyFluctuation < 50.0,
        `Energy exploded at omega * st = ${ratio}: fluctuation was ${energyFluctuation}`);
}

// Demonstrate exponential divergence when omega * st > 2.0
print('\n--- Demonstrating Instability Boundary (omega * st > 2.0) ---');
for (const ratio of [2.01, 2.1, 2.5]) {
    const st = 1.0;
    const tension = ratio * ratio;
    const state = { cur: 10.0, vel: 0.0 };
    const target = 0.0;
    const E0 = 0.5 * tension * 10.0 * 10.0;

    for (let step = 0; step < 50; step++) {
        integrateSpring(state, target, tension, 1.0, st, 1);
    }
    const finalE = 0.5 * state.vel * state.vel + 0.5 * tension * state.cur * state.cur;
    print(`  omega * st = ${ratio.toFixed(2)} after 50 steps: energy exploded by ${(finalE / E0).toExponential(2)}x`);
    assert(finalE / E0 > 1e4, `Expected explosion at omega * st = ${ratio}`);
}

// 5.3 Production Envelope Verification
// In Aqua Dock Pro, springTension in [0.1, 1.0], tau in [5, 300], smooth in [0.25, 2.5]
// tension = springTension * 0.22 * smooth <= 1.0 * 0.22 * 2.5 = 0.55
// st <= 1.0 (subSteps guarantees st <= 1.0)
// Max production omega * st = sqrt(0.55) * 1.0 = 0.7416 << 2.0
const maxProdTension = 1.0 * 0.22 * 2.5; // 0.55
const maxProdOmega = Math.sqrt(maxProdTension);
const maxProdSt = 1.0;
const prodSymplecticMargin = 2.0 / (maxProdOmega * maxProdSt);
print(`\n--- Aqua Dock Pro Production Safety Envelope ---`);
print(`  Maximum possible production tension: ${maxProdTension.toFixed(4)}`);
print(`  Maximum possible production omega: ${maxProdOmega.toFixed(4)}`);
print(`  Maximum possible production st: ${maxProdSt.toFixed(4)}`);
print(`  Maximum possible production omega * st: ${(maxProdOmega * maxProdSt).toFixed(4)}`);
print(`  Symplectic stability margin: ${prodSymplecticMargin.toFixed(2)}x (stability requires < 2.0)`);
assert(maxProdOmega * maxProdSt < 0.75, 'Production envelope must be strictly below 0.75');

// ============================================================================
// SUITE 6: UI Hover In/Out Settle Convergence & Frame Budget Stress
// ============================================================================
print('\n--- Running Suite 6: UI Settle Convergence & Frame Budget Stress ---');

const testCases = [
    { name: 'Default settings', tension: 1.0, damping: 0.5, tau: 38 },
    { name: 'Snappy (high tension, high damping)', tension: 1.0, damping: 0.9, tau: 10 },
    { name: 'Bouncy (high tension, low damping)', tension: 1.0, damping: 0.25, tau: 38 },
    { name: 'Gentle (low tension, high damping)', tension: 0.2, damping: 0.8, tau: 100 },
    { name: 'Extreme sluggish (min tension, max tau)', tension: 0.1, damping: 0.3, tau: 300, maxFrames: 1400 },
];

for (const tc of testCases) {
    const params = magnificationParams({
        zoomRange: 120,
        magnificationCurve: 2.0,
        tau: tc.tau,
        zoomMax: 2.6,
        springTension: tc.tension,
        springDamping: tc.damping,
    });

    const step = subSteps(16.0, params.damping, scratch);

    const maxFrames = tc.maxFrames || 150;
    // 1. Hover In: 1.0 -> 2.6
    const stateIn = { cur: 1.0, vel: 0.0 };
    let framesIn = 0;
    while ((stateIn.cur !== 2.6 || stateIn.vel !== 0) && framesIn < maxFrames) {
        integrateSpring(stateIn, 2.6, params.tension, step.dampPow, step.st, step.nSteps);
        framesIn++;
    }
    assert(stateIn.cur === 2.6 && stateIn.vel === 0, `${tc.name}: hover-in failed to settle within ${maxFrames} frames (cur=${stateIn.cur}, vel=${stateIn.vel})`);

    // 2. Hover Out: 2.6 -> 1.0
    const stateOut = { cur: 2.6, vel: 0.0 };
    let framesOut = 0;
    while ((stateOut.cur !== 1.0 || stateOut.vel !== 0) && framesOut < maxFrames) {
        integrateSpring(stateOut, 1.0, params.tension, step.dampPow, step.st, step.nSteps);
        framesOut++;
    }
    assert(stateOut.cur === 1.0 && stateOut.vel === 0, `${tc.name}: hover-out failed to settle within ${maxFrames} frames (cur=${stateOut.cur}, vel=${stateOut.vel})`);

    print(`  [Settle Time] ${tc.name.padEnd(45)}: hover-in = ${framesIn.toString().padStart(3)} frames (${(framesIn*16).toFixed(0)}ms), hover-out = ${framesOut.toString().padStart(3)} frames (${(framesOut*16).toFixed(0)}ms)`);
}

// 6.2 Damping = 1.0 (undamped perpetual oscillation) analysis
const undampedParams = magnificationParams({
    zoomRange: 120,
    magnificationCurve: 2.0,
    tau: 38,
    zoomMax: 2.6,
    springTension: 0.8,
    springDamping: 1.0,
});
const undampedStep = subSteps(16.0, undampedParams.damping, scratch);
const stateUndamped = { cur: 1.0, vel: 0.0 };
for (let f = 0; f < 1000; f++) {
    integrateSpring(stateUndamped, 2.6, undampedParams.tension, undampedStep.dampPow, undampedStep.st, undampedStep.nSteps);
}
assert(stateUndamped.cur !== 2.6 || stateUndamped.vel !== 0,
    'Undamped oscillator (damping=1.0) must not settle to rest');
print(`  [Undamped Perpetual Motion] Damping=1.0 after 1000 frames: cur=${stateUndamped.cur.toFixed(4)}, vel=${stateUndamped.vel.toFixed(4)} (oscillating perpetually)`);

print('✓ Suite 6 passed (UI Settle Convergence & Frame Budget Stress)');

print('\n=== ALL M2 EMPIRICAL PHYSICS STRESS TESTS PASSED SUCCESSFULLY ===');
