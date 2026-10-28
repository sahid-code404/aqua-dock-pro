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

// Test _applySpread shift constraining and _updateMagZone overflow tracking
{
    const spreadEngine = new AnimationEngine();
    function createMockActor() {
        return {
            x: 0, y: 0, width: 0, height: 0,
            translation_x: 0, translation_y: 0,
            set_position(x, y) { this.x = x; this.y = y; },
            set_size(w, h) { this.width = w; this.height = h; },
            set_x(x) { this.x = x; },
            set_y(y) { this.y = y; },
            set_width(w) { this.width = w; },
            set_height(h) { this.height = h; },
        };
    }

    const bg = createMockActor();
    const magZone = createMockActor();
    const chips = [
        { item: { scaleCurrent: 2.0 }, actor: createMockActor(), baseX: 10, extra: 72 },
        { item: { scaleCurrent: 1.0 }, actor: createMockActor(), baseX: 82, extra: 0 },
        { item: { scaleCurrent: 1.0 }, actor: createMockActor(), baseX: 154, extra: 0 },
    ];
    const monitor = { x: 0, y: 0, width: 1000, height: 800 };
    const cfg = {
        iconSize: 60,
        cellW: 72,
        vertical: false,
        position: 'bottom',
    };
    const geom = {
        x: 10, y: 700,
        mainLen: 236,
        bgBaseX: 0,
        bgBaseW: 236,
        monitor,
        edgeMargin: 8,
        magZone: {
            restInset: 4,
            growthPerScale: 60,
            hoverReach: 8,
            mainPad: 20,
            side: 'bottom',
            dockH: 80,
        },
    };

    spreadEngine.setModel({
        chips,
        items: chips.map(c => c.item),
        cfg,
        geom,
        bg,
        blurRegion: null,
        magZone,
    });

    // Test start alignment constraint:
    // With geom.x = 10, monitor.x + edgeMargin = 8,
    // dock is near the left edge.
    // If total = 100, unconstrained shift = -50.
    // stagePos + shift = 10 - 50 = -40 (off screen!).
    // With constraint: stagePos + shift >= 8 => shift >= -2.
    spreadEngine._applySpread(true, 100, 2.0);
    assert(spreadEngine._bgTargetX >= -2,
        `shift must be constrained so dock pill doesn't shift off left edge (was ${spreadEngine._bgTargetX})`);
    assert(geom.x + spreadEngine._bgTargetX >= monitor.x + geom.edgeMargin,
        `pill start must stay within monitor bounds`);
    for (const chip of chips) {
        if (chip.item) {
            const scale = chip.item.scaleCurrent ?? 1;
            const center = geom.x + chip.baseX + chip.actor.translation_x + cfg.cellW / 2;
            const iconLeft = center - (cfg.iconSize * scale) / 2;
            assert(iconLeft >= monitor.x + geom.edgeMargin - 0.5,
                `icon must stay within left monitor bound (was ${iconLeft})`);
        }
    }

    // Test end alignment constraint:
    geom.x = monitor.width - geom.edgeMargin - geom.mainLen - 2; // 1000 - 8 - 236 - 2 = 754
    spreadEngine._applySpread(true, 100, 2.0);
    const pillEnd = geom.x + spreadEngine._bgTargetX + geom.bgBaseW + 100;
    assert(pillEnd <= monitor.x + monitor.width - geom.edgeMargin,
        `pill end must stay within monitor bounds (was ${pillEnd}, max: ${monitor.width - geom.edgeMargin})`);

    // Test overflow centering when expanded dock width exceeds available monitor width (minShift > maxShift):
    {
        const smallMon = { x: 0, y: 0, width: 300, height: 800 };
        geom.monitor = smallMon;
        geom.x = 10;
        // With total=300, dock width is bgBaseW(236) + 300 = 536 > monitor available width (284)
        spreadEngine._applySpread(true, 300, 2.0);
        const minB = smallMon.x + geom.edgeMargin;
        const maxB = smallMon.x + smallMon.width - geom.edgeMargin;
        const targetShift = spreadEngine._bgTargetX - geom.bgBaseX;
        // Verify overflow is evenly centered on both edges
        // Stage position of dock start and end
        let minExt = geom.x + geom.bgBaseX;
        let maxExt = minExt + geom.bgBaseW + 300;
        let pfx = 0;
        for (const chip of chips) {
            if (chip.item) {
                const scale = chip.item.scaleCurrent ?? 1;
                const extra = chip.extra ?? 0;
                const center = geom.x + chip.baseX + pfx + extra / 2 + cfg.cellW / 2;
                const halfIcon = (cfg.iconSize * scale) / 2;
                if (center - halfIcon < minExt) minExt = center - halfIcon;
                if (center + halfIcon > maxExt) maxExt = center + halfIcon;
            }
            pfx += chip.extra ?? 0;
        }
        const expectedShift = ((minB + maxB) / 2) - ((minExt + maxExt) / 2);
        assert(Math.abs(targetShift - expectedShift) < 1e-6,
            `shift must smoothly center overflow when minShift > maxShift (expected ${expectedShift}, got ${targetShift})`);
        const leftOverflow = minB - (minExt + targetShift);
        const rightOverflow = (maxExt + targetShift) - maxB;
        assert(Math.abs(leftOverflow - rightOverflow) < 1e-6,
            `left overflow (${leftOverflow}) must equal right overflow (${rightOverflow})`);
        // Restore monitor
        geom.monitor = monitor;
    }

    // Test magZone accounts for _bgCurrentX and _bgCurrentW:
    spreadEngine._bgCurrentX = -20;
    spreadEngine._bgCurrentW = 336;
    spreadEngine._updateMagZone(2.0);
    assert(magZone.width === 336 + geom.magZone.mainPad * 2,
        `magZone width must match _bgCurrentW + mainPad*2 (was ${magZone.width})`);
    assert(magZone.x === geom.x + (-20) - geom.magZone.mainPad,
        `magZone x must match geom.x + _bgCurrentX - mainPad (was ${magZone.x})`);

    // Test vertical dock constraints and magZone:
    const vChips = [
        { item: { scaleCurrent: 2.0 }, actor: createMockActor(), baseX: 10, extra: 72 },
        { item: { scaleCurrent: 1.0 }, actor: createMockActor(), baseX: 82, extra: 0 },
    ];
    const vCfg = {
        iconSize: 60,
        cellW: 72,
        vertical: true,
        position: 'left',
    };
    const vGeom = {
        x: 8, y: 10,
        mainLen: 164,
        bgBaseX: 0,
        bgBaseW: 164,
        monitor,
        edgeMargin: 8,
        magZone: {
            restInset: 4,
            growthPerScale: 60,
            hoverReach: 8,
            mainPad: 20,
            side: 'left',
            dockH: 80,
        },
    };
    const vEngine = new AnimationEngine();
    vEngine.setModel({
        chips: vChips,
        items: vChips.map(c => c.item),
        cfg: vCfg,
        geom: vGeom,
        bg,
        blurRegion: null,
        magZone,
    });
    vEngine._applySpread(true, 80, 2.0);
    assert(vGeom.y + vEngine._bgTargetX >= monitor.y + vGeom.edgeMargin,
        'vertical dock must stay within top monitor bound');

    vEngine._bgCurrentX = -15;
    vEngine._bgCurrentW = 244;
    vEngine._updateMagZone(2.0);
    assert(magZone.height === 244 + vGeom.magZone.mainPad * 2,
        `vertical magZone height must match _bgCurrentW + mainPad*2`);
    assert(magZone.y === vGeom.y + (-15) - vGeom.magZone.mainPad,
        `vertical magZone y must match geom.y + _bgCurrentX - mainPad`);

    vEngine.destroy();
    spreadEngine.destroy();
}

print('animationEngine: ok');
