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

try {
    // AnimationEngine starts with an enabled cache. The direct settings path
    // updates the process-wide override and then calls kick() without setModel().
    // kick() must refresh that cache and stop immediately.
    setReduceMotionOverride(true);
    engine.kick();

    assert(engine._animate === false,
        'reduce-motion direct update did not refresh the animation mode');
    assert(scheduler.stopped === 1,
        'reduce-motion direct update did not stop the active frame scheduler');
    assert(scheduler.started === 0,
        'reduce-motion direct update unexpectedly started the frame scheduler');
} finally {
    setReduceMotionOverride(false);
    engine.destroy();
}

print('animationEngine: ok');
