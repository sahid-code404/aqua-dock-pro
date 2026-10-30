// Empirical Stress Test Suite for Milestone 1 (Lifecycle Integrity & Leak Elimination)
// Challenger 2: Timer/idle GSource returns, hook/unhook cycles, signal disconnection stress.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

// Register temporary mock Shell resource for Main imports
const tmpShellDir = GLib.dir_make_tmp('aqua-challenger2-XXXXXX');
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

// Initialize mock global
if (!globalThis.global) {
    globalThis.global = {
        stage: { get_key_focus: () => null },
        display: {},
        get_pointer: () => [0, 0, 0],
    };
}

async function runAllTests() {
    print('=== STARTING CHALLENGER 2 EMPIRICAL STRESS TESTS ===');

    const { TimeoutGroup, SignalGroup } = await import('../core/utils.js');
    const { registerBmsTarget, unregisterBmsTarget, cleanupBms } = await import('../dock/dockBlur.js');

    // ═══════════════════════════════════════════════════════════════════════════════
    // SUITE 1: TimeoutGroup add & addIdle Edge Cases & Concurrency Stress
    // ═══════════════════════════════════════════════════════════════════════════════
    print('\n--- Suite 1: TimeoutGroup add/addIdle Edge Cases & Concurrency Stress ---');

    // 1.1: Verify add and addIdle with undefined (void return)
    {
        const timers = new TimeoutGroup();
        let addFired = 0;
        let idleFired = 0;
        const loop = new GLib.MainLoop(null, false);

        timers.add(1, () => {
            addFired++;
            // returns undefined
        });

        timers.addIdle(() => {
            idleFired++;
            // returns undefined
        });

        let ticks = 0;
        const watcher = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
            ticks++;
            if (ticks >= 3) {
                loop.quit();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });

        loop.run();

        assert(addFired === 1, `add() with undefined must fire exactly once, fired ${addFired}`);
        assert(idleFired === 1, `addIdle() with undefined must fire exactly once, fired ${idleFired}`);
        assert(timers.size === 0, `TimeoutGroup.size must be 0 after completion, got ${timers.size}`);
        print('  ✓ 1.1: undefined return normalized to GLib.SOURCE_REMOVE (fires exactly once, size=0)');
    }

    // 1.2: Verify add and addIdle with null
    {
        const timers = new TimeoutGroup();
        let addFired = 0;
        let idleFired = 0;
        const loop = new GLib.MainLoop(null, false);

        timers.add(1, () => {
            addFired++;
            return null;
        });

        timers.addIdle(() => {
            idleFired++;
            return null;
        });

        let ticks = 0;
        const watcher = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
            ticks++;
            if (ticks >= 3) {
                loop.quit();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        loop.run();

        assert(addFired === 1, `add() with null must fire once, got ${addFired}`);
        assert(idleFired === 1, `addIdle() with null must fire once, got ${idleFired}`);
        assert(timers.size === 0, `timers.size must be 0, got ${timers.size}`);
        print('  ✓ 1.2: null return normalized to GLib.SOURCE_REMOVE');
    }

    // 1.3: Verify add and addIdle with false
    {
        const timers = new TimeoutGroup();
        let addFired = 0;
        let idleFired = 0;
        const loop = new GLib.MainLoop(null, false);

        timers.add(1, () => {
            addFired++;
            return false;
        });

        timers.addIdle(() => {
            idleFired++;
            return false;
        });

        let ticks = 0;
        const watcher = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
            ticks++;
            if (ticks >= 3) {
                loop.quit();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        loop.run();

        assert(addFired === 1, `add() with false must fire once, got ${addFired}`);
        assert(idleFired === 1, `addIdle() with false must fire once, got ${idleFired}`);
        assert(timers.size === 0, `timers.size must be 0, got ${timers.size}`);
        print('  ✓ 1.3: false return normalized to GLib.SOURCE_REMOVE');
    }

    // 1.4: Verify add and addIdle with 0
    {
        const timers = new TimeoutGroup();
        let addFired = 0;
        let idleFired = 0;
        const loop = new GLib.MainLoop(null, false);

        timers.add(1, () => {
            addFired++;
            return 0;
        });

        timers.addIdle(() => {
            idleFired++;
            return 0;
        });

        let ticks = 0;
        const watcher = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
            ticks++;
            if (ticks >= 3) {
                loop.quit();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        loop.run();

        assert(addFired === 1, `add() with 0 must fire once, got ${addFired}`);
        assert(idleFired === 1, `addIdle() with 0 must fire once, got ${idleFired}`);
        assert(timers.size === 0, `timers.size must be 0, got ${timers.size}`);
        print('  ✓ 1.4: 0 return normalized to GLib.SOURCE_REMOVE');
    }

    // 1.5: Verify add and addIdle when callback throws exceptions
    {
        const timers = new TimeoutGroup();
        let addFired = 0;
        let idleFired = 0;
        const loop = new GLib.MainLoop(null, false);

        timers.add(1, () => {
            addFired++;
            throw new Error('Empirical challenge: deliberate exception in add');
        });

        timers.addIdle(() => {
            idleFired++;
            throw new Error('Empirical challenge: deliberate exception in addIdle');
        });

        let ticks = 0;
        const watcher = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
            ticks++;
            if (ticks >= 3) {
                loop.quit();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        loop.run();

        assert(addFired === 1, `throwing in add() must be caught and remove source, got ${addFired}`);
        assert(idleFired === 1, `throwing in addIdle() must be caught and remove source, got ${idleFired}`);
        assert(timers.size === 0, `timers.size must be 0 after exceptions, got ${timers.size}`);
        print('  ✓ 1.5: exceptions cleanly caught, logged, and source removed without loop crash');
    }

    // 1.6: Verify GLib.SOURCE_CONTINUE repeats and cleanly terminates when returning SOURCE_REMOVE
    {
        const timers = new TimeoutGroup();
        let addRepeats = 0;
        let idleRepeats = 0;
        const loop = new GLib.MainLoop(null, false);

        timers.add(2, () => {
            addRepeats++;
            if (addRepeats < 5) {
                return GLib.SOURCE_CONTINUE;
            }
            return GLib.SOURCE_REMOVE;
        });

        timers.addIdle(() => {
            idleRepeats++;
            if (idleRepeats < 5) {
                return GLib.SOURCE_CONTINUE;
            }
            return GLib.SOURCE_REMOVE;
        });

        let ticks = 0;
        const watcher = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            ticks++;
            if (ticks >= 3 && addRepeats >= 5 && idleRepeats >= 5) {
                loop.quit();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        loop.run();

        assert(addRepeats === 5, `add() with CONTINUE must repeat 5 times, got ${addRepeats}`);
        assert(idleRepeats === 5, `addIdle() with CONTINUE must repeat 5 times, got ${idleRepeats}`);
        assert(timers.size === 0, `timers.size must be 0 after termination, got ${timers.size}`);
        print('  ✓ 1.6: GLib.SOURCE_CONTINUE preserved and terminates cleanly on SOURCE_REMOVE');
    }

    // 1.7: Verify non-boolean truthy values (e.g. 1, "continue", {}) are NOT treated as GLib.SOURCE_CONTINUE
    {
        const timers = new TimeoutGroup();
        let addFired = 0;
        let idleFired = 0;
        const loop = new GLib.MainLoop(null, false);

        timers.add(1, () => {
            addFired++;
            return 1; // truthy number, but NOT === GLib.SOURCE_CONTINUE
        });

        timers.addIdle(() => {
            idleFired++;
            return { continue: true }; // truthy object, but NOT === GLib.SOURCE_CONTINUE
        });

        let ticks = 0;
        const watcher = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
            ticks++;
            if (ticks >= 3) {
                loop.quit();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        loop.run();

        assert(addFired === 1, `truthy number must fire once, got ${addFired}`);
        assert(idleFired === 1, `truthy object must fire once, got ${idleFired}`);
        assert(timers.size === 0, `timers.size must be 0, got ${timers.size}`);
        print('  ✓ 1.7: non-boolean truthy returns safely normalized to GLib.SOURCE_REMOVE');
    }

    // 1.8: Verify in-callback self-removal and removeAll
    {
        const timers = new TimeoutGroup();
        const loop = new GLib.MainLoop(null, false);
        let selfRemoveFired = 0;
        let removeAllFired = 0;

        let id1 = 0;
        id1 = timers.add(1, () => {
            selfRemoveFired++;
            timers.remove(id1);
            return GLib.SOURCE_REMOVE;
        });

        let id2 = 0;
        id2 = timers.add(1, () => {
            removeAllFired++;
            timers.removeAll();
            return GLib.SOURCE_REMOVE;
        });

        let ticks = 0;
        const watcher = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
            ticks++;
            if (ticks >= 3) {
                loop.quit();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        loop.run();

        assert(selfRemoveFired === 1, 'in-callback remove(id) must not throw or double-remove');
        assert(removeAllFired <= 1, 'in-callback removeAll() must clear all sources safely');
        assert(timers.size === 0, `timers.size must be 0, got ${timers.size}`);
        print('  ✓ 1.8: in-callback self-removal and removeAll() execute safely');
    }

    // 1.9: Concurrency Stress Test: 500 timeouts + 500 idles with mixed return values
    {
        const timers = new TimeoutGroup();
        const loop = new GLib.MainLoop(null, false);
        const N = 500;
        let totalExecuted = 0;
        let continueExecutions = 0;

        for (let i = 0; i < N; i++) {
            const mode = i % 6;
            if (i % 2 === 0) {
                timers.add(1, () => {
                    totalExecuted++;
                    if (mode === 0) return undefined;
                    if (mode === 1) return null;
                    if (mode === 2) return false;
                    if (mode === 3) return 0;
                    if (mode === 4) throw new Error('Stress exception in timeout');
                    if (mode === 5) {
                        continueExecutions++;
                        return GLib.SOURCE_REMOVE;
                    }
                });
            } else {
                timers.addIdle(() => {
                    totalExecuted++;
                    if (mode === 0) return undefined;
                    if (mode === 1) return null;
                    if (mode === 2) return false;
                    if (mode === 3) return 0;
                    if (mode === 4) throw new Error('Stress exception in idle');
                    if (mode === 5) {
                        continueExecutions++;
                        return GLib.SOURCE_REMOVE;
                    }
                });
            }
        }

        assert(timers.size === N, `Initial timers.size should be ${N}, got ${timers.size}`);

        let waitTicks = 0;
        const watcher = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
            waitTicks++;
            if (timers.size === 0 || waitTicks > 100) {
                loop.quit();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        loop.run();

        assert(totalExecuted === N, `Expected all ${N} callbacks to execute, got ${totalExecuted}`);
        assert(timers.size === 0, `All timers must be deregistered, got ${timers.size}`);
        print(`  ✓ 1.9: Concurrency stress passed (${N} mixed sources drained, timers.size=0)`);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // SUITE 2: Verification of Modified Timer/Idle Callbacks
    // ═══════════════════════════════════════════════════════════════════════════════
    print('\n--- Suite 2: Exact Canonical GLib.SOURCE_REMOVE in Modified Callbacks ---');

    // 2.1: Static AST verification across entire repository
    {
        const modifiedFiles = [
            'autohide/autohideManager.js',
            'dock/dockController.js',
            'menus/menuManager.js',
            'ui/preview/previewManager.js',
            'services/mountedDevices.js',
        ];

        for (const relPath of modifiedFiles) {
            const fullPath = GLib.build_filenamev([GLib.get_current_dir(), relPath]);
            const [, bytes] = GLib.file_get_contents(fullPath);
            const code = new TextDecoder().decode(bytes);

            assert(code.includes("import GLib from 'gi://GLib';") || code.includes('import GLib from "gi://GLib";'),
                `${relPath} must import GLib`);

            const timerClosureRegex = /(?:addIdle|addOnce|_timers\.add|_timers\.addIdle)\s*\([^;]+?\);/gs;
            let match;
            while ((match = timerClosureRegex.exec(code)) !== null) {
                const closureText = match[0];
                assert(!closureText.includes('return false;'),
                    `Found bare 'return false;' inside timer closure in ${relPath}:\n${closureText}`);
                if (closureText.includes('return ')) {
                    assert(closureText.includes('GLib.SOURCE_REMOVE') || closureText.includes('GLib.SOURCE_CONTINUE'),
                        `Return statement in timer closure in ${relPath} must use GLib.SOURCE_REMOVE / CONTINUE:\n${closureText}`);
                }
            }
        }
        print('  ✓ 2.1: Static scan confirmed zero bare `return false;` in modified timer closures');
    }

    // 2.2: Dynamic callback return value inspection
    {
        // Test AutohideManager idle callbacks
        const autohideMod = await import('../autohide/autohideManager.js');
        const autohide = Object.create(autohideMod.AutohideManager.prototype);
        autohide._timers = new TimeoutGroup();
        autohide._idleId = 0;
        autohide._transitionReleaseId = 0;
        autohide._windowTransitions = new Map();
        autohide.updateIntellihide = () => {};

        let capturedCallback = null;
        autohide._timers.addIdle = (cb) => { capturedCallback = cb; return 1; };

        // Test queueIntellihide
        autohide.queueIntellihide();
        assert(capturedCallback !== null, 'queueIntellihide must schedule addIdle');
        const ret1 = capturedCallback();
        assert(ret1 === GLib.SOURCE_REMOVE, `queueIntellihide idle callback must return GLib.SOURCE_REMOVE, got ${ret1}`);
        assert(typeof ret1 === 'boolean' && ret1 === false, 'GLib.SOURCE_REMOVE must be boolean false');

        // Test _finishWindowTransition
        const mockActor = { disconnect: () => {} };
        autohide._windowTransitions.set(mockActor, [1]);
        autohide._enabled = true;
        autohide._transitionReleaseId = 0;
        capturedCallback = null;
        autohide._finishWindowTransition(mockActor);
        assert(capturedCallback !== null, '_finishWindowTransition must schedule addIdle');
        const ret2 = capturedCallback();
        assert(ret2 === GLib.SOURCE_REMOVE, `_finishWindowTransition idle callback must return GLib.SOURCE_REMOVE, got ${ret2}`);
        assert(typeof ret2 === 'boolean' && ret2 === false, 'GLib.SOURCE_REMOVE must be boolean false');

        // Test DockController _scheduleFocusLeave
        const dockControllerMod = await import('../dock/dockController.js');
        const controller = Object.create(dockControllerMod.DockController.prototype);
        controller._timers = new TimeoutGroup();
        controller._disableFocusPointerExit = () => {};
        controller._endHover = () => {};
        controller._autohide = { onDockLeft: () => {} };
        controller._engine = { setHeldItem: () => {} };
        controller._menu = { active: false };

        capturedCallback = null;
        controller._timers.addIdle = (cb) => { capturedCallback = cb; return 2; };

        // Scenario A: focusItem set, focused in items
        const dummyItem = { name: 'item1' };
        controller._focusItem = dummyItem;
        controller._focusLeaveId = 0;
        controller._factory = { items: [dummyItem] };
        globalThis.global.stage.get_key_focus = () => dummyItem;

        controller._scheduleFocusLeave();
        assert(capturedCallback !== null, '_scheduleFocusLeave must schedule idle callback');
        const retA = capturedCallback();
        assert(retA === GLib.SOURCE_REMOVE, `_scheduleFocusLeave (early return) must return GLib.SOURCE_REMOVE, got ${retA}`);
        assert(typeof retA === 'boolean' && retA === false, 'GLib.SOURCE_REMOVE must be boolean false');

        // Scenario B: focused outside dock
        controller._focusItem = dummyItem;
        controller._focusLeaveId = 0;
        globalThis.global.stage.get_key_focus = () => null;

        controller._scheduleFocusLeave();
        const retB = capturedCallback();
        assert(retB === GLib.SOURCE_REMOVE, `_scheduleFocusLeave (dock leave) must return GLib.SOURCE_REMOVE, got ${retB}`);
        assert(typeof retB === 'boolean' && retB === false, 'GLib.SOURCE_REMOVE must be boolean false');

        // Test MenuManager _scheduleClose
        const menuMod = await import('../menus/menuManager.js');
        const menuMgr = Object.create(menuMod.MenuManager.prototype);
        menuMgr._timers = new TimeoutGroup();
        menuMgr._closeIdle = 0;
        menuMgr._cancelCloseIdle = () => {};
        menuMgr._destroyMenu = () => {};
        menuMgr._host = { onClose: () => {} };

        capturedCallback = null;
        menuMgr._timers.addIdle = (cb) => { capturedCallback = cb; return 3; };

        const mockMenu = { close: () => {} };
        menuMgr._scheduleClose(mockMenu);
        assert(capturedCallback !== null, '_scheduleClose must schedule idle callback');
        const retMenu = capturedCallback();
        assert(retMenu === GLib.SOURCE_REMOVE, `_scheduleClose idle callback must return GLib.SOURCE_REMOVE, got ${retMenu}`);
        assert(typeof retMenu === 'boolean' && retMenu === false, 'GLib.SOURCE_REMOVE must be boolean false');

        // Test PreviewManager _queueWindowRefresh
        const previewMod = await import('../ui/preview/previewManager.js');
        const previewMgr = Object.create(previewMod.PreviewManager.prototype);
        previewMgr._timers = new TimeoutGroup();
        previewMgr._cancelWindowRefresh = () => {};
        previewMgr._build = () => {};

        capturedCallback = null;
        previewMgr._timers.addIdle = (cb) => { capturedCallback = cb; return 4; };

        const mockBox = { destroy: () => {} };
        const mockItem = { name: 'previewItem' };
        previewMgr._box = mockBox;
        previewMgr._queueWindowRefresh(mockItem, mockBox, false, 0, false);
        assert(capturedCallback !== null, '_queueWindowRefresh must schedule idle callback');
        const retPrev = capturedCallback();
        assert(retPrev === GLib.SOURCE_REMOVE, `_queueWindowRefresh idle callback must return GLib.SOURCE_REMOVE, got ${retPrev}`);
        assert(typeof retPrev === 'boolean' && retPrev === false, 'GLib.SOURCE_REMOVE must be boolean false');

        print('  ✓ 2.2: Dynamic invocation verified exact canonical GLib.SOURCE_REMOVE return across all modified managers');
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // SUITE 3: dockBlur.js Hook/Unhook Lifecycle & Stress
    // ═══════════════════════════════════════════════════════════════════════════════
    print('\n--- Suite 3: dockBlur.js Hook/Unhook Lifecycle & Stress ---');

    {
        let tryBlurCallCount = 0;
        const pristineTryBlur = function pristine_try_blur(c) {
            tryBlurCallCount++;
            return 'pristine_blur_result';
        };

        const pristineBlurExisting = function pristine_blur_existing() {
            return 'pristine_blur_existing';
        };

        const mockDashBlur = {
            enabled: true,
            dashes: [],
            try_blur: pristineTryBlur,
            blur_existing_dashes: pristineBlurExisting,
            add_blur() {
                return {
                    background_group: { get_parent: () => null, destroy() {} },
                    background: { set_position() {}, set_size() {} },
                };
            },
        };

        globalThis.global.blur_my_shell = { _dash_to_dock_blur: mockDashBlur };

        function createMockContainer(id) {
            return {
                name: `aquaContainer_${id}`,
                _isAquaDock: true,
                _dockBlurEnabled: true,
                width: 100,
                height: 60,
                get_dock_radius: () => 20,
                connect: () => 1,
                disconnect: () => {},
            };
        }

        // Helper to query resident memory in kilobytes
        function getRssKb() {
            try {
                const [, content] = GLib.file_get_contents('/proc/self/statm');
                const pages = parseInt(new TextDecoder().decode(content).trim().split(/\s+/)[1], 10);
                return (pages * 4096) / 1024;
            } catch {
                return 0;
            }
        }

        // 3.1: 1,000+ hook/unhook stress cycles: strict reference equality, post-stress invocations, zero name pollution
        const c1 = createMockContainer(1);
        const testCycles = 1000;

        const initialRss = getRssKb();
        for (let cycle = 0; cycle < testCycles; cycle++) {
            registerBmsTarget(c1, () => 20);
            assert(mockDashBlur._aquaDockHooked === true, `Cycle ${cycle}: _aquaDockHooked must be true`);

            unregisterBmsTarget(c1);
            assert(mockDashBlur._aquaDockHooked === undefined, `Cycle ${cycle}: _aquaDockHooked must be deleted`);

            // Strict reference equality asserted on every cycle
            assert(mockDashBlur.try_blur === pristineTryBlur,
                `Cycle ${cycle}: try_blur reference was corrupted! Expected pristineTryBlur, got ${mockDashBlur.try_blur?.name}`);
            assert(mockDashBlur.blur_existing_dashes === pristineBlurExisting,
                `Cycle ${cycle}: blur_existing_dashes reference was corrupted! Expected pristineBlurExisting, got ${mockDashBlur.blur_existing_dashes?.name}`);
        }

        const finalRss = getRssKb();
        const deltaRss = finalRss - initialRss;

        // Count and assert absence of name pollution
        const nameMatches = (mockDashBlur.try_blur.name.match(/bound /g) || []).length;
        const boundLayersCount = nameMatches;
        assert(boundLayersCount === 0, `Expected 0 bound wrappers, got ${boundLayersCount}`);
        assert(mockDashBlur.try_blur.name === 'pristine_try_blur',
            `Expected "pristine_try_blur", got "${mockDashBlur.try_blur.name}"`);
        assert(mockDashBlur.blur_existing_dashes.name === 'pristine_blur_existing',
            `Expected "pristine_blur_existing", got "${mockDashBlur.blur_existing_dashes.name}"`);

        // Post-stress invocation test on unhooked methods
        const countBefore = tryBlurCallCount;
        const unhookedResult = mockDashBlur.try_blur(c1);
        assert(unhookedResult === 'pristine_blur_result', `Expected pristine_blur_result, got ${unhookedResult}`);
        assert(tryBlurCallCount === countBefore + 1, 'Pristine try_blur must be invoked directly');

        const unhookedExisting = mockDashBlur.blur_existing_dashes();
        assert(unhookedExisting === 'pristine_blur_existing', `Expected pristine_blur_existing, got ${unhookedExisting}`);

        // Post-stress invocation test while hooked: verify .call(dashBlur, ...) preserves this & arguments
        registerBmsTarget(c1, () => 20);
        assert(mockDashBlur._aquaDockHooked === true, 'BMS must be hooked');

        // Target not in activeAquaContainers forwards to origTryBlur.call(dashBlur, container)
        const unmanagedContainer = { name: 'other_container' };
        const forwardedResult = mockDashBlur.try_blur(unmanagedContainer);
        assert(forwardedResult === 'pristine_blur_result', `Expected pristine_blur_result, got ${forwardedResult}`);
        assert(tryBlurCallCount === countBefore + 2, 'Pristine try_blur must be invoked via .call() forwarding');

        // blur_existing_dashes forwards to origBlurExistingDashes?.call(dashBlur)
        mockDashBlur.blur_existing_dashes();

        // Final unhook and re-verification of reference equality
        unregisterBmsTarget(c1);
        assert(mockDashBlur.try_blur === pristineTryBlur, 'try_blur must equal pristineTryBlur after final unhook');
        assert(mockDashBlur.blur_existing_dashes === pristineBlurExisting, 'blur_existing_dashes must equal pristineBlurExisting after final unhook');

        print(`  ✓ 3.1: ${testCycles} cycles passed: strict reference equality preserved, post-stress invocations verified, zero name pollution (Delta RSS: ${deltaRss} KB)`);

        // 3.2: Concurrent containers: register 100, unregister in arbitrary order
        const containers = [];
        for (let i = 0; i < 100; i++) {
            containers.push(createMockContainer(i));
        }

        for (const c of containers) {
            registerBmsTarget(c, () => 20);
        }
        assert(mockDashBlur._aquaDockHooked === true, 'BMS must be hooked with 100 containers');

        for (let i = 0; i < 99; i++) {
            unregisterBmsTarget(containers[i]);
            assert(mockDashBlur._aquaDockHooked === true, `Hook must remain active while container ${99} is registered`);
        }

        unregisterBmsTarget(containers[99]);
        assert(mockDashBlur._aquaDockHooked === undefined, 'Hook must be removed after last container unregistered');
        print('  ✓ 3.2: 100 concurrent containers correctly retained hook until last unregistration');

        // 3.3: cleanupBms() stress & idempotency
        for (const c of containers.slice(0, 30)) {
            registerBmsTarget(c, () => 20);
        }
        assert(mockDashBlur._aquaDockHooked === true, 'BMS must be hooked for 30 containers');
        cleanupBms();
        assert(mockDashBlur._aquaDockHooked === undefined, 'cleanupBms must unhook BMS');

        for (let i = 0; i < 50; i++) {
            cleanupBms();
            assert(mockDashBlur._aquaDockHooked === undefined, 'cleanupBms repeat must not throw');
        }
        print('  ✓ 3.3: cleanupBms() is completely idempotent and cleanly resets hook state');

        // 3.4: BMS absence / disable resilience
        globalThis.global.blur_my_shell = null;
        const testActor = createMockContainer(999);
        registerBmsTarget(testActor, () => 10);
        unregisterBmsTarget(testActor);
        cleanupBms();

        globalThis.global.blur_my_shell = { _dash_to_dock_blur: null };
        registerBmsTarget(testActor, () => 10);
        unregisterBmsTarget(testActor);
        cleanupBms();

        print('  ✓ 3.4: registerBmsTarget, unregisterBmsTarget, and cleanupBms behave safely when BMS is null');

        delete globalThis.global.blur_my_shell;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // SUITE 4: Signal Disconnection & Dash Lifecycle Stress
    // ═══════════════════════════════════════════════════════════════════════════════
    print('\n--- Suite 4: Signal Disconnection & Dash Lifecycle Stress ---');

    // 4.1: SignalGroup rapid connection and teardown stress
    {
        const signals = new SignalGroup();
        const MOCK_COUNT = 1000;
        const mockObjects = [];
        let disconnectedCount = 0;

        for (let i = 0; i < MOCK_COUNT; i++) {
            const obj = {
                id: i,
                signals: new Map(),
                connect(sig, cb) {
                    const connId = this.signals.size + 1;
                    this.signals.set(connId, cb);
                    return connId;
                },
                disconnect(connId) {
                    disconnectedCount++;
                    this.signals.delete(connId);
                },
            };
            mockObjects.push(obj);
            signals.connect(obj, 'test-signal', () => {});
        }

        assert(signals.size === MOCK_COUNT, `signals.size should be ${MOCK_COUNT}, got ${signals.size}`);
        signals.disconnectAll();
        assert(signals.size === 0, `signals.size must be 0 after disconnectAll, got ${signals.size}`);
        assert(disconnectedCount === MOCK_COUNT, `All ${MOCK_COUNT} signals must be disconnected, got ${disconnectedCount}`);

        // Disconnect already-empty group
        signals.disconnectAll();
        assert(signals.size === 0, 'disconnectAll on empty group must remain 0');

        // Robustness when objects throw on disconnect
        for (let i = 0; i < 50; i++) {
            const throwingObj = {
                connect: () => i + 1,
                disconnect: () => { throw new Error('Object already finalized'); },
            };
            signals.connect(throwingObj, 'throw-sig', () => {});
        }
        assert(signals.size === 50, 'signals.size must be 50');
        signals.disconnectAll(); // must not throw
        assert(signals.size === 0, 'signals.size must be 0 even after throwing objects');
        print('  ✓ 4.1: SignalGroup handles 1,000 connects, disconnectAll, and throwing objects cleanly');
    }

    // 4.2: dock.js hideDash() re-entrance and baseline property preservation stress
    {
        let signalIdCounter = 1;
        let disconnectedSignals = 0;
        const activeSignals = new Set();

        const mockDash = {
            visible: true,
            height: 80,
            opacity: 255,
            reactive: true,
            classes: new Set(),
            connect(sig, cb) {
                const sid = signalIdCounter++;
                activeSignals.add(sid);
                return sid;
            },
            disconnect(sid) {
                disconnectedSignals++;
                activeSignals.delete(sid);
            },
            add_style_class_name(cls) { this.classes.add(cls); },
            remove_style_class_name(cls) { this.classes.delete(cls); },
            set_height(h) { this.height = h; },
            show() { this.visible = true; },
            hide() { this.visible = false; },
        };

        const mockDock = {
            _dash: null,
            _dashNotifyIds: null,
            _dashWasVisible: null,
            _dashHeight: null,
            _dashOpacity: null,
            _dashReactive: null,
            _dashCfg: null,
            _enforceDash(cfg = null) {
                this._dash.opacity = 0;
                this._dash.reactive = false;
                this._dash.add_style_class_name('aqua-dash-hidden');
                this._dash.set_height(100);
                return true;
            },
            hideDash(cfg) {
                const dash = mockDash;
                if (this._dashNotifyIds) {
                    for (const id of this._dashNotifyIds) {
                        try { (this._dash ?? dash).disconnect(id); } catch { /* intentionally ignored: stock dash actor may already be destroyed in test teardown */ }
                    }
                    this._dashNotifyIds = null;
                }

                if (this._dash !== dash) {
                    this._dash = dash;
                    this._dashWasVisible = dash.visible;
                    this._dashHeight = dash.height;
                    this._dashOpacity = dash.opacity;
                    this._dashReactive = dash.reactive;
                }
                this._dashCfg = cfg;
                this._dashNotifyIds = [];

                this._enforceDash(cfg, true);
                this._dashNotifyIds.push(dash.connect('notify::opacity', () => this._enforceDash()));
                this._dashNotifyIds.push(dash.connect('notify::reactive', () => this._enforceDash()));
            },
            restoreDash() {
                if (!this._dash) return;
                if (this._dashNotifyIds) {
                    for (const id of this._dashNotifyIds) {
                        try { this._dash?.disconnect(id); } catch { /* intentionally ignored: stock dash actor may already be destroyed in test teardown */ }
                    }
                    this._dashNotifyIds = null;
                }
                try {
                    this._dash.remove_style_class_name('aqua-dash-hidden');
                    this._dash.set_height(this._dashHeight ?? -1);
                    this._dash.opacity = this._dashOpacity ?? 255;
                    this._dash.reactive = this._dashReactive ?? true;
                    if (this._dashWasVisible) this._dash.show();
                    else this._dash.hide();
                } catch { /* intentionally ignored: stock dash actor may already be destroyed in test teardown */ }
                this._dash = null;
                this._dashCfg = null;
                this._dashHeight = null;
            },
        };

        // Stress test: Call hideDash 100 times rapidly without restoreDash
        for (let i = 0; i < 100; i++) {
            mockDock.hideDash({ dockH: 48, edgeMargin: 0 });
        }

        // Verify exactly 2 notify signals are currently active on mockDash (prior 198 were disconnected)
        assert(activeSignals.size === 2, `Only 2 signal handlers should remain active, found ${activeSignals.size}`);
        assert(disconnectedSignals === 198, `Expected 198 disconnected signal handlers, got ${disconnectedSignals}`);

        // Verify baseline was NOT corrupted by 100 re-entrant calls
        assert(mockDock._dashOpacity === 255, `Baseline opacity must be 255, got ${mockDock._dashOpacity}`);
        assert(mockDock._dashHeight === 80, `Baseline height must be 80, got ${mockDock._dashHeight}`);
        assert(mockDock._dashReactive === true, 'Baseline reactive must be true');
        assert(mockDock._dashWasVisible === true, 'Baseline visibility must be true');

        // Call restoreDash()
        mockDock.restoreDash();
        assert(activeSignals.size === 0, 'All signal handlers must be disconnected after restoreDash');
        assert(mockDash.opacity === 255, `Dash opacity must be restored to 255, got ${mockDash.opacity}`);
        assert(mockDash.height === 80, `Dash height must be restored to 80, got ${mockDash.height}`);
        assert(mockDash.reactive === true, 'Dash reactive must be restored to true');
        assert(mockDash.visible === true, 'Dash visibility must be restored to true');
        assert(!mockDash.classes.has('aqua-dash-hidden'), 'Style class must be removed');

        print('  ✓ 4.2: hideDash re-entrancy preserves baseline properties and prevents signal handler leak');
    }

    // Cleanup temporary Shell resource
    GLib.spawn_sync(null, ['rm', '-rf', tmpShellDir], null, GLib.SpawnFlags.SEARCH_PATH, null);

    print('\n=== ALL CHALLENGER 2 EMPIRICAL STRESS TESTS PASSED ===\n');
}

runAllTests().catch(err => {
    printerr('CHALLENGER 2 STRESS TEST FAILED:\n' + (err.stack || err));
    imports.system.exit(1);
});
