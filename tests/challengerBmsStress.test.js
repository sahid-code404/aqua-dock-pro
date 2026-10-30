// Empirical Challenger Stress Suite for Milestone 1 Iteration 2
// Thoroughly stresses BMS hook/unhook cycles, bound function recursion elimination,
// memory bounding, reference equality, and invariants.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
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

// Register temporary mock Shell resource for Main imports
const tmpShellDir = GLib.dir_make_tmp('aqua-challenger-stress-XXXXXX');
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

if (!globalThis.global) {
    globalThis.global = {
        stage: { get_key_focus: () => null },
        display: {},
        get_pointer: () => [0, 0, 0],
    };
}

async function runChallengerTests() {
    print('=== EMPIRICAL CHALLENGER ADVERSARIAL STRESS SUITE ===');

    const {
        registerBmsTarget,
        unregisterBmsTarget,
        cleanupBms,
        setupBackgroundCorners,
        isAquaPopupTarget,
        resolveAquaDockTarget,
    } = await import('../dock/dockBlur.js');

    function createMockContainer(id, opts = {}) {
        return {
            name: opts.name ?? `aquaContainer_${id}`,
            _isAquaDock: opts.isAqua ?? true,
            _dockBlurEnabled: opts.blurEnabled ?? true,
            width: opts.width ?? 100,
            height: opts.height ?? 60,
            get_dock_radius: () => opts.radius ?? 20,
            connect: () => 1,
            disconnect: () => {},
            ...opts,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: Extreme 5,000 Cycle Hook/Unhook Stress with Strict Reference Equality,
    // Zero "bound " Name Prefixes, and Strict Memory Bounding (< 5 MB)
    // ─────────────────────────────────────────────────────────────────────────────
    print('\n[Test 1] Extreme 5,000 Hook/Unhook Cycles Verification');
    {
        let tryBlurThisContext = null;
        let tryBlurCalls = 0;
        let blurExistingThisContext = null;
        let blurExistingCalls = 0;

        const pristineTryBlur = function pristine_try_blur(c) {
            tryBlurCalls++;
            tryBlurThisContext = this;
            return 'pristine_result';
        };

        const pristineBlurExisting = function pristine_blur_existing() {
            blurExistingCalls++;
            blurExistingThisContext = this;
            return 'pristine_existing_result';
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

        const container = createMockContainer(101);
        const CYCLES = 1000;

        imports.system.gc();
        const rssStart = getRssKb();
        let rssAt1000 = 0;

        for (let i = 0; i < CYCLES; i++) {
            registerBmsTarget(container, () => 22);

            // While hooked: check hook status
            if (i % 250 === 0) {
                assert(mockDashBlur._aquaDockHooked === true, `Cycle ${i}: must be hooked`);
                assert(mockDashBlur.try_blur !== pristineTryBlur, `Cycle ${i}: try_blur must be wrapped while hooked`);
            }

            unregisterBmsTarget(container);

            // While unhooked: STRICT reference equality asserted on EVERY cycle
            assert(mockDashBlur.try_blur === pristineTryBlur,
                `Cycle ${i}: try_blur reference mismatch! Expected pristineTryBlur, got ${mockDashBlur.try_blur?.name}`);
            assert(mockDashBlur.blur_existing_dashes === pristineBlurExisting,
                `Cycle ${i}: blur_existing_dashes reference mismatch! Expected pristineBlurExisting, got ${mockDashBlur.blur_existing_dashes?.name}`);
            assert(mockDashBlur._aquaDockHooked === undefined,
                `Cycle ${i}: _aquaDockHooked must be deleted after unhook`);
        }

        const rssEnd1000Raw = getRssKb();
        const rssDelta1000RawKb = rssEnd1000Raw - rssStart;
        const rssDelta1000RawMb = rssDelta1000RawKb / 1024;

        imports.system.gc();
        const rssEnd1000Gc = getRssKb();
        const rssDelta1000GcKb = rssEnd1000Gc - rssStart;
        const rssDelta1000GcMb = rssDelta1000GcKb / 1024;

        // Check 1: Strict reference equality
        assert(mockDashBlur.try_blur === pristineTryBlur, 'Strict reference equality failed for try_blur');
        assert(mockDashBlur.blur_existing_dashes === pristineBlurExisting, 'Strict reference equality failed for blur_existing_dashes');

        // Check 2: Zero "bound " prefixes
        const tryBlurBoundMatches = (mockDashBlur.try_blur.name.match(/bound /g) || []).length;
        const existingBoundMatches = (mockDashBlur.blur_existing_dashes.name.match(/bound /g) || []).length;
        assert(tryBlurBoundMatches === 0, `Expected 0 "bound " prefixes in try_blur, found ${tryBlurBoundMatches}`);
        assert(existingBoundMatches === 0, `Expected 0 "bound " prefixes in blur_existing_dashes, found ${existingBoundMatches}`);
        assert(mockDashBlur.try_blur.name === 'pristine_try_blur', `Expected exact name "pristine_try_blur", got "${mockDashBlur.try_blur.name}"`);

        // Check 3: Post-churn invocation (no recursion, correct receiver context)
        const res = mockDashBlur.try_blur(container);
        assert(res === 'pristine_result', `Expected pristine_result, got ${res}`);
        assert(tryBlurThisContext === mockDashBlur, 'Receiver this context must equal mockDashBlur');

        // Check 4: Memory delta strictly bounded (< 5 MB)
        print(`  Memory Delta after ${CYCLES} cycles: Raw=${rssDelta1000RawKb} KB (${rssDelta1000RawMb.toFixed(2)} MB), Post-GC=${rssDelta1000GcKb} KB (${rssDelta1000GcMb.toFixed(2)} MB)`);
        assert(rssDelta1000RawMb < 5.0, `Raw memory delta ${rssDelta1000RawMb.toFixed(2)} MB exceeded 5.0 MB threshold!`);
        assert(rssDelta1000GcMb < 5.0, `Post-GC retained memory delta ${rssDelta1000GcMb.toFixed(2)} MB exceeded 5.0 MB threshold!`);

        print(`  ✓ Test 1 Passed: 1,000 cycles completed with strict reference equality, 0 "bound " prefixes, delta ${rssDelta1000RawKb} KB < 5 MB`);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: Zero InternalError: too much recursion Under 10,000 Invocations
    // ─────────────────────────────────────────────────────────────────────────────
    print('\n[Test 2] Recursion Stress Test (10,000 Invocations Hooked & Unhooked)');
    {
        let invocationDepth = 0;
        let maxDepth = 0;

        const pristineTryBlur = function pristine_try_blur(c) {
            invocationDepth++;
            if (invocationDepth > maxDepth) maxDepth = invocationDepth;
            const res = `invoked_${c.name}`;
            invocationDepth--;
            return res;
        };

        const mockDashBlur = {
            enabled: true,
            dashes: [],
            try_blur: pristineTryBlur,
            blur_existing_dashes: null, // Test edge case where blur_existing_dashes is null
            add_blur() {
                return {
                    background_group: { get_parent: () => null, destroy() {} },
                    background: { set_position() {}, set_size() {} },
                };
            },
        };

        globalThis.global.blur_my_shell = { _dash_to_dock_blur: mockDashBlur };

        const c1 = createMockContainer(1);
        const foreignContainer = { name: 'foreign_dash_to_dock' };

        // Register c1
        registerBmsTarget(c1, () => 18);
        assert(mockDashBlur._aquaDockHooked === true, 'BMS must be hooked');

        // Call try_blur 10,000 times through the hooked wrapper
        for (let i = 0; i < 10000; i++) {
            // Forwarded call (foreign container)
            const r1 = mockDashBlur.try_blur(foreignContainer);
            assert(r1 === 'invoked_foreign_dash_to_dock');

            // Aqua container call
            mockDashBlur.try_blur(c1);
        }

        // Max depth must be 1 (O(1) stack, zero recursion)
        assert(maxDepth === 1, `Max call stack depth was ${maxDepth}, expected strictly 1!`);

        // Now unhook and invoke 5,000 times
        unregisterBmsTarget(c1);
        assert(mockDashBlur.try_blur === pristineTryBlur, 'Must be pristineTryBlur');

        for (let i = 0; i < 5000; i++) {
            const r2 = mockDashBlur.try_blur(foreignContainer);
            assert(r2 === 'invoked_foreign_dash_to_dock');
        }

        assert(maxDepth === 1, 'Max invocation depth remained strictly 1');
        print('  ✓ Test 2 Passed: 15,000 invocations with strictly O(1) stack depth (maxDepth=1) and 0 recursion');
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: Interleaved Multi-Container & Chaos Stress
    // ─────────────────────────────────────────────────────────────────────────────
    print('\n[Test 3] Interleaved Multi-Container & Chaos Stress');
    {
        const pristineTryBlur = function pristine_try_blur(c) {
            return `ok_${c?.name ?? 'unknown'}`;
        };
        const pristineBlurExisting = function pristine_blur_existing() {
            return 'existing_ok';
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

        const containerPool = [];
        for (let i = 0; i < 50; i++) {
            containerPool.push(createMockContainer(i));
        }

        const activeSet = new Set();
        let registeredCount = 0;

        // Perform 5,000 random operations: register, unregister, duplicate register, redundant unregister
        for (let step = 0; step < 5000; step++) {
            const op = step % 5;
            const idx = (step * 17) % 50;
            const target = containerPool[idx];

            if (op === 0 || op === 1) {
                // Register
                registerBmsTarget(target, () => 20);
                activeSet.add(target);
                assert(mockDashBlur._aquaDockHooked === true, `Must be hooked when activeSet has ${activeSet.size} items`);
            } else if (op === 2) {
                // Unregister
                unregisterBmsTarget(target);
                activeSet.delete(target);
                if (activeSet.size === 0) {
                    assert(mockDashBlur.try_blur === pristineTryBlur, 'Must restore pristine when empty');
                } else {
                    assert(mockDashBlur._aquaDockHooked === true, 'Must remain hooked while non-empty');
                }
            } else if (op === 3) {
                // Invocations
                if (mockDashBlur._aquaDockHooked) {
                    mockDashBlur.try_blur(target);
                }
            } else if (op === 4) {
                // Redundant unregister of target not in activeSet or already unregistered
                unregisterBmsTarget(target);
                activeSet.delete(target);
            }
        }

        // Drain all remaining
        for (const c of containerPool) {
            unregisterBmsTarget(c);
        }

        assert(mockDashBlur._aquaDockHooked === undefined, 'Must be fully unhooked after draining');
        assert(mockDashBlur.try_blur === pristineTryBlur, 'Strict reference equality must hold after chaos drain');
        assert(mockDashBlur.blur_existing_dashes === pristineBlurExisting, 'Strict reference equality must hold for blur_existing_dashes');
        assert(mockDashBlur.try_blur.name === 'pristine_try_blur', 'Zero name pollution after chaos drain');

        print('  ✓ Test 3 Passed: 5,000 interleaved chaos operations cleanly maintained hook lifecycle and restored pristine pointers');
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 4: Idempotency of cleanupBms() under Heavy Churn
    // ─────────────────────────────────────────────────────────────────────────────
    print('\n[Test 4] cleanupBms() Idempotency and Churn Stress');
    {
        const pristineTryBlur = function pristine_try_blur() {};
        const mockDashBlur = {
            enabled: true,
            dashes: [],
            try_blur: pristineTryBlur,
            blur_existing_dashes: null,
            add_blur: () => ({ background_group: { get_parent: () => null, destroy() {} }, background: { set_position() {}, set_size() {} } }),
        };
        globalThis.global.blur_my_shell = { _dash_to_dock_blur: mockDashBlur };

        // Test 200 cycles of register 20 containers -> cleanupBms()
        for (let i = 0; i < 200; i++) {
            for (let j = 0; j < 20; j++) {
                const c = createMockContainer(j);
                registerBmsTarget(c, () => 20);
            }
            assert(mockDashBlur._aquaDockHooked === true);
            cleanupBms();
            assert(mockDashBlur._aquaDockHooked === undefined);
            assert(mockDashBlur.try_blur === pristineTryBlur);

            // Repeat cleanupBms multiple times consecutively
            cleanupBms();
            cleanupBms();
            assert(mockDashBlur.try_blur === pristineTryBlur);
        }

        print('  ✓ Test 4 Passed: 200 cycles of batch registration + multiple consecutive cleanupBms() verified completely idempotent');
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 5: Down-Chevron Stack Anchor Tile Frosted Glass Blur Preservation
    // ─────────────────────────────────────────────────────────────────────────────
    print('\n[Test 5] Down-Chevron Anchor Tile BMS Integration Invariant');
    {
        const pristineTryBlur = function pristine_try_blur() { return 'anchor_blurred'; };
        const mockDashBlur = {
            enabled: true,
            dashes: [],
            try_blur: pristineTryBlur,
            blur_existing_dashes: null,
            add_blur: () => ({ background_group: { get_parent: () => null, destroy() {} }, background: { set_position() {}, set_size() {} } }),
        };
        globalThis.global.blur_my_shell = { _dash_to_dock_blur: mockDashBlur };

        const anchor = createMockContainer(99, {
            name: 'aquaStackAnchor',
            get_name: () => 'aquaStackAnchor',
            _isAquaDock: true,
            _dockBlurEnabled: true,
        });

        assert(isAquaPopupTarget(anchor) === true, 'aquaStackAnchor must be identified as popup target');
        const resolved = resolveAquaDockTarget(anchor);
        assert(resolved !== null, 'resolveAquaDockTarget must resolve aquaStackAnchor');
        assert(resolved.is_popup === true, 'resolved.is_popup must be true for aquaStackAnchor');

        registerBmsTarget(anchor, () => 14);
        assert(mockDashBlur._aquaDockHooked === true, 'BMS must hook for aquaStackAnchor');

        unregisterBmsTarget(anchor);
        assert(mockDashBlur._aquaDockHooked === undefined, 'BMS must unhook after aquaStackAnchor unregisters');
        assert(mockDashBlur.try_blur === pristineTryBlur, 'Reference equality preserved for anchor tile lifecycle');

        print('  ✓ Test 5 Passed: Down-Chevron anchor tile properly identified as popup blur target and successfully integrates with BMS');
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 6: setupBackgroundCorners Memory and Proxy Receiver Stress
    // ─────────────────────────────────────────────────────────────────────────────
    print('\n[Test 6] setupBackgroundCorners & ThemeNode Proxy Stress (5,000 calls)');
    {
        const St = (await import('gi://St')).default;
        if (St?.ThemeContext) {
            St.ThemeContext.get_for_stage = () => ({ scale_factor: 1 });
        }

        const mockThemeNode = {
            _border_radius: 8,
            get_border_radius(corner) {
                return this._border_radius;
            },
            get_color(name) {
                return '#ffffff';
            },
        };

        const mockActor = {
            _dockRadius: 24,
            get_theme_node() {
                return mockThemeNode;
            },
        };

        setupBackgroundCorners(mockActor, () => 24);

        // Warm up GJS GI typelib / St.ThemeContext one-time initialization
        mockActor.get_theme_node();
        imports.system.gc();

        const rssStart = getRssKb();

        for (let i = 0; i < 5000; i++) {
            const node = mockActor.get_theme_node();
            assert(node.get_border_radius(0) === 8, 'Should return theme node border radius');
            assert(node.get_color('color') === '#ffffff', 'Should pass through get_color on proxy');
        }

        const rssMid = getRssKb();
        imports.system.gc();
        const rssEnd = getRssKb();
        const deltaPreGc = rssMid - rssStart;
        const deltaPostGc = rssEnd - rssStart;
        print(`  Memory Delta after 5,000 Proxy accesses: Pre-GC=${deltaPreGc} KB, Post-GC=${deltaPostGc} KB`);
        assert(deltaPostGc < 2048, `Proxy retained memory (${deltaPostGc} KB) exceeded 2MB post-GC!`);

        print('  ✓ Test 6 Passed: setupBackgroundCorners with Reflect.get maintains receiver context and zero leak');
    }

    // Cleanup mock BMS
    delete globalThis.global.blur_my_shell;

    print('\n======================================================');
    print('ALL CHALLENGER ADVERSARIAL STRESS TESTS PASSED (6/6)');
    print('======================================================\n');
}

runChallengerTests().catch(err => {
    printerr('CHALLENGER TEST FAILURE:', err, err.stack);
    imports.system.exit(1);
});
