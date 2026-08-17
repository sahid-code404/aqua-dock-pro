import { AnimationEngine } from '../animation/animationEngine.js';
import { setReduceMotionOverride } from '../core/utils.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const engine = new AnimationEngine();
const scheduler = {
    started: 0,
    stopped: 0,
    running: false,
    start() { this.started++; this.running = true; },
    stop() { this.stopped++; this.running = false; },
    isRunning() { return this.running; },
    destroy() { this.running = false; },
};
engine._scheduler = scheduler;
engine._model = {};
let snapFrames = 0;
engine._frame = dt => {
    assert(dt === 0, 'reduced-motion target frame must be synchronous');
    snapFrames++;
    return false;
};

try {
    // With reduced motion enabled there is intentionally no running timeline.
    // Every kick still has to apply one target frame so pointer/held-item changes
    // cannot leave magnification frozen at an older state.
    setReduceMotionOverride(true);
    engine.kick();
    engine.kick();

    assert(engine._animate === false,
        'reduce-motion did not refresh the animation mode');
    assert(scheduler.stopped === 2,
        'each reduced-motion kick should keep the scheduler stopped');
    assert(scheduler.started === 0,
        'reduce-motion unexpectedly started the frame scheduler');
    assert(snapFrames === 2,
        'reduced-motion did not apply a target frame for every kick');
} finally {
    setReduceMotionOverride(false);
    engine.destroy();
}

print('animationEngine: ok');
