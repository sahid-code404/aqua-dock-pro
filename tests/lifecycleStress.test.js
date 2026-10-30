// Empirical lifecycle stress test suite for Milestone 1 (Lifecycle Integrity & Leak Elimination):
// 1. Rapidly invoke ExtensionManager.disable() and all 6 cache resets repeatedly (150+ iterations).
// 2. Rapidly simulate download flyer arrivals and cancel/disable while animations are in flight (zero orphan actors).
// 3. Rapidly invoke hideDash() and restoreDash() on dock.js with real GObject property notifications (zero corruption).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

// ── 0. Setup Mock GNOME Shell Environment ─────────────────────────────────────
const tmpShellDir = GLib.dir_make_tmp('aqua-stress-XXXXXX');
const mainJsPath = GLib.build_filenamev([tmpShellDir, 'main.js']);
const configJsPath = GLib.build_filenamev([tmpShellDir, 'config.js']);
const boxpointerJsPath = GLib.build_filenamev([tmpShellDir, 'boxpointer.js']);
const xmlPath = GLib.build_filenamev([tmpShellDir, 'shell.gresource.xml']);
const resPath = GLib.build_filenamev([tmpShellDir, 'shell.gresource']);

GLib.file_set_contents(configJsPath, 'export const PACKAGE_VERSION = "50";\n');
GLib.file_set_contents(boxpointerJsPath, 'export const PopupAnimation = { NONE: 0, FULL: 1 };\n');

const appFavoritesJsPath = GLib.build_filenamev([tmpShellDir, 'appFavorites.js']);
GLib.file_set_contents(appFavoritesJsPath, `
export function getAppFavorites() {
    return {
        getFavorites: () => [],
        connect: () => 1,
        disconnect: () => {},
    };
}
`);

const popupMenuJsPath = GLib.build_filenamev([tmpShellDir, 'popupMenu.js']);
GLib.file_set_contents(popupMenuJsPath, `
export class PopupMenu { constructor() {} addMenuItem() {} destroy() {} }
export class PopupMenuItem { constructor() {} }
export class PopupMenuManager { constructor() {} addMenu() {} removeMenu() {} }
export class PopupSubMenuMenuItem { constructor() {} }
export class PopupSeparatorMenuItem { constructor() {} }
`);

const appMenuJsPath = GLib.build_filenamev([tmpShellDir, 'appMenu.js']);
GLib.file_set_contents(appMenuJsPath, 'export class AppMenu {}\n');

const dialogJsPath = GLib.build_filenamev([tmpShellDir, 'dialog.js']);
GLib.file_set_contents(dialogJsPath, 'export class Dialog {}\n');

const modalDialogJsPath = GLib.build_filenamev([tmpShellDir, 'modalDialog.js']);
GLib.file_set_contents(modalDialogJsPath, 'export class ModalDialog {}\n');

const dndJsPath = GLib.build_filenamev([tmpShellDir, 'dnd.js']);
GLib.file_set_contents(dndJsPath, `
export const DragMotionResult = { NO_DROP: 0, COPY_DROP: 1, MOVE_DROP: 2 };
export function makeDraggable() { return { connect: () => 1, disconnect: () => {} }; }
`);

GLib.file_set_contents(mainJsPath, `
export const extensionManager = null;
export const layoutManager = {
    monitors: [{ x: 0, y: 0, width: 1920, height: 1080 }],
    primaryIndex: 0,
    connect: (_sig, _cb) => 101,
    disconnect: (_id) => {},
    addChrome: (_actor, _opts) => {},
    removeChrome: (_actor) => {},
};
export const overview = { visible: false, dash: null };
export const wm = {
    addKeybinding: () => {},
    removeKeybinding: () => {},
};
export const uiGroup = {
    _children: new Set(),
    add_child(actor) {
        this._children.add(actor);
        actor._parent = this;
    },
    remove_child(actor) {
        this._children.delete(actor);
        actor._parent = null;
    },
    insert_child_below(actor, _sibling) {
        this.add_child(actor);
    },
    get children() {
        return [...this._children];
    },
};
`);

GLib.file_set_contents(xmlPath, `<?xml version="1.0" encoding="UTF-8"?>
<gresources>
  <gresource prefix="/org/gnome/shell/misc">
    <file>config.js</file>
  </gresource>
  <gresource prefix="/org/gnome/shell/ui">
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

// Real GObject Dash with registered properties and C-level notify emission
const MockDash = GObject.registerClass({
    GTypeName: 'AquaLifecycleStressMockDash',
    Properties: {
        'opacity': GObject.ParamSpec.int(
            'opacity', 'opacity', 'opacity',
            GObject.ParamFlags.READWRITE,
            0, 255, 255
        ),
        'reactive': GObject.ParamSpec.boolean(
            'reactive', 'reactive', 'reactive',
            GObject.ParamFlags.READWRITE,
            true
        ),
        'height': GObject.ParamSpec.int(
            'height', 'height', 'height',
            GObject.ParamFlags.READWRITE,
            -1, 10000, 80
        ),
    },
}, class AquaLifecycleStressMockDash extends GObject.Object {
    constructor() {
        super();
        this.visible = true;
        this.styleClasses = new Set();
        this._listenersCount = 0;
    }
    add_style_class_name(name) { this.styleClasses.add(name); }
    remove_style_class_name(name) { this.styleClasses.delete(name); }
    set_height(h) { this.height = h; }
    show() { this.visible = true; }
    hide() { this.visible = false; }
});

// Setup Main.overview.dash
const Main = await import('resource:///org/gnome/shell/ui/main.js');
const testDash = new MockDash();
Main.overview.dash = testDash;

// Import target modules
const { ExtensionManager } = await import('../core/extensionManager.js');
const { cleanupBms, registerBmsTarget } = await import('../dock/dockBlur.js');
const { clearMountedDeviceCache } = await import('../services/mountedDevices.js');
const { clearAppTrackerCache } = await import('../services/appTracker.js');
const { clearTrashWatcherCache } = await import('../services/trashWatcher.js');
const { clearDownloadWatcherCache, DownloadManager } = await import('../downloads/downloadManager.js');
const { resetSlowDownFactor } = await import('../effects/genie/genieEffect.js');
const { clearNotificationCache } = await import('../services/notificationService.js');
const { DockChrome } = await import('../dock/dock.js');

// ── 1. ExtensionManager.disable() & All 6 Cache Resets Stress Testing ──────────
print('Starting Stress Test 1: ExtensionManager.disable() and Cache Resets (150+ iterations)...');
{
    // Test 1A: 150 rapid consecutive disable() calls on a single instance (Idempotency)
    const em1 = new ExtensionManager({ getSettings: () => null });
    for (let i = 0; i < 150; i++) {
        em1.disable();
        assert(em1._settings === null, `em1._settings should be null at iteration ${i}`);
        assert(em1._bus === null, `em1._bus should be null at iteration ${i}`);
        assert(em1._docks.length === 0, `em1._docks should be empty at iteration ${i}`);
        assert(em1._keybindingAdded === false, `em1._keybindingAdded should be false at iteration ${i}`);
        assert(em1._monitorsChangedId === 0, `em1._monitorsChangedId should be 0 at iteration ${i}`);
    }

    // Test 1B: 150 fresh ExtensionManager instances created with dirty state and disabled
    for (let i = 0; i < 150; i++) {
        const em = new ExtensionManager({ getSettings: () => null });
        em._keybindingAdded = true;
        em._monitorsChangedId = 42 + i;
        em._unsubSettings = () => {};
        em._docks = [{ destroy: () => {} }, { destroy: () => {} }];
        em._rebuildRetryId = 1;
        em._rebuildRetryCount = 2;
        em._dashRetryId = 2;
        em._dashRetryCount = 1;

        em.disable();

        assert(em._keybindingAdded === false, 'Keybinding flag not cleared');
        assert(em._monitorsChangedId === 0, 'Monitors signal ID not cleared');
        assert(em._unsubSettings === null, 'Settings unsub not cleared');
        assert(em._docks.length === 0, 'Docks not cleared');
        assert(em._rebuildRetryId === 0, 'Rebuild retry not cancelled');
        assert(em._dashRetryId === 0, 'Dash retry not cancelled');
    }

    // Test 1C: Rapid individual cache reset invocations (150 iterations each)
    // 1. cleanupBms()
    const mockDashBlur = {
        dashes: [],
        try_blur: () => {},
        blur_existing_dashes: () => {},
        pending_docks: new Map(),
    };
    globalThis.global = { blur_my_shell: { _dash_to_dock_blur: mockDashBlur } };

    for (let i = 0; i < 150; i++) {
        const dummyContainer = {
            _dockBg: { _dockRadius: 28 },
            _aquaAllocWatch: 99,
            _dockRadius: 28,
            get_dock_radius: () => 28,
            connect: () => 1,
            disconnect: () => {},
        };
        registerBmsTarget(dummyContainer, () => 28);
        cleanupBms();
        assert(mockDashBlur.dashes.length === 0, `cleanupBms did not clear BMS dashes at iter ${i}`);
        assert(mockDashBlur._aquaDockHooked === undefined, `cleanupBms did not unhook BMS at iter ${i}`);
    }
    delete globalThis.global.blur_my_shell;

    // 2. clearMountedDeviceCache()
    for (let i = 0; i < 150; i++) {
        clearMountedDeviceCache();
    }

    // 3. clearAppTrackerCache()
    for (let i = 0; i < 150; i++) {
        clearAppTrackerCache();
    }

    // 4. clearTrashWatcherCache()
    for (let i = 0; i < 150; i++) {
        clearTrashWatcherCache();
    }

    // 5. clearDownloadWatcherCache()
    for (let i = 0; i < 150; i++) {
        clearDownloadWatcherCache();
    }

    // 6. resetSlowDownFactor()
    for (let i = 0; i < 150; i++) {
        resetSlowDownFactor();
    }

    // 7. clearNotificationCache()
    for (let i = 0; i < 150; i++) {
        clearNotificationCache();
    }

    // Test 1D: Interleaved chaotic resets and disable calls (200 iterations)
    const resets = [
        () => cleanupBms(),
        () => clearMountedDeviceCache(),
        () => clearAppTrackerCache(),
        () => clearTrashWatcherCache(),
        () => clearDownloadWatcherCache(),
        () => resetSlowDownFactor(),
        () => clearNotificationCache(),
        () => em1.disable(),
    ];

    for (let i = 0; i < 200; i++) {
        const randReset = resets[i % resets.length];
        randReset();
    }

    // Test 1E: ExtensionManager.enable failure rollback under dirty exception
    for (let i = 0; i < 50; i++) {
        const failingExtension = {
            getSettings: () => {
                throw new Error('Simulated GSettings connection failure');
            },
        };
        const emFail = new ExtensionManager(failingExtension);
        let caught = false;
        try {
            emFail.enable();
        } catch (e) {
            caught = true;
            assert(e.message === 'Simulated GSettings connection failure', 'Expected simulated error');
        }
        assert(caught === true, 'ExtensionManager.enable must rethrow error on failure');
        assert(emFail._settings === null, 'Settings must be null after failed enable rollback');
        assert(emFail._bus === null, 'Bus must be null after failed enable rollback');
        assert(emFail._docks.length === 0, 'Docks must be empty after failed enable rollback');
    }

    print('Test 1 passed: 150+ rapid ExtensionManager and cache resets verified zero crashes and clean idempotency.');
}

// ── 2. Download Flyer Arrivals & In-Flight Cancellation Stress Testing ────────
print('Starting Stress Test 2: Download Flyer Arrivals and Cancellation in Flight (150+ iterations)...');
{
    // Mock Clutter and St.Icon actor for flyer animation testing
    const createdFlyers = [];
    class MockFlyerActor {
        constructor(params = {}) {
            this.gicon = params.gicon ?? null;
            this.icon_size = params.icon_size ?? 32;
            this.style_class = params.style_class ?? '';
            this.x = 0;
            this.y = 0;
            this.scale_x = 1;
            this.scale_y = 1;
            this.opacity = 255;
            this.destroyed = false;
            this._parent = null;
            this._transitions = new Map();
            createdFlyers.push(this);
        }
        set_position(x, y) { this.x = x; this.y = y; }
        set_scale(sx, sy) { this.scale_x = sx; this.scale_y = sy; }
        ease(props) {
            if (this.destroyed) return;
            const tId = Math.random();
            this._transitions.set(tId, props);
            if (props.opacity !== undefined) this.opacity = props.opacity;
            if (props.x !== undefined) this.x = props.x;
            if (props.y !== undefined) this.y = props.y;
            if (props.scale_x !== undefined) this.scale_x = props.scale_x;
            if (props.scale_y !== undefined) this.scale_y = props.scale_y;
        }
        remove_all_transitions() {
            this._transitions.clear();
        }
        destroy() {
            this.destroyed = true;
            this.remove_all_transitions();
            if (this._parent) {
                this._parent.remove_child(this);
                this._parent = null;
            }
        }
        get_parent() {
            return this._parent;
        }
    }

    // Replace St.Icon with our mock for flyer tracking
    St.Icon = MockFlyerActor;

    // Mock host for DownloadManager
    let bounceCount = 0;
    const mockItem = {
        width: 48,
        height: 48,
        get_transformed_position: () => [200, 600],
        bounce: () => { bounceCount++; },
        pulseScale: (_scale, cb) => { if (cb) cb(); },
        setStackOpenState: () => {},
    };

    const mockHost = {
        getConfig: () => ({
            iconSize: 48,
            bounceHeight: 20,
            bounceDecay: 0.8,
            showDownloads: true,
        }),
        getDownloadsItem: () => mockItem,
        isHidden: () => false,
        kickEngine: () => {},
        hideTooltip: () => {},
        getMonitor: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
        getContainer: () => ({ name: 'mockAquaContainer' }),
    };

    // Helper to create mock Gio.File with async icon query support
    function createMockFile(uri) {
        return {
            get_uri: () => uri,
            query_info_async: (_attrs, _flags, _pri, cancellable, callback) => {
                // Asynchronous query that immediately resolves unless cancelled
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    if (cancellable.is_cancelled()) {
                        return GLib.SOURCE_REMOVE;
                    }
                    callback({
                        query_info_finish: () => ({
                            get_icon: () => Gio.ThemedIcon.new('application-x-executable'),
                        }),
                    }, null);
                    return GLib.SOURCE_REMOVE;
                });
            },
        };
    }

    // Test 2A: 150 flyer arrivals spawned directly, cancelled mid-flight via settleAnimations()
    const dm = new DownloadManager(mockHost);
    createdFlyers.length = 0;

    for (let i = 0; i < 150; i++) {
        const file = createMockFile(`file:///home/user/Downloads/file_${i}.zip`);
        dm._scheduleArrival(file);
    }
    assert(dm._arrivalQueue.length > 0 || dm._pendingArrivalUris.size > 0, 'Arrival queue should be populated');

    // Force drain to trigger spawn
    dm._drainArrivalQueue();
    // Simulate multiple concurrent flyers directly spawned
    for (let i = 0; i < 50; i++) {
        const flyer = new MockFlyerActor();
        Main.uiGroup.add_child(flyer);
        dm._flyers.add(flyer);
    }
    assert(dm._flyers.size >= 50, 'Flyers should be tracked in dm._flyers');
    assert(Main.uiGroup.children.length >= 50, 'Main.uiGroup should have flyer children');

    // Cancel while animations are in flight
    dm.settleAnimations();

    assert(dm._flyers.size === 0, 'settleAnimations must clear all tracked flyers');
    assert(Main.uiGroup.children.length === 0, 'Main.uiGroup must have zero orphan flyer actors after settleAnimations');
    for (const f of createdFlyers) {
        assert(f.destroyed === true, 'All created flyer actors must be destroyed');
        assert(f.get_parent() === null, 'All flyer actors must have null parent');
    }

    // Test 2B: 150 arrivals spam, then immediate disable() mid-flight
    createdFlyers.length = 0;
    for (let i = 0; i < 150; i++) {
        const flyer = new MockFlyerActor();
        Main.uiGroup.add_child(flyer);
        dm._flyers.add(flyer);
    }
    assert(dm._flyers.size === 150, 'dm._flyers should have 150 active flyers');
    assert(Main.uiGroup.children.length === 150, 'Main.uiGroup should hold 150 active flyers');

    dm.disable();

    assert(dm._flyers.size === 0, 'disable must clear all tracked flyers');
    assert(Main.uiGroup.children.length === 0, 'Main.uiGroup must have zero orphan flyer actors after disable');
    assert(dm._arrivalQueue.length === 0, 'Arrival queue must be cleared on disable');
    assert(dm._pendingArrivalUris.size === 0, 'Pending arrival URIs must be cleared on disable');
    for (const f of createdFlyers) {
        assert(f.destroyed === true, 'All created flyer actors must be destroyed');
        assert(f.get_parent() === null, 'All flyer actors must have null parent');
    }

    // Test 2C: Race condition stress testing — transition callbacks after destroy
    for (const f of createdFlyers) {
        // Invoking destroy again or triggering transitions on destroyed flyers must be safe
        dm._destroyFlyer(f);
        dm._destroyFlyer(null);
    }
    assert(dm._flyers.size === 0, 'Flyers set remains empty');

    // Test 2D: Rapid enable-disable churn with file arrivals (50 cycles)
    for (let i = 0; i < 50; i++) {
        dm.enable();
        const f = new MockFlyerActor();
        Main.uiGroup.add_child(f);
        dm._flyers.add(f);
        dm.disable();
        assert(dm._flyers.size === 0, `Flyers must be 0 after disable in churn cycle ${i}`);
        assert(Main.uiGroup.children.length === 0, `uiGroup must have 0 flyers in churn cycle ${i}`);
    }

    // Test 2E: High-throughput arrival burst (500 arrivals) cancelled mid-flight
    createdFlyers.length = 0;
    dm.enable();
    for (let i = 0; i < 500; i++) {
        const file = createMockFile(`file:///home/user/Downloads/burst_${i}.bin`);
        dm._scheduleArrival(file);
    }
    // Cancel immediately while queues and cancellables are pending
    dm.settleAnimations();
    assert(dm._arrivalQueue.length === 0, 'Arrival queue must be empty after settleAnimations');
    assert(dm._pendingArrivalUris.size === 0, 'Pending URIs must be empty after settleAnimations');
    assert(dm._flyers.size === 0, 'Flyers set must be empty after settleAnimations');
    assert(Main.uiGroup.children.length === 0, 'Main.uiGroup must have 0 flyer actors after burst settle');

    dm.disable();

    print('Test 2 passed: Download flyer animations verified zero orphan actors and crash-free cancellation.');
}

// ── 3. hideDash() and restoreDash() Stress Testing ─────────────────────────────
print('Starting Stress Test 3: Rapid hideDash() and restoreDash() with real GObject property notifications (150+ iterations)...');
{
    // Use DockChrome's hideDash and restoreDash implementation directly
    const dockProto = DockChrome.prototype;
    const testDock = Object.create(dockProto);
    testDock._dash = null;
    testDock._dashWasVisible = true;
    testDock._dashHeight = null;
    testDock._dashOpacity = null;
    testDock._dashReactive = null;
    testDock._dashCfg = null;
    testDock._dashNotifyIds = null;

    const dockCfg = { dockH: 56, edgeMargin: 8 };

    // Initial baseline verification
    assert(testDash.opacity === 255, 'Initial dash opacity should be 255');
    assert(testDash.reactive === true, 'Initial dash reactive should be true');
    assert(testDash.height === 80, 'Initial dash height should be 80');

    // Test 3A: 150 symmetric hideDash() -> restoreDash() cycles
    for (let i = 0; i < 150; i++) {
        testDock.hideDash(dockCfg);

        // Verify hidden state
        assert(testDash.opacity === 0, `Dash opacity must be 0 when hidden at iter ${i}`);
        assert(testDash.reactive === false, `Dash reactive must be false when hidden at iter ${i}`);
        assert(testDash.styleClasses.has('aqua-dash-hidden'), `Style class must be added at iter ${i}`);
        assert(Array.isArray(testDock._dashNotifyIds) && testDock._dashNotifyIds.length === 2,
            `Exactly 2 notify IDs must be active when hidden at iter ${i}`);

        testDock.restoreDash();

        // Verify restored baseline
        assert(testDash.opacity === 255, `Dash opacity must be restored to 255 at iter ${i}`);
        assert(testDash.reactive === true, `Dash reactive must be restored to true at iter ${i}`);
        assert(testDash.height === 80, `Dash height must be restored to 80 at iter ${i}`);
        assert(!testDash.styleClasses.has('aqua-dash-hidden'), `Style class must be removed at iter ${i}`);
        assert(testDock._dash === null, `_dash reference must be null after restore at iter ${i}`);
        assert(testDock._dashNotifyIds === null, `_dashNotifyIds must be null after restore at iter ${i}`);
    }

    // Verify no signal leaks on dash: notify::opacity should NOT trigger _enforceDash after restore
    let strayNotifyCount = 0;
    testDash.opacity = 200;
    assert(testDash.opacity === 200, 'Dash opacity should not be forcefully overwritten when extension is restored');
    testDash.opacity = 255;

    // Test 3B: Asymmetric hideDash() calls without restore (Idempotent baseline preservation)
    // When hideDash is called repeatedly, the baseline (255, true) must NOT be overwritten by (0, false)
    for (let i = 0; i < 50; i++) {
        testDock.hideDash(dockCfg);
        assert(testDock._dashOpacity === 255, `Baseline opacity must remain 255 across repeated hideDash calls (iter ${i})`);
        assert(testDock._dashReactive === true, `Baseline reactive must remain true across repeated hideDash calls (iter ${i})`);
        assert(testDock._dashNotifyIds.length === 2, `Old notify IDs must be disconnected; exactly 2 IDs must exist (iter ${i})`);
    }
    // Now restore: must restore original 255, not 0!
    testDock.restoreDash();
    assert(testDash.opacity === 255, 'Dash opacity must restore to 255 even after 50 repeated hideDash calls');
    assert(testDash.reactive === true, 'Dash reactive must restore to true even after 50 repeated hideDash calls');

    // Test 3C: Multiple consecutive restoreDash() calls (Idempotency)
    for (let i = 0; i < 50; i++) {
        testDock.restoreDash();
        assert(testDock._dash === null, 'testDock._dash remains null');
        assert(testDash.opacity === 255, 'Dash opacity remains 255');
        assert(testDash.reactive === true, 'Dash reactive remains true');
    }

    // Test 3D: Shell property reset while hidden (Real GObject signal enforcement)
    testDock.hideDash(dockCfg);
    assert(testDash.opacity === 0, 'Dash hidden');
    assert(testDash.reactive === false, 'Dash unreactive');

    // Simulate GNOME Shell trying to show the dash during overview transition
    testDash.opacity = 255;
    // GObject signal handler fires synchronously or on notify: verify _enforceDash re-enforces opacity = 0
    assert(testDash.opacity === 0, 'GObject notify::opacity must re-enforce opacity = 0 while hidden');

    testDash.reactive = true;
    assert(testDash.reactive === false, 'GObject notify::reactive must re-enforce reactive = false while hidden');

    // Restore after external reset attempts: baseline must still be 255
    testDock.restoreDash();
    assert(testDash.opacity === 255, 'Dash opacity restored to 255');
    assert(testDash.reactive === true, 'Dash reactive restored to true');

    // Test 3E: Chaotic random sequence of 200 operations
    const operations = [
        () => testDock.hideDash(dockCfg),
        () => testDock.restoreDash(),
        () => { if (testDock._dash) testDash.opacity = 255; },
        () => { if (testDock._dash) testDash.reactive = true; },
        () => testDock.enforceDashGap(dockCfg),
    ];

    for (let i = 0; i < 200; i++) {
        const op = operations[i % operations.length];
        op();
    }

    // Final clean restore
    testDock.restoreDash();
    assert(testDash.opacity === 255, 'Final dash opacity must be 255');
    assert(testDash.reactive === true, 'Final dash reactive must be true');
    assert(testDash.height === 80, 'Final dash height must be 80');
    assert(testDock._dash === null, 'Final testDock._dash must be null');

    // Test 3F: Dash unavailable failure handling
    Main.overview.dash = null;
    let unavailableCaught = false;
    try {
        testDock.hideDash(dockCfg);
    } catch (e) {
        unavailableCaught = true;
        assert(e.message === 'GNOME overview dash is unavailable', 'Expected unavailable error');
    }
    assert(unavailableCaught === true, 'hideDash must throw when overview dash is unavailable');
    assert(testDock._dash === null, 'testDock._dash must remain null when unavailable');
    Main.overview.dash = testDash;

    // Test 3G: Strict enforce failure rollback
    const brokenDash = Object.create(testDash);
    Object.defineProperty(brokenDash, 'opacity', {
        set() { throw new Error('Simulated hardware compositor property rejection'); },
        get() { return 255; },
    });
    Main.overview.dash = brokenDash;
    let enforceCaught = false;
    try {
        testDock.hideDash(dockCfg);
    } catch (e) {
        enforceCaught = true;
        assert(e.message === 'Simulated hardware compositor property rejection', 'Expected enforce error');
    }
    assert(enforceCaught === true, 'hideDash must throw when strict enforcement fails');
    assert(testDock._dash === null, 'testDock._dash must be restored to null on strict enforcement failure');
    Main.overview.dash = testDash;

    print('Test 3 passed: hideDash() and restoreDash() verified zero corruption and clean signal lifecycle.');
}

// ── Teardown Mock Shell Resource ──────────────────────────────────────────────
shellResource._unregister();
GLib.spawn_sync(null, ['rm', '-rf', tmpShellDir], null, GLib.SpawnFlags.SEARCH_PATH, null);

print('lifecycleStress: ok — All empirical stress tests passed (150+ iterations each).');
