// Unit tests for Aqua Dock Pro blur integration:
// - Dock pill style transparency and border radius
// - AnimationEngine pill & blurRegion synchronization during stretch
// - Blur my Shell dock target resolution and dynamic allocation
// - DockBlurManager state machine and BMS pipeline coordination (no native blur)

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { pillStyle, applyAlpha } from '../dock/dockLayout.js';
import { AnimationEngine } from '../animation/animationEngine.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// Register temporary mock Shell resource for Main imports
const tmpShellDir = GLib.dir_make_tmp('aqua-dockblur-XXXXXX');
const mainJsPath = GLib.build_filenamev([tmpShellDir, 'main.js']);
const xmlPath = GLib.build_filenamev([tmpShellDir, 'shell.gresource.xml']);
const resPath = GLib.build_filenamev([tmpShellDir, 'shell.gresource']);

GLib.file_set_contents(mainJsPath,
    'export const extensionManager = null;\nexport const layoutManager = null;\nexport const overview = { visible: false };\n');
GLib.file_set_contents(xmlPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<gresources>
  <gresource prefix="/org/gnome/shell/ui">
    <file>main.js</file>
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

// ── 1. Pill Style & Transparency ─────────────────────────────────────────────
{
    const cfg = {
        dockRadius: 28,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.2)',
        pillColor: 'rgba(20,20,24,0.8)',
        bgOpacity: 0.9,
        highContrast: false,
    };

    const regularStyle = pillStyle(cfg, false);
    assert(regularStyle.includes('border-radius: 28px;'),
        'pillStyle should set border-radius to configured dockRadius');
    assert(regularStyle.includes('background-color: rgba(20, 20, 24, 0.720);'),
        'pillStyle should compute pillColor with opacity multiplier');

    const transparentStyle = pillStyle(cfg, true);
    assert(transparentStyle.includes('border-radius: 28px;'),
        'transparent pillStyle should retain border-radius');
    assert(transparentStyle.includes('background-color: transparent;'),
        'transparent pillStyle should use transparent background for Blur my Shell');

    // When blur is active (isTransparent = true), background becomes transparent
    const blurOnStyle = pillStyle({ ...cfg, blurEffect: true }, true);
    assert(blurOnStyle.includes('background-color: transparent;'),
        'pillStyle should use transparent fill when blur is active');

    // When blur is inactive/absent (isTransparent = false), background falls back to normal transparency and pill color
    const blurOffBmsStyle = pillStyle({ ...cfg, blurEffect: true }, false);
    assert(blurOffBmsStyle.includes('background-color: rgba(20, 20, 24, 0.720);'),
        'pillStyle should fallback to normal transparency when BMS is inactive even if blurEffect is enabled');

    // When blurEffect is false, background falls back to normal transparency
    const blurOffStyle = pillStyle({ ...cfg, blurEffect: false }, false);
    assert(blurOffStyle.includes('background-color: rgba(20, 20, 24, 0.720);'),
        'pillStyle should fallback to normal transparency when blurEffect is disabled');

    assert(applyAlpha('rgba(100, 100, 100, 1)', 0.5) === 'rgba(100, 100, 100, 0.500)',
        'applyAlpha should correctly scale alpha component');
}

// ── 2. AnimationEngine Pill & BlurRegion Synchronization ─────────────────────
{
    function createMockActor(x = 0, y = 0, w = 100, h = 60) {
        return {
            x, y, width: w, height: h,
            set_x(val) { this.x = val; },
            set_y(val) { this.y = val; },
            set_width(val) { this.width = val; },
            set_height(val) { this.height = val; },
            ease(props) { Object.assign(this, props); },
            remove_transition() {},
            remove_all_transitions() {},
        };
    }

    // Horizontal dock stretch
    const engine = new AnimationEngine();
    const bgH = createMockActor(100, 10, 400, 70);
    const blurH = createMockActor(100, 10, 400, 70);
    const magZone = createMockActor(0, 0, 0, 0);

    const modelH = {
        cfg: {
            vertical: false,
            cellW: 64,
            zoomMax: 2.0,
        },
        geom: {
            bgBaseX: 100,
            bgBaseW: 400,
            x: 0,
            y: 0,
            mainLen: 400,
            magZone: { mainPad: 8, dockH: 70, side: 'bottom', growthPerScale: 30, restInset: 8 },
        },
        chips: [],
        items: [],
        bg: bgH,
        blurRegion: blurH,
        magZone,
    };

    engine.setModel(modelH);
    assert(engine._cachedBlurRegion === blurH,
        'AnimationEngine must cache blurRegion reference in setModel');

    // Simulate pill spread (e.g. icon magnified)
    engine._bgCurrentX = 80;
    engine._bgCurrentW = 440;
    engine._applySpread(false);

    assert(bgH.x === blurH.x,
        `bg.x (${bgH.x}) and blurRegion.x (${blurH.x}) must synchronize during horizontal spread`);
    assert(bgH.width === blurH.width,
        `bg.width (${bgH.width}) and blurRegion.width (${blurH.width}) must synchronize during horizontal spread`);

    // Test snapToRest
    engine.snapToRest();
    assert(bgH.x === 100 && blurH.x === 100,
        'bg and blurRegion x must snap to rest position identically');
    assert(bgH.width === 400 && blurH.width === 400,
        'bg and blurRegion width must snap to rest position identically');

    engine.destroy();

    // Vertical dock stretch
    const engineV = new AnimationEngine();
    const bgV = createMockActor(10, 100, 70, 400);
    const blurV = createMockActor(10, 100, 70, 400);

    const modelV = {
        cfg: {
            vertical: true,
            cellW: 64,
            zoomMax: 2.0,
        },
        geom: {
            bgBaseX: 100,
            bgBaseW: 400,
            x: 0,
            y: 0,
            mainLen: 400,
            magZone: { mainPad: 8, dockH: 70, side: 'left', growthPerScale: 30, restInset: 8 },
        },
        chips: [],
        items: [],
        bg: bgV,
        blurRegion: blurV,
        magZone,
    };

    engineV.setModel(modelV);
    engineV._bgCurrentX = 85;
    engineV._bgCurrentW = 430;
    engineV._applySpread(false);

    assert(bgV.y === blurV.y,
        `bg.y (${bgV.y}) and blurRegion.y (${blurV.y}) must synchronize during vertical spread`);
    assert(bgV.height === blurV.height,
        `bg.height (${bgV.height}) and blurRegion.height (${blurV.height}) must synchronize during vertical spread`);

    engineV.destroy();

    // Property notification test during stretch
    const engineN = new AnimationEngine();
    let notifyX = 0, notifyW = 0, notifyPos = 0, notifySize = 0;
    const bgN = {
        x: 100, y: 10, width: 400, height: 70,
        set_x(v) { this.x = v; },
        set_width(v) { this.width = v; },
        notify(prop) {
            if (prop === 'x') notifyX++;
            if (prop === 'width') notifyW++;
            if (prop === 'position') notifyPos++;
            if (prop === 'size') notifySize++;
        },
    };
    const modelN = {
        cfg: { vertical: false, cellW: 64, zoomMax: 2.0 },
        geom: { bgBaseX: 100, bgBaseW: 400, x: 0, y: 0, mainLen: 400, magZone: { mainPad: 8, dockH: 70, side: 'bottom', growthPerScale: 30, restInset: 8 } },
        chips: [],
        items: [],
        bg: bgN,
        blurRegion: null,
        magZone,
    };
    engineN.setModel(modelN);
    engineN._bgCurrentX = 80;
    engineN._bgCurrentW = 440;
    engineN._applySpread(false);
    assert(notifyX > 0 && notifyPos > 0, 'AnimationEngine must notify x and position on spread change');
    assert(notifyW > 0 && notifySize > 0, 'AnimationEngine must notify width and size on spread change');
    engineN.destroy();
}

// ── 3. Blur My Shell Target Resolver Compatibility & Runtime Integration ─────
{
    const {
        resolveAquaDockTarget,
        setupBackgroundCorners,
        registerBmsTarget,
        unregisterBmsTarget,
        AquaDockSurface,
    } = await import('../dock/dockBlur.js');

    // Container recognition via in-memory target resolver
    const aquaContainer = {
        get_name: () => 'aquaDockContainer',
        name: 'aquaDockContainer',
        _isAquaDock: true,
        _dockBg: {
            width: 300,
            height: 60,
            _dockRadius: 24,
            has_allocation: () => true,
        },
        _dockBlurRegion: {
            width: 300,
            height: 60,
        },
        _dockBlurEnabled: true,
        get_children: () => [],
        has_allocation: () => true,
        width: 300,
        height: 60,
        insert_child_below() {},
    };

    const resolved = resolveAquaDockTarget(aquaContainer);
    assert(resolved !== null,
        'resolveAquaDockTarget should resolve Aqua Dock target');
    assert(resolved.background === aquaContainer._dockBg,
        'resolved background must point to Aqua Dock _dockBg');
    assert(resolved.sibling === aquaContainer._dockBlurRegion,
        'resolved sibling must point to Aqua Dock _dockBlurRegion');

    // Disabled blur setting check
    aquaContainer._dockBlurEnabled = false;
    assert(resolveAquaDockTarget(aquaContainer) === null,
        'resolveAquaDockTarget must return null when _dockBlurEnabled is false');
    aquaContainer._dockBlurEnabled = true;

    // Test with stock BMS files if present
    const bmsTargetsPath = `${GLib.get_home_dir()}/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/components/dock/dock_targets.js`;
    if (GLib.file_test(bmsTargetsPath, GLib.FileTest.EXISTS)) {
        const {
            is_supported_dock_container,
            has_valid_allocation,
            get_dock_corners,
        } = await import(`file://${bmsTargetsPath}`);

        // Stock BMS is_supported_dock_container does not know aquaContainer on disk (pure stock v76)
        assert(is_supported_dock_container(aquaContainer) === false,
            'Stock BMS is_supported_dock_container must remain unmodified');

        // Allocation validation during dynamic resize
        const validActor = {
            has_allocation: () => true,
            width: 320,
            height: 60,
        };
        assert(has_valid_allocation(validActor),
            'has_valid_allocation must succeed when width and height are positive');

        const zeroSizeActor = {
            has_allocation: () => true,
            width: 0,
            height: 60,
        };
        assert(!has_valid_allocation(zeroSizeActor),
            'has_valid_allocation must reject zero-sized actors');

        // Corner radius calculation via setupBackgroundCorners with stock BMS get_dock_corners
        if (!globalThis.global) globalThis.global = {};
        globalThis.global.stage = {};
        const St = (await import('gi://St')).default;
        if (St?.ThemeContext) {
            St.ThemeContext.get_for_stage = () => ({ scale_factor: 1 });
        }
        setupBackgroundCorners(aquaContainer._dockBg, () => 24);
        const corners = get_dock_corners(aquaContainer._dockBg);
        assert(corners.radius === 24,
            `get_dock_corners should read explicit _dockRadius 24 via setupBackgroundCorners (got ${corners.radius})`);
    }

    // Test runtime in-memory BMS registration and AquaDockSurface creation
    const mockDashBlur = {
        enabled: true,
        is_static: false,
        settings: { dash_to_dock: { STATIC_BLUR: false, PIPELINE: 'default' } },
        dashes: [],
        add_blur(dash_container, target) {
            const bgActor = {
                x: 0, y: 0, width: 0, height: 0,
                set_position(x, y) { this.x = x; this.y = y; },
                set_size(w, h) { this.width = w; this.height = h; },
                set_clip(x, y, w, h) { this.clip = [x, y, w, h]; },
            };
            const bgGroup = {
                parent: dash_container,
                get_parent() { return this.parent; },
                destroy() { this.destroyed = true; },
            };
            return {
                background: bgActor,
                background_group: bgGroup,
                bg_manager: { destroy() {} },
                pipeline: {
                    set_corner_radius(r) { this.radius = r; },
                    destroy() {},
                },
                rounded_pipeline: null,
                corner_settings: { radius: 24, corners: 0 },
            };
        },
        try_blur(dash_container) {},
        queue_discovery() { this.discovered = true; },
        update_background() {},
    };
    globalThis.global = {
        blur_my_shell: {
            _dash_to_dock_blur: mockDashBlur,
        },
    };

    registerBmsTarget(aquaContainer);
    assert(mockDashBlur.dashes.length === 1, 'registerBmsTarget must add AquaDockSurface to BMS dashes');
    assert(mockDashBlur.dashes[0] instanceof AquaDockSurface, 'created surface must be AquaDockSurface');
    assert(mockDashBlur.dashes[0].dash_container === aquaContainer, 'surface dash_container matches');

    // Test geometry synchronization
    aquaContainer._dockBg.width = 360;
    aquaContainer._dockBg.height = 70;
    mockDashBlur.dashes[0].update_size();
    assert(mockDashBlur.dashes[0].background.width === 360, 'surface background width matches background');
    assert(mockDashBlur.dashes[0].background.height === 70, 'surface background height matches background');

    // Clean up
    unregisterBmsTarget(aquaContainer);
    assert(mockDashBlur.dashes.length === 0, 'unregisterBmsTarget must cleanly remove surface from BMS dashes');
    delete globalThis.global.blur_my_shell;
}

// ── 4. DockBlurManager State Machine & BMS Coordination ──────────────────────
{
    delete globalThis.global?.blur_my_shell;
    const projectRoot = GLib.get_current_dir();
    const { DockBlurManager } = await import(`file://${projectRoot}/dock/dockBlur.js`);

        class MockWidget {
            constructor(name) {
                this.name = name;
                this.effects = [];
                this.visible = false;
            }
            add_effect(effect) { this.effects.push(effect); }
            remove_effect(effect) { this.effects = this.effects.filter(e => e !== effect); }
            show() { this.visible = true; }
            hide() { this.visible = false; }
        }

        const container = new MockWidget('container');
        const bg = new MockWidget('bg');
        const blurRegion = new MockWidget('blurRegion');
        const handle = new MockWidget('handle');
        const handleBlurRegion = new MockWidget('handleBlurRegion');

        let cfg = {
            blurEffect: true,
            showAutohideHandle: true,
        };

        let blurStateEvents = [];
        const manager = new DockBlurManager({
            container,
            bg,
            blurRegion,
            handle,
            handleBlurRegion,
            getConfig: () => cfg,
            onBlurStateChanged: (active) => blurStateEvents.push(active),
        });

        // Test 1: Without BMS, native blur path is NOT run (no native effects, regions hidden)
        assert(!manager.bmsActive, 'bmsActive should be false when BMS is absent');
        assert(container._dockBlurEnabled === true, 'container._dockBlurEnabled must be true when blurEffect is enabled');
        assert(!blurRegion.visible, 'blurRegion should be hidden when BMS is absent');
        assert(blurRegion.effects.length === 0, 'no native blur effect should be created or attached');
        assert(!handleBlurRegion.visible, 'handleBlurRegion should be hidden when BMS is absent');

        // Test 2: Blur My Shell enabled coordination
        const mockSurface = {
            dash_container: container,
            dash: bg,
            removed: false,
            remove_dash_blur() { this.removed = true; },
        };
        globalThis.global = {
            blur_my_shell: {
                _dash_to_dock_blur: {
                    enabled: true,
                    dashes: [mockSurface],
                    queue_discovery() { this.discovered = true; },
                },
            },
        };

        manager.syncBlurState();
        assert(manager.bmsActive, 'bmsActive should become true when BMS dock blur is active');
        assert(blurStateEvents[blurStateEvents.length - 1] === true, 'onBlurStateChanged should emit true');
        assert(!blurRegion.visible, 'blurRegion should be hidden when BMS is active');
        assert(container._dockBlurEnabled === true, 'container._dockBlurEnabled must be true for BMS');
        assert(global.blur_my_shell._dash_to_dock_blur.discovered, 'BMS queue_discovery should be triggered');

        // Test 3: blurEffect disabled falls back cleanly (removes BMS blur, restores normal state)
        bg.styleClass = 'transparent-dash';
        bg.has_style_class_name = (name) => bg.styleClass === name;
        bg.remove_style_class_name = (name) => { if (bg.styleClass === name) bg.styleClass = ''; };
        cfg.blurEffect = false;
        manager.syncBlurState();
        assert(!manager.bmsActive, 'bmsActive should be false when blurEffect is false');
        assert(blurStateEvents[blurStateEvents.length - 1] === false, 'onBlurStateChanged should emit false');
        assert(mockSurface.removed, 'BMS surface must be removed cleanly when blurEffect is turned off');
        assert(bg.styleClass === '', 'transparent-dash class must be removed when blurEffect is off');
        assert(!blurRegion.visible, 'blurRegion should be hidden when blurEffect is false');
        assert(container._dockBlurEnabled === false, 'container._dockBlurEnabled must be false when blurEffect is false');

        // Re-enabling blurEffect restores container._dockBlurEnabled to true
        cfg.blurEffect = true;
        manager.syncBlurState();
        assert(container._dockBlurEnabled === true, 'container._dockBlurEnabled must return to true when re-enabled');
        assert(manager.bmsActive, 'bmsActive should become true again upon re-enabling');

        // Test 4: Hook and autohide handle blur with BMS pipeline
        handle.visible = true;
        manager.syncBlurState();
        assert(!handleBlurRegion.visible, 'handleBlurRegion remains hidden under BMS pipeline');
        assert(handleBlurRegion.effects.length === 0, 'handleBlurRegion has no native blur effect');

        // Test 5: Destroy cleanup
        mockSurface.removed = false;
        globalThis.global = {
            blur_my_shell: {
                _dash_to_dock_blur: {
                    enabled: true,
                    dashes: [mockSurface],
                    queue_discovery() {},
                },
            },
        };
        manager.syncBlurState();
        manager.destroy();
        assert(mockSurface.removed, 'BMS surface must be removed on destroy');
        assert(container._dockBlurEnabled === false, 'container._dockBlurEnabled must be false on destroy');
        assert(blurRegion.effects.length === 0, 'all blur effects must be empty on destroy');
        assert(handleBlurRegion.effects.length === 0, 'handle blur effects must be empty on destroy');

        // Test 6: Pill style fallback with opacity and hex/rgba colors when BMS is disabled/absent
        const fallbackCfgRgba = {
            dockRadius: 28,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.16)',
            pillColor: 'rgba(28,28,32,0.80)',
            bgOpacity: 0.50,
            blurEffect: true,
            highContrast: false,
        };
        const fallbackStyleRgba = pillStyle(fallbackCfgRgba, false);
        assert(!fallbackStyleRgba.includes('background-color: transparent;'),
            'pillStyle must NOT be transparent when isTransparent is false');
        assert(fallbackStyleRgba.includes('background-color: rgba(28, 28, 32, 0.400);'),
            `pillStyle must scale rgba alpha by bgOpacity: got ${fallbackStyleRgba}`);

        const fallbackCfgHex = {
            ...fallbackCfgRgba,
            pillColor: '#202024',
            bgOpacity: 0.65,
        };
        const fallbackStyleHex = pillStyle(fallbackCfgHex, false);
        assert(fallbackStyleHex.includes('background-color: rgba(32, 32, 36, 0.650);'),
            `pillStyle must convert hex to rgba and apply bgOpacity: got ${fallbackStyleHex}`);

        // Test 7: Runtime BMS disable detection and instant background restoration
        delete globalThis.global?.blur_my_shell;
        const testContainer = new MockWidget('container2');
        const testBg = new MockWidget('bg2');
        let latestBlurState = null;
        const testManager = new DockBlurManager({
            container: testContainer,
            bg: testBg,
            blurRegion: new MockWidget('blurRegion2'),
            handle: new MockWidget('handle2'),
            handleBlurRegion: new MockWidget('handleBlurRegion2'),
            getConfig: () => ({ blurEffect: true, dockRadius: 30 }),
            onBlurStateChanged: (active) => { latestBlurState = active; },
        });

        // Initially BMS is absent
        assert(!testManager.bmsActive, 'bmsActive must be false when BMS is absent');
        let isTrans = Boolean(testManager.bmsActive);
        let currentPillStyle = pillStyle({ blurEffect: true, dockRadius: 30, pillColor: 'rgba(28,28,32,0.8)', bgOpacity: 0.8 }, isTrans);
        assert(!currentPillStyle.includes('background-color: transparent;'),
            'Dock pill must not be transparent when BMS is absent');

        // BMS becomes active
        globalThis.global = {
            blur_my_shell: {
                _dash_to_dock_blur: {
                    enabled: true,
                    dashes: [],
                    queue_discovery() {},
                },
            },
        };
        testManager.syncBlurState();
        assert(testManager.bmsActive, 'bmsActive must become true when BMS is enabled');
        assert(latestBlurState === true, 'onBlurStateChanged must emit true when BMS is enabled');
        isTrans = Boolean(testManager.bmsActive);
        currentPillStyle = pillStyle({ blurEffect: true, dockRadius: 30, pillColor: 'rgba(28,28,32,0.8)', bgOpacity: 0.8 }, isTrans);
        assert(currentPillStyle.includes('background-color: transparent;'),
            'Dock pill must be transparent when BMS is active');

        // BMS disabled at runtime
        globalThis.global.blur_my_shell._dash_to_dock_blur.enabled = false;
        testManager.syncBlurState();
        assert(!testManager.bmsActive, 'bmsActive must become false when BMS is disabled');
        assert(latestBlurState === false, 'onBlurStateChanged must emit false when BMS is disabled');
        isTrans = Boolean(testManager.bmsActive);
        currentPillStyle = pillStyle({ blurEffect: true, dockRadius: 30, pillColor: 'rgba(28,28,32,0.8)', bgOpacity: 0.8 }, isTrans);
        assert(!currentPillStyle.includes('background-color: transparent;'),
            'Dock pill must restore normal transparency when BMS is disabled');
        assert(currentPillStyle.includes('background-color: rgba(28, 28, 32, 0.640);'),
            'Dock pill must show scaled pillColor and bgOpacity when BMS is disabled');

        testManager.destroy();
        delete globalThis.global.blur_my_shell;

        // Test 8: Real BMS disable sequence with remove-dashes signal emission
        class MockBmsWithDisable {
            constructor() {
                this.enabled = true;
                this.dashes = [];
                this.settings = { dash_to_dock: { STATIC_BLUR: false, PIPELINE: 'default' } };
                this._listeners = new Map();
            }
            connect(sig, cb) {
                if (!this._listeners.has(sig)) this._listeners.set(sig, []);
                this._listeners.get(sig).push(cb);
                return cb;
            }
            disconnect() {}
            emit(sig) {
                const list = this._listeners.get(sig) || [];
                for (const cb of [...list]) cb();
            }
            add_blur(dash_container, target) {
                return {
                    background: { x: 0, y: 0, width: 100, height: 100, set_position() {}, set_size() {} },
                    background_group: { get_parent() { return null; }, destroy() {} },
                    bg_manager: { destroy() {} },
                    pipeline: { destroy() {} },
                    rounded_pipeline: null,
                    corner_settings: { radius: 20, corners: 0 },
                };
            }
            try_blur(dash_container) {
                const target = { content: dash_container, background: dash_container._dockBg, content_parent: dash_container };
                const blur = this.add_blur(dash_container, target);
                const surface = new AquaDockSurface(this, dash_container, target, blur);
                this.dashes.push(surface);
            }
            update_background() {}
            disable() {
                if (!this.enabled) return;
                this.emit('remove-style');
                this.emit('remove-dashes');
                this.enabled = false;
            }
        }

        const realMockBms = new MockBmsWithDisable();
        globalThis.global = { blur_my_shell: { _dash_to_dock_blur: realMockBms } };

        const dockContainer = new MockWidget('dockContainer');
        dockContainer._isAquaDock = true;
        dockContainer.width = 300;
        dockContainer.height = 70;
        const dockBg = new MockWidget('dockBg');
        dockBg.width = 300;
        dockBg.height = 70;
        dockContainer._dockBg = dockBg;

        let bmsEvent = null;
        const bmsManager = new DockBlurManager({
            container: dockContainer,
            bg: dockBg,
            blurRegion: new MockWidget('br'),
            handle: null,
            handleBlurRegion: null,
            getConfig: () => ({ blurEffect: true, dockRadius: 28, pillColor: 'rgba(28,28,32,0.8)', bgOpacity: 0.75 }),
            onBlurStateChanged: (active) => { bmsEvent = active; },
        });

        assert(bmsManager.bmsActive === true, 'bmsManager must be active when BMS is enabled');
        assert(bmsEvent === true, 'onBlurStateChanged must emit true');
        assert(realMockBms.dashes.length === 1, 'realMockBms must have 1 dash surface');

        // Execute stock BMS disable sequence (remove-dashes emitted while enabled is true)
        realMockBms.disable();
        assert(bmsManager.bmsActive === false, 'bmsManager must be inactive immediately after BMS disable');
        assert(bmsEvent === false, 'onBlurStateChanged must emit false upon BMS disable');
        assert(realMockBms.dashes.length === 0, 'dashes must be empty after BMS disable');

        const disabledStyle = pillStyle({ blurEffect: true, dockRadius: 28, pillColor: 'rgba(28,28,32,0.8)', bgOpacity: 0.75 }, bmsManager.bmsActive);
        assert(!disabledStyle.includes('background-color: transparent;'), 'Dock pill must not be transparent after BMS disable');
        assert(disabledStyle.includes('background-color: rgba(28, 28, 32, 0.600);'), 'Dock pill must restore configured opacity and color');

        bmsManager.destroy();
        delete globalThis.global.blur_my_shell;
}

GLib.spawn_sync(null, ['rm', '-rf', tmpShellDir], null, GLib.SpawnFlags.SEARCH_PATH, null);

print('dockBlur: ok');
