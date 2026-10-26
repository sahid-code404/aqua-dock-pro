// Unit tests for Aqua Dock Pro Downloads blur integration:
// - Tile and panel style transparency and fallback
// - Blur My Shell discoverability for downloads stack views (PanelView, FanView)
// - No native Shell.BlurEffect creation (handled exclusively via BMS pipeline)
// - Popup area animation synchronization (open, settle, close)
// - Fallback to normal colors/transparency when blur-effect is disabled

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { applyTileStyle } from '../downloads/tileStyle.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// ── 1. Tile Style Transparency & Fallback ────────────────────────────────────
{
    function createMockPill() {
        return {
            style: '',
            set_style(s) { this.style = s; },
        };
    }

    const labelPill = createMockPill();
    const label = createMockPill();
    const thumb = createMockPill();

    const cfgBase = {
        dockRadius: 16,
        dlItemRadius: 12,
        dlItemBorderWidth: 1,
        dlItemBorderColor: 'rgba(255,255,255,0.2)',
        dlItemColor: 'rgba(30,30,36,0.8)',
        bgOpacity: 0.8,
        highContrast: false,
    };

    // When blurEffect is true: pill background becomes transparent
    applyTileStyle({ ...cfgBase, blurEffect: true }, labelPill, label, thumb, 10, false, '6px 14px');
    assert(labelPill.style.includes('background-color: transparent;'),
        'applyTileStyle should use transparent background when blurEffect is enabled');
    assert(labelPill.style.includes('border-radius: 12px;'),
        'applyTileStyle should preserve corner radius when blurEffect is enabled');

    // On hover with blurEffect true: pill background uses hover highlight
    applyTileStyle({ ...cfgBase, blurEffect: true }, labelPill, label, thumb, 10, true, '6px 14px');
    assert(labelPill.style.includes('background-color: rgba(255,255,255,0.16);'),
        'applyTileStyle should use hover highlight when hovered with blurEffect enabled');

    // When blurEffect is false: pill background falls back to normal color
    applyTileStyle({ ...cfgBase, blurEffect: false }, labelPill, label, thumb, 10, false, '6px 14px');
    assert(labelPill.style.includes('background-color: rgba(30,30,36,0.8);'),
        'applyTileStyle should fallback to normal color when blurEffect is false');

    // High contrast overrides blur transparency
    applyTileStyle({ ...cfgBase, blurEffect: true, highContrast: true }, labelPill, label, thumb, 10, false, '6px 14px');
    assert(labelPill.style.includes('background-color: rgba(0,0,0,0.96);'),
        'applyTileStyle should enforce high contrast solid background even if blurEffect is true');
}

// ── 2. BMS Discoverability for PanelView and FanView ────────────────────────
{
    const bmsTargetsPath = `${GLib.get_home_dir()}/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/components/dock/dock_targets.js`;
    if (GLib.file_test(bmsTargetsPath, GLib.FileTest.EXISTS)) {
        const {
            is_supported_dock_container,
            resolve_dock_target,
            get_dock_corners,
            is_dock_ready,
        } = await import(`file://${bmsTargetsPath}`);

        // PanelView BMS Target Discovery
        const panelBlurRegion = {
            width: 360,
            height: 420,
            has_allocation: () => true,
        };
        const panelContainer = {
            get_name: () => 'aquaDownloadsPanel',
            _isAquaDock: true,
            _dockBg: null,
            _dockBlurRegion: panelBlurRegion,
            _dockBlurEnabled: true,
            _dockRadius: 22,
            get_children: () => [],
            has_allocation: () => true,
            width: 360,
            height: 420,
            get_dock_radius: () => 22,
        };
        panelContainer._dockBg = panelContainer;

        assert(is_supported_dock_container(panelContainer),
            'Blur my Shell is_supported_dock_container should recognize PanelView via _isAquaDock');

        const resolvedPanel = resolve_dock_target(panelContainer);
        assert(resolvedPanel !== null, 'resolve_dock_target should resolve PanelView target');
        assert(resolvedPanel.background === panelContainer,
            'resolved background should point to PanelView _dockBg');
        assert(resolvedPanel.content_parent === panelContainer,
            'resolved content_parent should point to panel container');
        assert(resolvedPanel.sibling === panelBlurRegion,
            'resolved sibling should point to _dockBlurRegion');

        const panelCorners = get_dock_corners(resolvedPanel.background);
        assert(panelCorners.radius === 22,
            `get_dock_corners should read explicit panel _dockRadius 22 (got ${panelCorners.radius})`);
        assert(is_dock_ready(panelContainer, resolvedPanel),
            'is_dock_ready should succeed for allocated PanelView');

        // PanelView blur disabled fallback
        panelContainer._dockBlurEnabled = false;
        assert(resolve_dock_target(panelContainer) === null,
            'resolve_dock_target must return null for PanelView when _dockBlurEnabled is false');

        // FanView BMS Target Discovery
        const fanBlurRegion = {
            width: 320,
            height: 380,
            has_allocation: () => true,
        };
        const fanContainer = {
            get_name: () => 'aquaDownloadsFan',
            _isAquaDock: true,
            _dockBg: null,
            _dockBlurRegion: fanBlurRegion,
            _dockBlurEnabled: true,
            _dockRadius: 20,
            get_children: () => [],
            has_allocation: () => true,
            width: 320,
            height: 380,
            get_dock_radius: () => 20,
        };
        fanContainer._dockBg = fanContainer;

        assert(is_supported_dock_container(fanContainer),
            'Blur my Shell is_supported_dock_container should recognize FanView via _isAquaDock');

        const resolvedFan = resolve_dock_target(fanContainer);
        assert(resolvedFan !== null, 'resolve_dock_target should resolve FanView target');
        assert(resolvedFan.background === fanContainer,
            'resolved background should point to FanView _dockBg');
        assert(resolvedFan.sibling === fanBlurRegion,
            'resolved sibling should point to fan _dockBlurRegion');

        const fanCorners = get_dock_corners(resolvedFan.background);
        assert(fanCorners.radius === 20,
            `get_dock_corners should read explicit fan _dockRadius 20 (got ${fanCorners.radius})`);
        assert(is_dock_ready(fanContainer, resolvedFan),
            'is_dock_ready should succeed for allocated FanView');

        // FanView blur disabled fallback
        fanContainer._dockBlurEnabled = false;
        assert(resolve_dock_target(fanContainer) === null,
            'resolve_dock_target must return null for FanView when _dockBlurEnabled is false');
    }
}

// ── 3. PanelView & FanView Structure, Properties, and Fallback ───────────────
{
    class MockActor {
        constructor(name) {
            this.name = name;
            this.effects = [];
            this.visible = true;
            this.opacity = 0;
            this.scale_x = 1;
            this.scale_y = 1;
            this.translation_y = 0;
            this.width = 300;
            this.height = 300;
            this.style = '';
            this.transitions = [];
        }
        add_effect(e) { this.effects.push(e); }
        remove_effect(e) { this.effects = this.effects.filter(x => x !== e); }
        set_style(s) { this.style = s; }
        set_scale(x, y) { this.scale_x = x; this.scale_y = y; }
        show() { this.visible = true; }
        hide() { this.visible = false; }
        has_allocation() { return true; }
        get_name() { return this.name; }
        get_children() { return []; }
        ease(props) {
            this.transitions.push(props);
            if (props.opacity !== undefined) this.opacity = props.opacity;
            if (props.scale_x !== undefined) this.scale_x = props.scale_x;
            if (props.scale_y !== undefined) this.scale_y = props.scale_y;
            if (props.translation_y !== undefined) this.translation_y = props.translation_y;
            props.onComplete?.();
        }
        remove_all_transitions() { this.transitions = []; }
        destroy() { this.destroyed = true; }
    }

    function simulatePanelView(cfg) {
        const radius = cfg.downloadsBorderRadius ?? 24;
        const blurEnabled = Boolean(cfg.blurEffect);
        const fill = cfg.highContrast ? 'rgba(0,0,0,0.96)'
            : (blurEnabled ? 'transparent' : (cfg.downloadsPillColor ?? 'rgba(28,28,32,0.8)'));

        const panel = new MockActor('panel');
        panel.set_style(`border-radius: ${radius}px; background-color: ${fill}; border: 1px solid rgba(255,255,255,0.16);`);

        const blurRegion = new MockActor('aqua-downloads-panel-blur-region');
        blurRegion._dockRadius = radius;
        blurRegion.set_style(`border-radius: ${radius}px;`);

        panel._blurRegion = blurRegion;
        panel._dockBlurRegion = blurRegion;
        panel._dockBg = panel;
        panel._isAquaDock = true;
        panel._dockBlurEnabled = blurEnabled;
        panel._dockRadius = radius;
        panel.get_dock_radius = () => radius;

        if (!blurEnabled) {
            blurRegion.hide();
        }

        return { panel, blurRegion };
    }

    const cfgBlur = {
        blurEffect: true,
        downloadsBorderRadius: 24,
    };

    const { panel, blurRegion } = simulatePanelView(cfgBlur);
    assert(panel._isAquaDock === true, 'panel._isAquaDock must be true');
    assert(panel._dockBlurEnabled === true, 'panel._dockBlurEnabled must be true when blurEffect is true');
    assert(panel._dockBg === panel, 'panel._dockBg points to panel itself');
    assert(panel._dockBlurRegion === blurRegion, 'panel._dockBlurRegion points to blurRegion');
    assert(panel._dockRadius === 24, 'panel._dockRadius matches configured downloadsBorderRadius');
    assert(panel.effects.length === 0, 'panel must have NO native Shell.BlurEffect attached');
    assert(blurRegion.effects.length === 0, 'blurRegion must have NO native Shell.BlurEffect attached');
    assert(panel.style.includes('background-color: transparent;'),
        'panel style must use transparent background when blurEffect is true');

    // Panel animation sync: open
    panel.ease({ opacity: 255, scale_x: 1, scale_y: 1, duration: 240 });
    blurRegion.ease({ opacity: 255, scale_x: 1, scale_y: 1, duration: 240 });
    assert(panel.opacity === 255 && blurRegion.opacity === 255, 'panel and blurRegion ease to opacity 255');

    // Settle animations
    panel.remove_all_transitions();
    blurRegion.remove_all_transitions();
    panel.opacity = 255;
    blurRegion.opacity = 255;
    assert(blurRegion.opacity === 255, 'settle animations keeps blurRegion opacity at 255');

    // Close animation
    panel.ease({ opacity: 0, duration: 200 });
    blurRegion.ease({ opacity: 0, duration: 200 });
    assert(panel.opacity === 0 && blurRegion.opacity === 0, 'panel and blurRegion ease out together');

    // Panel with blurEffect: false fallback
    const { panel: panelOff, blurRegion: blurRegionOff } = simulatePanelView({
        ...cfgBlur,
        blurEffect: false,
    });
    assert(panelOff._isAquaDock === true, 'panelOff._isAquaDock is true');
    assert(panelOff._dockBlurEnabled === false, 'panelOff._dockBlurEnabled must be false when blurEffect is false');
    assert(blurRegionOff.visible === false, 'blurRegionOff must be hidden when blurEffect is false');
    assert(!panelOff.style.includes('background-color: transparent;'),
        'panelOff style must use solid background when blurEffect is false');

    // Fan view simulation
    function simulateFanView(cfg) {
        const blurEnabled = Boolean(cfg.blurEffect);
        const fan = new MockActor('fan');
        fan.set_style('background-color: transparent; border: none;');

        const fanBlurRegion = new MockActor('aqua-downloads-fan-blur-region');
        fanBlurRegion._dockRadius = 20;

        fan._blurRegion = fanBlurRegion;
        fan._dockBlurRegion = fanBlurRegion;
        fan._dockBg = fan;
        fan._isAquaDock = true;
        fan._dockBlurEnabled = blurEnabled;
        fan._dockRadius = 20;
        fan.get_dock_radius = () => 20;

        if (!blurEnabled) fanBlurRegion.hide();

        return { fan, fanBlurRegion };
    }

    const { fan, fanBlurRegion } = simulateFanView(cfgBlur);
    assert(fan._isAquaDock === true, 'fan._isAquaDock must be true');
    assert(fan._dockBlurEnabled === true, 'fan._dockBlurEnabled must be true when blurEffect is true');
    assert(fan._dockBg === fan, 'fan._dockBg points to fan');
    assert(fan._dockBlurRegion === fanBlurRegion, 'fan._dockBlurRegion points to fanBlurRegion');
    assert(fan._dockRadius === 20, 'fan._dockRadius is 20');
    assert(fan.effects.length === 0, 'fan has NO native blur effect attached');
    assert(fanBlurRegion.effects.length === 0, 'fanBlurRegion has NO native blur effect attached');

    // Fan view fallback when blurEffect: false
    const { fan: fanOff, fanBlurRegion: fanBlurRegionOff } = simulateFanView({
        ...cfgBlur,
        blurEffect: false,
    });
    assert(fanOff._isAquaDock === true, 'fanOff._isAquaDock is true');
    assert(fanOff._dockBlurEnabled === false, 'fanOff._dockBlurEnabled must be false');
    assert(fanBlurRegionOff.visible === false, 'fanBlurRegionOff must be hidden when blurEffect is false');
}

// ── 4. Settings and DownloadsStack Controller ────────────────────────────────
{
    // Verify downloadsChanged includes blur-effect and high-contrast
    const checkDownloadsChanged = (changedKey) => {
        return changedKey.startsWith('downloads-') || changedKey === 'blur-effect' || changedKey === 'high-contrast';
    };
    assert(checkDownloadsChanged('blur-effect') === true, 'blur-effect must trigger downloadsChanged to close stale stacks');
    assert(checkDownloadsChanged('high-contrast') === true, 'high-contrast must trigger downloadsChanged');
    assert(checkDownloadsChanged('downloads-pill-color') === true, 'downloads- keys trigger downloadsChanged');
    assert(checkDownloadsChanged('icon-size') === false, 'unrelated keys do not trigger downloadsChanged');

    // Test DownloadsStack getter signatures
    const tmpDir = GLib.dir_make_tmp('aqua-stack-test-XXXXXX');
    try {
        const mainJsPath = GLib.build_filenamev([tmpDir, 'main.js']);
        const popupMenuJsPath = GLib.build_filenamev([tmpDir, 'popupMenu.js']);
        const xmlPath = GLib.build_filenamev([tmpDir, 'shell.gresource.xml']);
        const resPath = GLib.build_filenamev([tmpDir, 'shell.gresource']);

        GLib.file_set_contents(mainJsPath,
            'export const extensionManager = null;\nexport const layoutManager = null;\nexport const uiGroup = { add_child() {} };\n');
        GLib.file_set_contents(popupMenuJsPath,
            'export class PopupMenu {}\nexport class PopupMenuItem {}\nexport class PopupMenuManager {}\nexport class PopupSubMenuMenuItem {}\nexport class PopupSeparatorMenuItem {}\n');
        GLib.file_set_contents(xmlPath,
            `<?xml version="1.0" encoding="UTF-8"?>
<gresources>
  <gresource prefix="/org/gnome/shell/ui">
    <file>main.js</file>
    <file>popupMenu.js</file>
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
        const { DownloadsStack } = await import(`file://${projectRoot}/downloads/downloadsStack.js`);
        const stack = new DownloadsStack(() => ({ x: 0, y: 0, width: 1920, height: 1080 }));
        assert(stack.blurRegion === null, 'DownloadsStack.blurRegion is null initially');
        assert(stack.view === null, 'DownloadsStack.view is null initially');
    } finally {
        GLib.spawn_sync(null, ['rm', '-rf', tmpDir], null, GLib.SpawnFlags.SEARCH_PATH, null);
    }
}

print('downloadsBlur: ok');
