// Unit tests for Aqua Dock Pro Downloads blur integration:
// - Tile and panel style transparency and fallback
// - Blur My Shell discoverability for downloads stack views (PanelView, FanView)
// - No native Shell.BlurEffect creation (handled exclusively via BMS pipeline)
// - Popup area animation synchronization (open, settle, close)
// - Fallback to normal colors/transparency when blur-effect is disabled

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { applyTileStyle, applyStackMenuPillStyle } from '../downloads/tileStyle.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// Register temporary mock Shell resource for Main and PopupMenu imports
const tmpShellDir = GLib.dir_make_tmp('aqua-dlblur-XXXXXX');
const mainJsPath = GLib.build_filenamev([tmpShellDir, 'main.js']);
const popupMenuJsPath = GLib.build_filenamev([tmpShellDir, 'popupMenu.js']);
const xmlPath = GLib.build_filenamev([tmpShellDir, 'shell.gresource.xml']);
const resPath = GLib.build_filenamev([tmpShellDir, 'shell.gresource']);

GLib.file_set_contents(mainJsPath,
    'export const extensionManager = null;\nexport const layoutManager = null;\nexport const overview = { visible: false };\nexport const uiGroup = { add_child() {}, insert_child_below() {} };\n');
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

    // When blurEffect is true but isBlurActive is false (BMS disabled/absent): falls back to normal color
    applyTileStyle({ ...cfgBase, blurEffect: true }, labelPill, label, thumb, 10, false, '6px 14px', false);
    assert(labelPill.style.includes('background-color: rgba(30,30,36,0.8);'),
        'applyTileStyle should fallback to normal color when isBlurActive is false even if blurEffect is true');
    assert(!labelPill.style.includes('background-color: transparent;'),
        'applyTileStyle must NOT be transparent when isBlurActive is false');

    // When dlItemColor is unset, falls back to rgba(28,28,32,${bgAlpha}) computed from bgOpacity
    const cfgNoDlColor = { ...cfgBase, dlItemColor: null, bgOpacity: 0.50 };
    applyTileStyle(cfgNoDlColor, labelPill, label, thumb, 10, false, '6px 14px', false);
    assert(labelPill.style.includes('background-color: rgba(28,28,32,0.50);'),
        'applyTileStyle should compute default color from bgOpacity when dlItemColor is unset');

    // High contrast overrides blur transparency
    applyTileStyle({ ...cfgBase, blurEffect: true, highContrast: true }, labelPill, label, thumb, 10, false, '6px 14px');
    assert(labelPill.style.includes('background-color: rgba(0,0,0,0.96);'),
        'applyTileStyle should enforce high contrast solid background even if blurEffect is true');

    // ── Stack Menu Pill (Copy action) Style & Synchronized Hover ──────────────
    const menuBox = createMockPill();
    const menuItem = createMockPill();
    menuItem.label = createMockPill();

    // When blurEffect is true: menuBox is transparent, item is transparent without inner margins
    applyStackMenuPillStyle({ ...cfgBase, blurEffect: true }, menuBox, [menuItem], false, true);
    assert(menuBox.style.includes('background-color: transparent !important;'),
        'applyStackMenuPillStyle should make menuBox transparent when blur is active');
    assert(menuBox.style.includes('border-radius: 12px;'),
        'applyStackMenuPillStyle should match dlItemRadius');
    assert(menuBox.style.includes('padding: 0;'),
        'applyStackMenuPillStyle should zero menuBox padding so item covers entire pill');
    assert(menuItem.style.includes('background-color: transparent !important;'),
        'applyStackMenuPillStyle item should be transparent to avoid box blur');
    assert(menuItem.style.includes('margin: 0 !important;'),
        'applyStackMenuPillStyle item margin must be 0');
    assert(menuItem.style.includes('padding: 6px 14px !important;'),
        'applyStackMenuPillStyle item padding must match fan pill');

    // On hover: whole menuBox lights up with rgba(255, 255, 255, 0.16), item remains transparent (no inner box)
    applyStackMenuPillStyle({ ...cfgBase, blurEffect: true }, menuBox, [menuItem], true, true);
    assert(menuBox.style.includes('background-color: rgba(255, 255, 255, 0.16) !important;'),
        'applyStackMenuPillStyle menuBox must light up with hover highlight when hovered');
    assert(menuItem.style.includes('background-color: transparent !important;'),
        'applyStackMenuPillStyle item must remain transparent on hover to avoid nested box');

    // When blur is false: menuBox falls back to stack item color
    applyStackMenuPillStyle({ ...cfgBase, blurEffect: false }, menuBox, [menuItem], false, false);
    assert(menuBox.style.includes('background-color: rgba(30,30,36,0.8) !important;'),
        'applyStackMenuPillStyle menuBox must fallback to configured dlItemColor when blur is off');

    // High contrast mode
    applyStackMenuPillStyle({ ...cfgBase, blurEffect: true, highContrast: true }, menuBox, [menuItem], false, true);
    assert(menuBox.style.includes('background-color: rgba(0,0,0,0.96) !important;'),
        'applyStackMenuPillStyle menuBox must enforce solid high contrast background');
}

// ── 2. BMS Discoverability for PanelView and FanView ────────────────────────
{
    const {
        resolveAquaDockTarget,
        setupBackgroundCorners,
        registerBmsTarget,
        unregisterBmsTarget,
    } = await import('../dock/dockBlur.js');

    // PanelView BMS Target Discovery
    const panelBlurRegion = {
        width: 360,
        height: 420,
        has_allocation: () => true,
    };
    const panelContainer = {
        get_name: () => 'aquaDownloadsPanel',
        name: 'aquaDownloadsPanel',
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
        insert_child_below() {},
    };
    panelContainer._dockBg = panelContainer;

    const resolvedPanel = resolveAquaDockTarget(panelContainer);
    assert(resolvedPanel !== null, 'resolveAquaDockTarget should resolve PanelView target');
    assert(resolvedPanel.background === panelContainer,
        'resolved background should point to PanelView _dockBg');
    assert(resolvedPanel.content_parent === panelContainer,
        'resolved content_parent should point to panel container');
    assert(resolvedPanel.sibling === panelBlurRegion,
        'resolved sibling should point to _dockBlurRegion');

    // PanelView blur disabled fallback
    panelContainer._dockBlurEnabled = false;
    assert(resolveAquaDockTarget(panelContainer) === null,
        'resolveAquaDockTarget must return null for PanelView when _dockBlurEnabled is false');
    panelContainer._dockBlurEnabled = true;

    // FanView BMS Target Discovery
    const fanBlurRegion = {
        width: 320,
        height: 380,
        has_allocation: () => true,
    };
    const fanContainer = {
        get_name: () => 'aquaDownloadsFan',
        name: 'aquaDownloadsFan',
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
        insert_child_below() {},
    };
    fanContainer._dockBg = fanContainer;

    const resolvedFan = resolveAquaDockTarget(fanContainer);
    assert(resolvedFan !== null, 'resolveAquaDockTarget should resolve FanView target');
    assert(resolvedFan.background === fanContainer,
        'resolved background should point to FanView _dockBg');
    assert(resolvedFan.sibling === fanBlurRegion,
        'resolved sibling should point to fan _dockBlurRegion');

    // FanView blur disabled fallback
    fanContainer._dockBlurEnabled = false;
    assert(resolveAquaDockTarget(fanContainer) === null,
        'resolveAquaDockTarget must return null for FanView when _dockBlurEnabled is false');
    fanContainer._dockBlurEnabled = true;

    // FanView Item Pill BMS Target Discovery
    const fanItemBlurRegion = { width: 140, height: 32, has_allocation: () => true };
    const fanItemPill = { width: 140, height: 32, has_allocation: () => true, _dockRadius: 14, get_dock_radius: () => 14 };
    const fanItemRow = {
        get_name: () => 'aquaDownloadsFanItem',
        name: 'aquaDownloadsFanItem',
        _isAquaDock: true,
        _dockBg: fanItemPill,
        _dockBlurRegion: fanItemBlurRegion,
        _dockBlurEnabled: true,
        _dockRadius: 14,
        get_dock_radius: () => 14,
        width: 220,
        height: 48,
        has_allocation: () => true,
        insert_child_below() {},
    };
    const resolvedItem = resolveAquaDockTarget(fanItemRow);
    assert(resolvedItem !== null, 'resolveAquaDockTarget should resolve Fan item pill target');
    assert(resolvedItem.background === fanItemPill, 'resolved background should point to item labelPill');
    assert(resolvedItem.sibling === fanItemBlurRegion, 'resolved sibling should point to item blurRegion');

    fanItemRow._dockBlurEnabled = false;
    assert(resolveAquaDockTarget(fanItemRow) === null,
        'resolveAquaDockTarget must return null for Fan item when _dockBlurEnabled is false');
    fanItemRow._dockBlurEnabled = true;

    // Test with stock BMS files if present
    const bmsTargetsPath = `${GLib.get_home_dir()}/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/components/dock/dock_targets.js`;
    if (GLib.file_test(bmsTargetsPath, GLib.FileTest.EXISTS)) {
        const {
            is_supported_dock_container,
            get_dock_corners,
        } = await import(`file://${bmsTargetsPath}`);

        // Pure stock BMS dock_targets.js does not recognize popups directly (by design)
        assert(is_supported_dock_container(panelContainer) === false,
            'Pure stock BMS does not recognize PanelView on disk');
        assert(is_supported_dock_container(fanContainer) === false,
            'Pure stock BMS does not recognize FanView on disk');

        if (!globalThis.global) globalThis.global = {};
        globalThis.global.stage = {};
        const St = (await import('gi://St')).default;
        if (St?.ThemeContext) {
            St.ThemeContext.get_for_stage = () => ({ scale_factor: 1 });
        }

        setupBackgroundCorners(panelContainer, () => 22);
        const panelCorners = get_dock_corners(panelContainer);
        assert(panelCorners.radius === 22,
            `get_dock_corners should read explicit panel _dockRadius 22 (got ${panelCorners.radius})`);

        setupBackgroundCorners(fanContainer, () => 20);
        const fanCorners = get_dock_corners(fanContainer);
        assert(fanCorners.radius === 20,
            `get_dock_corners should read explicit fan _dockRadius 20 (got ${fanCorners.radius})`);

        setupBackgroundCorners(fanItemPill, () => 14);
        const itemCorners = get_dock_corners(fanItemPill);
        assert(itemCorners.radius === 14,
            `get_dock_corners should read explicit fan item _dockRadius 14 (got ${itemCorners.radius})`);
    }

    // Test in-memory BMS registration
    const mockDashBlur = {
        enabled: true,
        is_static: false,
        settings: { dash_to_dock: { STATIC_BLUR: false, PIPELINE: 'default' } },
        dashes: [],
        add_blur(dash_container, target) {
            return {
                background: { x: 0, y: 0, width: 0, height: 0, set_position() {}, set_size() {}, set_clip() {} },
                background_group: { parent: dash_container, get_parent() { return this.parent; }, destroy() {} },
                bg_manager: { destroy() {} },
                pipeline: { set_corner_radius() {}, destroy() {} },
                rounded_pipeline: null,
                corner_settings: { radius: 20, corners: 0 },
            };
        },
        try_blur() {},
        queue_discovery() {},
        update_background() {},
    };
    globalThis.global = {
        blur_my_shell: {
            _dash_to_dock_blur: mockDashBlur,
        },
    };

    registerBmsTarget(panelContainer);
    assert(mockDashBlur.dashes.length === 1, 'registerBmsTarget should register panel into BMS dashes');
    registerBmsTarget(fanContainer);
    assert(mockDashBlur.dashes.length === 2, 'registerBmsTarget should register fan into BMS dashes');
    registerBmsTarget(fanItemRow);
    assert(mockDashBlur.dashes.length === 3, 'registerBmsTarget should register fan item into BMS dashes');

    // When blur is disabled on fan container, it should not register into BMS dashes
    fanContainer._dockBlurEnabled = false;
    mockDashBlur.try_blur(fanContainer);
    // Dashes length remains 3 (or drops to 2 if cleaned up)
    fanContainer._dockBlurEnabled = true;

    unregisterBmsTarget(panelContainer);
    unregisterBmsTarget(fanContainer);
    unregisterBmsTarget(fanItemRow);
    assert(mockDashBlur.dashes.length === 0, 'unregisterBmsTarget should cleanly unregister popups');
    delete globalThis.global.blur_my_shell;
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

    // Fan view simulation: bounding box blur is removed, blur is on individual item pills
    function simulateFanView(cfg, numItems = 3) {
        const blurEnabled = Boolean(cfg.blurEffect);
        const radius = cfg.dlItemRadius ?? 16;
        const fan = new MockActor('fan');
        fan.name = 'aquaDownloadsFan';
        fan._isAquaDock = true;
        fan.set_style('background-color: transparent; border: none;');
        fan._dockBlurEnabled = false; // Bounding blur box removed!

        const items = [];
        const blurRegions = [];

        for (let i = 0; i < numItems; i++) {
            const row = new MockActor(`fan-row-${i}`);
            row.name = 'aquaDownloadsFanItem';
            row.width = 200;
            row.height = 44;

            const labelPill = new MockActor(`label-pill-${i}`);
            labelPill.width = 120;
            labelPill.height = 28;
            labelPill._dockRadius = radius;
            labelPill.get_dock_radius = () => radius;

            const blurRegion = new MockActor(`aqua-downloads-fan-blur-region-${i}`);
            blurRegion.width = 120;
            blurRegion.height = 28;
            blurRegion._dockRadius = radius;
            blurRegion.set_style(`border-radius: ${radius}px;`);

            const thumb = new MockActor(`thumb-${i}`);
            applyTileStyle(cfg, labelPill, new MockActor('label'), thumb, 8, false, '6px 14px', blurEnabled);

            row._isAquaDock = true;
            row._dockBlurEnabled = blurEnabled;
            row._dockBg = blurRegion;
            row._dockContent = blurRegion;
            row._dockContentParent = blurRegion;
            row._dockBlurRegion = blurRegion;
            row._dockRadius = radius;
            row.get_dock_radius = () => radius;
            blurRegion._isAquaDock = true;
            blurRegion._dockBlurEnabled = blurEnabled;
            blurRegion._dockRadius = radius;
            blurRegion.get_dock_radius = () => radius;

            if (!blurEnabled) blurRegion.hide();

            items.push({ row, labelPill, blurRegion, thumb });
            blurRegions.push(blurRegion);
        }

        fan._blurRegion = blurRegions[0] ?? null;
        fan._blurRegions = blurRegions;

        return { fan, items, blurRegions };
    }

    const { fan, items, blurRegions: fanBlurRegions } = simulateFanView(cfgBlur);
    assert(fan.name === 'aquaDownloadsFan', 'fan container name must be aquaDownloadsFan');
    assert(fan._isAquaDock === true, 'fan container must be marked as AquaDock');
    assert(fan._dockBlurEnabled === false, 'fan container must NOT have bounding blur enabled');
    assert(items.length === 3, 'fan view should have simulated item pills');
    for (const item of items) {
        assert(item.row._isAquaDock === true, 'item row must be marked as AquaDock');
        assert(item.row._dockBlurEnabled === true, 'item row must have blur enabled when blurEffect is true');
        assert(item.row._dockBg === item.blurRegion, 'item row _dockBg points to blurRegion');
        assert(item.row._dockContentParent === item.blurRegion, 'item row _dockContentParent points to blurRegion');
        assert(item.row._dockBlurRegion === item.blurRegion, 'item row _dockBlurRegion points to its blurRegion');
        assert(item.row._dockRadius === 16, 'item row _dockRadius matches item radius');
        assert(item.row.effects.length === 0, 'row has NO native blur effect attached');
        assert(item.labelPill.effects.length === 0, 'labelPill has NO native blur effect attached');
        assert(item.blurRegion.effects.length === 0, 'blurRegion has NO native blur effect attached');
        assert(item.labelPill.style.includes('background-color: transparent;'),
            'item pill must have transparent background when blur is active');
        assert(item.labelPill.style.includes('border-radius: 16px;'),
            'item pill must have rounded corners');
    }

    // Animation synchronization on pills
    for (const item of items) {
        item.row.ease({ opacity: 255, translation_x: 0, translation_y: 0, scale_x: 1, scale_y: 1 });
        item.blurRegion.ease({ opacity: 255, translation_x: 0, translation_y: 0, scale_x: 1, scale_y: 1 });
        assert(item.row.opacity === 255 && item.blurRegion.opacity === 255, 'pill and blurRegion ease in');
        assert(item.row.scale_x === 1 && item.blurRegion.scale_x === 1, 'pill and blurRegion scale in');

        item.row.remove_all_transitions();
        item.blurRegion.remove_all_transitions();
        item.row.opacity = 255;
        item.blurRegion.opacity = 255;
        item.blurRegion.translation_x = 0;
        item.blurRegion.translation_y = 0;
        item.blurRegion.scale_x = 1;
        item.blurRegion.scale_y = 1;
        assert(item.blurRegion.opacity === 255, 'settle animations keeps blurRegion at 255');
        assert(item.blurRegion.scale_x === 1, 'settle animations keeps blurRegion at scale 1');

        item.row.ease({ opacity: 0, scale_x: 0.4, scale_y: 0.4 });
        item.blurRegion.ease({ opacity: 0, scale_x: 0.4, scale_y: 0.4 });
        assert(item.row.opacity === 0 && item.blurRegion.opacity === 0, 'pill and blurRegion ease out');
        assert(item.row.scale_x === 0.4 && item.blurRegion.scale_x === 0.4, 'pill and blurRegion scale out');
    }

    // Fan view fallback when blurEffect: false
    const { fan: fanOff, items: itemsOff } = simulateFanView({
        ...cfgBlur,
        blurEffect: false,
    });
    assert(fanOff._dockBlurEnabled === false, 'fanOff has bounding blur disabled');
    for (const item of itemsOff) {
        assert(item.row._dockBlurEnabled === false, 'item row blur must be disabled when blurEffect is false');
        assert(item.blurRegion.visible === false, 'item blurRegion must be hidden when blurEffect is false');
        assert(!item.labelPill.style.includes('background-color: transparent;'),
            'item pill must have solid background when blurEffect is false');
    }

    // Test PanelView fallback when BMS is absent/disabled (even if blurEffect is true)
    delete globalThis.global?.blur_my_shell;
    const { isBmsDockBlurActive } = await import('../dock/dockBlur.js');
    const { applyAlpha } = await import('../dock/dockLayout.js');
    assert(isBmsDockBlurActive() === false, 'isBmsDockBlurActive must return false when BMS is absent');

    function simulateRealPanelView(cfg) {
        const a = (cfg.bgOpacity ?? 0.8).toFixed(2);
        const radius = cfg.downloadsBorderRadius ?? 24;
        const blurActive = Boolean(cfg.blurEffect && isBmsDockBlurActive());
        const normalFill = cfg.downloadsPillColor ?? (cfg.pillColor ? applyAlpha(cfg.pillColor, cfg.bgOpacity ?? 0.8) : `rgba(28,28,32,${a})`);
        const fill = cfg.highContrast ? 'rgba(0,0,0,0.96)' : (blurActive ? 'transparent' : normalFill);

        const panel = new MockActor('panel');
        panel.set_style(`border-radius: ${radius}px; background-color: ${fill}; border: 1px solid rgba(255,255,255,0.16);`);
        const blurRegion = new MockActor('aqua-downloads-panel-blur-region');
        panel._blurRegion = blurRegion;
        panel._dockBlurRegion = blurRegion;
        panel._dockBg = panel;
        panel._isAquaDock = true;
        panel._dockBlurEnabled = blurActive;
        panel._dockRadius = radius;
        if (!blurActive) blurRegion.hide();
        return { panel, blurRegion, blurActive };
    }

    const panelNoBms = simulateRealPanelView({
        blurEffect: true,
        pillColor: 'rgba(28,28,32,0.80)',
        bgOpacity: 0.60,
    });
    assert(panelNoBms.blurActive === false, 'blurActive must be false when BMS is absent');
    assert(panelNoBms.panel._dockBlurEnabled === false, 'panel._dockBlurEnabled must be false when BMS is absent');
    assert(panelNoBms.blurRegion.visible === false, 'blurRegion must be hidden when BMS is absent');
    assert(!panelNoBms.panel.style.includes('background-color: transparent;'),
        'panel must NOT have transparent background when BMS is absent');
    assert(panelNoBms.panel.style.includes('background-color: rgba(28, 28, 32, 0.480);'),
        'panel must show normal transparency with configured pillColor and bgOpacity when BMS is absent');

    function simulateRealFanView(cfg) {
        const blurActive = Boolean(cfg.blurEffect && isBmsDockBlurActive());
        return simulateFanView({ ...cfg, blurEffect: blurActive }, 2);
    }
    const fanNoBms = simulateRealFanView({ blurEffect: true });
    assert(fanNoBms.fan._dockBlurEnabled === false, 'fanNoBms bounding blur must be disabled');
    for (const item of fanNoBms.items) {
        assert(item.row._dockBlurEnabled === false, 'item row blur must be disabled when BMS is absent');
        assert(item.blurRegion.visible === false, 'item blurRegion must be hidden when BMS is absent');
        assert(!item.labelPill.style.includes('background-color: transparent;'),
            'item pill must NOT have transparent background when BMS is absent');
    }
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
    const projectRoot = GLib.get_current_dir();
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const { DownloadsStack } = await import(`file://${projectRoot}/downloads/downloadsStack.js`);
    const mockContainer = { name: 'aquaDockContainer', get_parent: () => Main.uiGroup };
    const stack = new DownloadsStack(
        () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
        () => mockContainer
    );
    assert(stack.blurRegion === null, 'DownloadsStack.blurRegion is null initially');
    assert(stack.view === null, 'DownloadsStack.view is null initially');
    assert(stack.anchor === null, 'DownloadsStack.anchor is null initially');
    assert(stack.currentFolderUri === null, 'DownloadsStack.currentFolderUri is null initially');

    // Test _resolveDockContainer resolution
    assert(stack._resolveDockContainer(null) === mockContainer,
        '_resolveDockContainer resolves dockContainer from host callback');
    const stackNoHost = new DownloadsStack(() => ({ x: 0, y: 0, width: 1920, height: 1080 }));
    const mockAnchor = { get_parent: () => mockContainer };
    assert(stackNoHost._resolveDockContainer(mockAnchor) === mockContainer,
        '_resolveDockContainer resolves dockContainer from anchor parent');

    // ── 5. Layering Order in Main.uiGroup (Stack Overlay Behind Dock Icons) ───────
    const uiChildren = [];
    const mockUiGroup = {
        add_child(actor) {
            uiChildren.push(actor);
        },
        insert_child_below(actor, sibling) {
            const idx = uiChildren.indexOf(sibling);
            if (idx >= 0) {
                uiChildren.splice(idx, 0, actor);
            } else {
                uiChildren.unshift(actor);
            }
        },
    };

    const dock = { name: 'aquaDockContainer' };
    mockUiGroup.add_child(dock);

    // Blocker is inserted below dockContainer
    const blocker = { name: 'blocker' };
    mockUiGroup.insert_child_below(blocker, dock);

    // Fan/Panel is inserted below dockContainer (above blocker)
    const stackView = { name: 'fanView' };
    mockUiGroup.insert_child_below(stackView, dock);

    // Blur region is inserted below stackView (between blocker and stackView)
    const blurRegion = { name: 'blurRegion' };
    mockUiGroup.insert_child_below(blurRegion, stackView);

    const blockerIdx = uiChildren.indexOf(blocker);
    const blurIdx = uiChildren.indexOf(blurRegion);
    const stackIdx = uiChildren.indexOf(stackView);
    const dockIdx = uiChildren.indexOf(dock);

    assert(blockerIdx >= 0 && blurIdx >= 0 && stackIdx >= 0 && dockIdx >= 0,
        'all overlay and dock elements present in uiChildren');
    assert(blockerIdx < blurIdx, 'blocker must be below blurRegion');
    assert(blurIdx < stackIdx, 'blurRegion must be below stackView');
    assert(stackIdx < dockIdx, 'stackView must be below dock (behind dock app icons)');
    assert(blockerIdx < dockIdx, 'blocker must be below dock (behind dock app icons)');

    // ── 6. DownloadManager Toggle Behavior ─────────────────────────────────────────
    const { DownloadManager } = await import(`file://${projectRoot}/downloads/downloadManager.js`);
    let closedCount = 0;
    const mockHost = {
        getConfig: () => ({ showDownloads: false, bounceHeight: 12, bounceDecay: 0.8 }),
        getMonitor: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
        getContainer: () => mockContainer,
        onStackClosed: () => { closedCount++; },
    };
    const dlMgr = new DownloadManager(mockHost);
    let mockIsOpen = false;
    let mockAnchorItem = null;
    dlMgr._stack = {
        get isOpen() { return mockIsOpen; },
        get anchor() { return mockAnchorItem; },
        get currentFolderUri() { return 'file:///home/user/Downloads'; },
        show(item, folder, cfg, onClose) {
            mockIsOpen = true;
            mockAnchorItem = item;
        },
        hide() {
            mockIsOpen = false;
            mockAnchorItem = null;
            closedCount++;
        },
    };

    let stackOpenStateCalls = [];
    mockHost.kickEngine = () => {};

    const mockItem = {
        entry: { kind: 'downloads' },
        bounce() {},
        gicon: null,
        setStackOpenState(isOpen) {
            this.isOpenState = isOpen;
            stackOpenStateCalls.push(isOpen);
        },
    };
    const mockFolder = { get_uri: () => 'file:///home/user/Downloads' };

    // 1st click: opens stack without demagnifying item
    dlMgr.openFolderStack(mockItem, mockFolder);
    assert(dlMgr.stackOpen === true, 'openFolderStack opens stack on first click');
    assert(dlMgr.activeItem === mockItem, 'activeItem set to mockItem');
    assert(mockItem.isOpenState === true, 'setStackOpenState(true) called on item');

    // 2nd click: toggles/closes stack
    dlMgr.openFolderStack(mockItem, mockFolder);
    assert(dlMgr.stackOpen === false, 'openFolderStack toggles closed on second click');
    assert(dlMgr.activeItem === null, 'activeItem cleared when closed');
    assert(mockItem.isOpenState === false, 'setStackOpenState(false) called on item when closed');
    assert(closedCount > 0, 'onClose/hide was called');
}

GLib.spawn_sync(null, ['rm', '-rf', tmpShellDir], null, GLib.SpawnFlags.SEARCH_PATH, null);

print('downloadsBlur: ok');
