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

    // When blurEffect is true, background becomes transparent (opacity & pill color disabled)
    const blurOnStyle = pillStyle({ ...cfg, blurEffect: true });
    assert(blurOnStyle.includes('background-color: transparent;'),
        'pillStyle should use transparent fill when blurEffect is enabled');

    // When blurEffect is false, background falls back to normal transparency
    const blurOffStyle = pillStyle({ ...cfg, blurEffect: false });
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

// ── 3. Blur My Shell Target Resolver Compatibility ───────────────────────────
{
    const bmsTargetsPath = `${GLib.get_home_dir()}/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/components/dock/dock_targets.js`;
    if (GLib.file_test(bmsTargetsPath, GLib.FileTest.EXISTS)) {
        const {
            is_supported_dock_container,
            resolve_dock_target,
            has_valid_allocation,
            get_dock_corners,
        } = await import(`file://${bmsTargetsPath}`);

        // Container recognition
        const aquaContainer = {
            get_name: () => 'aquaDockContainer',
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
        };

        assert(is_supported_dock_container(aquaContainer),
            'Blur my Shell is_supported_dock_container should recognize Aqua Dock container');

        const resolved = resolve_dock_target(aquaContainer);
        assert(resolved !== null,
            'resolve_dock_target should resolve Aqua Dock target');
        assert(resolved.background === aquaContainer._dockBg,
            'resolved background must point to Aqua Dock _dockBg');
        assert(resolved.sibling === aquaContainer._dockBlurRegion,
            'resolved sibling must point to Aqua Dock _dockBlurRegion');

        // Allocation validation during dynamic resize
        const dirtyAllocActor = {
            has_allocation: () => false, // allocation marked dirty during animation tick
            width: 320,
            height: 60,
        };
        assert(has_valid_allocation(dirtyAllocActor),
            'has_valid_allocation must succeed when width and height are positive even if allocation is dirty');

        const zeroSizeActor = {
            has_allocation: () => true,
            width: 0,
            height: 60,
        };
        assert(!has_valid_allocation(zeroSizeActor),
            'has_valid_allocation must reject zero-sized actors');

        // Corner radius calculation with explicit _dockRadius
        const corners = get_dock_corners(aquaContainer._dockBg);
        assert(corners.radius === 24,
            `get_dock_corners should read explicit _dockRadius 24 (got ${corners.radius})`);

        // Disabled blur setting check
        aquaContainer._dockBlurEnabled = false;
        assert(resolve_dock_target(aquaContainer) === null,
            'resolve_dock_target must return null when _dockBlurEnabled is false');

        // RoundedPipeline set_clip propagation for static blur
        const bmsRoundedPath = `${GLib.get_home_dir()}/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/render/rounded_pipeline.js`;
        if (GLib.file_test(bmsRoundedPath, GLib.FileTest.EXISTS)) {
            const { RoundedPipeline } = await import(`file://${bmsRoundedPath}`);
            let attachedEffect = null;
            const mockEffectsManager = {
                new_corner_effect: (params) => {
                    attachedEffect = { ...params };
                    return attachedEffect;
                },
            };
            const rounded = new RoundedPipeline(mockEffectsManager, () => 24, () => 0);
            const mockPipeline = { effects: [] };
            const mockActor = {
                connect: () => 1,
                disconnect: () => {},
                add_effect: () => {},
                remove_effect: () => {},
            };
            rounded.bind(mockPipeline, mockActor);
            assert(typeof rounded.set_clip === 'function', 'RoundedPipeline must implement set_clip');
            rounded.set_clip([10, 20, 300, 60]);
            assert(attachedEffect?.clip?.[0] === 10 && attachedEffect?.clip?.[2] === 300,
                'set_clip must propagate clip coordinates to CornerEffect');
        }
    }
}

// ── 4. DockBlurManager State Machine & BMS Coordination ──────────────────────
{
    // Register temporary mock Shell resource for Main.extensionManager
    const tmpDir = GLib.dir_make_tmp('aqua-test-XXXXXX');
    try {
        const mainJsPath = GLib.build_filenamev([tmpDir, 'main.js']);
        const xmlPath = GLib.build_filenamev([tmpDir, 'shell.gresource.xml']);
        const resPath = GLib.build_filenamev([tmpDir, 'shell.gresource']);

        GLib.file_set_contents(mainJsPath,
            'export const extensionManager = null;\nexport const layoutManager = null;\n');
        GLib.file_set_contents(xmlPath,
            `<?xml version="1.0" encoding="UTF-8"?>
<gresources>
  <gresource prefix="/org/gnome/shell/ui">
    <file>main.js</file>
  </gresource>
</gresources>`);

        const [ok, , stderr, status] = GLib.spawn_sync(
            null,
            ['glib-compile-resources', `--target=${resPath}`, `--sourcedir=${tmpDir}`, xmlPath],
            null,
            GLib.SpawnFlags.SEARCH_PATH,
            null
        );
        assert(ok && status === 0, `glib-compile-resources failed: ${new TextDecoder().decode(stderr)}`);

        const resource = Gio.Resource.load(resPath);
        resource._register();

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
    } finally {
        GLib.spawn_sync(null, ['rm', '-rf', tmpDir], null, GLib.SpawnFlags.SEARCH_PATH, null);
    }
}

print('dockBlur: ok');
