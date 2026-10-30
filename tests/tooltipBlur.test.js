// Unit tests for Aqua Dock Pro tooltip blur and pure pill bubble geometry:
// - TooltipManager structure, container, bubble, label, and blurRegion (no arrow/beak)
// - Blur My Shell target resolution (aquaTooltip)
// - Bubble transparency when blur is active and fallback when blur is disabled/absent
// - High contrast mode override
// - Pure pill bubble orientation and positioning for all 4 dock sides (bottom, top, left, right)
// - Clean gap between the hovered icon and pill bubble
// - Strict dimension match between pill bubble and blur region
// - Rapid and slow hover switching between items without stale bounds or ghosting
// - Synchronous geometry notification (position, size, x, y, width, height) and transition cancellation
// - CSS color parser

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// Register temporary mock Shell resource for Main imports
const tmpShellDir = GLib.dir_make_tmp('aqua-tooltipblur-XXXXXX');
const mainJsPath = GLib.build_filenamev([tmpShellDir, 'main.js']);
const xmlPath = GLib.build_filenamev([tmpShellDir, 'shell.gresource.xml']);
const resPath = GLib.build_filenamev([tmpShellDir, 'shell.gresource']);

GLib.file_set_contents(mainJsPath,
    'export const extensionManager = null;\nexport const layoutManager = null;\nexport const overview = { visible: false };\nexport const uiGroup = { add_child() {}, insert_child_below() {}, set_child_above_sibling() {} };\n');
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

const { TooltipManager, parseCssColor } = await import('../interactions/tooltipManager.js');
const {
    resolveAquaDockTarget,
    setupBackgroundCorners,
    registerBmsTarget,
    unregisterBmsTarget,
    isBmsTooltipBlurActive,
    isAquaPopupTarget,
    addBlurForTarget,
    getBmsPopupSettings,
    AquaDockSurface,
} = await import('../dock/dockBlur.js');

// ── 1. CSS Color Parser ──────────────────────────────────────────────────────
{
    const hex3 = parseCssColor('#fff');
    assert(hex3[0] === 1 && hex3[1] === 1 && hex3[2] === 1 && hex3[3] === 1,
        'parseCssColor should parse #fff');

    const hex4 = parseCssColor('#fffa');
    assert(hex4[0] === 1 && Math.abs(hex4[3] - 170 / 255) < 0.01,
        'parseCssColor should parse #fffa with alpha');

    const hex6 = parseCssColor('#202024');
    assert(Math.abs(hex6[0] - 32 / 255) < 0.01 && Math.abs(hex6[1] - 32 / 255) < 0.01,
        'parseCssColor should parse #202024');

    const hex8 = parseCssColor('#20202480');
    assert(Math.abs(hex8[0] - 32 / 255) < 0.01 && Math.abs(hex8[3] - 128 / 255) < 0.01,
        'parseCssColor should parse #20202480 with alpha');

    const rgb = parseCssColor('rgb(32, 32, 36)');
    assert(Math.abs(rgb[0] - 32 / 255) < 0.01 && rgb[3] === 1.0,
        'parseCssColor should parse rgb(32, 32, 36) with alpha 1.0');

    const rgba = parseCssColor('rgba(32, 32, 36, 0.92)');
    assert(Math.abs(rgba[0] - 32 / 255) < 0.01 && Math.abs(rgba[3] - 0.92) < 0.001,
        'parseCssColor should parse rgba(32, 32, 36, 0.92)');

    const trans = parseCssColor('transparent');
    assert(trans[0] === 0 && trans[1] === 0 && trans[2] === 0 && trans[3] === 0,
        'parseCssColor should parse transparent as [0,0,0,0]');

    const white = parseCssColor('white');
    assert(white[0] === 1 && white[1] === 1 && white[2] === 1 && white[3] === 1,
        'parseCssColor should parse white');

    const black = parseCssColor('black');
    assert(black[0] === 0 && black[1] === 0 && black[2] === 0 && black[3] === 1,
        'parseCssColor should parse black');

    const rgbaPercent = parseCssColor('rgba(100%, 50%, 0%, 80%)');
    assert(rgbaPercent[0] === 1 && Math.abs(rgbaPercent[1] - 0.5) < 0.01 && rgbaPercent[2] === 0 && Math.abs(rgbaPercent[3] - 0.8) < 0.01,
        'parseCssColor should parse percentage rgba values');

    const rgbSpace = parseCssColor('rgb(32 32 36 / 0.92)');
    assert(Math.abs(rgbSpace[0] - 32 / 255) < 0.01 && Math.abs(rgbSpace[3] - 0.92) < 0.001,
        'parseCssColor should parse CSS Level 4 space-separated rgb syntax');

    const invalidHex = parseCssColor('#xyz', [0, 0, 0, 1]);
    assert(invalidHex[3] === 1, 'parseCssColor fallback on invalid hex');

    const noneColor = parseCssColor('none');
    assert(noneColor[0] === 0 && noneColor[1] === 0 && noneColor[2] === 0 && noneColor[3] === 0,
        'parseCssColor should parse none as transparent [0,0,0,0]');

    const fallback = parseCssColor(null, [0, 0, 0, 1]);
    assert(fallback[3] === 1, 'parseCssColor fallback on null');
}

// ── 2. BMS Discoverability for Tooltip Container ─────────────────────────────
{
    const tooltipBlurRegion = {
        width: 120,
        height: 32,
        has_allocation: () => true,
    };
    const tooltipBubble = {
        width: 120,
        height: 32,
        has_allocation: () => true,
        _dockRadius: 10,
        get_dock_radius: () => 10,
    };
    const tooltipContainer = {
        get_name: () => 'aquaTooltip',
        name: 'aquaTooltip',
        _isAquaDock: true,
        _dockBg: tooltipBubble,
        _dockContent: null,
        _dockBlurRegion: tooltipBlurRegion,
        _dockContentParent: null,
        _dockBlurEnabled: true,
        _dockRadius: 10,
        get_dock_radius: () => 10,
        width: 120,
        height: 32,
        has_allocation: () => true,
        insert_child_below() {},
    };
    tooltipContainer._dockContent = tooltipContainer;

    const resolved = resolveAquaDockTarget(tooltipContainer);
    assert(resolved !== null, 'resolveAquaDockTarget must resolve aquaTooltip target');
    assert(resolved.background === tooltipBubble, 'resolved background must point to tooltipBubble');
    assert(resolved.sibling === tooltipBlurRegion, 'resolved sibling must point to tooltipBlurRegion');
    assert(resolved.content === tooltipContainer, 'resolved content must point to tooltipContainer');

    // Blur disabled check
    tooltipContainer._dockBlurEnabled = false;
    assert(resolveAquaDockTarget(tooltipContainer) === null,
        'resolveAquaDockTarget must return null when _dockBlurEnabled is false');
    tooltipContainer._dockBlurEnabled = true;

    // Test runtime in-memory BMS registration
    const mockDashBlur = {
        enabled: true,
        is_static: false,
        settings: { dash_to_dock: { STATIC_BLUR: false, PIPELINE: 'default' } },
        dashes: [],
        add_blur(dash_container, target) {
            return {
                background: { x: 0, y: 0, width: 120, height: 32, set_position() {}, set_size() {}, set_clip() {} },
                background_group: { parent: dash_container, get_parent() { return this.parent; }, destroy() {} },
                bg_manager: { destroy() {} },
                pipeline: { set_corner_radius() {}, destroy() {} },
                rounded_pipeline: null,
                corner_settings: { radius: 10, corners: 0 },
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

    registerBmsTarget(tooltipContainer);
    assert(mockDashBlur.dashes.length === 1, 'registerBmsTarget should register tooltip into BMS dashes');
    assert(tooltipContainer._aquaDockSurface !== null, 'container should have _aquaDockSurface assigned');
    const existingSurface = tooltipContainer._aquaDockSurface;
    // Re-registering with matching background and parent should preserve _aquaDockSurface
    registerBmsTarget(tooltipContainer);
    assert(tooltipContainer._aquaDockSurface === existingSurface, 're-registration preserves _aquaDockSurface');
    unregisterBmsTarget(tooltipContainer);
    assert(mockDashBlur.dashes.length === 0, 'unregisterBmsTarget should cleanly unregister tooltip');
    assert(tooltipContainer._aquaDockSurface === null, '_aquaDockSurface cleaned up on unregister');
    delete globalThis.global.blur_my_shell;
}

// ── 3. TooltipManager Construction, Styling, and Transparency ────────────────
{
    class MockActor {
        constructor(name) {
            this.name = name;
            this.style = '';
            this.visible = false;
            this.opacity = 255;
            this.width = 100;
            this.height = 30;
            this.x = 0;
            this.y = 0;
            this._text = '';
            this.children = [];
            this.parent = null;
            this.style_classes = new Set();
            this.aboveSiblingCalls = [];
            this.belowSiblingCalls = [];
            this.transitionsRemoved = 0;
            this.notifiedProps = [];
            this.emittedSignals = [];
            this.clutter_text = {
                ellipsize: 3,
                line_wrap: true,
                x_align: 0,
                set_ellipsize(m) { this.ellipsize = m; },
                set_line_wrap(w) { this.line_wrap = w; },
                set_x_align(a) { this.x_align = a; },
            };
        }
        get_clutter_text() { return this.clutter_text; }
        get text() { return this._text; }
        set text(t) {
            this._text = t;
            if (this.name === 'aquaTooltipLabel') {
                this.width = t ? Math.max(12, t.length * 8) : 0;
                this.height = t ? 16 : 0;
            }
        }
        get_name() { return this.name; }
        set_style(s) { this.style = s; }
        show() {
            this.showAtX = this.x;
            this.showAtY = this.y;
            this.visible = true;
        }
        hide() { this.visible = false; }
        set_size(w, h) {
            this.width = w >= 0 ? w : (this._text ? Math.max(12, this._text.length * 8) : (this.child ? this.child.width + 24 : 100));
            this.height = h >= 0 ? h : (this._text ? 16 : (this.child ? this.child.height + 10 : 30));
        }
        set_position(x, y) { this.x = x; this.y = y; }
        add_child(child) { child.parent = this; this.children.push(child); }
        insert_child_below(child, sibling) {
            child.parent = this;
            const idx = sibling ? this.children.indexOf(sibling) : -1;
            if (idx !== -1) this.children.splice(idx, 0, child);
            else this.children.push(child);
        }
        set_child(child) { child.parent = this; this.child = child; }
        get_parent() { return this.parent; }
        get_preferred_width() {
            if (this.child) {
                const [, cw] = this.child.get_preferred_width();
                return [0, cw + 24];
            }
            return [0, this.width];
        }
        get_preferred_height() {
            if (this.child) {
                const [, ch] = this.child.get_preferred_height();
                return [0, ch + 10];
            }
            return [0, this.height];
        }
        get_transformed_position() { return [this.x, this.y]; }
        get_transformed_size() { return [this.width, this.height]; }
        destroy() { this.destroyed = true; }
        queue_repaint() { this.repainted = true; }
        add_style_class_name(cls) { this.style_classes.add(cls); }
        remove_style_class_name(cls) { this.style_classes.delete(cls); }
        remove_all_transitions() { this.transitionsRemoved++; }
        notify(prop) { this.notifiedProps.push(prop); }
        emit(sig) { this.emittedSignals.push(sig); }
        set_child_above_sibling(child, sibling) {
            this.aboveSiblingCalls.push({ child: child?.name, sibling: sibling?.name ?? null });
        }
        set_child_below_sibling(child, sibling) {
            this.belowSiblingCalls.push({ child: child?.name, sibling: sibling?.name ?? null });
        }
    }

    let currentCfg = {
        showTooltip: true,
        tooltipDelay: 100,
        tooltipRadius: 6,
        tooltipBg: 'rgba(32,32,36,0.92)',
        tooltipFg: 'rgba(242,242,244,1.0)',
        tooltipBorderWidth: 1,
        tooltipBorderColor: 'rgba(255,255,255,0.16)',
        blurEffect: true,
        highContrast: false,
    };

    let hoveredItem = {
        label: () => 'Files',
        _icon: new MockActor('icon'),
    };
    hoveredItem._icon.x = 200;
    hoveredItem._icon.y = 800;
    hoveredItem._icon.width = 48;
    hoveredItem._icon.height = 48;

    const monitor = { x: 0, y: 0, width: 1920, height: 1080 };

    // Test with BMS active
    let bmsUpdated = 0;
    globalThis.global = {
        blur_my_shell: {
            _dash_to_dock_blur: {
                enabled: true,
                dashes: [],
                add_blur() {
                    return {
                        background: new MockActor('bg'),
                        background_group: new MockActor('bgGroup'),
                        bg_manager: { destroy() {} },
                        pipeline: { set_corner_radius() {}, destroy() {} },
                        rounded_pipeline: null,
                        corner_settings: { radius: 10, corners: 0 },
                    };
                },
                try_blur() {},
                update_background() { bmsUpdated++; },
            },
        },
    };

    const actors = {
        container: new MockActor('aquaTooltip'),
        bubble: new MockActor('aquaTooltipBubble'),
        label: new MockActor('aquaTooltipLabel'),
        blurRegion: new MockActor('aquaTooltipBlurRegion'),
    };
    const mockParent = new MockActor('uiGroup');
    mockParent.add_child(actors.container);
    mockParent.add_child(actors.blurRegion);

    const mgr = new TooltipManager(() => currentCfg, () => hoveredItem, () => monitor, actors);
    assert(mgr.container !== null, 'TooltipManager has container');
    assert(mgr.bubble !== null, 'TooltipManager has bubble');
    assert(mgr.label !== null, 'TooltipManager has label');
    assert(mgr.blurRegion !== null, 'TooltipManager has blurRegion');
    assert(mgr.arrow === undefined, 'TooltipManager must NOT have an arrow actor');

    // Container should host ONLY the bubble, no arrow child
    assert(actors.container.children.length === 1 && actors.container.children[0] === actors.bubble,
        'container must host only the pill bubble (no arrow child)');

    mgr.style();
    assert(mgr.blurActive === true, 'blurActive must be true when blurEffect and BMS are enabled');
    assert(mgr.bubble.style.includes('background-color: transparent;'),
        'bubble must have transparent background when blur is active');
    assert(mgr.bubble.style.includes('border-radius: 6px;'),
        'bubble must retain border-radius when blur is active');
    assert(mgr.container._dockBlurEnabled === true,
        'container._dockBlurEnabled must be true when blur is active');

    const resolvedMgr = resolveAquaDockTarget(mgr.container);
    assert(resolvedMgr !== null, 'resolveAquaDockTarget must resolve mgr.container');
    assert(resolvedMgr.background === mgr.blurRegion,
        'resolved background must point to mgr.blurRegion');
    assert(resolvedMgr.content === mgr.container,
        'resolved content must point to mgr.container');
    assert(resolvedMgr.sibling === mgr.blurRegion,
        'resolved sibling must point to mgr.blurRegion');

    // Test fallback when blurEffect is false
    currentCfg.blurEffect = false;
    mgr.style();
    assert(mgr.blurActive === false, 'blurActive must be false when blurEffect is false');
    assert(mgr.bubble.style.includes('background-color: rgba(32,32,36,0.92);'),
        'bubble must fallback to normal background color when blurEffect is false');
    assert(!mgr.bubble.style.includes('background-color: transparent;'),
        'bubble must NOT be transparent when blurEffect is false');
    assert(mgr.container._dockBlurEnabled === false,
        'container._dockBlurEnabled must be false when blurEffect is false');

    // Test fallback when BMS is disabled/absent even if blurEffect is true
    delete globalThis.global.blur_my_shell;
    currentCfg.blurEffect = true;
    mgr.style();
    assert(mgr.blurActive === false, 'blurActive must be false when BMS is absent');
    assert(mgr.bubble.style.includes('background-color: rgba(32,32,36,0.92);'),
        'bubble must fallback to normal background color when BMS is absent');
    assert(!mgr.bubble.style.includes('background-color: transparent;'),
        'bubble must NOT be transparent when BMS is absent');

    // Test high contrast override
    currentCfg.highContrast = true;
    mgr.style();
    assert(mgr.blurActive === false, 'blurActive must be false in high contrast mode');
    assert(mgr.bubble.style.includes('background-color: rgba(0,0,0,0.98);'),
        'bubble must use high contrast background');
    assert(mgr.bubble.style.includes('#ffffff'),
        'bubble must use high contrast border color');
    currentCfg.highContrast = false;

    // Re-enable BMS
    globalThis.global = {
        blur_my_shell: {
            _dash_to_dock_blur: {
                enabled: true,
                dashes: [],
                add_blur() {
                    return {
                        background: new MockActor('bg'),
                        background_group: new MockActor('bgGroup'),
                        bg_manager: { destroy() {} },
                        pipeline: { set_corner_radius() {}, destroy() {} },
                        rounded_pipeline: null,
                        corner_settings: { radius: 10, corners: 0 },
                    };
                },
                try_blur() {},
                update_background() { bmsUpdated++; },
            },
        },
    };
    currentCfg.blurEffect = true;
    mgr.style();
    assert(mgr.blurActive === true, 'blurActive re-enabled');

    // ── 4. Pure Rounded Pill Bubble Placement for all 4 Dock Sides ──────────────
    mockParent.aboveSiblingCalls = [];
    mgr.show(hoveredItem, { side: 'bottom', vert: false });
    assert(mgr.shown === true, 'TooltipManager.shown is true after show()');
    assert(mgr.side === 'bottom', 'side is bottom when dock is at bottom');

    // Bottom dock: pill bubble placed above icon with clean 8px gap
    const gap = 8;
    assert(mgr.container.y === hoveredItem._icon.y - mgr.container.height - gap,
        `container must sit exactly ${gap}px above the hovered icon in bottom dock`);
    assert(mgr.bubble.x === 0 && mgr.bubble.y === 0,
        'bubble must sit flush at (0, 0) inside container');
    assert(mgr.bubble.width === mgr.container.width && mgr.bubble.height === mgr.container.height,
        'bubble dimensions must match container dimensions exactly');
    assert(mgr.blurRegion.x === mgr.container.x && mgr.blurRegion.y === mgr.container.y,
        'blurRegion position must strictly match container position');
    assert(mgr.blurRegion.width === mgr.container.width && mgr.blurRegion.height === mgr.container.height,
        'blurRegion size must strictly match container pill dimensions with no protrusion or beak offset');

    // Z-order: blurRegion raised, container placed above blurRegion
    assert(mockParent.aboveSiblingCalls.some(c => c.child === 'aquaTooltipBlurRegion' && c.sibling === null),
        'blurRegion must be raised above siblings');
    assert(mockParent.aboveSiblingCalls.some(c => c.child === 'aquaTooltip' && c.sibling === 'aquaTooltipBlurRegion'),
        'container must be placed above blurRegion');

    // Top dock: pill bubble placed below icon with clean 8px gap
    mgr.position(hoveredItem, { side: 'top', vert: false });
    assert(mgr.side === 'top', 'side is top when dock is at top');
    assert(mgr.container.y === hoveredItem._icon.y + hoveredItem._icon.height + gap,
        `container must sit exactly ${gap}px below the hovered icon in top dock`);
    assert(mgr.bubble.x === 0 && mgr.bubble.y === 0, 'bubble at (0, 0) for top dock');
    assert(mgr.blurRegion.x === mgr.container.x && mgr.blurRegion.y === mgr.container.y,
        'blurRegion position must match container for top dock');
    assert(mgr.blurRegion.width === mgr.container.width && mgr.blurRegion.height === mgr.container.height,
        'blurRegion size must match container for top dock');

    // Left dock: pill bubble placed to the right of icon with clean 8px gap
    mgr.position(hoveredItem, { side: 'left', vert: true });
    assert(mgr.side === 'left', 'side is left when dock is at left');
    assert(mgr.container.x === hoveredItem._icon.x + hoveredItem._icon.width + gap,
        `container must sit exactly ${gap}px to the right of the hovered icon in left dock`);
    assert(mgr.bubble.x === 0 && mgr.bubble.y === 0, 'bubble at (0, 0) for left dock');
    assert(mgr.blurRegion.x === mgr.container.x && mgr.blurRegion.y === mgr.container.y,
        'blurRegion position must match container for left dock');
    assert(mgr.blurRegion.width === mgr.container.width && mgr.blurRegion.height === mgr.container.height,
        'blurRegion size must match container for left dock');

    // Right dock: pill bubble placed to the left of icon with clean 8px gap
    mgr.position(hoveredItem, { side: 'right', vert: true });
    assert(mgr.side === 'right', 'side is right when dock is at right');
    assert(mgr.container.x === hoveredItem._icon.x - mgr.container.width - gap,
        `container must sit exactly ${gap}px to the left of the hovered icon in right dock`);
    assert(mgr.bubble.x === 0 && mgr.bubble.y === 0, 'bubble at (0, 0) for right dock');
    assert(mgr.blurRegion.x === mgr.container.x && mgr.blurRegion.y === mgr.container.y,
        'blurRegion position must match container for right dock');
    assert(mgr.blurRegion.width === mgr.container.width && mgr.blurRegion.height === mgr.container.height,
        'blurRegion size must match container for right dock');

    // Edge clamping: icon at far right of monitor
    hoveredItem._icon.x = 1910;
    mgr.position(hoveredItem, { side: 'bottom', vert: false });
    assert(mgr.container.x + mgr.container.width <= monitor.width - 4,
        'pill bubble must remain clamped within monitor boundary');
    assert(mgr.blurRegion.x === mgr.container.x,
        'blurRegion must track container clamp position');

    // Empty label check: tooltip hides when item has empty or null label
    const emptyItem = { label: () => '', _icon: new MockActor('icon') };
    mgr.show(emptyItem, { side: 'bottom', vert: false });
    assert(mgr.shown === false, 'TooltipManager should hide when label is empty');

    // Short label check: minimum width clamped to ensure corners fit
    const shortItem = { label: () => 'A', _icon: new MockActor('icon') };
    actors.bubble.width = 10;
    actors.bubble.height = 10;
    mgr.show(shortItem, { side: 'bottom', vert: false });
    assert(mgr.shown === true, 'TooltipManager shown for short label');
    const shortW = mgr.bubble.width;
    assert(shortW >= 2 * currentCfg.tooltipRadius,
        'bubble width must clamp to minimum required for corners');

    // Full label text sizing (e.g. "System Settings"): no premature truncation or ellipses
    const settingsItem = {
        label: () => 'System Settings',
        _icon: new MockActor('icon'),
    };
    settingsItem._icon.x = 500;
    settingsItem._icon.y = 800;
    settingsItem._icon.width = 48;
    settingsItem._icon.height = 48;

    mgr.show(settingsItem, { side: 'bottom', vert: false });
    assert(mgr.shown === true, 'TooltipManager shown for System Settings');
    assert(mgr.label.text === 'System Settings', 'label text must be full unabbreviated "System Settings"');
    assert(mgr.label.clutter_text.ellipsize === 0, 'ellipsize must be NONE (0) so text is never truncated to ellipses');
    assert(mgr.label.clutter_text.line_wrap === false, 'line_wrap must be false');
    assert(mgr.bubble.width >= 120 + 24,
        'bubble width must accommodate full "System Settings" text (120px) plus padding (24px)');
    assert(mgr.bubble.width > shortW,
        'System Settings bubble width must be strictly larger than short label width');

    // Invalidate monitor resets cached metrics
    mgr.invalidateMonitor();
    assert(mgr._mon === null && mgr._w === null && mgr._h === null,
        'invalidateMonitor must reset monitor and dimension cache');

    // ── 5. Hover Switching Between Items Without Stale Bounds or Ghosting ────────
    // Reset trackers
    actors.container.transitionsRemoved = 0;
    actors.bubble.transitionsRemoved = 0;
    actors.label.transitionsRemoved = 0;
    actors.blurRegion.transitionsRemoved = 0;
    actors.container.notifiedProps = [];
    actors.blurRegion.notifiedProps = [];

    // Switch from "System Settings" to "Files" while already visible (mgr.shown === true)
    hoveredItem._icon.x = 220;
    hoveredItem._icon.y = 800;
    hoveredItem._icon.width = 48;
    hoveredItem._icon.height = 48;

    mgr.scheduleShow(hoveredItem, { side: 'bottom', vert: false });

    // 1. Label text must immediately be updated to "Files"
    assert(mgr.label.text === 'Files', 'label text must immediately update to new item');

    // 2. Bubble, container, and blurRegion must all immediately resize to "Files" dimensions
    assert(mgr.bubble.width < 120, 'bubble width must immediately shrink from "System Settings" width');
    assert(mgr.container.width === mgr.bubble.width, 'container width must match bubble width');
    assert(mgr.blurRegion.width === mgr.bubble.width, 'blurRegion width must match bubble width');
    assert(mgr.blurRegion.height === mgr.bubble.height, 'blurRegion height must match bubble height');

    // 3. Container and blurRegion positions must synchronously update to new icon
    const expectedX = Math.round(hoveredItem._icon.x + 24 - mgr.container.width * 0.5);
    const expectedY = Math.round(hoveredItem._icon.y - mgr.container.height - gap);
    assert(mgr.container.x === expectedX && mgr.container.y === expectedY,
        `container position (${mgr.container.x}, ${mgr.container.y}) must match icon anchor (${expectedX}, ${expectedY})`);
    assert(mgr.blurRegion.x === mgr.container.x && mgr.blurRegion.y === mgr.container.y,
        'blurRegion position must synchronously match container position');

    // 4. Lingering transitions must be cancelled on container, bubble, label, blurRegion, and BMS background
    assert(actors.container.transitionsRemoved > 0, 'transitions must be removed on container on item switch');
    assert(actors.bubble.transitionsRemoved > 0, 'transitions must be removed on bubble on item switch');
    assert(actors.label.transitionsRemoved > 0, 'transitions must be removed on label on item switch');
    assert(actors.blurRegion.transitionsRemoved > 0, 'transitions must be removed on blurRegion on item switch');
    const surface = actors.container._aquaDockSurface;
    assert(surface !== null, 'container._aquaDockSurface must exist');
    assert(surface.background.transitionsRemoved > 0, 'transitions must be removed on BMS background on item switch');
    assert(surface.background_group.transitionsRemoved > 0, 'transitions must be removed on BMS background_group on item switch');
    assert(surface.background.x === mgr.container.x && surface.background.y === mgr.container.y,
        'BMS background position must match container');
    assert(surface.background.width === mgr.container.width && surface.background.height === mgr.container.height,
        'BMS background size must match container');

    // 5. GObject properties must be notified synchronously on both container and blurRegion
    const requiredProps = ['position', 'size', 'x', 'y', 'width', 'height'];
    for (const p of requiredProps) {
        assert(actors.container.notifiedProps.includes(p),
            `container must notify GObject property "${p}" for BMS`);
        assert(actors.blurRegion.notifiedProps.includes(p),
            `blurRegion must notify GObject property "${p}" for BMS`);
    }

    // 6. Slow hover / magnification tracking (scale change from 1.0 to 1.5):
    actors.container.notifiedProps = [];
    actors.blurRegion.notifiedProps = [];
    hoveredItem._icon.x = 208;
    hoveredItem._icon.y = 776;
    hoveredItem._icon.width = 72;
    hoveredItem._icon.height = 72;

    mgr.position(hoveredItem, { side: 'bottom', vert: false });
    assert(mgr.container.x === mgr.blurRegion.x && mgr.container.y === mgr.blurRegion.y,
        'container and blurRegion must remain in lockstep during magnification');
    assert(mgr.container.width === mgr.blurRegion.width && mgr.container.height === mgr.blurRegion.height,
        'container and blurRegion sizes must match during magnification');
    assert(mgr.container.y === hoveredItem._icon.y - mgr.container.height - gap,
        'container must track magnified icon top edge with gap');

    // 7. Rapid hover switching between 3 items
    const item1 = { label: () => 'Terminal', _icon: new MockActor('icon1') };
    item1._icon.x = 300; item1._icon.y = 800; item1._icon.width = 48; item1._icon.height = 48;
    const item2 = { label: () => 'Music', _icon: new MockActor('icon2') };
    item2._icon.x = 360; item2._icon.y = 800; item2._icon.width = 48; item2._icon.height = 48;
    const item3 = { label: () => 'Calculator', _icon: new MockActor('icon3') };
    item3._icon.x = 420; item3._icon.y = 800; item3._icon.width = 48; item3._icon.height = 48;

    mgr.scheduleShow(item1, { side: 'bottom', vert: false });
    mgr.scheduleShow(item2, { side: 'bottom', vert: false });
    mgr.scheduleShow(item3, { side: 'bottom', vert: false });

    assert(mgr.shown === true, 'tooltip remains shown during rapid switching');
    assert(mgr.label.text === 'Calculator', 'tooltip immediately reflects final hovered item');
    assert(mgr.container.x === mgr.blurRegion.x && mgr.container.y === mgr.blurRegion.y,
        'container and blurRegion remain perfectly aligned after rapid hover switching');

    // 8. Clean departure / hide
    assert(surface.background_group.visible === true, 'background_group visible before hide');
    mgr.hide();
    assert(mgr.shown === false, 'shown is false after hide');
    assert(actors.container.visible === false, 'container hidden after hide');
    assert(actors.blurRegion.visible === false, 'blurRegion hidden after hide');
    assert(surface.background_group.visible === false, 'surface background_group must be synchronously hidden on hide()');
    assert(isNaN(mgr._x) && isNaN(mgr._y), 'cached coordinates cleared on hide');
    assert(mgr._w === null && mgr._h === null, 'cached dimensions cleared on hide');

    // 8b. Zero-lag wake from hidden state (no stale flash at old coordinates)
    actors.container.x = 999;
    actors.container.y = 999;
    actors.blurRegion.x = 999;
    actors.blurRegion.y = 999;
    const wakeItem = { label: () => 'Files', _icon: new MockActor('wakeIcon') };
    wakeItem._icon.x = 100;
    wakeItem._icon.y = 800;
    wakeItem._icon.width = 48;
    wakeItem._icon.height = 48;
    mgr.show(wakeItem, { side: 'bottom', vert: false });
    assert(mgr.shown === true, 'shown after wake');
    const wakeExpectedX = Math.round(wakeItem._icon.x + 24 - mgr.container.width * 0.5);
    const wakeExpectedY = Math.round(wakeItem._icon.y - mgr.container.height - gap);
    assert(actors.container.showAtX === wakeExpectedX,
        `container must be positioned at new icon (${wakeExpectedX}) BEFORE show(), got ${actors.container.showAtX}`);
    assert(actors.blurRegion.showAtX === wakeExpectedX,
        `blurRegion must be positioned at new icon (${wakeExpectedX}) BEFORE show(), got ${actors.blurRegion.showAtX}`);
    assert(surface.background.x === wakeExpectedX && surface.background.y === wakeExpectedY,
        'surface.background must match new icon on wake');

    // 8c. Direct sibling coordinate calculation without stale transform matrix
    actors.blurRegion.apply_relative_transform_to_point = () => {
        throw new Error('apply_relative_transform_to_point should not be called for direct siblings!');
    };
    surface.update_size();
    assert(surface.background.x === wakeExpectedX && surface.background.y === wakeExpectedY,
        'surface.background must resolve directly via sibling offsets without matrix transform');
    delete actors.blurRegion.apply_relative_transform_to_point;

    // 9. Destroy and style class cleanup
    actors.bubble.add_style_class_name('transparent-dash');
    actors.container.add_style_class_name('transparent-dash');
    actors.blurRegion.add_style_class_name('transparent-dash');
    mgr.destroy();
    assert(mgr.container === null && mgr.blurRegion === null,
        'TooltipManager cleanly cleans up actors on destroy()');
    assert(!actors.bubble.style_classes.has('transparent-dash'),
        'transparent-dash must be removed from bubble on destroy');
    assert(!actors.container.style_classes.has('transparent-dash'),
        'transparent-dash must be removed from container on destroy');
    assert(!actors.blurRegion.style_classes.has('transparent-dash'),
        'transparent-dash must be removed from blurRegion on destroy');

    // 10. Actor initial visibility state
    const freshActors = {
        container: new MockActor('c'),
        bubble: new MockActor('b'),
        label: new MockActor('l'),
        blurRegion: new MockActor('br'),
    };
    const defaultMgr = new TooltipManager(() => currentCfg, null, null, freshActors);
    assert(defaultMgr.blurRegion.visible === false, 'blurRegion must be hidden on init');
    assert(defaultMgr.container.visible === false, 'container must be hidden on init');
    defaultMgr.destroy();
}

// ── 11. Tooltip Follows Context Menu / Popup Blur Pipeline ──────────────────
{
    // A. isBmsTooltipBlurActive behavior
    globalThis.global = {
        blur_my_shell: {
            _popup: { enabled: true },
            _dash_to_dock_blur: { enabled: false },
        },
    };
    assert(isBmsTooltipBlurActive({ blurEffect: true }) === true,
        'isBmsTooltipBlurActive must be true when popup blur is active, even if dash blur is disabled');
    assert(isBmsTooltipBlurActive({ blurEffect: false }) === false,
        'isBmsTooltipBlurActive must be false when blurEffect is false');
    assert(isBmsTooltipBlurActive({ blurEffect: true, highContrast: true }) === false,
        'isBmsTooltipBlurActive must be false when highContrast is true');

    globalThis.global.blur_my_shell._popup.enabled = false;
    globalThis.global.blur_my_shell._dash_to_dock_blur.enabled = true;
    assert(isBmsTooltipBlurActive({ blurEffect: true }) === true,
        'isBmsTooltipBlurActive must be true when dash blur is active');

    globalThis.global.blur_my_shell._dash_to_dock_blur.enabled = false;
    assert(isBmsTooltipBlurActive({ blurEffect: true }) === false,
        'isBmsTooltipBlurActive must be false when both popup and dash blur are disabled');

    // B. isAquaPopupTarget classification
    const tooltipActor = { name: 'aquaTooltip' };
    const menuActor = { name: 'aquaMenu' };
    const dockActor = { name: 'aquaDockContainer' };
    const customPopupActor = { _blurType: 'popup' };
    const customDockActor = { _blurType: 'dock' };

    assert(isAquaPopupTarget(tooltipActor) === true, 'aquaTooltip must be identified as popup target');
    assert(isAquaPopupTarget(menuActor) === true, 'aquaMenu must be identified as popup target');
    assert(isAquaPopupTarget(customPopupActor) === true, '_blurType popup must be identified as popup target');
    assert(isAquaPopupTarget(dockActor) === false, 'aquaDockContainer must not be identified as popup target');
    assert(isAquaPopupTarget(customDockActor) === false, '_blurType dock must not be identified as popup target');

    // C. addBlurForTarget pipeline delegation
    let capturedStatic = null;
    let capturedPipeline = null;
    const mockDashBlur = {
        enabled: true,
        settings: {
            dash_to_dock: { STATIC_BLUR: true, PIPELINE: 'dash_pipeline_heavy' },
            popup: { STATIC_BLUR: false, PIPELINE: 'popup_pipeline_light' },
        },
        add_blur(container, target) {
            capturedStatic = this.settings.dash_to_dock.STATIC_BLUR;
            capturedPipeline = this.settings.dash_to_dock.PIPELINE;
            return {
                background: { set_position() {}, set_size() {}, set_clip() {} },
                background_group: { get_parent: () => null, destroy() {} },
                bg_manager: { destroy() {} },
                pipeline: {
                    change_pipeline_to(p) { this.current = p; },
                    set_corner_radius() {},
                    destroy() {},
                },
                rounded_pipeline: capturedStatic ? { update() {}, destroy() {} } : null,
                corner_settings: { radius: 6 },
            };
        },
        dashes: [],
    };

    // Tooltip should follow popup settings (STATIC_BLUR: false, PIPELINE: 'popup_pipeline_light')
    const tooltipTarget = { content: tooltipActor, background: tooltipActor, is_popup: true };
    const tooltipBlur = addBlurForTarget(mockDashBlur, tooltipActor, tooltipTarget);
    assert(capturedStatic === false, 'tooltip must receive popup STATIC_BLUR (false), not dash STATIC_BLUR');
    assert(capturedPipeline === 'popup_pipeline_light',
        'tooltip must receive popup PIPELINE (popup_pipeline_light), not dash PIPELINE');
    assert(tooltipBlur.rounded_pipeline === null, 'dynamic blur must not have rounded_pipeline');

    // Main dock should continue to use dash settings (STATIC_BLUR: true, PIPELINE: 'dash_pipeline_heavy')
    const dockTarget = { content: dockActor, background: dockActor, is_popup: false };
    const dockBlur = addBlurForTarget(mockDashBlur, dockActor, dockTarget);
    assert(capturedStatic === true, 'dock must receive dash STATIC_BLUR (true)');
    assert(capturedPipeline === 'dash_pipeline_heavy', 'dock must receive dash PIPELINE');
    assert(dockBlur.rounded_pipeline !== null, 'static blur must have rounded_pipeline');

    // D. AquaDockSurface for tooltip: update_pipeline and is_static
    const tooltipSurface = new AquaDockSurface(mockDashBlur, tooltipActor, tooltipTarget, tooltipBlur);
    assert(tooltipSurface.is_static === false, 'tooltip surface is_static must be false');
    assert(tooltipSurface._isPopupType === true, 'tooltip surface _isPopupType must be true');

    // Update pipeline should pull from popup settings
    tooltipSurface.update_pipeline();
    assert(tooltipSurface.pipeline.current === 'popup_pipeline_light',
        'AquaDockSurface update_pipeline on tooltip must set popup pipeline');

    // If popup pipeline changes, update_pipeline updates to the new popup pipeline
    mockDashBlur.settings.popup.PIPELINE = 'popup_pipeline_custom_frosted';
    tooltipSurface.update_pipeline();
    assert(tooltipSurface.pipeline.current === 'popup_pipeline_custom_frosted',
        'AquaDockSurface update_pipeline on tooltip must follow changed popup pipeline');

    // Clean up
    tooltipSurface.destroy_dash();
    delete globalThis.global.blur_my_shell;
}

GLib.spawn_sync(null, ['rm', '-rf', tmpShellDir], null, GLib.SpawnFlags.SEARCH_PATH, null);

print('tooltipBlur: ok');
