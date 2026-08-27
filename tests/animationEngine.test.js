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
let restSnaps = 0;
let targetFrames = 0;
engine.snapToRest = () => { restSnaps++; };
engine._frame = () => { targetFrames++; return false; };

try {
    // Reduce Motion is a hard no-motion state: kicks must stop the frame clock
    // and flatten magnification synchronously rather than applying live pointer
    // or held-item targets without spring interpolation.
    setReduceMotionOverride(true);
    engine.kick();
    engine.kick();

    assert(engine._animate === false,
        'reduce-motion did not refresh the animation mode');
    assert(scheduler.stopped === 2,
        'each reduced-motion kick should keep the scheduler stopped');
    assert(scheduler.started === 0,
        'reduce-motion unexpectedly started the frame scheduler');
    assert(restSnaps === 2,
        'reduce-motion did not synchronously flatten magnification');
    assert(targetFrames === 0,
        'reduce-motion still evaluated a live magnification target frame');
} finally {
    setReduceMotionOverride(false);
    engine.destroy();
}

print('animationEngine: ok');
