import { AnimationEngine } from '../animation/animationEngine.js';
import { magnificationParams } from '../animation/springSolver.js';
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

// ── Item Suppression Verification ──────────────────────────────────────────
{
    const supEngine = new AnimationEngine();
    let schedStarted = 0;
    const testSched = {
        start() { schedStarted++; },
        stop() {},
        isRunning() { return true; },
        destroy() {},
    };
    supEngine._scheduler = testSched;

    const itemA = { scaleCurrent: 1, scaleTarget: 1, vel: 0, setScale(s) { this.scaleCurrent = s; } };
    const itemB = { scaleCurrent: 1, scaleTarget: 1, vel: 0, setScale(s) { this.scaleCurrent = s; } };
    const chipA = { item: itemA, center: 100, actor: { translation_x: 0 } };
    const chipB = { item: itemB, center: 200, actor: { translation_x: 0 } };
    const cfg = {
        vertical: false, cellW: 64, zoomMax: 2.0,
        zoomRange: 120, magnificationCurve: 2.0, tau: 38,
        springTension: 0.8, springDamping: 0.8,
    };
    cfg.mag = magnificationParams(cfg);
    const model = {
        cfg,
        geom: {
            bgBaseX: 0, bgBaseW: 300,
            firstItemCenter: 100, lastItemCenter: 200,
            band: { low: -100, high: 200 },
        },
        chips: [chipA, chipB],
        items: [itemA, itemB],
        bg: { set_position() {}, set_size() {}, set_x() {}, set_width() {}, set_y() {}, set_height() {} },
    };
    supEngine._container = {
        x: 0, y: 0,
        transform_stage_point(x, y) { return [true, x, y]; },
    };
    supEngine.setModel(model);

    // 1. Pointer over itemA: normally itemA magnifies
    supEngine.setPointer(100, 20, true);
    supEngine._frame(16);
    assert(itemA.scaleTarget > 1.5, 'itemA should have magnified target when hovered');

    // 2. Folder item MUST demagnify when stack is opened
    supEngine.setMagnificationSuppressed(true);
    assert(supEngine.magnificationSuppressed === true, 'magnificationSuppressed should be true');
    supEngine._frame(16);
    assert(itemA.scaleTarget === 1, 'itemA target must be 1.0 when stack is open');

    // Integrate several frames to verify demagnification towards 1.0
    for (let i = 0; i < 30; i++) supEngine._frame(16);
    assert(itemA.scaleCurrent < 1.05, 'itemA should smoothly demagnify down close to 1.0');

    // 3. Pointer moves over itemB while stack is open: itemB must NOT magnify
    supEngine.setPointer(200, 20, true);
    supEngine._frame(16);
    assert(itemB.scaleTarget === 1, 'itemB must NOT magnify when hovered while stack is open');
    assert(Math.abs(itemB.scaleCurrent - 1) < 0.01, `itemB scale must remain at resting ~1.0, got ${itemB.scaleCurrent}`);

    // 4. Stack is closed: magnification suppression released
    supEngine.setMagnificationSuppressed(false);
    assert(supEngine.magnificationSuppressed === false, 'magnificationSuppressed should be false');
    supEngine._frame(16);
    assert(itemB.scaleTarget > 1.5, 'itemB should magnify normally once stack closes');

    supEngine.destroy();
}

print('animationEngine: ok');
