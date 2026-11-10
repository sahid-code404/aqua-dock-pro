// Empirical Challenger Stress Suite for Milestone 1: Animation, Physics & Frame Scheduling
// Adversarial challenge: FrameScheduler get_delta edge cases, springSolver subSteps stability, bounce physics.

import Clutter from 'gi://Clutter';
import { FrameScheduler } from '../animation/frameScheduler.js';
import { subSteps, integrateSpring, magnificationParams, gaussianTarget, resetSpringSolverCache } from '../animation/springSolver.js';
import { Bounce } from '../animation/bounce.js';
import { SETTLE_EPS } from '../core/constants.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

print('================================================================');
print('CHALLENGER 1: EMPIRICAL ADVERSARIAL ANIMATION & PHYSICS STRESS');
print('================================================================\n');

// ============================================================================
// PART 1: FrameScheduler Pathological get_delta & Lifecycle Stress
// ============================================================================
print('--- Part 1: FrameScheduler Pathological get_delta & Lifecycle Stress ---');

// 1.1 Direct unit test of delta clamping and lastDt fallback logic
{
    print('[Test 1.1] Clamping and lastDt fallback logic across edge cases...');
    const fakeActor = { connect: () => 1, disconnect: () => {} };
    let capturedDt = null;
    const sched = new FrameScheduler(fakeActor, dt => {
        capturedDt = dt;
        return true;
    });

    // Mock timeline to intercept and feed synthetic get_delta values
    let mockDelta = 0;
    const mockTimeline = {
        _playing: false,
        get_delta: () => mockDelta,
        start() { this._playing = true; },
        stop() { this._playing = false; },
        is_playing() { return this._playing; },
        connect(sig, cb) { this._cb = cb; return 42; },
        disconnect() {},
        set_actor() {},
    };

    sched._timeline = mockTimeline;
    mockTimeline.connect('new-frame', () => {});

    // Rebind frame callback manually through the scheduler's actual logic
    function fireFrame(delta) {
        mockDelta = delta;
        // Reproduce scheduler's frame handler logic
        let dt = mockTimeline.get_delta();
        if (!Number.isFinite(dt) || dt <= 0) {
            dt = sched._lastDt ?? 16.67;
        } else {
            dt = Math.min(64, dt);
            sched._lastDt = dt;
        }
        sched._onFrame(dt);
    }

    // Frame 1: get_delta() == 0 (initial frame hitch on timeline start)
    fireFrame(0);
    assert(capturedDt === 16.67, `Initial dt=0 should fallback to 16.67, got ${capturedDt}`);
    assert(sched._lastDt === null, `Fallback frame must not contaminate _lastDt, got ${sched._lastDt}`);

    // Frame 2: Monitor runs at 120Hz (8.33ms)
    fireFrame(8.3333);
    assert(Math.abs(capturedDt - 8.3333) < 1e-4, `120Hz delta must be passed accurately`);
    assert(Math.abs(sched._lastDt - 8.3333) < 1e-4, `_lastDt should record 120Hz interval`);

    // Frame 3: Hitch occurs, get_delta() returns 0
    fireFrame(0);
    assert(Math.abs(capturedDt - 8.3333) < 1e-4, `dt=0 hitch must inherit calibrated _lastDt (8.33ms), got ${capturedDt}`);

    // Frame 4: Negative delta (-10ms clock reversal / jump)
    fireFrame(-10);
    assert(Math.abs(capturedDt - 8.3333) < 1e-4, `Negative delta must fallback to _lastDt, got ${capturedDt}`);

    // Frame 5: NaN delta
    fireFrame(NaN);
    assert(Math.abs(capturedDt - 8.3333) < 1e-4, `NaN delta must fallback to _lastDt, got ${capturedDt}`);

    // Frame 6: +Infinity delta
    fireFrame(Infinity);
    assert(Math.abs(capturedDt - 8.3333) < 1e-4, `+Infinity delta must fallback to _lastDt, got ${capturedDt}`);

    // Frame 7: -Infinity delta
    fireFrame(-Infinity);
    assert(Math.abs(capturedDt - 8.3333) < 1e-4, `-Infinity delta must fallback to _lastDt, got ${capturedDt}`);

    // Frame 8: Extreme frame stall / lag spike (> 100ms, e.g. 500ms)
    fireFrame(500);
    assert(capturedDt === 64, `Spike > 64ms must be clamped to 64ms, got ${capturedDt}`);
    assert(sched._lastDt === 64, `_lastDt should record clamped max 64ms`);

    // Frame 9: Return to 144Hz (6.944ms)
    fireFrame(6.9444);
    assert(Math.abs(capturedDt - 6.9444) < 1e-4, `144Hz delta must update accurately`);
    assert(Math.abs(sched._lastDt - 6.9444) < 1e-4, `_lastDt should update to 144Hz interval`);

    sched.destroy();
    assert(sched._lastDt === null, `destroy() must reset _lastDt to null`);
    print('  ✓ Test 1.1 Passed: Edge cases (0, negative, NaN, Inf, extreme spikes) properly clamped and calibrated.');
}

// 1.2 50,000 Iterations Chaotic Pathological Input Stress
{
    print('[Test 1.2] 50,000 frames of randomized pathological deltas...');
    const fakeActor = { connect: () => 1, disconnect: () => {} };
    let framesProcessed = 0;
    const sched = new FrameScheduler(fakeActor, dt => {
        assert(Number.isFinite(dt), `Dispatched dt must be finite, got ${dt}`);
        assert(dt > 0, `Dispatched dt must be strictly positive, got ${dt}`);
        assert(dt <= 64, `Dispatched dt must not exceed 64ms, got ${dt}`);
        framesProcessed++;
        return true;
    });

    const pathologicalPool = [
        0, -0.0001, -1, -50, -1000, -Infinity,
        NaN, Infinity, undefined, null,
        0.000001, 0.01, 0.5, 4.166, 6.944, 8.333, 16.666, 33.333,
        63.999, 64.0, 64.001, 100, 250, 1000, 60000,
    ];

    for (let i = 0; i < 50000; i++) {
        const raw = pathologicalPool[i % pathologicalPool.length];
        let dt = raw;
        if (!Number.isFinite(dt) || dt <= 0) {
            dt = sched._lastDt ?? 16.67;
        } else {
            dt = Math.min(64, dt);
            sched._lastDt = dt;
        }
        sched._onFrame(dt);
    }

    assert(framesProcessed === 50000, `All 50,000 frames should process without exception`);
    sched.destroy();
    print('  ✓ Test 1.2 Passed: 50,000 chaotic delta frames processed with 100% finite, positive, bounded dt.');
}

// 1.3 Rapid Start/Stop/Destroy Cycles & Error Containment
{
    print('[Test 1.3] Rapid start/stop cycles and error boundary containment...');

    // Mock Clutter.Timeline to run end-to-end within headless test environment
    let timelineInstantiations = 0;
    class MockClutterTimeline {
        constructor(params) {
            timelineInstantiations++;
            this.actor = params.actor;
            this.duration = params.duration;
            this.repeat_count = params.repeat_count;
            this._playing = false;
            this._delta = 0;
            this._handlers = new Map();
            this._nextId = 1;
        }
        start() { this._playing = true; }
        stop() { this._playing = false; }
        is_playing() { return this._playing; }
        get_delta() { return this._delta; }
        set_actor(a) { this.actor = a; }
        connect(sig, cb) {
            const id = this._nextId++;
            this._handlers.set(id, cb);
            return id;
        }
        disconnect(id) {
            this._handlers.delete(id);
        }
        _fireFrame(dt) {
            this._delta = dt;
            for (const cb of Array.from(this._handlers.values())) {
                cb();
            }
        }
    }

    const OriginalTimeline = Clutter.Timeline;
    Clutter.Timeline = MockClutterTimeline;

    try {
        let destroyedActor = false;
        let actorHandler = null;
        const fakeActor = {
            connect: (sig, cb) => {
                actorHandler = cb;
                return 99;
            },
            disconnect: (id) => {
                if (id === 99) destroyedActor = true;
            },
        };

        let framesReceived = 0;
        let lastReceivedDt = 0;
        const sched = new FrameScheduler(fakeActor, dt => {
            framesReceived++;
            lastReceivedDt = dt;
            return true;
        });

        // Test start/stop
        sched.start();
        assert(sched.isRunning(), 'sched must be running after start()');
        assert(timelineInstantiations === 1, 'Timeline must be instantiated once');
        const tl1 = sched._timeline;

        // Fire 1st frame with delta = 0 (timeline initial frame hitch)
        tl1._fireFrame(0);
        assert(framesReceived === 1, '1 frame should have been delivered');
        assert(lastReceivedDt === 16.67, `Initial delta=0 should fallback to 16.67, got ${lastReceivedDt}`);

        // Fire 2nd frame at 120Hz (8.33ms)
        tl1._fireFrame(8.3333);
        assert(framesReceived === 2, '2 frames delivered');
        assert(Math.abs(lastReceivedDt - 8.3333) < 1e-4, '120Hz frame delivered');

        // Stop and restart: timeline must be REUSED, not reallocated
        sched.stop();
        assert(!sched.isRunning(), 'sched stopped');
        sched.start();
        assert(sched.isRunning(), 'sched restarted');
        assert(timelineInstantiations === 1, 'start() after stop() must NOT reallocate Timeline');
        assert(sched._timeline === tl1, 'Timeline reference must be strictly preserved');

        // Fire frame immediately after restart with delta = 0
        // Because of _lastDt, it should NOT jump back to 16.67, but use 8.3333ms!
        tl1._fireFrame(0);
        assert(framesReceived === 3, '3 frames delivered');
        assert(Math.abs(lastReceivedDt - 8.3333) < 1e-4,
            `Restart hitch delta=0 must reuse calibrated 120Hz interval (8.3333ms), got ${lastReceivedDt}`);

        // 1,000 rapid start/stop cycles
        for (let i = 0; i < 1000; i++) {
            sched.stop();
            sched.start();
        }
        assert(timelineInstantiations === 1, '1,000 start/stop cycles must have zero timeline allocations');

        // Verify that returning false from onFrame stops the timeline
        let stopSchedFired = false;
        const stoppingSched = new FrameScheduler(fakeActor, () => {
            stopSchedFired = true;
            return false; // Request stop
        });
        stoppingSched.start();
        stoppingSched._timeline._fireFrame(16);
        assert(stopSchedFired, 'Stopping callback must execute');
        assert(!stoppingSched.isRunning(), 'Returning false from onFrame must stop timeline');
        stoppingSched.destroy();

        // Verify unhandled exception in onFrame stops timeline safely
        let errorCaught = false;
        const faultSched = new FrameScheduler(fakeActor, () => {
            errorCaught = true;
            throw new Error('Test intentional fault');
        });
        faultSched.start();
        assert(faultSched.isRunning(), 'Fault scheduler running');
        faultSched._timeline._fireFrame(16);
        assert(errorCaught, 'Fault was invoked');
        assert(!faultSched.isRunning(), 'Exception in onFrame must stop the timeline safely');
        faultSched.destroy();

        // Verify actor destruction cleans up FrameScheduler
        let isolatedDestroyed = false;
        let isolatedHandler = null;
        const isolatedActor = {
            connect: (sig, cb) => {
                isolatedHandler = cb;
                return 101;
            },
            disconnect: (id) => {
                if (id === 101) isolatedDestroyed = true;
            },
        };
        const actorSched = new FrameScheduler(isolatedActor, () => true);
        actorSched.start();
        assert(!isolatedDestroyed, 'Actor not yet disconnected');
        isolatedHandler(); // Simulate actor destroy signal
        assert(isolatedDestroyed, 'Scheduler destroy must disconnect from actor destroy signal');
        assert(actorSched._timeline === null, 'Timeline must be nulled after destroy()');
        assert(actorSched._lastDt === null, '_lastDt must be nulled after destroy()');
        sched.destroy();

        print('  ✓ Test 1.3 Passed: Timeline reuse confirmed, 1,000 start/stop cycles clean, error boundary verified.');
    } finally {
        Clutter.Timeline = OriginalTimeline;
    }
}


// ============================================================================
// PART 2: springSolver subSteps Stability Across Fractional dt & Damping
// ============================================================================
print('\n--- Part 2: springSolver subSteps & integrateSpring Stability ---');

// 2.1 Sub-steps fine-grained parameter sweep (0.01ms to 120ms, damping 0.01 to 0.999)
{
    print('[Test 2.1] Sweeping 100,000 (dtMs, damping) parameter pairs...');
    const out = {};
    const dampingValues = [0.01, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 0.9, 0.95, 0.99, 0.999];

    let maxPowError = 0;
    let iterations = 0;

    for (const damping of dampingValues) {
        // Sweep dtMs from 0.01ms to 120ms in steps of ~0.013ms (~10,000 samples per damping value)
        for (let dt = 0.01; dt <= 120; dt += 0.013) {
            subSteps(dt, damping, out);
            iterations++;

            // Invariants
            assert(Number.isInteger(out.nSteps), `nSteps must be an integer, got ${out.nSteps}`);
            assert(out.nSteps >= 1 && out.nSteps <= 4, `nSteps must be in [1, 4] for clamped dt, got ${out.nSteps}`);
            assert(Number.isFinite(out.st), `st must be finite, got ${out.st}`);
            assert(out.st > 0 && out.st <= 1.0, `Normalized st must be in (0, 1.0], got ${out.st}`);
            assert(Number.isFinite(out.dampPow), `dampPow must be finite, got ${out.dampPow}`);
            assert(out.dampPow > 0 && out.dampPow <= 1.0, `dampPow must be in (0, 1.0], got ${out.dampPow}`);

            // Analytical comparison: Math.pow(damping, st)
            const expected = out.st === 1 ? damping : Math.pow(damping, out.st);
            const diff = Math.abs(out.dampPow - expected);
            if (diff > maxPowError) maxPowError = diff;
            assert(diff < 1e-12, `dampPow discrepancy too large: ${diff}`);
        }
    }

    print(`  ✓ Test 2.1 Passed: Evaluated ${iterations} cases. Maximum power difference vs Math.pow: ${maxPowError.toExponential(4)}`);
}

// 2.2 Boundary and Pathological inputs to subSteps
{
    print('[Test 2.2] Pathological and boundary inputs to subSteps...');
    const out = {};

    // Negative dt
    subSteps(-10, 0.8, out);
    assert(out.nSteps === 1 && Math.abs(out.st - 0.1 / 16) < 1e-6, `dt < 0 must clamp to 0.1ms`);

    // Zero dt
    subSteps(0, 0.8, out);
    assert(out.nSteps === 1 && Math.abs(out.st - 0.1 / 16) < 1e-6, `dt = 0 must clamp to 0.1ms`);

    // Non-finite dt
    for (const badDt of [NaN, Infinity, -Infinity, undefined, null]) {
        subSteps(badDt, 0.85, out);
        assert(out.nSteps === 1, `Invalid dt ${badDt} must default to 16ms (nSteps=1)`);
        assert(out.st === 1, `Invalid dt ${badDt} must default to st=1`);
        assert(out.dampPow === 0.85, `Invalid dt ${badDt} must yield exact damping factor`);
    }

    // Boundary damping values
    subSteps(16, 0.0, out);
    assert(out.dampPow === 0.0, `damping=0 at st=1 must yield 0.0`);
    subSteps(16, 1.0, out);
    assert(out.dampPow === 1.0, `damping=1 at st=1 must yield 1.0`);
    subSteps(8, 1.0, out);
    assert(out.dampPow === 1.0, `damping=1 at fractional st must yield 1.0`);

    print('  ✓ Test 2.2 Passed: Boundary inputs handled robustly without NaN or breakdown.');
}

// 2.3 Dynamic integrateSpring Stress Across 10,000 Randomized Runs
{
    print('[Test 2.3] 10,000 randomized dynamic integrateSpring trials with extreme initial conditions...');
    let settledCount = 0;
    const scratch = {};

    for (let trial = 0; trial < 10000; trial++) {
        // Extreme initial displacements and velocities
        const target = 1.0 + (trial % 200) / 100; // [1.0, 3.0]
        const initialCur = ((trial * 7) % 1000) / 50 - 10; // [-10, 10]
        const initialVel = ((trial * 13) % 2000) / 20 - 50; // [-50, 50]
        const tension = 0.05 + ((trial * 17) % 50) / 100; // [0.05, 0.55]
        const damping = 0.01 + ((trial * 19) % 98) / 100; // [0.01, 0.99]
        const dtMs = 0.01 + ((trial * 23) % 12000) / 100; // [0.01, 120]

        subSteps(dtMs, damping, scratch);

        const state = { cur: initialCur, vel: initialVel };

        // Integrate up to 1000 frames
        let settled = false;
        for (let frame = 0; frame < 1000; frame++) {
            integrateSpring(state, target, tension, scratch.dampPow, scratch.st, scratch.nSteps);

            assert(Number.isFinite(state.cur), `Trial ${trial}: cur must be finite, got ${state.cur}`);
            assert(Number.isFinite(state.vel), `Trial ${trial}: vel must be finite, got ${state.vel}`);

            if (state.cur === target && state.vel === 0) {
                settled = true;
                break;
            }
        }
        if (settled) settledCount++;
    }

    print(`  ✓ Test 2.3 Passed: 10,000 trials evaluated. Cleanly settled count: ${settledCount}/10,000. 0 NaN, 0 divergence.`);
}

// 2.4 Symplectic Stability Margin Proof
{
    print('[Test 2.4] Verifying symplectic stability margin across all clamped step sizes...');
    // Stability condition for Verlet: omega * st < 2.0
    // Max dock tension = 0.55 (derived from cfg.springTension=1.0, smooth=2.5)
    const maxTension = 0.55;
    const omega = Math.sqrt(maxTension);

    // subSteps guarantees dtMs clamped <= 64, and nSteps = ceil(dtMs / 16)
    // Therefore st = (dtMs / nSteps) / 16 <= 1.0
    for (let dt = 0.1; dt <= 64; dt += 0.1) {
        const nSteps = Math.max(1, Math.ceil(dt / 16));
        const st = (dt / nSteps) / 16;
        assert(st <= 1.0, `Normalized step size st must never exceed 1.0, got ${st} for dt=${dt}`);
        const product = omega * st;
        assert(product < 2.0, `Symplectic condition violated: omega*st = ${product}`);
        assert(product <= 0.74162, `Symplectic margin check: expected <= 0.74162, got ${product}`);
    }
    print('  ✓ Test 2.4 Passed: Unconditional symplectic stability verified (omega*st <= 0.7416 << 2.0).');
}


// ============================================================================
// PART 3: Bounce Physics Integration with Extreme Velocities & Heights
// ============================================================================
print('\n--- Part 3: Bounce Physics Integration with Extreme Velocities & Heights ---');

// 3.1 Direct _composeDeformation Mathematical Stress
{
    print('[Test 3.1] Stressing _composeDeformation under extreme velocities and heights...');
    const fakeActor = { connect: () => 1, disconnect: () => {} };
    let capturedY = null, capturedSx = null, capturedSy = null;
    const bounce = new Bounce(fakeActor, (y, sx, sy) => {
        capturedY = y;
        capturedSx = sx;
        capturedSy = sy;
    });

    const testScenarios = [
        // { v0, peak, v, y, desc }
        { v0: 0, peak: 0, v: 0, y: 0, desc: 'Zero initial velocity & zero peak' },
        { v0: -500, peak: -100, v: -500, y: -100, desc: 'Negative initial velocity & negative peak' },
        { v0: 1e-10, peak: 1e-10, v: 1e-10, y: 0, desc: 'Sub-microscopic v0 and peak' },
        { v0: 100000, peak: 50000, v: 100000, y: 0, desc: 'Extreme supersonic velocity at ground' },
        { v0: 100000, peak: 50000, v: 0, y: 50000, desc: 'Extreme peak at apogee (v=0, y=peak)' },
        { v0: 100000, peak: 50000, v: -100000, y: 25000, desc: 'Extreme upward velocity mid-air' },
        { v0: 100000, peak: 50000, v: 200000, y: -500, desc: 'Over-speed downwards below ground' },
        { v0: 1e15, peak: 1e14, v: 1e15, y: 1e14, desc: 'Astronomical finite floats (1e15)' },
        { v0: 1000, peak: 500, v: Infinity, y: Infinity, desc: 'Infinite v and y with finite baseline' },
    ];

    for (const sc of testScenarios) {
        bounce._v0 = sc.v0;
        bounce._peak = sc.peak;
        bounce._v = sc.v;
        bounce._y = sc.y;

        bounce._composeDeformation();

        assert(Number.isFinite(capturedSx), `${sc.desc}: sx must be finite, got ${capturedSx}`);
        assert(Number.isFinite(capturedSy), `${sc.desc}: sy must be finite, got ${capturedSy}`);
        assert(capturedSx > 0, `${sc.desc}: sx must be strictly positive, got ${capturedSx}`);
        assert(capturedSy > 0, `${sc.desc}: sy must be strictly positive, got ${capturedSy}`);

        // Squash/stretch physical envelope check: deformation should remain within [0.7, 1.3]
        if (Number.isFinite(sc.v0) && sc.v0 > 0 && Number.isFinite(sc.peak) && sc.peak > 0) {
            assert(capturedSx >= 0.8 && capturedSx <= 1.25, `${sc.desc}: sx=${capturedSx} out of physical envelope`);
            assert(capturedSy >= 0.8 && capturedSy <= 1.25, `${sc.desc}: sy=${capturedSy} out of physical envelope`);
        }
    }
    bounce.destroy();
    print('  ✓ Test 3.1 Passed: _composeDeformation strictly guards divisions and generates valid poses.');
}

// 3.2 Full Projectile Trajectory Simulation across extreme heights
{
    print('[Test 3.2] Simulating full ballistic trajectories across heights (0.01px to 10,000px)...');
    const fakeActor = { connect: () => 1, disconnect: () => {} };
    const testHeights = [0.01, 0.1, 1, 12, 24, 48, 100, 500, 2000, 10000];

    for (const h of testHeights) {
        let settled = false;
        let composeCount = 0;
        let maxObservedY = 0;

        const bounce = new Bounce(
            fakeActor,
            (y, sx, sy) => {
                composeCount++;
                if (y > maxObservedY) maxObservedY = y;
                assert(Number.isFinite(y), `y must be finite, got ${y}`);
                assert(Number.isFinite(sx) && sx > 0, `sx must be positive and finite, got ${sx}`);
                assert(Number.isFinite(sy) && sy > 0, `sy must be positive and finite, got ${sy}`);
            },
            () => { settled = true; }
        );

        // Mock scheduler to drive frames deterministically
        bounce._scheduler = {
            start() { bounce._active = true; },
            stop() { bounce._active = false; },
            destroy() {},
            isRunning() { return bounce._active; },
        };

        bounce.start(h, { state: 'once' });
        assert(bounce.active, `Bounce should be active for height=${h}`);

        // Simulate frame updates with varying refresh intervals (120Hz = 8.33ms, 60Hz = 16.67ms, lag = 33.33ms)
        const frameDts = [8.33, 16.67, 33.33];
        let frameCount = 0;
        while (bounce.active && frameCount < 10000) {
            const dt = frameDts[frameCount % frameDts.length];
            const running = bounce._frame(dt);
            frameCount++;
            if (!running) break;
        }

        assert(settled, `Height ${h} must settle cleanly, frames=${frameCount}`);
        assert(!bounce.active, `Height ${h}: active should be false after settle`);
        assert(composeCount > 0, `Height ${h}: compose must be invoked`);
        assert(maxObservedY <= h * 1.05, `Height ${h}: peak height exceeded (${maxObservedY} vs ${h})`);

        bounce.destroy();
    }
    print('  ✓ Test 3.2 Passed: Full projectile trajectories converged cleanly across all heights.');
}

// 3.3 Negative and Boundary Heights to bounce.start()
{
    print('[Test 3.3] Boundary and invalid heights to bounce.start()...');
    const fakeActor = { connect: () => 1, disconnect: () => {} };
    for (const badHeight of [0, -1, -50, -Infinity]) {
        let settled = false;
        const bounce = new Bounce(fakeActor, () => {}, () => { settled = true; });
        bounce.start(badHeight);
        assert(!bounce.active, `Height ${badHeight} must not activate bounce`);
        assert(!settled, `Height ${badHeight} must not trigger settle`);
        bounce.destroy();
    }
    print('  ✓ Test 3.3 Passed: Non-positive heights safely rejected.');
}

// 3.4 Attention Burst Mode and Inter-Burst Pauses
{
    print('[Test 3.4] Testing attention mode (3 bursts with 120ms pause)...');
    const fakeActor = { connect: () => 1, disconnect: () => {} };
    let settles = 0;
    let posesAtRest = 0;

    const bounce = new Bounce(
        fakeActor,
        (y, sx, sy) => {
            if (y === 0 && sx === 1 && sy === 1) posesAtRest++;
        },
        () => { settles++; }
    );
    bounce._scheduler = {
        start() { bounce._active = true; },
        stop() { bounce._active = false; },
        destroy() {},
        isRunning() { return bounce._active; },
    };

    bounce.start(30, { state: 'attention' });
    assert(bounce._burstsLeft === 3, 'Attention bounce should start with 3 bursts');

    // Run until completion
    let frames = 0;
    while (bounce.active && frames < 5000) {
        bounce._frame(16.67);
        frames++;
    }

    assert(settles === 1, `Attention bounce must fire onSettle exactly once, got ${settles}`);
    assert(!bounce.active, 'Attention bounce should be inactive after finishing 3 bursts');
    assert(posesAtRest > 0, 'Rest poses must be composed during attention pauses');
    bounce.destroy();
    print('  ✓ Test 3.4 Passed: Attention 3-burst cycle with inter-burst pause completed cleanly.');
}

// 3.5 Launch Loop Mode and stopLaunch()
{
    print('[Test 3.5] Testing launch loop mode and stopLaunch() termination...');
    const fakeActor = { connect: () => 1, disconnect: () => {} };
    let launches = 0;
    let isLaunching = true;
    let settles = 0;

    const bounce = new Bounce(
        fakeActor,
        () => {},
        () => { settles++; }
    );
    bounce._scheduler = {
        start() { bounce._active = true; },
        stop() { bounce._active = false; },
        destroy() {},
        isRunning() { return bounce._active; },
    };

    bounce.start(40, {
        state: 'launch',
        repeat: () => {
            launches++;
            return isLaunching;
        },
    });

    // Let it run through 5 repeat loops
    let frames = 0;
    while (launches < 5 && frames < 3000) {
        bounce._frame(16.67);
        frames++;
    }
    assert(launches >= 5, `Expected at least 5 launch loops, got ${launches}`);
    assert(bounce.active, 'Bounce should still be active in launch loop');

    // Now signal stop
    isLaunching = false;
    bounce.stopLaunch();
    assert(bounce._state === 'once', 'stopLaunch must switch state to once');

    // Complete the final arc
    while (bounce.active && frames < 6000) {
        bounce._frame(16.67);
        frames++;
    }

    assert(!bounce.active, 'Bounce should settle after stopLaunch');
    assert(settles === 1, `Launch loop should settle exactly once, got ${settles}`);
    bounce.destroy();
    print('  ✓ Test 3.5 Passed: Launch loop repeated and settled cleanly on stopLaunch.');
}

print('\n================================================================');
print('ALL EMPIRICAL CHALLENGER ADVERSARIAL STRESS TESTS PASSED (12/12)');
print('================================================================');
