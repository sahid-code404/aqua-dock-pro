// Empirical Adversarial Stress Harness for Milestone 2 Remediation (Round 2)
// Specifically stress-testing:
// 1. 10,000-event pointer stream with micro-steps (0.1px to 0.4px per event) across dock boundaries.
//    Empirically verifies that every 0.5px accumulated distance correctly triggers _pickItem() and _engine.kick().
// 2. Rapid enter/leave events cleanly reset coordinates without triggering false hits.
// 3. Badge repositioning behavior under active oscillation and settleMotion.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`[EMPIRICAL CHALLENGE ASSERTION FAILED] ${message}`);
    }
}

// Register temporary mock Shell resource for GNOME Shell UI modules
const tmpShellDir = GLib.dir_make_tmp('aqua-m2r2stress-XXXXXX');
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
    'export const extensionManager = null;\nexport const layoutManager = { removeChrome() {}, primaryIndex: 0 };\nexport const overview = { visible: false };\nexport const uiGroup = { add_child() {} };\n');
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

print('================================================================');
print('CHALLENGER M2 ROUND 2 EMPIRICAL ADVERSARIAL STRESS HARNESS');
print('================================================================\n');

class MockEvent {
    constructor(x, y, type = Clutter.EventType.MOTION) {
        this.x = x;
        this.y = y;
        this._type = type;
    }
    get_coords() { return [this.x, this.y]; }
    type() { return this._type; }
}

function createInstrumentedController(geom = { vert: false, x: 0, y: 800, thick: 70 }) {
    const c = Object.create(DockController.prototype);
    c._pointerInContainer = false;
    c._pointerInMag = false;
    c._pointerInEdge = false;
    c._lastPointerX = NaN;
    c._lastPointerY = NaN;
    c._drag = { reordering: false };
    c._updatePressedDrag = () => false;
    c._autohide = { onDockActivity() {} };
    c._cancelEndHover = () => {};
    c._scheduleEndHover = () => {};
    c._geom = geom;

    c.stats = {
        setPointerCalls: 0,
        kickCalls: 0,
        pickCalls: 0,
        lastSetPointerX: NaN,
        lastSetPointerY: NaN,
        lastPickedX: NaN,
        lastPickedY: NaN,
    };

    c._engine = {
        setPointer(x, y, active) {
            c.stats.setPointerCalls++;
            c.stats.lastSetPointerX = x;
            c.stats.lastSetPointerY = y;
        },
        kick() {
            c.stats.kickCalls++;
        },
    };

    c._pickItem = (x, y) => {
        c.stats.pickCalls++;
        c.stats.lastPickedX = x;
        c.stats.lastPickedY = y;
        return { id: `item_at_${x.toFixed(1)}_${y.toFixed(1)}`, x, y };
    };

    c._setHover = item => {
        c._hoverItem = item;
    };
    c._tooltip = { hide() {}, scheduleShow() {} };
    c._preview = { hide() {}, schedule() {} };

    return c;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1: 10,000-Event Pointer Stream with Micro-Steps (0.1px - 0.4px)
// ─────────────────────────────────────────────────────────────────────────────
print('--- SUITE 1: 10,000-Event Pointer Stream Accumulation ---');

{
    print('[Test 1.1] 10,000 micro-step events (0.1px to 0.4px) in _onMotion: exact oracle verification...');
    const controller = createInstrumentedController();

    // Event 0: initial enter event at (100.0, 50.0)
    controller._onMotion(new MockEvent(100.0, 50.0, Clutter.EventType.ENTER));
    assert(controller.stats.pickCalls === 1, 'Initial enter must trigger _pickItem');
    assert(controller.stats.kickCalls === 1, 'Initial enter must trigger _engine.kick');
    assert(controller.stats.setPointerCalls === 1, 'Initial enter must call _engine.setPointer');
    assert(controller._lastPointerX === 100.0 && controller._lastPointerY === 50.0, 'Baseline initialized to (100, 50)');

    // Oracle simulation tracking
    let oracleBaselineX = 100.0;
    let oracleBaselineY = 50.0;
    let oraclePickCalls = 1;
    let oracleKickCalls = 1;
    let oracleSetPointerCalls = 1;

    let curX = 100.0;
    let curY = 50.0;

    // Deterministic pseudo-random sequence for repeatability
    let seed = 123456789;
    function randRange(min, max) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return min + (seed / 0x7fffffff) * (max - min);
    }

    for (let i = 0; i < 10000; i++) {
        // Step size strictly between 0.1px and 0.4px
        const stepX = randRange(0.1, 0.4);
        curX += stepX;
        oracleSetPointerCalls++;

        const distFromBaseline = Math.hypot(curX - oracleBaselineX, curY - oracleBaselineY);
        let expectedPick = false;

        if (distFromBaseline >= 0.5) {
            expectedPick = true;
            oracleBaselineX = curX;
            oracleBaselineY = curY;
            oraclePickCalls++;
            oracleKickCalls++;
        }

        controller._onMotion(new MockEvent(curX, curY, Clutter.EventType.MOTION));

        // Verify oracle match at EVERY single event
        assert(controller.stats.setPointerCalls === oracleSetPointerCalls,
            `Event ${i}: _engine.setPointer must be called every event`);
        assert(controller.stats.pickCalls === oraclePickCalls,
            `Event ${i}: pick count mismatch! Expected ${oraclePickCalls}, got ${controller.stats.pickCalls} (dist: ${distFromBaseline.toFixed(4)})`);
        assert(controller.stats.kickCalls === oracleKickCalls,
            `Event ${i}: kick count mismatch! Expected ${oracleKickCalls}, got ${controller.stats.kickCalls}`);
        assert(Math.abs(controller._lastPointerX - oracleBaselineX) < 1e-9,
            `Event ${i}: _lastPointerX mismatch! Expected ${oracleBaselineX}, got ${controller._lastPointerX}`);

        if (expectedPick) {
            assert(Math.abs(controller.stats.lastPickedX - curX) < 1e-9,
                `Event ${i}: _pickItem must receive current micro-step X coordinate`);
        }
    }

    assert(controller.stats.pickCalls > 3500 && controller.stats.pickCalls < 5500,
        `Expected ~4,000-5,000 picks over 10,000 micro-steps of ~0.25px, got: ${controller.stats.pickCalls}`);
    print(`  ✓ 10,000 micro-step events processed in _onMotion: exact match on all 10,000 events.`);
    print(`    Total picks & kicks triggered: ${controller.stats.pickCalls} (accumulated every >= 0.5px).`);
}

{
    print('[Test 1.2] 10,000 micro-steps along a 2D diagonal and curved trajectory...');
    const controller = createInstrumentedController();

    controller._onMotion(new MockEvent(200.0, 200.0, Clutter.EventType.ENTER));
    let oracleBaselineX = 200.0;
    let oracleBaselineY = 200.0;
    let oraclePicks = 1;

    let curX = 200.0;
    let curY = 200.0;
    let angle = 0;

    let seed = 987654321;
    function randRange(min, max) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return min + (seed / 0x7fffffff) * (max - min);
    }

    for (let i = 0; i < 10000; i++) {
        // Spiral / sinusoidal curve in 2D with micro-step magnitude in [0.1, 0.4]
        const stepMag = randRange(0.1, 0.4);
        angle += 0.05;
        const dx = stepMag * Math.cos(angle);
        const dy = stepMag * Math.sin(angle);
        curX += dx;
        curY += dy;

        const dist = Math.hypot(curX - oracleBaselineX, curY - oracleBaselineY);
        if (dist >= 0.5) {
            oracleBaselineX = curX;
            oracleBaselineY = curY;
            oraclePicks++;
        }

        controller._onMotion(new MockEvent(curX, curY, Clutter.EventType.MOTION));

        assert(controller.stats.pickCalls === oraclePicks,
            `2D step ${i}: pick mismatch! Expected ${oraclePicks}, got ${controller.stats.pickCalls}`);
    }

    print(`  ✓ 10,000 2D curved micro-steps verified with exact 2D hypot accumulation.`);
    print(`    Total picks & kicks triggered: ${controller.stats.pickCalls}.`);
}

{
    print('[Test 1.3] 10,000 micro-steps in _onMagMotion (horizontal & vertical docks)...');

    // Horizontal dock: geom.vert = false
    {
        const geomH = { vert: false, x: 100, y: 800, thick: 70 };
        const controllerH = createInstrumentedController(geomH);
        const projectedY = geomH.y + geomH.thick / 2; // 835

        controllerH._onMagMotion(new MockEvent(150.0, 750.0, Clutter.EventType.ENTER));
        assert(controllerH.stats.lastPickedY === projectedY, 'MagMotion must project Y to dock center for horizontal dock');

        let oracleBaseX = 150.0;
        let oracleBaseY = 750.0;
        let oraclePicks = 1;
        let curX = 150.0;
        let curY = 750.0;

        for (let i = 0; i < 5000; i++) {
            const stepX = 0.2; // exactly 0.2px
            curX += stepX;
            const dist = Math.hypot(curX - oracleBaseX, curY - oracleBaseY);
            if (dist >= 0.5) {
                oracleBaseX = curX;
                oracleBaseY = curY;
                oraclePicks++;
            }
            controllerH._onMagMotion(new MockEvent(curX, curY));
            assert(controllerH.stats.pickCalls === oraclePicks, `Horizontal MagMotion step ${i} failed`);
        }
        assert(controllerH.stats.pickCalls === oraclePicks && controllerH.stats.pickCalls === 1667, `Expected 1667 picks for 5000 steps of 0.2px, got ${controllerH.stats.pickCalls}`);
    }

    // Vertical dock: geom.vert = true
    {
        const geomV = { vert: true, x: 0, y: 100, thick: 80 };
        const controllerV = createInstrumentedController(geomV);
        const projectedX = geomV.x + geomV.thick / 2; // 40

        controllerV._onMagMotion(new MockEvent(20.0, 150.0, Clutter.EventType.ENTER));
        assert(controllerV.stats.lastPickedX === projectedX, 'MagMotion must project X to dock center for vertical dock');

        let oracleBaseX = 20.0;
        let oracleBaseY = 150.0;
        let oraclePicks = 1;
        let curX = 20.0;
        let curY = 150.0;

        for (let i = 0; i < 5000; i++) {
            const stepY = 0.25; // exactly 0.25px -> pick every 2 steps
            curY += stepY;
            const dist = Math.hypot(curX - oracleBaseX, curY - oracleBaseY);
            if (dist >= 0.5) {
                oracleBaseX = curX;
                oracleBaseY = curY;
                oraclePicks++;
            }
            controllerV._onMagMotion(new MockEvent(curX, curY));
            assert(controllerV.stats.pickCalls === oraclePicks, `Vertical MagMotion step ${i} failed`);
        }
        assert(controllerV.stats.pickCalls === 2501, `Expected 2501 picks for 5000 steps of 0.25px, got ${controllerV.stats.pickCalls}`);
    }

    print('  ✓ 10,000 micro-steps in _onMagMotion verified across horizontal and vertical dock projections.');
}

{
    print('[Test 1.4] 10,000 micro-steps in _onEdgeMotion...');
    const geom = { vert: false, x: 200, y: 800, thick: 64 };
    const controller = createInstrumentedController(geom);

    controller._onEdgeMotion(new MockEvent(200.0, 863.0, Clutter.EventType.ENTER));
    let oracleBaseX = 200.0;
    let oracleBaseY = 863.0;
    let oraclePicks = 1;
    let curX = 200.0;
    let curY = 863.0;

    for (let i = 0; i < 10000; i++) {
        const stepX = 0.3; // 0.3px -> step 1: dist 0.3 < 0.5; step 2: dist 0.6 >= 0.5 (pick); step 3: dist 0.3 < 0.5; ...
        curX += stepX;
        const dist = Math.hypot(curX - oracleBaseX, curY - oracleBaseY);
        if (dist >= 0.5) {
            oracleBaseX = curX;
            oracleBaseY = curY;
            oraclePicks++;
        }
        controller._onEdgeMotion(new MockEvent(curX, curY));
        assert(controller.stats.pickCalls === oraclePicks, `EdgeMotion step ${i} failed`);
    }

    assert(controller.stats.pickCalls === 5001, `Expected 5001 picks for 10,000 steps of 0.3px, got ${controller.stats.pickCalls}`);
    print('  ✓ 10,000 micro-steps in _onEdgeMotion verified with exact accumulation.');
}

{
    print('[Test 1.5] Sub-threshold jitter (< 0.45px) around fixed baseline...');
    const controller = createInstrumentedController();

    // Enter at (300.0, 400.0)
    controller._onMotion(new MockEvent(300.0, 400.0, Clutter.EventType.ENTER));
    assert(controller.stats.pickCalls === 1, 'Initial enter triggers 1 pick');
    assert(controller.stats.kickCalls === 1, 'Initial enter triggers 1 kick');

    // 10,000 jitter events strictly inside a circle of radius 0.4px around (300.0, 400.0)
    for (let i = 0; i < 10000; i++) {
        const theta = (i * 0.37) % (2 * Math.PI);
        const r = 0.1 + 0.3 * Math.abs(Math.sin(i * 0.13)); // 0.1 <= r <= 0.4 < 0.5
        const jx = 300.0 + r * Math.cos(theta);
        const jy = 400.0 + r * Math.sin(theta);
        assert(Math.hypot(jx - 300.0, jy - 400.0) < 0.45, 'In-bounds jitter');

        controller._onMotion(new MockEvent(jx, jy));
    }

    assert(controller.stats.pickCalls === 1,
        `Sub-threshold jitter strictly < 0.45px must NEVER trigger redundant picks! (Got ${controller.stats.pickCalls})`);
    assert(controller.stats.kickCalls === 1,
        `Sub-threshold jitter strictly < 0.45px must NEVER trigger redundant kicks! (Got ${controller.stats.kickCalls})`);
    assert(controller.stats.setPointerCalls === 10001,
        `All 10,000 jitter events must still update engine pointer coordinates! (Got ${controller.stats.setPointerCalls})`);

    print('  ✓ 10,000 sub-threshold jitter events correctly throttled: 0 redundant picks/kicks.');
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2: Rapid Enter / Leave Events and Coordinate Reset
// ─────────────────────────────────────────────────────────────────────────────
print('\n--- SUITE 2: Rapid Enter / Leave Events and Coordinate Reset ---');

{
    print('[Test 2.1] 5,000 rapid Enter -> Leave -> Enter cycles at IDENTICAL coordinates...');
    const controller = createInstrumentedController();

    const staticX = 250.0;
    const staticY = 60.0;

    for (let cycle = 0; cycle < 5000; cycle++) {
        // Enter event
        controller._resetPointerCoords();
        controller._onMotion(new MockEvent(staticX, staticY, Clutter.EventType.ENTER));

        assert(controller.stats.pickCalls === cycle + 1,
            `Cycle ${cycle}: Enter at same coordinate MUST trigger _pickItem! (Expected ${cycle + 1}, got ${controller.stats.pickCalls})`);
        assert(controller.stats.kickCalls === cycle + 1,
            `Cycle ${cycle}: Enter at same coordinate MUST trigger _engine.kick! (Expected ${cycle + 1}, got ${controller.stats.kickCalls})`);
        assert(controller._lastPointerX === staticX && controller._lastPointerY === staticY,
            `Cycle ${cycle}: Baseline set to static coordinates`);

        // Leave event
        controller._onContainerLeave();
        assert(Number.isNaN(controller._lastPointerX), `Cycle ${cycle}: _lastPointerX must be NaN after leave`);
        assert(Number.isNaN(controller._lastPointerY), `Cycle ${cycle}: _lastPointerY must be NaN after leave`);
        assert(controller._pointerInContainer === false, `Cycle ${cycle}: _pointerInContainer false`);
    }

    print(`  ✓ 5,000 rapid Enter/Leave cycles at identical coordinates verified: 5,000 clean triggers, 0 swallowed.`);
}

{
    print('[Test 2.2] Boundary skimming across dock edge (1,000 enter/leave crossings with micro-movements)...');
    const controller = createInstrumentedController();

    let scheduledEndHovers = 0;
    let cancelledEndHovers = 0;
    controller._scheduleEndHover = () => { scheduledEndHovers++; };
    controller._cancelEndHover = () => { cancelledEndHovers++; };

    for (let i = 0; i < 1000; i++) {
        // Skim inside
        controller._resetPointerCoords();
        controller._onMotion(new MockEvent(150.0 + (i % 10) * 0.1, 70.1, Clutter.EventType.ENTER));

        // Sub-pixel movement inside
        controller._onMotion(new MockEvent(150.0 + (i % 10) * 0.1 + 0.1, 70.2));

        // Skim outside
        controller._onContainerLeave();
    }

    assert(scheduledEndHovers === 1000, `Expected 1000 scheduledEndHovers, got ${scheduledEndHovers}`);
    assert(Number.isNaN(controller._lastPointerX) && Number.isNaN(controller._lastPointerY),
        'Coordinates must be NaN after boundary skimming');
    print('  ✓ 1,000 boundary skimming cycles verified with clean hover cancellation/scheduling.');
}

{
    print('[Test 2.3] Rapid cross-zone transitions (Container <-> MagZone <-> EdgeZone)...');
    const geom = { vert: false, x: 0, y: 800, thick: 70 };
    const controller = createInstrumentedController(geom);

    for (let i = 0; i < 1000; i++) {
        // Enter container
        controller._resetPointerCoords();
        controller._onMotion(new MockEvent(100.0, 820.0, Clutter.EventType.ENTER));
        assert(controller._pointerInContainer === true, 'In container');

        // Transition into magZone (container leave -> magZone enter)
        controller._onContainerLeave();
        assert(Number.isNaN(controller._lastPointerX), 'NaN after container leave');
        controller._resetPointerCoords();
        controller._onMagMotion(new MockEvent(100.0, 820.0, Clutter.EventType.ENTER));
        assert(controller._pointerInMag === true, 'In magZone');

        // Transition into edgeZone (mag leave -> edgeZone enter)
        controller._onMagLeave();
        assert(Number.isNaN(controller._lastPointerX), 'NaN after mag leave');
        controller._resetPointerCoords();
        controller._onEdgeMotion(new MockEvent(100.0, 868.0, Clutter.EventType.ENTER));
        assert(controller._pointerInEdge === true, 'In edgeZone');

        // Leave edgeZone
        controller._onEdgeLeave();
        assert(Number.isNaN(controller._lastPointerX), 'NaN after edge leave');
    }

    print('  ✓ 1,000 cross-zone transitions verified with zero state leaks or coordinate contamination.');
}

{
    print('[Test 2.4] Complete coordinate reset verification across all termination paths...');
    const controller = createInstrumentedController();

    // Verify _onContainerLeave resets coords
    controller._lastPointerX = 123.4; controller._lastPointerY = 567.8;
    controller._onContainerLeave();
    assert(Number.isNaN(controller._lastPointerX) && Number.isNaN(controller._lastPointerY),
        '_onContainerLeave must reset coords to NaN');

    // Verify _onMagLeave resets coords
    controller._lastPointerX = 123.4; controller._lastPointerY = 567.8;
    controller._onMagLeave();
    assert(Number.isNaN(controller._lastPointerX) && Number.isNaN(controller._lastPointerY),
        '_onMagLeave must reset coords to NaN');

    // Verify _onEdgeLeave resets coords
    controller._lastPointerX = 123.4; controller._lastPointerY = 567.8;
    controller._onEdgeLeave();
    assert(Number.isNaN(controller._lastPointerX) && Number.isNaN(controller._lastPointerY),
        '_onEdgeLeave must reset coords to NaN');

    // Verify _endHover resets coords
    controller._lastPointerX = 123.4; controller._lastPointerY = 567.8;
    controller._hoverItem = { id: 'test' };
    controller._engine.setHover = () => {};
    controller._engine.kick = () => {};
    controller._chrome = { container: { queue_relayout() {} } };
    controller._endHover(false);
    assert(Number.isNaN(controller._lastPointerX) && Number.isNaN(controller._lastPointerY),
        '_endHover must reset coords to NaN');

    // Verify _resetPointerCoords directly
    controller._lastPointerX = 999.0; controller._lastPointerY = 888.0;
    controller._resetPointerCoords();
    assert(Number.isNaN(controller._lastPointerX) && Number.isNaN(controller._lastPointerY),
        '_resetPointerCoords must reset coords to NaN');

    print('  ✓ All 5 termination and exit paths confirmed to unconditionally reset coordinates.');
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3: Badge Repositioning Behavior under Active Oscillation and SettleMotion
// ─────────────────────────────────────────────────────────────────────────────
print('\n--- SUITE 3: Badge Repositioning Behavior under Active Oscillation and SettleMotion ---');

function createInstrumentedDockItem(cfg = {}) {
    const item = Object.create(DockItem.prototype);
    item._cfg = {
        vertical: false,
        position: 'bottom',
        hoverLift: 20,
        ...cfg,
    };
    item._vert = item._cfg.vertical;
    item._isRight = item._cfg.position === 'right';
    item._liftSign = -1;
    item._liftDenom = 1 / 1.6;
    item._liftProp = item._vert ? 'translation_x' : 'translation_y';
    item.scaleTarget = 1;
    item.scaleCurrent = 1;
    item.vel = 0;
    item._lastScale = NaN;
    item._lastBadgeScale = -1;
    item._iconLift = 0;
    item._pulsing = false;
    item._bounce = null;
    item._baseIconSize = 64;
    item._iconBaseX = 0;
    item._iconBaseY = 0;
    item._pivotX = 0.5;
    item._pivotY = 1.0;
    item._badgeW = 20;
    item._badgeH = 20;
    item._badgePX = null;
    item._badgePY = null;

    item.stats = {
        positionBadgeCalls: 0,
        syncTextureTierCalls: 0,
        iconScaleSets: 0,
    };

    item._badge = {
        visible: true,
        translation_x: 0,
        translation_y: 0,
        get_preferred_width: () => [0, item._badgeW],
        get_preferred_height: () => [0, item._badgeH],
        remove_all_transitions: () => {},
    };

    item._icon = {
        set_scale(sx, sy) { item.stats.iconScaleSets++; this.scale_x = sx; this.scale_y = sy; },
        scale_x: 1,
        scale_y: 1,
        translation_x: 0,
        translation_y: 0,
        remove_all_transitions: () => {},
        ease: (props) => { props.onComplete?.(); },
    };

    item._syncTextureTier = () => { item.stats.syncTextureTierCalls++; };

    // Instrument _positionBadge to count calls
    const origPositionBadge = DockItem.prototype._positionBadge;
    item._positionBadge = function() {
        item.stats.positionBadgeCalls++;
        origPositionBadge.call(item);
    };

    return item;
}

{
    print('[Test 3.1] Micro-deltas (< 0.005) throttling vs macro-deltas (>= 0.005)...');
    const item = createInstrumentedDockItem();

    // Initial scale at 1.0: delta from -1 is 2.0 >= 0.005 -> triggers 1 reposition
    item.setScale(1.0);
    assert(item.stats.positionBadgeCalls === 1, 'Initial setScale(1.0) must position badge');
    assert(item._lastBadgeScale === 1.0, '_lastBadgeScale set to 1.0');

    // 5,000 micro-spring updates with delta < 0.005 (e.g. 1.0001 to 1.0049)
    for (let f = 1; f <= 5000; f++) {
        const delta = (f % 45) * 0.0001; // max 0.0045 < 0.005
        item.setScale(1.0 + delta);
    }
    assert(item.stats.positionBadgeCalls === 1,
        `5,000 sub-threshold micro-updates must NOT reposition badge! Got: ${item.stats.positionBadgeCalls}`);

    // Now test macro-deltas: step by 0.006 (>= 0.005) for 5,000 updates
    let expectedCalls = 1;
    let curScale = 1.0;
    for (let f = 1; f <= 5000; f++) {
        curScale += 0.006;
        item.setScale(curScale);
        expectedCalls++;
        assert(item.stats.positionBadgeCalls === expectedCalls,
            `Macro-update ${f} failed to reposition badge`);
    }

    print(`  ✓ 5,000 micro-updates strictly throttled (0 redundant calls).`);
    print(`  ✓ 5,000 macro-updates accurately repositioned badge.`);
}

{
    print('[Test 3.2] Badge positioning analytical formula equivalence across scale range [1.0 .. 2.6]...');
    const item = createInstrumentedDockItem();

    for (let s = 1.0; s <= 2.6; s += 0.01) {
        item.setScale(s);

        // Analytical badge coordinate calculation per dockItem.js formula:
        const bw = item._badgeW, bh = item._badgeH;
        const baseSize = item._baseIconSize;
        const drawn = baseSize * item.scaleCurrent;
        const lift = item._iconLift ?? 0;
        const ix = item._iconBaseX + (item._vert ? lift : 0);
        const iy = item._iconBaseY + (item._vert ? 0 : lift);
        const drawnX = ix + baseSize * item._pivotX * (1 - item.scaleCurrent);
        const drawnY = iy + baseSize * item._pivotY * (1 - item.scaleCurrent);
        const cornerX = (item._vert && item._isRight) ? drawnX : drawnX + drawn;
        const expectedBx = Math.round(cornerX - bw * 0.6);
        const expectedBy = Math.round(drawnY - bh * 0.4);

        assert(item._badge.translation_x === expectedBx,
            `Badge translation_x at scale ${s.toFixed(2)}: expected ${expectedBx}, got ${item._badge.translation_x}`);
        assert(item._badge.translation_y === expectedBy,
            `Badge translation_y at scale ${s.toFixed(2)}: expected ${expectedBy}, got ${item._badge.translation_y}`);
    }

    print('  ✓ Analytical badge coordinates match 100% across all scales with ZERO drift.');
}

{
    print('[Test 3.3] SettleMotion precision: guaranteed badge sync when spring settles at sub-threshold delta...');
    const item = createInstrumentedDockItem();

    // Scale is currently magnified at 1.5
    item.setScale(1.5);
    assert(item._lastBadgeScale === 1.5, '_lastBadgeScale is 1.5');
    assert(item.stats.positionBadgeCalls === 1, '1 position call at 1.5');

    // Dock is demagnifying towards resting scale (scaleTarget = 1.0).
    // Tail-end of spring decelerates: last frame before rest is at 1.003
    item.setScale(1.003); // delta from 1.003 is > 0.005 relative to 1.5, so it updates to 1.003
    assert(item._lastBadgeScale === 1.003, '_lastBadgeScale recorded 1.003');
    const callsBeforeSettle = item.stats.positionBadgeCalls;

    // Spring solver settles: delta between 1.003 and 1.000 is 0.003 (< 0.005)!
    // Under setScale, this would have been skipped!
    // But settleMotion() must UNCONDITIONALLY snap to scaleTarget (1.000) and sync _lastBadgeScale!
    item.scaleTarget = 1.0;
    item.settleMotion();

    assert(item.scaleCurrent === 1.0, 'scaleCurrent must be set to scaleTarget');
    assert(item._lastBadgeScale === 1.0, '_lastBadgeScale MUST be synchronized to 1.0 upon settleMotion');
    assert(item.stats.positionBadgeCalls === callsBeforeSettle + 1,
        'settleMotion must unconditionally trigger _positionBadge');

    // Verify resting position matches scale 1.0 exactly
    const baseSize = item._baseIconSize;
    const drawn = baseSize * 1.0;
    const drawnX = item._iconBaseX + baseSize * item._pivotX * (1 - 1.0);
    const drawnY = item._iconBaseY + baseSize * item._pivotY * (1 - 1.0);
    const cornerX = drawnX + drawn;
    const expectedRestBx = Math.round(cornerX - item._badgeW * 0.6);
    const expectedRestBy = Math.round(drawnY - item._badgeH * 0.4);

    assert(item._badge.translation_x === expectedRestBx,
        `Settled badge translation_x must be exact resting position (${expectedRestBx}), got ${item._badge.translation_x}`);
    assert(item._badge.translation_y === expectedRestBy,
        `Settled badge translation_y must be exact resting position (${expectedRestBy}), got ${item._badge.translation_y}`);

    // Now call setScale(1.0) again: delta from 1.0 is 0 < 0.005 -> must be cleanly skipped!
    item.setScale(1.0);
    assert(item.stats.positionBadgeCalls === callsBeforeSettle + 1,
        'Subsequent setScale at resting scaleTarget must not re-trigger redundant _positionBadge');

    print('  ✓ settleMotion precision verified: badge snapped to resting geometry and _lastBadgeScale synchronized.');
}

{
    print('[Test 3.4] 1,000 cycles of active oscillation and settleMotion stress...');
    const item = createInstrumentedDockItem();

    for (let cycle = 0; cycle < 1000; cycle++) {
        // Expand
        item.setScale(1.0 + (cycle % 10) * 0.08);

        // Sub-step jitter during hover
        item.setScale(item.scaleCurrent + 0.002);

        // Sudden settle
        item.scaleTarget = 1.0;
        item.settleMotion();

        assert(item.scaleCurrent === 1.0, `Cycle ${cycle}: settle must end at 1.0`);
        assert(item._lastBadgeScale === 1.0, `Cycle ${cycle}: _lastBadgeScale must be 1.0`);
        assert(!Number.isNaN(item._badge.translation_x) && !Number.isNaN(item._badge.translation_y),
            `Cycle ${cycle}: badge coordinates must not be NaN`);
    }

    print('  ✓ 1,000 oscillation and settleMotion cycles completed with zero numerical drift or NaN.');
}

{
    print('[Test 3.5] easeToRest() badge reset and positioning...');
    const item = createInstrumentedDockItem();

    item.setScale(1.8);
    assert(item._lastBadgeScale === 1.8, 'Scale at 1.8');

    // Call easeToRest
    item.easeToRest(0);
    assert(item._lastBadgeScale === -1, 'easeToRest must reset _lastBadgeScale to -1');

    print('  ✓ easeToRest() resets _lastBadgeScale to -1 for subsequent animation cleanly.');
}

print('\n================================================================');
print('ALL ADVERSARIAL CHALLENGES EMPIRICALLY VERIFIED AND PASSED (EXIT 0)');
print('================================================================\n');
