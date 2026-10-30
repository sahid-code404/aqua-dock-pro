// Unit tests for Aqua Dock Pro Downloads blur integration:
// - Tile and panel style transparency and fallback
// - Blur My Shell discoverability for downloads stack views (PanelView, FanView)
// - No native Shell.BlurEffect creation (handled exclusively via BMS pipeline)
// - Popup area animation synchronization (open, settle, close)
// - Fallback to normal colors/transparency when blur-effect is disabled

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { applyTileStyle, applyStackMenuPillStyle } from '../downloads/tileStyle.js';
import { ActorPool } from '../downloads/actorPool.js';

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
            set_x_align(a) { this.x_align = a; },
            set_y_align(a) { this.y_align = a; },
            set_x_expand(e) { this.x_expand = e; },
            set_y_expand(e) { this.y_expand = e; },
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
    assert(thumb.style.includes('background-color: #000000;') && thumb.style.includes('border: 2px solid #ffffff;'),
        'applyTileStyle thumb must have high contrast border and background');

    // Thumb styling: rectangular translucent box with border and corner radius
    applyTileStyle(cfgBase, labelPill, label, thumb, 10, false, '6px 14px');
    assert(thumb.style.includes('border-radius: 10px;'),
        'applyTileStyle thumb must set border-radius to thumbRadius');
    assert(thumb.style.includes('background-color: rgba(46,46,54,0.70);'),
        'applyTileStyle thumb must use translucent box background');
    assert(thumb.style.includes('border: 1px solid rgba(255,255,255,0.2);'),
        'applyTileStyle thumb must have subtle translucent border');

    // Thumb styling on hover: highlights with rgba(255, 255, 255, 0.18)
    applyTileStyle(cfgBase, labelPill, label, thumb, 10, true, '6px 14px');
    assert(thumb.style.includes('background-color: rgba(255, 255, 255, 0.18);'),
        'applyTileStyle thumb must highlight on hover');

    // Dynamic pill height scaling to match thumbnail/folder preview height
    applyTileStyle(cfgBase, labelPill, label, thumb, 10, false, '0 12px', false, null, 40);
    assert(labelPill.style.includes('min-height: 40px; height: 40px;'),
        'applyTileStyle must set min-height and height when pillH is provided');

    // Dynamic pill height inferred from labelPill.height if pillH is omitted
    const pillWithHeight = createMockPill();
    pillWithHeight.height = 36;
    applyTileStyle(cfgBase, pillWithHeight, label, thumb, 10, false, '0 12px');
    assert(pillWithHeight.style.includes('min-height: 36px; height: 36px;'),
        'applyTileStyle must infer height from labelPill.height when pillH is not explicitly passed');

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
    assert(menuItem.style.includes('padding: 0 16px !important;'),
        'applyStackMenuPillStyle item padding must be 0 16px to allow center alignment');
    assert(menuItem.style.includes('spacing: 0 !important;'),
        'applyStackMenuPillStyle item spacing must be 0');
    assert(menuItem.label.style.includes('text-align: center;'),
        'applyStackMenuPillStyle label style must center text');
    assert(menuItem.x_expand === true && menuItem.y_expand === true,
        'applyStackMenuPillStyle item must expand to fill menuBox');
    assert(menuItem.label.x_align === 2 && menuItem.label.y_align === 2,
        'applyStackMenuPillStyle label must be centered horizontally and vertically');

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

    // Target height matching pill
    applyStackMenuPillStyle({ ...cfgBase, blurEffect: false }, menuBox, [menuItem], false, false, 36);
    assert(menuBox.style.includes('min-height: 36px; height: 36px;'),
        'applyStackMenuPillStyle menuBox must set matching pill height when targetHeight is provided');
    assert(menuItem.style.includes('min-height: 36px; height: 36px;'),
        'applyStackMenuPillStyle menuItem must set matching pill height when targetHeight is provided');
}

// ── 2. BMS Discoverability for PanelView and FanView ────────────────────────
{
    const {
        resolveAquaDockTarget,
        isAquaPopupTarget,
        isBmsStackBlurActive,
        setupBackgroundCorners,
        registerBmsTarget,
        unregisterBmsTarget,
    } = await import('../dock/dockBlur.js');

    // PanelView Target Discovery & Popup Classification (Grid & List views enable blur like dock pill)
    const panelContainer = {
        get_name: () => 'aquaDownloadsPanel',
        name: 'aquaDownloadsPanel',
        _isAquaDock: true,
        _blurType: 'popup',
        _dockBg: null,
        _dockBlurRegion: null,
        _dockBlurEnabled: true,
        _dockRadius: 22,
        get_children: () => [],
        has_allocation: () => true,
        width: 360,
        height: 420,
        get_dock_radius: () => 22,
        insert_child_below() {},
        has_style_class_name(c) { return c === 'aqua-dl-panel'; },
    };
    panelContainer._dockBg = panelContainer;

    assert(isAquaPopupTarget(panelContainer) === true,
        'isAquaPopupTarget must return true for aquaDownloadsPanel when blur is enabled');
    assert(isAquaPopupTarget({ has_style_class_name: c => c === 'aqua-dl-panel' }) === true,
        'isAquaPopupTarget must return true for .aqua-dl-panel when blur is enabled');

    // PanelView resolves to a BMS target when _dockBlurEnabled is true
    const resolvedPanel = resolveAquaDockTarget(panelContainer);
    assert(resolvedPanel !== null, 'resolveAquaDockTarget must resolve PanelView when _dockBlurEnabled is true');
    assert(resolvedPanel.is_popup === true, 'PanelView must resolve as popup');

    // FanView strictly has _dockBlurEnabled = false and is not an Aqua popup target
    const fanTestTarget = {
        get_name: () => 'aquaDownloadsFan',
        name: 'aquaDownloadsFan',
        _isAquaDock: true,
        _blurType: null,
        _dockBlurEnabled: false,
        has_style_class_name(c) { return c === 'aqua-dl-fan'; },
    };
    assert(isAquaPopupTarget(fanTestTarget) === false, 'FanView must NOT be an Aqua popup target');
    assert(resolveAquaDockTarget(fanTestTarget) === null, 'resolveAquaDockTarget must return null for FanView');

    // Down-Chevron drawer anchor remains an Aqua popup target with frosted glass blur
    const anchorContainer = {
        get_name: () => 'aquaStackAnchor',
        name: 'aquaStackAnchor',
        _isAquaDock: true,
        _blurType: 'popup',
        _dockBg: null,
        _dockBlurRegion: null,
        _dockBlurEnabled: true,
        _dockRadius: 18,
        get_children: () => [],
        has_allocation: () => true,
        width: 48,
        height: 48,
        get_dock_radius: () => 18,
        insert_child_below() {},
        has_style_class_name(c) { return c === 'aqua-stack-anchor-tile'; },
    };
    anchorContainer._dockBg = anchorContainer;

    assert(isAquaPopupTarget(anchorContainer) === true,
        'isAquaPopupTarget must identify aquaStackAnchor as a popup blur target');
    assert(isAquaPopupTarget({ has_style_class_name: c => c === 'aqua-stack-anchor-tile' }) === true,
        'isAquaPopupTarget must identify .aqua-stack-anchor-tile as a popup blur target');

    const resolvedAnchor = resolveAquaDockTarget(anchorContainer);
    assert(resolvedAnchor !== null, 'resolveAquaDockTarget should resolve aquaStackAnchor target');
    assert(resolvedAnchor.background === anchorContainer, 'resolved background should point to anchorContainer');
    assert(resolvedAnchor.is_popup === true, 'resolved is_popup must be true for anchorContainer');

    // FanView Target Discovery
    const fanContainer = {
        get_name: () => 'aquaDownloadsFan',
        name: 'aquaDownloadsFan',
        _isAquaDock: true,
        _dockBg: null,
        _dockBlurRegion: null,
        _dockBlurEnabled: false,
        _dockRadius: 20,
        get_children: () => [],
        has_allocation: () => true,
        width: 320,
        height: 380,
        get_dock_radius: () => 20,
        insert_child_below() {},
    };
    fanContainer._dockBg = fanContainer;

    assert(resolveAquaDockTarget(fanContainer) === null,
        'resolveAquaDockTarget must return null for FanView when _dockBlurEnabled is false');

    // FanView Item Pill Target Discovery
    const fanItemPill = {
        name: 'aquaDownloadsFanPill',
        get_name: () => 'aquaDownloadsFanPill',
        _isAquaDock: true,
        _blurType: 'popup',
        _dockBlurEnabled: true,
        _dockBg: null,
        _dockContent: null,
        _dockContentParent: null,
        _dockBlurRegion: null,
        _dockRadius: 14,
        get_dock_radius: () => 14,
        width: 140,
        height: 32,
        has_allocation: () => true,
        insert_child_below() {},
        has_style_class_name(c) { return c === 'aqua-dl-fan-label-pill'; },
    };
    fanItemPill._dockBg = fanItemPill;
    fanItemPill._dockContent = fanItemPill;
    fanItemPill._dockContentParent = fanItemPill;

    assert(isAquaPopupTarget(fanItemPill) === true,
        'isAquaPopupTarget must identify aquaDownloadsFanPill as a popup blur target');
    assert(isAquaPopupTarget({ has_style_class_name: c => c === 'aqua-dl-fan-label-pill' }) === true,
        'isAquaPopupTarget must identify .aqua-dl-fan-label-pill as a popup blur target');

    const resolvedFanPill = resolveAquaDockTarget(fanItemPill);
    assert(resolvedFanPill !== null,
        'resolveAquaDockTarget must resolve Fan pill target when _dockBlurEnabled is true');
    assert(resolvedFanPill.is_popup === true,
        'resolvedFanPill must resolve as popup target');

    const fanItemRow = {
        get_name: () => 'aquaDownloadsFanItem',
        name: 'aquaDownloadsFanItem',
        _isAquaDock: true,
        _dockBg: fanItemPill,
        _dockBlurRegion: null,
        _dockBlurEnabled: false,
        _dockRadius: 14,
        get_dock_radius: () => 14,
        width: 220,
        height: 48,
        has_allocation: () => true,
        insert_child_below() {},
    };
    assert(resolveAquaDockTarget(fanItemRow) === null,
        'resolveAquaDockTarget must return null for Fan item when _dockBlurEnabled is false');

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

    registerBmsTarget(anchorContainer);
    assert(mockDashBlur.dashes.length === 1, 'registerBmsTarget should register anchorContainer into BMS dashes');

    unregisterBmsTarget(anchorContainer);
    assert(mockDashBlur.dashes.length === 0, 'unregisterBmsTarget should cleanly unregister anchorContainer');
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
        const fill = cfg.highContrast ? 'rgba(0,0,0,0.96)'
            : (cfg.downloadsPillColor ?? 'rgba(28,28,32,0.8)');

        const panel = new MockActor('panel');
        panel.set_style(`border-radius: ${radius}px; background-color: ${fill}; border: 1px solid rgba(255,255,255,0.16);`);

        panel._blurRegion = null;
        panel._dockBlurRegion = null;
        panel._dockBg = panel;
        panel._isAquaDock = true;
        panel._dockBlurEnabled = false;
        panel._dockRadius = radius;
        panel.get_dock_radius = () => radius;

        return { panel };
    }

    const cfgBlur = {
        blurEffect: true,
        downloadsBorderRadius: 24,
    };

    const { panel } = simulatePanelView(cfgBlur);
    assert(panel._isAquaDock === true, 'panel._isAquaDock must be true');
    assert(panel._dockBlurEnabled === false, 'panel._dockBlurEnabled must be false');
    assert(panel._dockBg === panel, 'panel._dockBg points to panel itself');
    assert(panel._dockRadius === 24, 'panel._dockRadius matches configured downloadsBorderRadius');
    assert(panel.effects.length === 0, 'panel must have NO native Shell.BlurEffect attached');
    assert(panel._blurRegion === null, 'panel must have NO blurRegion');
    assert(!panel.style.includes('background-color: transparent;'),
        'panel style must use solid background even when blurEffect is true');

    // Panel animation sync: open
    panel.ease({ opacity: 255, scale_x: 1, scale_y: 1, duration: 240 });
    assert(panel.opacity === 255, 'panel eases to opacity 255');

    // Settle animations
    panel.remove_all_transitions();
    panel.opacity = 255;
    assert(panel.opacity === 255, 'settle animations keeps panel opacity at 255');

    // Close animation
    panel.ease({ opacity: 0, duration: 200 });
    assert(panel.opacity === 0, 'panel eases out');

    // Panel with blurEffect: false fallback
    const { panel: panelOff } = simulatePanelView({
        ...cfgBlur,
        blurEffect: false,
    });
    assert(panelOff._isAquaDock === true, 'panelOff._isAquaDock is true');
    assert(panelOff._dockBlurEnabled === false, 'panelOff._dockBlurEnabled must be false when blurEffect is false');
    assert(!panelOff.style.includes('background-color: transparent;'),
        'panelOff style must use solid background when blurEffect is false');

    // Fan view simulation: pill blur enabled matching dock pill when blurEffect is true and BMS is active
    function simulateFanView(cfg, numItems = 3) {
        const radius = cfg.dlItemRadius ?? 16;
        const fan = new MockActor('fan');
        fan.name = 'aquaDownloadsFan';
        fan._isAquaDock = true;
        fan.set_style('background-color: transparent; border: none;');
        fan._dockBlurEnabled = false;

        const isBlur = Boolean(cfg.blurEffect) && Boolean(globalThis.global?.blur_my_shell);
        const items = [];

        for (let i = 0; i < numItems; i++) {
            const row = new MockActor(`fan-row-${i}`);
            row.name = 'aquaDownloadsFanItem';
            row.width = 200;
            row.height = 44;

            const labelPill = new MockActor(`label-pill-${i}`);
            labelPill.name = 'aquaDownloadsFanPill';
            labelPill._isAquaDock = true;
            labelPill._blurType = 'popup';
            labelPill._dockBlurEnabled = isBlur;
            labelPill.width = 120;
            labelPill.height = 28;
            labelPill._dockRadius = radius;
            labelPill.get_dock_radius = () => radius;

            const thumb = new MockActor(`thumb-${i}`);
            applyTileStyle(cfg, labelPill, new MockActor('label'), thumb, 8, false, '6px 14px', isBlur);

            row._isAquaDock = true;
            row._dockBlurEnabled = false;
            row._dockRadius = radius;
            row.get_dock_radius = () => radius;

            items.push({ row, labelPill, thumb });
        }

        fan._blurRegion = null;
        fan._blurRegions = [];

        return { fan, items };
    }

    const { fan, items } = simulateFanView(cfgBlur);
    assert(fan.name === 'aquaDownloadsFan', 'fan container name must be aquaDownloadsFan');
    assert(fan._isAquaDock === true, 'fan container must be marked as AquaDock');
    assert(fan._dockBlurEnabled === false, 'fan container must NOT have bounding blur enabled');
    assert(items.length === 3, 'fan view should have simulated item pills');
    for (const item of items) {
        assert(item.row._isAquaDock === true, 'item row must be marked as AquaDock');
        assert(item.row._dockBlurEnabled === false, 'item row blur must be disabled');
        assert(item.row._dockRadius === 16, 'item row _dockRadius matches item radius');
        assert(item.row.effects.length === 0, 'row has NO native blur effect attached');
        assert(item.labelPill._isAquaDock === true, 'labelPill is marked as AquaDock');
        assert(item.labelPill._dockBlurEnabled === false, 'labelPill blur must be disabled when BMS is absent');
        assert(!item.labelPill.style.includes('background-color: transparent;'),
            'item pill must have solid background when BMS is absent');
        assert(item.labelPill.style.includes('border-radius: 16px;'),
            'item pill must have rounded corners');
    }

    // Animation synchronization on pills
    for (const item of items) {
        item.row.ease({ opacity: 255, translation_x: 0, translation_y: 0, scale_x: 1, scale_y: 1 });
        assert(item.row.opacity === 255, 'pill eases in');
        assert(item.row.scale_x === 1, 'pill scales in');

        item.row.remove_all_transitions();
        item.row.opacity = 255;

        item.row.ease({ opacity: 0, scale_x: 0.4, scale_y: 0.4 });
        assert(item.row.opacity === 0, 'pill eases out');
        assert(item.row.scale_x === 0.4, 'pill scales out');
    }

    // Fan view fallback when blurEffect: false
    const { fan: fanOff, items: itemsOff } = simulateFanView({
        ...cfgBlur,
        blurEffect: false,
    });
    assert(fanOff._dockBlurEnabled === false, 'fanOff has bounding blur disabled');
    for (const item of itemsOff) {
        assert(item.row._dockBlurEnabled === false, 'item row blur must be disabled when blurEffect is false');
        assert(item.labelPill._dockBlurEnabled === false, 'item labelPill blur must be disabled when blurEffect is false');
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
        const normalFill = cfg.downloadsPillColor ?? (cfg.pillColor ? applyAlpha(cfg.pillColor, cfg.bgOpacity ?? 0.8) : `rgba(28,28,32,${a})`);
        const fill = cfg.highContrast ? 'rgba(0,0,0,0.96)' : normalFill;

        const panel = new MockActor('panel');
        panel.set_style(`border-radius: ${radius}px; background-color: ${fill}; border: 1px solid rgba(255,255,255,0.16);`);
        panel._blurRegion = null;
        panel._dockBlurRegion = null;
        panel._dockBg = panel;
        panel._isAquaDock = true;
        panel._dockBlurEnabled = false;
        panel._dockRadius = radius;
        return { panel, blurActive: false };
    }

    const panelNoBms = simulateRealPanelView({
        blurEffect: true,
        pillColor: 'rgba(28,28,32,0.80)',
        bgOpacity: 0.60,
    });
    assert(panelNoBms.blurActive === false, 'blurActive must be false');
    assert(panelNoBms.panel._dockBlurEnabled === false, 'panel._dockBlurEnabled must be false');
    assert(!panelNoBms.panel.style.includes('background-color: transparent;'),
        'panel must NOT have transparent background');
    assert(panelNoBms.panel.style.includes('background-color: rgba(28, 28, 32, 0.480);'),
        'panel must show normal transparency with configured pillColor and bgOpacity');

    function simulateRealFanView(cfg) {
        return simulateFanView(cfg, 2);
    }
    const fanNoBms = simulateRealFanView({ blurEffect: true });
    assert(fanNoBms.fan._dockBlurEnabled === false, 'fanNoBms bounding blur must be disabled');
    for (const item of fanNoBms.items) {
        assert(item.row._dockBlurEnabled === false, 'item row blur must be disabled');
        assert(item.blurRegion === undefined, 'item blurRegion must not exist');
        assert(!item.labelPill.style.includes('background-color: transparent;'),
            'item pill must NOT have transparent background');
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

    const blockerIdx = uiChildren.indexOf(blocker);
    const stackIdx = uiChildren.indexOf(stackView);
    const dockIdx = uiChildren.indexOf(dock);

    assert(blockerIdx >= 0 && stackIdx >= 0 && dockIdx >= 0,
        'all overlay and dock elements present in uiChildren');
    assert(blockerIdx < stackIdx, 'blocker must be below stackView');
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
    let suppressionCalls = [];
    let hideTooltipCalls = 0;
    mockHost.kickEngine = () => {};
    mockHost.hideTooltip = () => { hideTooltipCalls++; };
    mockHost.setMagnificationSuppressed = (s) => suppressionCalls.push(s);

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

    // 1st click: opens stack and suppresses magnification across dock (demagnifying folder)
    dlMgr.openFolderStack(mockItem, mockFolder);
    assert(dlMgr.stackOpen === true, 'openFolderStack opens stack on first click');
    assert(dlMgr.activeItem === mockItem, 'activeItem set to mockItem');
    assert(mockItem.isOpenState === true, 'setStackOpenState(true) called on item');
    assert(hideTooltipCalls > 0, 'hideTooltip called when stack opened');
    assert(suppressionCalls[suppressionCalls.length - 1] === true,
        'setMagnificationSuppressed(true) called on stack open');

    // 2nd click: toggles/closes stack and re-enables magnification
    dlMgr.openFolderStack(mockItem, mockFolder);
    assert(dlMgr.stackOpen === false, 'openFolderStack toggles closed on second click');
    assert(dlMgr.activeItem === null, 'activeItem cleared when closed');
    assert(mockItem.isOpenState === false, 'setStackOpenState(false) called on item when closed');
    assert(closedCount > 0, 'onClose/hide was called');
    assert(suppressionCalls[suppressionCalls.length - 1] === false,
        'setMagnificationSuppressed(false) called on stack close');

    // ── 7. Downloads & Folder Stack Blur Verification (Grid & List enabled, Fan disabled) ──
    {
        const {
            isAquaPopupTarget,
            isBmsStackBlurActive,
            resolveAquaDockTarget,
        } = await import('../dock/dockBlur.js');

        // Test popup target identification: Grid and List view panels ARE popup targets
        assert(isAquaPopupTarget({ name: 'aquaDownloadsPanel' }) === true,
            'isAquaPopupTarget must identify aquaDownloadsPanel as popup');
        assert(isAquaPopupTarget({ has_style_class_name: c => c === 'aqua-dl-panel' }) === true,
            'isAquaPopupTarget must identify .aqua-dl-panel as popup');
        assert(isAquaPopupTarget({ has_style_class_name: c => c === 'aqua-dl-grid' || c === 'aqua-dl-panel' }) === true,
            'isAquaPopupTarget must identify grid view stack as popup');
        assert(isAquaPopupTarget({ has_style_class_name: c => c === 'aqua-dl-list' || c === 'aqua-dl-panel' }) === true,
            'isAquaPopupTarget must identify list view stack as popup');

        // Fan view container must strictly NOT be a popup blur target (prevents giant bounding blur box)
        assert(isAquaPopupTarget({ name: 'aquaDownloadsFan' }) === false,
            'isAquaPopupTarget must NOT identify aquaDownloadsFan as popup');
        assert(isAquaPopupTarget({ has_style_class_name: c => c === 'aqua-dl-fan' }) === false,
            'isAquaPopupTarget must NOT identify .aqua-dl-fan as popup');

        // Fan view item label pill IS a popup blur target
        assert(isAquaPopupTarget({ name: 'aquaDownloadsFanPill' }) === true,
            'isAquaPopupTarget must identify aquaDownloadsFanPill as popup');
        assert(isAquaPopupTarget({ has_style_class_name: c => c === 'aqua-dl-fan-label-pill' }) === true,
            'isAquaPopupTarget must identify .aqua-dl-fan-label-pill as popup');

        // Test resolution of grid and list view stack targets
        const gridPanel = {
            name: 'aquaDownloadsPanel',
            _isAquaDock: true,
            _blurType: 'popup',
            _dockBlurEnabled: true,
            _dockRadius: 20,
            _dockBg: null,
            has_style_class_name: c => c === 'aqua-dl-panel' || c === 'aqua-dl-grid',
        };
        gridPanel._dockBg = gridPanel;
        const resolvedGrid = resolveAquaDockTarget(gridPanel);
        assert(resolvedGrid !== null, 'resolveAquaDockTarget must resolve grid stack target when _dockBlurEnabled is true');
        assert(resolvedGrid.is_popup === true, 'grid stack must resolve as is_popup');

        const listPanel = {
            name: 'aquaDownloadsPanel',
            _isAquaDock: true,
            _blurType: 'popup',
            _dockBlurEnabled: true,
            _dockRadius: 20,
            _dockBg: null,
            has_style_class_name: c => c === 'aqua-dl-panel' || c === 'aqua-dl-list',
        };
        listPanel._dockBg = listPanel;
        const resolvedList = resolveAquaDockTarget(listPanel);
        assert(resolvedList !== null, 'resolveAquaDockTarget must resolve list stack target when _dockBlurEnabled is true');
        assert(resolvedList.is_popup === true, 'list stack must resolve as is_popup');

        // Test Fan View pill blur target resolution when blur is active
        const fanPillTarget = {
            name: 'aquaDownloadsFanPill',
            _isAquaDock: true,
            _blurType: 'popup',
            _dockBlurEnabled: true,
            _dockRadius: 16,
            _dockBg: null,
            _dockContent: null,
            _dockContentParent: null,
            has_style_class_name: c => c === 'aqua-dl-fan-label-pill',
        };
        fanPillTarget._dockBg = fanPillTarget;
        fanPillTarget._dockContent = fanPillTarget;
        fanPillTarget._dockContentParent = fanPillTarget;
        const resolvedFanPillInSec7 = resolveAquaDockTarget(fanPillTarget);
        assert(resolvedFanPillInSec7 !== null, 'resolveAquaDockTarget must resolve fan pill target when _dockBlurEnabled is true');
        assert(resolvedFanPillInSec7.is_popup === true, 'fan pill must resolve as is_popup');

        // Test blur activation logic
        assert(isBmsStackBlurActive({ blurEffect: false }) === false,
            'isBmsStackBlurActive must return false when blurEffect is false');
        assert(isBmsStackBlurActive({ blurEffect: true, highContrast: true }) === false,
            'isBmsStackBlurActive must return false when highContrast is true');
    }

    // ── 8. FileItemMenu Anchor Alignment and Right-Click Triggers ─────────────
    {
        const { FileItemMenu } = await import(`file://${projectRoot}/downloads/fileItemMenu.js`);
        const St = (await import('gi://St')).default;
        const Clutter = (await import('gi://Clutter')).default;

        const fileMenu = new FileItemMenu({ x: 0, y: 0, width: 1920, height: 1080 }, {});

        // Test anchor resolution and right-click triggers
        let openedWithAnchor = null;
        fileMenu.openFor = (anchor, _file) => {
            openedWithAnchor = anchor;
        };

        const mockLabelPill = { name: 'mockLabelPill', height: 36, get_height: () => 36 };
        const mockRowBtn = {
            _labelPill: mockLabelPill,
            handlers: {},
            connect(sig, cb) { this.handlers[sig] = cb; },
            set_button_mask(mask) { this.mask = mask; },
        };

        fileMenu.attach(mockRowBtn, { get_uri: () => 'file:///tmp/test' }, () => {}, null);

        // 1. Right-click press event opens menu immediately anchored to _labelPill
        assert(typeof mockRowBtn.handlers['button-press-event'] === 'function',
            'attach must connect button-press-event for responsive right-click');
        const pressEvt = { get_button: () => Clutter.BUTTON_SECONDARY };
        const pressRes = mockRowBtn.handlers['button-press-event'](mockRowBtn, pressEvt);
        assert(pressRes === Clutter.EVENT_STOP, 'button-press-event must return EVENT_STOP');
        assert(openedWithAnchor === mockLabelPill,
            'right click press must open menu anchored to labelPill');

        // 2. Right-click clicked event fallback also opens anchored to labelPill
        openedWithAnchor = null;
        assert(typeof mockRowBtn.handlers['clicked'] === 'function',
            'attach must connect clicked event');
        mockRowBtn.handlers['clicked'](mockRowBtn, Clutter.BUTTON_SECONDARY);
        assert(openedWithAnchor === mockLabelPill,
            'clicked fallback must open menu anchored to labelPill');

        // 3. Test _setupAnchorAlignment positioning math
        const mockAnchor = {
            get_transformed_position: () => [800, 400],
            get_transformed_size: () => [140, 36],
            get_allocation_box: () => ({ x1: 800, y1: 400, get_width: () => 140, get_height: () => 36 }),
        };

        const mockBoxPointer = {
            _arrowSide: St.Side.RIGHT,
            get_preferred_size: () => [0, 0, 60, 32],
            get_parent: () => ({
                transform_stage_point: (sx, sy) => [true, sx, sy],
                get_parent: () => null,
            }),
            setArrowOrigin(orig) { this.arrowOrigin = orig; },
        };

        const mockMenu = { _boxPointer: mockBoxPointer, actor: mockBoxPointer };
        fileMenu._setupAnchorAlignment(mockMenu, mockAnchor);

        let allocatedOrigin = null;
        const mockAllocBox = {
            set_origin(x, y) { allocatedOrigin = [x, y]; },
        };

        // When _arrowSide is RIGHT (menu placed to the left of the pill):
        // pillCenterX = 800 + 70 = 870, pillCenterY = 400 + 18 = 418
        // resX = 800 - 60 - 8 = 732
        // resY = 418 - 32/2 = 402
        mockBoxPointer._reposition(mockAllocBox);
        assert(allocatedOrigin !== null, '_reposition must set allocation origin');
        assert(allocatedOrigin[0] === 732, `_reposition X must be 732 (got ${allocatedOrigin[0]})`);
        assert(allocatedOrigin[1] === 402, `_reposition Y must be 402 (got ${allocatedOrigin[1]})`);
        // Verify center alignment:
        const menuCenterY = allocatedOrigin[1] + 32 / 2;
        const pillCenterY = 400 + 36 / 2;
        assert(menuCenterY === pillCenterY,
            `menu vertical center (${menuCenterY}) must match pill vertical center (${pillCenterY})`);
        assert(mockBoxPointer.arrowOrigin === 16,
            'setArrowOrigin should be centered on menu height (16)');

        // When _arrowSide is LEFT (menu placed to the right of the pill):
        mockBoxPointer._arrowSide = St.Side.LEFT;
        mockBoxPointer._reposition(mockAllocBox);
        assert(allocatedOrigin[0] === 948, `_reposition X to the right must be 948 (got ${allocatedOrigin[0]})`);
        assert(allocatedOrigin[1] === 402, `_reposition Y must remain 402 (got ${allocatedOrigin[1]})`);
    }
}

// ── 9. ActorPool Recycling & Leak-Free Teardown ───────────────────────────────
{
    function createMockCard(name) {
        const classes = new Set();
        return {
            btn: {
                name,
                _isAquaDock: true,
                _dockBlurEnabled: false,
                _activate: null,
                _openFileMenu: null,
                _onHover: null,
                classes,
                add_style_class_name(c) { classes.add(c); },
                remove_style_class_name(c) { classes.delete(c); },
                has_style_class_name(c) { return classes.has(c); },
                remove_all_transitions() {},
                destroy() { this.destroyed = true; },
            },
            row: {
                name,
                _isAquaDock: true,
                _dockBlurEnabled: false,
                _activate: null,
                _openFileMenu: null,
                _onHover: null,
                classes,
                add_style_class_name(c) { classes.add(c); },
                remove_style_class_name(c) { classes.delete(c); },
                has_style_class_name(c) { return classes.has(c); },
                remove_all_transitions() {},
                destroy() { this.destroyed = true; },
            },
        };
    }

    const mockFactory = {
        createFanCard() {
            const card = createMockCard('aquaDownloadsFanItem');
            return {
                btn: card.btn,
                box: {},
                labelPill: {},
                label: { text: '' },
                gap: {},
                thumb: { get_child: () => ({}) },
                icon: {},
            };
        },
        createPanelCard(view) {
            const card = createMockCard(`aquaDownloadsPanelItem_${view}`);
            return {
                row: card.row,
                box: {},
                labelPill: {},
                label: { text: '' },
                gap: {},
                thumb: { get_child: () => ({}) },
                icon: {},
            };
        },
    };

    const pool = new ActorPool(16, mockFactory);
    const fanCard1 = pool.acquireFanItem();
    assert(fanCard1 && fanCard1.btn, 'acquireFanItem should return card with btn');
    assert(fanCard1.btn._isAquaDock === true, 'fan card must be tagged _isAquaDock');
    assert(fanCard1.btn._dockBlurEnabled === false,
        'fan card must have _dockBlurEnabled === false strictly per Invariant 1');

    fanCard1.btn._activate = () => 'test_activate';
    fanCard1.btn._openFileMenu = () => 'test_menu';
    fanCard1.btn._onHover = () => 'test_hover';
    fanCard1.btn.add_style_class_name('aqua-dl-fan-row-sel');

    pool.releaseFanItem(fanCard1.btn);
    assert(fanCard1.btn._activate === null, 'releaseFanItem must nullify _activate');
    assert(fanCard1.btn._openFileMenu === null, 'releaseFanItem must nullify _openFileMenu');
    assert(fanCard1.btn._onHover === null, 'releaseFanItem must nullify _onHover');
    assert(!fanCard1.btn.has_style_class_name('aqua-dl-fan-row-sel'), 'releaseFanItem must remove selection class');

    const fanCard2 = pool.acquireFanItem();
    assert(fanCard2.btn === fanCard1.btn, 're-acquired fan card must return pooled instance');

    const panelCard1 = pool.acquirePanelItem('grid');
    assert(panelCard1 && panelCard1.row, 'acquirePanelItem should return card with row');
    assert(panelCard1.row._dockBlurEnabled === false,
        'panel card must have _dockBlurEnabled === false strictly per Invariant 1');

    panelCard1.row._activate = () => 'test_activate';
    panelCard1.row._openFileMenu = () => 'test_menu';
    pool.releasePanelItem(panelCard1.row);
    assert(panelCard1.row._activate === null, 'releasePanelItem must nullify _activate');
    assert(panelCard1.row._openFileMenu === null, 'releasePanelItem must nullify _openFileMenu');

    const panelCard2 = pool.acquirePanelItem('list');
    assert(panelCard2.row === panelCard1.row, 're-acquired panel card must return pooled instance');

    pool.clear();
    assert(pool._fanPool.length === 0, 'pool.clear must empty _fanPool');
    assert(pool._panelPool.length === 0, 'pool.clear must empty _panelPool');
}

GLib.spawn_sync(null, ['rm', '-rf', tmpShellDir], null, GLib.SpawnFlags.SEARCH_PATH, null);

print('downloadsBlur: ok');
