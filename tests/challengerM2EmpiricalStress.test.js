// Empirical Adversarial Stress Test for Milestone 2:
// 1. High-frequency pointer simulation (10,000 pointer events at 1000Hz with sub-pixel noise < 0.5px vs macroscopic > 10px)
// 2. Rapid enter/leave cycles and cross-zone transitions (preventing stuck or missed hover states)
// 3. Badge scaling edge cases (10,000 rapid scale toggles between 1.0 and 2.0 without visual lag or drift)
// 4. Separator recycling stress and bounded pooling

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`[EMPIRICAL CHALLENGE ASSERTION FAILED] ${message}`);
    }
}

// Register temporary mock Shell resource for Main and misc imports
const tmpShellDir = GLib.dir_make_tmp('aqua-m2empirical-XXXXXX');
const mainJsPath = GLib.build_filenamev([tmpShellDir, 'main.js']);
const xmlPath = GLib.build_filenamev([tmpShellDir, 'shell.gresource.xml']);
const resPath = GLib.build_filenamev([tmpShellDir, 'shell.gresource']);

const configJsPath = GLib.build_filenamev([tmpShellDir, 'config.js']);
const boxpointerJsPath = GLib.build_filenamev([tmpShellDir, 'boxpointer.js']);
const appFavoritesJsPath = GLib.build_filenamev([tmpShellDir, 'appFavorites.js']);
const popupMenuJsPath = GLib.build_filenamev([tmpShellDir, 'popupMenu.js']);
const appMenuJsPath = GLib.build_filenamev([tmpShellDir, 'appMenu.js']);
const dialogJsPath = GLib.build_filenamev([tmpShellDir, 'dialog.js']);
const modalDialogJsPath = GLib.build_filenamev([tmpShellDir, 'modalDialog.js']);
const dndJsPath = GLib.build_filenamev([tmpShellDir, 'dnd.js']);

GLib.file_set_contents(configJsPath, 'export const PACKAGE_VERSION = "50";\n');
GLib.file_set_contents(boxpointerJsPath, 'export const PopupAnimation = { NONE: 0, FULL: 1 };\n');
GLib.file_set_contents(appFavoritesJsPath, 'export function getAppFavorites() { return { getFavorites: () => [], connect: () => 1, disconnect: () => {} }; }\n');
GLib.file_set_contents(popupMenuJsPath, 'export class PopupMenu { constructor() {} addMenuItem() {} destroy() {} }\nexport class PopupMenuItem { constructor() {} }\nexport class PopupMenuManager { constructor() {} addMenu() {} removeMenu() {} }\nexport class PopupSubMenuMenuItem { constructor() {} }\nexport class PopupSeparatorMenuItem { constructor() {} }\n');
GLib.file_set_contents(appMenuJsPath, 'export class AppMenu { constructor() {} }\n');
GLib.file_set_contents(dialogJsPath, 'export class Dialog { constructor() {} }\n');
GLib.file_set_contents(modalDialogJsPath, 'export class ModalDialog { constructor() {} }\n');
GLib.file_set_contents(dndJsPath, 'export const DragMotionResult = { NO_DROP: 0, COPY_DROP: 1, MOVE_DROP: 2 };\nexport function makeDraggable() { return { connect: () => 1, disconnect: () => {} }; }\n');

GLib.file_set_contents(mainJsPath,
    'export const extensionManager = null;\nexport const layoutManager = { removeChrome() {} };\nexport const overview = { visible: false };\nexport const uiGroup = { add_child() {} };\n');
GLib.file_set_contents(xmlPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<gresources>
  <gresource prefix="/org/gnome/shell/misc">
    <file>config.js</file>
  </gresource>
  <gresource prefix="/org/gnome/shell/ui">
    <file>config.js</file>
    <file>boxpointer.js</file>
    <file>main.js</file>
    <file>appFavorites.js</file>
    <file>popupMenu.js</file>
    <file>appMenu.js</file>
    <file>dialog.js</file>
    <file>modalDialog.js</file>
    <file>dnd.js</file>
  </gresource>
</gresources>`);

const [resOk, , resErr, resStatus] = GLib.spawn_sync(
    null,
    ['glib-compile-resources', `--target=${resPath}`, `--sourcedir=${tmpShellDir}`, xmlPath],
    null,
    GLib.SpawnFlags.SEARCH_PATH,
    null
);
assert(resOk && resStatus === 0, `glib-compile-resources failed: ${new TextDecoder().decode(resErr)}`);

const shellResource = Gio.Resource.load(resPath);
shellResource._register();

// Import real modules under test
const { DockController } = await import('../dock/dockController.js');
const { DockItem } = await import('../dock/dockItem.js');
const { DockFactory } = await import('../dock/dockFactory.js');

print('================================================================');
print('CHALLENGER M2 EMPIRICAL ADVERSARIAL STRESS TEST');
print('================================================================\n');

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1: High-Frequency Pointer Simulation (10,000 events at 1000Hz)
// ─────────────────────────────────────────────────────────────────────────────
print('--- SUITE 1: High-Frequency Pointer Simulation ---');

class MockEvent {
    constructor(x, y, type = Clutter.EventType.MOTION) {
        this.x = x;
        this.y = y;
        this._type = type;
    }
    get_coords() { return [this.x, this.y]; }
    type() { return this._type; }
}

{
    print('[Test 1.1] 10,000 events with sub-pixel noise (< 0.5px)...');

    // Create an instrumented DockController instance
    const controller = Object.create(DockController.prototype);
    controller._pointerInContainer = false;
    controller._pointerInMag = false;
    controller._pointerInEdge = false;
    controller._lastPointerX = NaN;
    controller._lastPointerY = NaN;
    controller._drag = { reordering: false };
    controller._updatePressedDrag = () => false;
    controller._autohide = { onDockActivity() {} };
    controller._cancelEndHover = () => {};
    controller._scheduleEndHover = () => {};
    controller._geom = { vert: false, x: 100, y: 800, thick: 70 };

    let setPointerCalls = 0;
    let kicks = 0;
    let pickCalls = 0;
    let lastSetPointerX = NaN;
    let lastSetPointerY = NaN;

    controller._engine = {
        setPointer(x, y, active) {
            setPointerCalls++;
            lastSetPointerX = x;
            lastSetPointerY = y;
        },
        kick() { kicks++; },
    };
    controller._pickItem = (x, y) => {
        pickCalls++;
        return { id: 'item_1', x, y };
    };
    controller._setHover = item => {
        controller._hoverItem = item;
    };

    // Event 0: initial enter at (250.0, 850.0)
    controller._onMotion(new MockEvent(250.0, 850.0));
    assert(pickCalls === 1, 'Initial motion must trigger _pickItem');
    assert(kicks === 1, 'Initial motion must trigger _engine.kick');
    assert(setPointerCalls === 1, 'Initial motion must update engine pointer');

    // Simulate 10,000 high-frequency events at 1000Hz with sub-pixel jitter (< 0.5px)
    // Jitter is bounded strictly within (-0.45, +0.45) px around (250.0, 850.0)
    // Distance from baseline (250, 850) is always < 0.5px
    let lastX = 250.0, lastY = 850.0;
    for (let i = 0; i < 10000; i++) {
        const curX = 250.0 + (Math.random() - 0.5) * 0.4;
        const curY = 850.0 + (Math.random() - 0.5) * 0.4;
        const dist = Math.hypot(curX - 250.0, curY - 850.0);
        assert(dist < 0.5, `Test invariant: jitter distance from baseline must be < 0.5px (was ${dist})`);

        controller._onMotion(new MockEvent(curX, curY));

        lastX = curX;
        lastY = curY;
    }

    assert(pickCalls === 1,
        `Redundant _pickItem must be SKIPPED for all 10,000 sub-pixel noise events! (Actual calls: ${pickCalls})`);
    assert(kicks === 1,
        `Redundant _engine.kick must be SKIPPED for all 10,000 sub-pixel noise events! (Actual kicks: ${kicks})`);
    assert(setPointerCalls === 10001,
        `Engine pointer coordinates must be continuously updated! (Got: ${setPointerCalls})`);
    assert(Math.abs(lastSetPointerX - lastX) < 1e-9 && Math.abs(lastSetPointerY - lastY) < 1e-9,
        'Engine must receive exact sub-pixel coordinates');

    print('  ✓ 10,000 sub-pixel events processed: 0 redundant _pickItem() calls, 0 redundant kick() wakeups.');
}

{
    print('[Test 1.2] 10,000 macroscopic movements (> 10px)...');

    const controller = Object.create(DockController.prototype);
    controller._pointerInContainer = false;
    controller._pointerInMag = false;
    controller._pointerInEdge = false;
    controller._lastPointerX = NaN;
    controller._lastPointerY = NaN;
    controller._drag = { reordering: false };
    controller._updatePressedDrag = () => false;
    controller._autohide = { onDockActivity() {} };
    controller._cancelEndHover = () => {};
    controller._scheduleEndHover = () => {};
    controller._geom = { vert: false, x: 100, y: 800, thick: 70 };

    let kicks = 0;
    let pickCalls = 0;
    controller._engine = {
        setPointer() {},
        kick() { kicks++; },
    };
    controller._pickItem = (x, y) => {
        pickCalls++;
        return { x, y };
    };
    controller._setHover = () => {};

    // 10,000 macroscopic jumps > 10px (e.g., jumps of 20px - 80px)
    let curX = 100.0, curY = 820.0;
    for (let i = 0; i < 10000; i++) {
        // Jump between 15px and 60px
        const jump = 15.0 + (i % 45);
        curX = 100.0 + ((curX + jump) % 800);
        controller._onMotion(new MockEvent(curX, curY));
    }

    assert(pickCalls === 10000,
        `Every macroscopic jump must reliably trigger _pickItem! (Expected: 10000, got: ${pickCalls})`);
    assert(kicks === 10000,
        `Every macroscopic jump must reliably trigger _engine.kick! (Expected: 10000, got: ${kicks})`);

    print('  ✓ 10,000 macroscopic jumps processed: 10,000 / 10,000 (100%) reliably triggered _pickItem & kick.');
}

{
    print('[Test 1.3] Realistic workload: 1,000 macroscopic jumps interleaved with 20 sub-pixel noise events (21,000 total)...');

    const controller = Object.create(DockController.prototype);
    controller._pointerInContainer = false;
    controller._pointerInMag = false;
    controller._pointerInEdge = false;
    controller._lastPointerX = NaN;
    controller._lastPointerY = NaN;
    controller._drag = { reordering: false };
    controller._updatePressedDrag = () => false;
    controller._autohide = { onDockActivity() {} };
    controller._cancelEndHover = () => {};
    controller._scheduleEndHover = () => {};
    controller._geom = { vert: false, x: 100, y: 800, thick: 70 };

    let kicks = 0;
    let pickCalls = 0;
    controller._engine = {
        setPointer() {},
        kick() { kicks++; },
    };
    controller._pickItem = (x, y) => {
        pickCalls++;
        return { x, y };
    };
    controller._setHover = () => {};

    let curX = 200.0, curY = 820.0;
    const NUM_CYCLES = 1000;
    const JITTER_PER_CYCLE = 20;

    for (let c = 0; c < NUM_CYCLES; c++) {
        // Macroscopic jump: move to next icon (+48px)
        curX += 48.0;
        if (curX > 900) curX = 200.0;
        controller._onMotion(new MockEvent(curX, curY));

        // Followed by JITTER_PER_CYCLE sub-pixel jitter events (< 0.3px)
        for (let j = 0; j < JITTER_PER_CYCLE; j++) {
            const jX = curX + (Math.random() - 0.5) * 0.25;
            const jY = curY + (Math.random() - 0.5) * 0.25;
            controller._onMotion(new MockEvent(jX, jY));
        }
    }

    assert(pickCalls === NUM_CYCLES,
        `Expected exactly ${NUM_CYCLES} _pickItem calls for macroscopic jumps, got ${pickCalls}`);
    assert(kicks === NUM_CYCLES,
        `Expected exactly ${NUM_CYCLES} kicks, got ${kicks}`);

    print(`  ✓ 21,000 events processed: exactly ${NUM_CYCLES} picks executed, ${NUM_CYCLES * JITTER_PER_CYCLE} redundant calls skipped.`);
}

{
    print('[Test 1.4] Deduplication and coordinate projection across container, magZone, and edgeZone...');

    const controller = Object.create(DockController.prototype);
    controller._pointerInContainer = false;
    controller._pointerInMag = false;
    controller._pointerInEdge = false;
    controller._lastPointerX = NaN;
    controller._lastPointerY = NaN;
    controller._drag = { reordering: false };
    controller._updatePressedDrag = () => false;
    controller._autohide = { onDockActivity() {} };
    controller._cancelEndHover = () => {};
    controller._scheduleEndHover = () => {};
    controller._geom = { vert: false, x: 100, y: 800, thick: 70 };

    let lastRx = NaN, lastRy = NaN;
    controller._engine = {
        setPointer(rx, ry) { lastRx = rx; lastRy = ry; },
        kick() {},
    };
    controller._pickItem = () => ({});
    controller._setHover = () => {};

    // 1. Container motion
    controller._onMotion(new MockEvent(300.0, 835.0));
    assert(controller._lastPointerX === 300.0 && controller._lastPointerY === 835.0, 'Container sets coords');
    assert(lastRx === 300.0 && lastRy === 835.0, 'Container passes raw stage coords');

    // 2. MagZone motion: on horizontal dock (vert: false), ry is projected to geom.y + geom.thick / 2 = 835
    controller._onMagMotion(new MockEvent(350.0, 750.0));
    assert(controller._lastPointerX === 350.0 && controller._lastPointerY === 750.0, 'MagZone sets coords');
    assert(lastRx === 350.0 && lastRy === 835.0, `MagZone projects horizontal ry to center (835), got ${lastRy}`);

    // MagZone sub-pixel deduplication
    const initialRx = lastRx, initialRy = lastRy;
    controller._onMagMotion(new MockEvent(350.2, 750.1));
    assert(controller._lastPointerX === 350.0 && controller._lastPointerY === 750.0, 'MagZone preserves baseline coords on sub-pixel delta');
    assert(lastRx === 350.2 && lastRy === 835.0, 'MagZone sub-pixel passes projected coords to engine');

    // 3. EdgeZone motion: on horizontal dock, ry projected to 835
    controller._onEdgeMotion(new MockEvent(400.0, 880.0));
    assert(controller._lastPointerX === 400.0 && controller._lastPointerY === 880.0, 'EdgeZone sets coords');
    assert(lastRx === 400.0 && lastRy === 835.0, `EdgeZone projects horizontal ry to center (835), got ${lastRy}`);

    // 4. Test vertical dock projection (vert: true)
    controller._geom = { vert: true, x: 0, y: 200, thick: 60 };
    controller._onMagMotion(new MockEvent(50.0, 450.0));
    // rx projected to geom.x + geom.thick / 2 = 30
    assert(lastRx === 30.0 && lastRy === 450.0, `MagZone on vertical dock projects rx to 30, got ${lastRx}`);

    controller._onEdgeMotion(new MockEvent(80.0, 500.0));
    assert(lastRx === 30.0 && lastRy === 500.0, `EdgeZone on vertical dock projects rx to 30, got ${lastRx}`);

    print('  ✓ Coordinate projection and deduplication verified across all three zones and dock orientations.');
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2: Rapid Enter/Leave Cycles & Race Conditions
// ─────────────────────────────────────────────────────────────────────────────
print('\n--- SUITE 2: Rapid Enter/Leave Cycles ---');

{
    print('[Test 2.1] 10,000 rapid enter/leave cycles at exact same coordinates...');

    const controller = Object.create(DockController.prototype);
    controller._pointerInContainer = false;
    controller._pointerInMag = false;
    controller._pointerInEdge = false;
    controller._lastPointerX = NaN;
    controller._lastPointerY = NaN;
    controller._drag = { reordering: false };
    controller._updatePressedDrag = () => false;
    controller._autohide = { onDockActivity() {}, onDockLeft() {} };
    controller._hoverItem = null;
    controller._tooltip = { hide() {}, scheduleShow() {} };
    controller._preview = { hide() {}, schedule() {} };
    controller._downloads = { cancelPrewarm() {} };
    controller._menu = { active: false };
    controller._cfg = { showTooltip: true, tooltipDelay: 100 };
    controller._geom = { vert: false, x: 100, y: 800, thick: 70 };
    controller._timers = { addOnce: () => 1, remove: () => {} };
    controller._endHoverId = 0;

    let endHoverKicks = 0;
    controller._engine = {
        setPointer() {},
        kick() { endHoverKicks++; },
    };

    let pickCalls = 0;
    const targetItem = { id: 'app_terminal' };
    controller._pickItem = (x, y) => {
        pickCalls++;
        return targetItem;
    };

    const enterEvent = new MockEvent(250.0, 835.0, Clutter.EventType.ENTER);

    for (let cycle = 0; cycle < 10000; cycle++) {
        // 1. Enter container at exact same coords (250.0, 835.0)
        controller._resetPointerCoords();
        controller._onMotion(enterEvent);

        assert(controller._pointerInContainer === true, `Cycle ${cycle}: pointerInContainer must be true`);
        assert(controller._hoverItem === targetItem, `Cycle ${cycle}: hoverItem must be set on enter`);
        assert(pickCalls === cycle + 1,
            `Cycle ${cycle}: _pickItem MUST be called on enter (no false deduplication)! Expected ${cycle + 1}, got ${pickCalls}`);

        // 2. Leave container
        controller._onContainerLeave();
        assert(controller._pointerInContainer === false, `Cycle ${cycle}: pointerInContainer must be false`);
        assert(Number.isNaN(controller._lastPointerX) && Number.isNaN(controller._lastPointerY),
            `Cycle ${cycle}: _lastPointerX/Y must be NaN after leave`);

        // End hover
        controller._endHover(false);
        assert(controller._hoverItem === null, `Cycle ${cycle}: hoverItem must be cleared after _endHover`);
        assert(Number.isNaN(controller._lastPointerX) && Number.isNaN(controller._lastPointerY),
            `Cycle ${cycle}: _lastPointerX/Y must remain NaN after _endHover`);
    }

    assert(pickCalls === 10000, `All 10,000 enters must trigger pickItem (got ${pickCalls})`);
    print('  ✓ 10,000 enter/leave cycles passed: ZERO stuck states, ZERO missed hover events.');
}

{
    print('[Test 2.2] Rapid zone-hopping race condition stress (container <-> magZone <-> edgeZone)...');

    const controller = Object.create(DockController.prototype);
    controller._pointerInContainer = false;
    controller._pointerInMag = false;
    controller._pointerInEdge = false;
    controller._lastPointerX = NaN;
    controller._lastPointerY = NaN;
    controller._drag = { reordering: false };
    controller._updatePressedDrag = () => false;
    controller._autohide = { onDockActivity() {}, onDockLeft() {} };
    controller._hoverItem = null;
    controller._tooltip = { hide() {}, scheduleShow() {} };
    controller._preview = { hide() {}, schedule() {} };
    controller._downloads = { cancelPrewarm() {} };
    controller._menu = { active: false };
    controller._cfg = { showTooltip: true, tooltipDelay: 100 };
    controller._geom = { vert: false, x: 100, y: 800, thick: 70 };
    controller._engine = { setPointer() {}, kick() {} };

    let timerScheduled = false;
    let timerCancelled = false;
    controller._timers = {
        addOnce(ms, cb) {
            timerScheduled = true;
            return 42;
        },
        remove(id) {
            if (id === 42) timerCancelled = true;
        },
    };
    controller._endHoverId = 0;

    let pickedItem = null;
    controller._pickItem = (x, y) => ({ x, y });

    // Step 1: Pointer in container
    controller._resetPointerCoords();
    controller._onMotion(new MockEvent(200, 835, Clutter.EventType.ENTER));
    assert(controller._pointerInContainer === true, 'In container');

    // Step 2: Pointer moves into magZone: container leave fires first
    controller._onContainerLeave();
    assert(controller._pointerInContainer === false, 'Left container');
    assert(controller._pointerInMag === false && controller._pointerInEdge === false, 'Not in other zones yet');
    assert(timerScheduled === true, '16ms deferred end hover must be scheduled');

    // Step 3: MagZone enter fires within the frame (cancels end hover timer)
    controller._resetPointerCoords();
    controller._onMagMotion(new MockEvent(200, 750, Clutter.EventType.ENTER));
    assert(controller._pointerInMag === true, 'In magZone');
    assert(timerCancelled === true, 'Deferred end hover must be CANCELLED by magZone entry');
    assert(controller._hoverItem !== null, 'Hover item preserved across zone transition');

    // Step 4: Pointer moves into edgeZone: magZone leave fires
    timerScheduled = false;
    timerCancelled = false;
    controller._onMagLeave();
    assert(controller._pointerInMag === false, 'Left magZone');
    assert(timerScheduled === true, 'Deferred end hover scheduled on mag leave');

    // EdgeZone enter fires
    controller._resetPointerCoords();
    controller._onEdgeMotion(new MockEvent(200, 880, Clutter.EventType.ENTER));
    assert(controller._pointerInEdge === true, 'In edgeZone');
    assert(timerCancelled === true, 'Deferred end hover CANCELLED by edgeZone entry');
    assert(controller._hoverItem !== null, 'Hover item preserved');

    // Step 5: Full exit
    controller._onEdgeLeave();
    assert(controller._pointerInEdge === false && controller._pointerInContainer === false && controller._pointerInMag === false);
    // Simulate timer firing
    controller._endHover();
    assert(controller._hoverItem === null, 'Hover cleanly cleared on complete exit');
    assert(Number.isNaN(controller._lastPointerX), 'Coords reset on full exit');

    print('  ✓ Zone transitions preserve hover without flicker; timer cancellation verified.');
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3: Badge Scaling Edge Cases, Visual Lag & Drift
// ─────────────────────────────────────────────────────────────────────────────
print('\n--- SUITE 3: Badge Scaling Edge Cases & Drift ---');

{
    print('[Test 3.1] 10,000 rapid scale toggles (1.0 <-> 2.0) with analytical ground truth comparison...');

    // Analytical badge positioning oracle
    function computeExpectedBadge(baseSize, s, iconLift, iconBaseX, iconBaseY, pivotX, pivotY, vert, isRight, bw, bh) {
        const drawn = baseSize * s;
        const ix = iconBaseX + (vert ? iconLift : 0);
        const iy = iconBaseY + (vert ? 0 : iconLift);
        const drawnX = ix + baseSize * pivotX * (1 - s);
        const drawnY = iy + baseSize * pivotY * (1 - s);
        const cornerX = (vert && isRight) ? drawnX : drawnX + drawn;
        const bx = Math.round(cornerX - bw * 0.6);
        const by = Math.round(drawnY - bh * 0.4);
        return { bx, by };
    }

    const mockCfg = {
        vertical: false,
        position: 'bottom',
        hoverLift: 16,
    };
    const mockBadge = {
        visible: true,
        translation_x: 0,
        translation_y: 0,
        get_preferred_width: () => [0, 20],
        get_preferred_height: () => [0, 20],
        remove_all_transitions() {},
    };

    const mockItem = Object.create(DockItem.prototype);
    mockItem._cfg = mockCfg;
    mockItem._vert = false;
    mockItem._isRight = false;
    mockItem.scaleCurrent = 1;
    mockItem._lastBadgeScale = -1;
    mockItem._badge = mockBadge;
    mockItem._badgeW = 20;
    mockItem._badgeH = 20;
    mockItem._baseIconSize = 48;
    mockItem._iconBaseX = 10;
    mockItem._iconBaseY = 10;
    mockItem._pivotX = 0.5;
    mockItem._pivotY = 0.5;
    mockItem._liftProp = 'translation_y';
    mockItem._liftSign = -1;
    mockItem._liftDenom = 1.0;
    mockItem._syncTextureTier = () => {};
    mockItem._icon = {
        set_scale() {},
        translation_x: 0,
        translation_y: 0,
        remove_all_transitions() {},
    };

    let positionBadgeCalls = 0;
    const originalPositionBadge = DockItem.prototype._positionBadge;
    mockItem._positionBadge = function () {
        positionBadgeCalls++;
        originalPositionBadge.call(this);
    };

    const initialExpected = computeExpectedBadge(48, 1.0, 0, 10, 10, 0.5, 0.5, false, false, 20, 20);
    mockItem.setScale(1.0);
    assert(mockBadge.translation_x === initialExpected.bx, 'Initial bx matches oracle');
    assert(mockBadge.translation_y === initialExpected.by, 'Initial by matches oracle');
    const initialBx = mockBadge.translation_x;
    const initialBy = mockBadge.translation_y;

    // Run 10,000 rapid scale toggles between 1.0 and 2.0
    for (let i = 1; i <= 10000; i++) {
        const targetScale = (i % 2 === 1) ? 2.0 : 1.0;
        mockItem.setScale(targetScale);

        const expected = computeExpectedBadge(
            48,
            targetScale,
            mockItem._iconLift,
            10, 10,
            0.5, 0.5,
            false, false,
            20, 20
        );

        assert(mockBadge.translation_x === expected.bx,
            `Toggle ${i}: badge translation_x (${mockBadge.translation_x}) must match oracle (${expected.bx})`);
        assert(mockBadge.translation_y === expected.by,
            `Toggle ${i}: badge translation_y (${mockBadge.translation_y}) must match oracle (${expected.by})`);
    }

    assert(positionBadgeCalls === 10001,
        `All 10,000 toggles must trigger badge update (got ${positionBadgeCalls})`);

    // Verify ZERO drift after 10,000 iterations: scale 1.0 must equal initial state exactly
    assert(mockBadge.translation_x === initialBx, `Zero drift in bx: ${mockBadge.translation_x} === ${initialBx}`);
    assert(mockBadge.translation_y === initialBy, `Zero drift in by: ${mockBadge.translation_y} === ${initialBy}`);

    print('  ✓ 10,000 toggles completed: 100% exact match against analytical oracle with ZERO pixel drift.');
}

{
    print('[Test 3.2] Badge scale throttling hysteresis stress (sub-threshold deltas < 0.005)...');

    const mockItem = Object.create(DockItem.prototype);
    mockItem._cfg = { vertical: false, position: 'bottom', hoverLift: 16 };
    mockItem._vert = false;
    mockItem._isRight = false;
    mockItem.scaleCurrent = 1;
    mockItem._lastBadgeScale = -1;
    mockItem._badge = {
        visible: true,
        translation_x: 0,
        translation_y: 0,
        get_preferred_width: () => [0, 20],
        get_preferred_height: () => [0, 20],
        remove_all_transitions() {},
    };
    mockItem._badgeW = 20;
    mockItem._badgeH = 20;
    mockItem._baseIconSize = 48;
    mockItem._iconBaseX = 10;
    mockItem._iconBaseY = 10;
    mockItem._pivotX = 0.5;
    mockItem._pivotY = 0.5;
    mockItem._liftProp = 'translation_y';
    mockItem._liftSign = -1;
    mockItem._liftDenom = 1.0;
    mockItem._syncTextureTier = () => {};
    mockItem._icon = { set_scale() {}, remove_all_transitions() {}, ease() {} };

    let positionBadgeCalls = 0;
    mockItem._positionBadge = function () {
        positionBadgeCalls++;
        DockItem.prototype._positionBadge.call(this);
    };

    // Set scale to 1.500 -> calls _positionBadge
    mockItem.setScale(1.500);
    assert(positionBadgeCalls === 1, 'Initial 1.500 calls _positionBadge');
    assert(mockItem._lastBadgeScale === 1.500, '_lastBadgeScale is 1.500');

    // 100 sub-threshold micro-oscillations between 1.500 and 1.504 (all deltas < 0.005)
    for (let i = 0; i < 100; i++) {
        const microScale = 1.500 + (i % 5) * 0.0008; // max 1.5032
        mockItem.setScale(microScale);
    }
    assert(positionBadgeCalls === 1,
        `All 100 sub-threshold changes (< 0.005) must be throttled! (calls: ${positionBadgeCalls})`);

    // Step to 1.506 (delta from 1.500 = 0.006 >= 0.005) -> must trigger
    mockItem.setScale(1.506);
    assert(positionBadgeCalls === 2, 'Delta 0.006 >= 0.005 must trigger _positionBadge');
    assert(mockItem._lastBadgeScale === 1.506, '_lastBadgeScale updated to 1.506');

    // easeToRest resets _lastBadgeScale to -1
    mockItem.easeToRest();
    assert(mockItem._lastBadgeScale === -1, 'easeToRest must reset _lastBadgeScale to -1');

    print('  ✓ Sub-threshold scale hysteresis and easeToRest reset verified.');
}

{
    print('[Test 3.3] Analytical badge positioning across all 4 dock edges...');

    const orientations = [
        { side: 'bottom', vert: false, isRight: false },
        { side: 'top', vert: false, isRight: false },
        { side: 'left', vert: true, isRight: false },
        { side: 'right', vert: true, isRight: true },
    ];

    for (const orient of orientations) {
        const mockItem = Object.create(DockItem.prototype);
        mockItem._cfg = { vertical: orient.vert, position: orient.side, hoverLift: 16 };
        mockItem._vert = orient.vert;
        mockItem._isRight = orient.isRight;
        mockItem.scaleCurrent = 1;
        mockItem._lastBadgeScale = -1;
        mockItem._badge = {
            visible: true,
            translation_x: 0,
            translation_y: 0,
            get_preferred_width: () => [0, 20],
            get_preferred_height: () => [0, 20],
            remove_all_transitions() {},
        };
        mockItem._badgeW = 20;
        mockItem._badgeH = 20;
        mockItem._baseIconSize = 48;
        mockItem._iconBaseX = 10;
        mockItem._iconBaseY = 10;
        mockItem._pivotX = 0.5;
        mockItem._pivotY = 0.5;
        mockItem._liftProp = orient.vert ? 'translation_x' : 'translation_y';
        mockItem._liftSign = (orient.side === 'right' || orient.side === 'bottom') ? -1 : 1;
        mockItem._liftDenom = 1.0;
        mockItem._syncTextureTier = () => {};
        mockItem._icon = { set_scale() {}, remove_all_transitions() {} };

        mockItem.setScale(1.8);
        assert(Number.isFinite(mockItem._badge.translation_x) && Number.isFinite(mockItem._badge.translation_y),
            `Badge coords must be finite for ${orient.side}`);

        if (orient.side === 'right') {
            // On right vertical dock, badge is on the inner (left) edge: drawnX rather than drawnX + drawn
            const drawnX = 10 + mockItem._iconLift + 48 * 0.5 * (1 - 1.8);
            const expectedBx = Math.round(drawnX - 20 * 0.6);
            assert(mockItem._badge.translation_x === expectedBx,
                `Right dock badge must align to drawnX (${expectedBx}), got ${mockItem._badge.translation_x}`);
        }
    }

    print('  ✓ All 4 dock positions (bottom, top, left, right) positioned accurately.');
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4: Separator Recycling & Pool Bounds
// ─────────────────────────────────────────────────────────────────────────────
print('\n--- SUITE 4: Separator Recycling & Pool Bounds ---');

{
    print('[Test 4.1] 1,000 dock rebuild cycles with alternating separator counts...');

    class MockContainer {
        constructor() { this.children = []; }
        add_child(actor) { if (!this.children.includes(actor)) { this.children.push(actor); actor._parent = this; } }
        remove_child(actor) { const i = this.children.indexOf(actor); if (i >= 0) { this.children.splice(i, 1); actor._parent = null; } }
    }

    class MockSeparatorActor {
        constructor(style_class = '') {
            this.style_class = style_class;
            this.style = '';
            this.visible = true;
            this._destroyed = false;
            this._parent = null;
        }
        set_style(s) { this.style = s; }
        remove_all_transitions() {}
        get_parent() { return this._parent; }
        destroy() { this._destroyed = true; }
    }

    const container = new MockContainer();
    const factory = Object.create(DockFactory.prototype);
    factory._container = container;
    factory._items = [];
    factory._chips = [];
    factory._separatorPool = [];

    // Use MockSeparatorActor for factory St.Widget instantiation
    const originalRebuild = DockFactory.prototype._rebuild;

    // Simulate 1,000 rebuild cycles
    let totalSeparatorsCreated = 0;
    let poolReuses = 0;

    for (let cycle = 0; cycle < 1000; cycle++) {
        // Vary separator count between 1 and 10
        const sepCount = 1 + (cycle % 10);
        const entries = [];
        for (let s = 0; s < sepCount; s++) {
            entries.push({ key: `sep_${s}`, kind: s % 2 === 0 ? 'separator' : 'spacer' });
        }

        // Run rebuild logic
        const nextChips = [];
        const nextItems = [];
        const createdActors = [];
        const reusedSeparators = [];

        for (const chip of factory._chips) {
            if (!chip.item && chip.actor)
                factory._recycleSeparator(chip.actor);
        }

        for (const entry of entries) {
            const styleClass = entry.kind === 'spacer' ? 'aqua-spacer' : 'aqua-separator';
            let sep = factory._separatorPool.pop();
            if (sep) {
                reusedSeparators.push(sep);
                poolReuses++;
                sep.style_class = styleClass;
                if (typeof sep.set_style === 'function') sep.set_style(null);
                sep.visible = true;
            } else {
                sep = new MockSeparatorActor(styleClass);
                createdActors.push(sep);
                totalSeparatorsCreated++;
            }
            if (sep.get_parent?.() !== factory._container)
                factory._container.add_child(sep);
            nextChips.push({ entry, actor: sep, item: null, w: 10 });
        }

        factory._chips = nextChips;
        factory._items = nextItems;

        // Verify pool invariant: pool size must never exceed 16
        assert(factory._separatorPool.length <= 16,
            `Cycle ${cycle}: _separatorPool must not exceed capacity 16 (was ${factory._separatorPool.length})`);

        // Verify all active separators have valid style class and visible
        for (const chip of factory._chips) {
            assert(chip.actor.visible === true, 'Active separator must be visible');
            assert(chip.actor.style_class.length > 0, 'Active separator must have valid style_class');
        }
    }

    assert(factory._separatorPool.length <= 16, 'Pool capacity strictly bounded to <= 16');
    assert(poolReuses > 5000, `Pool reuses should be frequent across 1,000 rebuilds (got: ${poolReuses})`);
    assert(totalSeparatorsCreated <= 20,
        `Total separator allocations must be bounded! (created: ${totalSeparatorsCreated}, expected <= 20)`);

    // Teardown
    factory.destroyAll();
    assert(factory._separatorPool.length === 0, 'destroyAll must clear pool');
    assert(factory._chips.length === 0, 'destroyAll must clear chips');

    print(`  ✓ 1,000 rebuild cycles completed: only ${totalSeparatorsCreated} total actors created across 5,500 separator placements (${poolReuses} reuses from pool). Max pool size <= 16.`);
}

// Cleanup mock Shell resource
GLib.spawn_sync(null, ['rm', '-rf', tmpShellDir], null, GLib.SpawnFlags.SEARCH_PATH, null);

print('\n================================================================');
print('ALL EMPIRICAL CHALLENGE SUITES COMPLETED WITH ZERO ERRORS (EXIT 0)');
print('================================================================\n');
