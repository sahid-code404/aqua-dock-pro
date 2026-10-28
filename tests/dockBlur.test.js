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
    'export const extensionManager = null;\nexport let layoutManager = null;\nexport function setLayoutManager(lm) { layoutManager = lm; }\nexport const overview = { visible: false };\n');
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
        isBmsDockBlurActive,
        isBmsPopupBlurActive,
        isBmsMenuBlurActive,
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

// ── 6. Context Menu Blur Target Resolution, BMS Coordination & Styling ────────
{
    const {
        resolveAquaDockTarget,
        isBmsDockBlurActive,
        isBmsPopupBlurActive,
        isBmsMenuBlurActive,
        registerBmsTarget,
        unregisterBmsTarget,
    } = await import('../dock/dockBlur.js');

    // 1. Detection when BMS is absent
    delete globalThis.global?.blur_my_shell;
    assert(isBmsPopupBlurActive() === false, 'isBmsPopupBlurActive must be false when BMS is absent');
    assert(isBmsDockBlurActive() === false, 'isBmsDockBlurActive must be false when BMS is absent');
    assert(isBmsMenuBlurActive({ blurEffect: true }) === false, 'isBmsMenuBlurActive must be false when BMS is absent');

    // 2. Detection when BMS has popup blur active
    if (!globalThis.global) globalThis.global = {};
    globalThis.global.blur_my_shell = {
        _popup: { enabled: true },
        _dash_to_dock_blur: { enabled: false, dashes: [] },
    };
    assert(isBmsPopupBlurActive() === true, 'isBmsPopupBlurActive must be true when _popup.enabled is true');
    assert(isBmsMenuBlurActive({ blurEffect: true }) === true, 'isBmsMenuBlurActive must be true with popup blur active');
    assert(isBmsMenuBlurActive({ blurEffect: false }) === false, 'isBmsMenuBlurActive must be false when blurEffect is false');
    assert(isBmsMenuBlurActive({ blurEffect: true, highContrast: true }) === false, 'isBmsMenuBlurActive must be false on highContrast');

    // 3. Detection when BMS popup blur is disabled but dock blur is active
    globalThis.global.blur_my_shell = {
        _popup: { enabled: false },
        _dash_to_dock_blur: { enabled: true, dashes: [], add_blur: () => ({ background_group: {} }), try_blur() {} },
    };
    assert(isBmsPopupBlurActive() === false, 'isBmsPopupBlurActive must be false when _popup.enabled is false');
    assert(isBmsDockBlurActive() === true, 'isBmsDockBlurActive must be true when dash blur is active');
    assert(isBmsMenuBlurActive({ blurEffect: true }) === true, 'isBmsMenuBlurActive must be true with dock blur fallback');

    // 4. Target resolution for aquaMenu
    const menuContainer = {
        name: 'aquaMenu',
        _isAquaDock: true,
        _dockBlurEnabled: true,
        _dockBg: { width: 220, height: 180 },
        _dockRadius: 12,
        has_style_class_name: (cls) => cls === 'aqua-menu',
    };
    const resolvedMenu = resolveAquaDockTarget(menuContainer);
    assert(resolvedMenu !== null, 'resolveAquaDockTarget must resolve aquaMenu');
    assert(resolvedMenu.background === menuContainer._dockBg, 'resolved background must match menuBg');

    menuContainer._dockBlurEnabled = false;
    assert(resolveAquaDockTarget(menuContainer) === null, 'resolveAquaDockTarget must return null when blur is disabled');
    menuContainer._dockBlurEnabled = true;

    // 5. Menu styling calculation
    const defaultMenuBg = 'rgba(35,36,40,0.94)';
    const normalStyledBg = applyAlpha(defaultMenuBg, 0.45);
    assert(normalStyledBg === 'rgba(35, 36, 40, 0.423)', 'applyAlpha must create translucent glass tint for blurred menu');

    // 6. Registration and unregistration lifecycle
    const mockDashBlur = {
        enabled: true,
        dashes: [],
        add_blur() {
            return {
                background_group: {
                    get_parent: () => null,
                    destroy() {},
                },
                background: {
                    set_position() {},
                    set_size() {},
                },
            };
        },
        try_blur(c) {
            this.dashes.push(c);
        },
    };
    globalThis.global.blur_my_shell._dash_to_dock_blur = mockDashBlur;

    const testMenuActor = {
        name: 'aquaMenu',
        _isAquaDock: true,
        _dockBlurEnabled: true,
        width: 220,
        height: 180,
        get_dock_radius: () => 12,
        connect: () => 1,
        disconnect: () => {},
    };
    registerBmsTarget(testMenuActor, () => 12);
    assert(mockDashBlur.dashes.some(d => d.dash_container === testMenuActor), 'testMenuActor must be registered into BMS dashes');
    assert(testMenuActor._aquaDockSurface !== null, 'testMenuActor must have _aquaDockSurface assigned');

    unregisterBmsTarget(testMenuActor);
    assert(!mockDashBlur.dashes.some(d => d.dash_container === testMenuActor), 'testMenuActor must be removed from BMS dashes');
    assert(!testMenuActor._aquaDockSurface, 'testMenuActor _aquaDockSurface must be cleared');
    delete globalThis.global.blur_my_shell;
}

// ── 7. Static Blur Lifecycle, Layout Loop Protection & Destruction ───────────
{
    const { registerBmsTarget, unregisterBmsTarget } = await import('../dock/dockBlur.js');
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const mockMonitor = { index: 0, x: 0, y: 0, width: 1920, height: 1080 };
    Main.setLayoutManager({
        primaryMonitor: mockMonitor,
        findMonitorForActor: () => mockMonitor,
    });

    let destroyedBgManager = false;
    let destroyedPipeline = false;
    let destroyedRoundedPipeline = false;
    let clipSetCount = 0;

    const mockStaticBg = {
        x: 0,
        y: 0,
        scale_x: 1,
        scale_y: 1,
        set_pivot_point() {},
        set_clip(x, y, w, h) {
            this.clip = [x, y, w, h];
            clipSetCount++;
        },
    };

    const mockParentActor = {
        x: 100,
        y: 1000,
        width: 400,
        height: 70,
        get_transformed_position: () => [100, 1000],
        get_transformed_size: () => [400, 70],
        has_allocation: () => true,
        connect: () => 1,
        disconnect: () => {},
    };

    const mockBgGroup = {
        parent: mockParentActor,
        get_parent() { return this.parent; },
        destroy() { this.destroyed = true; },
        connect: () => 1,
        disconnect: () => {},
    };

    const mockStaticBlur = {
        enabled: true,
        is_static: true,
        settings: { dash_to_dock: { STATIC_BLUR: true, PIPELINE: 'default' } },
        dashes: [],
        add_blur(dash_container, target) {
            return {
                background: mockStaticBg,
                background_group: mockBgGroup,
                bg_manager: { destroy() { destroyedBgManager = true; } },
                pipeline: {
                    destroy() { destroyedPipeline = true; },
                    change_pipeline_to() {},
                },
                rounded_pipeline: {
                    destroy() { destroyedRoundedPipeline = true; },
                    update() {},
                },
                corner_settings: { radius: 28, corners: 0 },
            };
        },
        try_blur() {},
        queue_discovery() {},
        update_background() {},
    };

    globalThis.global = {
        blur_my_shell: {
            _dash_to_dock_blur: mockStaticBlur,
        },
    };

    const dockContainer = {
        name: 'aquaDockContainer',
        _isAquaDock: true,
        _dockBlurEnabled: true,
        width: 400,
        height: 70,
        _dockRadius: 28,
        get_dock_radius: () => 28,
        has_allocation: () => true,
        get_allocation_box: () => ({ get_width: () => 400, get_height: () => 70 }),
        get_transformed_position: () => [100, 1000],
        get_transformed_size: () => [400, 70],
        connect: () => 1,
        disconnect: () => {},
    };
    dockContainer._dockBg = dockContainer;

    registerBmsTarget(dockContainer);
    assert(mockStaticBlur.dashes.length === 1, 'Static blur surface registered');
    const surface = mockStaticBlur.dashes[0];
    assert(surface.is_static === true, 'Surface flagged as static');

    // First update positions and clips
    surface.update_size();
    assert(clipSetCount === 1, `First update should set clip once (got ${clipSetCount})`);
    assert(mockStaticBg.clip[0] === 100 && mockStaticBg.clip[1] === 1000,
        `Clip coordinates match monitor offset: ${JSON.stringify(mockStaticBg.clip)}`);
    assert(mockStaticBg.clip[2] === 400 && mockStaticBg.clip[3] === 70,
        `Clip size matches dock dimensions: ${JSON.stringify(mockStaticBg.clip)}`);

    // Second update with identical geometry should be a NO-OP (infinite loop protection)
    surface.update_size();
    surface.update_size();
    assert(clipSetCount === 1,
        `Identical updates must NOT re-apply clip (preventing allocation loops): got ${clipSetCount}`);

    // Geometry change updates clip correctly
    dockContainer.get_transformed_position = () => [150, 1000];
    surface.update_size();
    assert(clipSetCount === 2, `Geometry change must re-apply clip: got ${clipSetCount}`);
    assert(mockStaticBg.clip[0] === 150, `Updated clip x matches new position`);

    // Clean destruction: verify all pipelines and bgManager are destroyed without leak
    unregisterBmsTarget(dockContainer);
    assert(mockStaticBlur.dashes.length === 0, 'Dashes list empty after unregister');
    assert(destroyedBgManager === true, 'bg_manager.destroy() must be called');
    assert(destroyedPipeline === true, 'pipeline.destroy() must be called');
    assert(destroyedRoundedPipeline === true, 'rounded_pipeline.destroy() must be called');
    assert(mockBgGroup.destroyed === true, 'background_group.destroy() must be called');

    delete globalThis.global.blur_my_shell;
}

// ── 8. Static Blur Clip Live Dimension Tracking (Direct Child/Sibling) ────────
{
    const { AquaDockSurface } = await import('../dock/dockBlur.js');
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const mockMonitor = { index: 0, x: 0, y: 0, width: 1920, height: 1080 };
    Main.setLayoutManager({
        primaryMonitor: mockMonitor,
        findMonitorForActor: () => mockMonitor,
    });

    const mockStaticBg = {
        x: 0,
        y: 0,
        scale_x: 1,
        scale_y: 1,
        set_pivot_point() {},
        set_clip(x, y, w, h) {
            this.clip = [x, y, w, h];
        },
    };

    const parentActor = {
        x: 200,
        y: 900,
        width: 600,
        height: 100,
        get_transformed_position: () => [200, 900],
        get_transformed_size: () => [600, 100],
        has_allocation: () => true,
        connect: () => 1,
        disconnect: () => {},
    };

    const bgGroup = {
        parent: parentActor,
        get_parent() { return this.parent; },
        destroy() { this.destroyed = true; },
        connect: () => 1,
        disconnect: () => {},
    };

    // dash_background is a direct child of parentActor (sibling to bgGroup)
    const dashBg = {
        x: 50,
        y: 10,
        width: 500,
        height: 80,
        parent: parentActor,
        get_parent() { return this.parent; },
        has_allocation: () => true,
        // Even if get_transformed_position returns stale values, live x/y/width/height must be used!
        get_transformed_position: () => [9999, 9999],
        get_transformed_size: () => [9999, 9999],
        connect: () => 1,
        disconnect: () => {},
    };

    const containerActor = {
        has_allocation: () => true,
        width: 600,
        height: 100,
        connect: () => 1,
        disconnect: () => {},
    };

    const mockBlur = {
        background: mockStaticBg,
        background_group: bgGroup,
        bg_manager: { destroy() {} },
        pipeline: { destroy() {} },
        rounded_pipeline: null,
        corner_settings: { radius: 28, corners: 0 },
    };

    const mockDashBlur = {
        is_static: true,
        settings: { dash_to_dock: { STATIC_BLUR: true } },
        connect: () => 1,
    };

    const target = {
        content: containerActor,
        background: dashBg,
        content_parent: parentActor,
    };

    const surface = new AquaDockSurface(mockDashBlur, containerActor, target, mockBlur);
    surface.update_size();

    // parent_stage_x = 200, parent_stage_y = 900, parent_scale_x = 1, parent_scale_y = 1
    // bg_stage_x = 200 + 50 * 1 = 250
    // bg_stage_y = 900 + 10 * 1 = 910
    // bg_stage_width = 500 * 1 = 500
    // bg_stage_height = 80 * 1 = 80
    // clip_x = 250 - 0 = 250, clip_y = 910 - 0 = 910, clip_w = 500, clip_h = 80
    assert(mockStaticBg.clip[0] === 250, `Clip x should be 250 (got ${mockStaticBg.clip[0]})`);
    assert(mockStaticBg.clip[1] === 910, `Clip y should be 910 (got ${mockStaticBg.clip[1]})`);
    assert(mockStaticBg.clip[2] === 500, `Clip width should be 500 (got ${mockStaticBg.clip[2]})`);
    assert(mockStaticBg.clip[3] === 80, `Clip height should be 80 (got ${mockStaticBg.clip[3]})`);

    // Simulate live stretch (magnification spread): dashBg.x shifts to 30, width expands to 540
    dashBg.x = 30;
    dashBg.width = 540;
    surface.update_size();

    assert(mockStaticBg.clip[0] === 230, `Updated clip x should be 230 after live actor shift (got ${mockStaticBg.clip[0]})`);
    assert(mockStaticBg.clip[2] === 540, `Updated clip width should be 540 after live actor spread (got ${mockStaticBg.clip[2]})`);

    surface.destroy_dash();
}

// ── 9. Style Isolation: AquaDockSurface.override_style() Does Not Add BMS Classes ──
{
    const { AquaDockSurface } = await import('../dock/dockBlur.js');

    class MockStyledActor {
        constructor() {
            this.classes = new Set();
        }
        add_style_class_name(c) { this.classes.add(c); }
        remove_style_class_name(c) { this.classes.delete(c); }
        has_style_class_name(c) { return this.classes.has(c); }
        has_allocation() { return true; }
        connect() { return 1; }
        disconnect() {}
    }

    const dash = new MockStyledActor();
    const container = new MockStyledActor();
    const background = new MockStyledActor();

    // Add foreign classes beforehand
    dash.add_style_class_name('transparent-dash');
    container.add_style_class_name('light-dash');
    background.add_style_class_name('dark-dash');

    const mockDashBlur = {
        is_static: false,
        settings: { dash_to_dock: { STYLE_DASH_TO_DOCK: 0 } },
        connect: () => 1,
    };

    const target = {
        content: dash,
        background: background,
        content_parent: container,
    };

    const mockBlur = {
        background: { set_position() {}, set_size() {} },
        background_group: { get_parent() { return null; }, destroy() {} },
        bg_manager: { destroy() {} },
        pipeline: { destroy() {} },
        rounded_pipeline: null,
        corner_settings: null,
    };

    const surface = new AquaDockSurface(mockDashBlur, container, target, mockBlur);

    // Call override_style()
    surface.override_style();

    // Verify foreign classes were removed and NO new BMS classes were added
    assert(!dash.has_style_class_name('transparent-dash'), 'transparent-dash should be removed from dash');
    assert(!container.has_style_class_name('light-dash'), 'light-dash should be removed from container');
    assert(!background.has_style_class_name('dark-dash'), 'dark-dash should be removed from background');
    assert(dash.classes.size === 0, 'No BMS classes should be added to dash');
    assert(container.classes.size === 0, 'No BMS classes should be added to container');
    assert(background.classes.size === 0, 'No BMS classes should be added to background');

    surface.destroy_dash();
}

// ── 10. BlurManager / DockBlurManager GSettings Change Listening & State Sync ──
{
    const { DockBlurManager, BlurManager } = await import('../dock/dockBlur.js');
    assert(DockBlurManager === BlurManager, 'BlurManager must be exported as alias for DockBlurManager');

    class MockSettings {
        constructor(initialValues = {}) {
            this.values = { ...initialValues };
            this._listeners = new Map();
        }
        connect(sig, cb) {
            if (!this._listeners.has(sig)) this._listeners.set(sig, []);
            this._listeners.get(sig).push(cb);
            return cb;
        }
        disconnect(cb) {
            for (const [sig, list] of this._listeners.entries()) {
                const idx = list.indexOf(cb);
                if (idx !== -1) list.splice(idx, 1);
            }
        }
        get_boolean(key) {
            return Boolean(this.values[key]);
        }
        set_boolean(key, val) {
            this.values[key] = val;
            this.emit('changed', key);
        }
        emit(sig, key) {
            const list = this._listeners.get(sig) || [];
            for (const cb of [...list]) cb(this, key);
        }
        get settings_schema() {
            return {
                has_key: (k) => k in this.values,
            };
        }
    }

    const mockDashSettings = new MockSettings({
        blur: true,
        'static-blur': false,
        pipeline: 'default',
    });
    const mockBmsSettings = new MockSettings({
        sigma: 30,
        brightness: 0.6,
    });

    const mockSurface = {
        dash_container: null,
        dash: null,
        is_static: false,
        updateCount: 0,
        changeTypeCount: 0,
        updatePipelineCount: 0,
        change_blur_type() {
            this.changeTypeCount++;
            this.is_static = mockBmsDashBlur.is_static;
        },
        update_pipeline() {
            this.updatePipelineCount++;
        },
        schedule_update() {
            this.updateCount++;
        },
        remove_dash_blur() {
            this.removed = true;
        },
    };

    const mockBmsDashBlur = {
        enabled: true,
        is_static: false,
        dashes: [mockSurface],
        settings: { dash_to_dock: { STATIC_BLUR: false } },
        connect: () => 1,
        queue_discovery() {},
    };

    globalThis.global = {
        blur_my_shell: {
            _dash_to_dock_blur: mockBmsDashBlur,
        },
    };

    const container = {
        name: 'aquaDockContainer',
        _isAquaDock: true,
        _dockBlurEnabled: true,
        width: 400,
        height: 70,
        connect: () => 1,
        disconnect: () => {},
    };
    const bg = { width: 400, height: 70 };
    container._dockBg = bg;
    mockSurface.dash_container = container;
    mockSurface.dash = bg;

    let blurStateChanges = [];
    const manager = new BlurManager({
        container,
        bg,
        blurRegion: { hide() {} },
        handle: null,
        handleBlurRegion: null,
        getConfig: () => ({ blurEffect: true }),
        onBlurStateChanged: (active) => blurStateChanges.push(active),
        bmsSettings: mockBmsSettings,
        bmsDashToDockSettings: mockDashSettings,
    });

    assert(manager.bmsActive === true, 'manager should initially be active');
    container._aquaDockSurface = mockSurface;

    // 1. User toggles "Dock blur" OFF in BMS GSettings
    mockDashSettings.set_boolean('blur', false);
    assert(manager.bmsActive === false, 'bmsActive must become false when blur GSetting is turned OFF');
    assert(blurStateChanges[blurStateChanges.length - 1] === false, 'onBlurStateChanged must emit false');

    // 2. User toggles "Dock blur" back ON in BMS GSettings
    mockDashSettings.set_boolean('blur', true);
    assert(manager.bmsActive === true, 'bmsActive must become true when blur GSetting is turned ON');
    assert(blurStateChanges[blurStateChanges.length - 1] === true, 'onBlurStateChanged must emit true');

    // 3. User toggles static-blur in BMS GSettings
    const prevTypeCount = mockSurface.changeTypeCount;
    mockDashSettings.set_boolean('static-blur', true);
    assert(mockSurface.changeTypeCount > prevTypeCount, 'change_blur_type must be invoked when static-blur is changed');

    // 4. User modifies BMS main settings (e.g. sigma)
    const prevUpdateCount = mockSurface.updateCount;
    mockBmsSettings.set_boolean('sigma', true);
    assert(mockSurface.updateCount > prevUpdateCount, 'surface update should be scheduled when BMS settings change');

    manager.destroy();
    delete globalThis.global.blur_my_shell;
}

GLib.spawn_sync(null, ['rm', '-rf', tmpShellDir], null, GLib.SpawnFlags.SEARCH_PATH, null);

print('dockBlur: ok');
