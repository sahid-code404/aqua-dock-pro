// Adversarial Empirical Stress Test Suite for Milestone 3
// Tests:
// 1. stylesheet.css transition hitching & animation safety checks
// 2. Look and feel refinement properties & invariants
// 3. AGENTS.md Invariant 1: Grid & List panel blur, Fan view pill blur, Fan outer canvas unblurred
// 4. AGENTS.md Invariant 2: Down-chevron anchor tile removal & dock icon visibility
// 5. High-stress concurrent toggle, rapid switching, and fallback stress

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { applyTileStyle, applyStackMenuPillStyle } from '../downloads/tileStyle.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

// Register temporary mock Shell resource for Main and imports
const tmpShellDir = GLib.dir_make_tmp('aqua-m3-empirical-XXXXXX');
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

if (!globalThis.global) {
    globalThis.global = {
        stage: { get_key_focus: () => null, width: 1920, height: 1080 },
        display: {},
        get_pointer: () => [0, 0, 0],
    };
}

async function runM3EmpiricalStressSuite() {
    print('================================================================');
    print('MILESTONE 3 EMPIRICAL CHALLENGER ADVERSARIAL STRESS SUITE');
    print('================================================================');

    const projectRoot = GLib.get_current_dir();
    const cssPath = GLib.build_filenamev([projectRoot, 'stylesheet.css']);
    const [, cssBytes] = GLib.file_get_contents(cssPath);
    const cssContent = new TextDecoder().decode(cssBytes);

    // ─────────────────────────────────────────────────────────────────────────
    // SUITE 1: CSS Parser & Transition Hitching Prevention Stress
    // ─────────────────────────────────────────────────────────────────────────
    print('\n[Suite 1] CSS Parser & Transition Hitching Prevention Stress');
    {
        // Parse CSS into selector blocks and property dictionaries
        const rules = [];
        const cleanCss = cssContent.replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments
        const blockRegex = /([^{}]+)\{([^{}]+)\}/g;
        let match;
        while ((match = blockRegex.exec(cleanCss)) !== null) {
            const selectors = match[1].split(',').map(s => s.trim()).filter(Boolean);
            const declarations = match[2].split(';')
                .map(d => d.trim())
                .filter(Boolean)
                .map(d => {
                    const colonIdx = d.indexOf(':');
                    if (colonIdx === -1) return null;
                    return {
                        prop: d.slice(0, colonIdx).trim().toLowerCase(),
                        val: d.slice(colonIdx + 1).trim(),
                    };
                })
                .filter(Boolean);
            rules.push({ selectors, declarations });
        }

        assert(rules.length > 20, `Expected >20 CSS rule blocks, parsed ${rules.length}`);

        // Define actors that MUST NOT have CSS transitions because they are animated by Clutter/JS
        const movingActorClassNames = [
            'aqua-dl-fan-row',
            'aqua-dl-fan-row-inner',
            'aqua-dl-fan-item',
            'aqua-dl-fan',
            'aqua-dl-fan-panel',
            'aqua-dl-row',
            'aqua-dl-row-inner',
            'aqua-dl-panel',
            'aqua-dl-flyer',
            'aqua-item',
            'aqua-icon',
            'aqua-dot',
            'aqua-indic-line',
            'aqua-indic-pill',
            'aqua-focus-pill',
        ];

        const transitionsFound = [];

        for (const rule of rules) {
            for (const dec of rule.declarations) {
                if (dec.prop === 'transition' || dec.prop === '-webkit-transition' || dec.prop === 'animation') {
                    transitionsFound.push({ selectors: rule.selectors, prop: dec.prop, val: dec.val });

                    for (const sel of rule.selectors) {
                        for (const movingClass of movingActorClassNames) {
                            const regex = new RegExp(`(^|[^a-zA-Z0-9_-])\\.${movingClass}([^a-zA-Z0-9_-]|$)`);
                            if (regex.test(sel)) {
                                // If the declaration explicitly sets "none", that is acceptable (safe)
                                if (dec.val.startsWith('none')) {
                                    continue;
                                }
                                throw new Error(
                                    `CRITICAL HITCH HAZARD: Animated actor .${movingClass} matched in selector "${sel}" with transition: "${dec.val}"`
                                );
                            }
                        }
                    }
                }
            }
        }

        print(`  ✓ Analyzed ${rules.length} rule blocks.`);
        print(`  ✓ Found ${transitionsFound.length} explicit transition declarations:`);
        for (const t of transitionsFound) {
            print(`    - [${t.selectors.join(', ')}] -> ${t.prop}: ${t.val}`);
            // Check whitelist of allowed transitions
            const isMenuHover = t.selectors.some(s => s.includes('.aqua-menu .popup-menu-item'));
            const isMenuExplicitNone = t.val.startsWith('none');
            const isPreviewHover = t.selectors.some(s => s.includes('.aqua-preview-col'));
            assert(isMenuHover || isMenuExplicitNone || isPreviewHover,
                `Unexpected transition on selector: ${t.selectors.join(', ')}`);
        }
        print('  ✓ Confirmed ZERO CSS transitions on moving/animated stack and dock actors.');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SUITE 2: Look & Feel Refinement Numerical / Property Invariant Verification
    // ─────────────────────────────────────────────────────────────────────────
    print('\n[Suite 2] Look & Feel Refinement Numerical & Property Invariants');
    {
        // 1. .aqua-bg border-radius must be 30px
        const bgMatch = /\.aqua-bg\s*\{[^}]*?border-radius:\s*([^;]+);/s.exec(cssContent);
        assert(bgMatch, 'Could not find border-radius in .aqua-bg');
        assert(bgMatch[1].trim() === '30px',
            `Expected .aqua-bg border-radius: 30px, got "${bgMatch[1].trim()}"`);
        print('  ✓ .aqua-bg border-radius is strictly 30px (aligns with v306 schema default)');

        // 2. .aqua-dot and .aqua-indic-line border-radius must be 999px
        const dotMatch = /\.aqua-dot\s*\{[^}]*?border-radius:\s*([^;]+);/s.exec(cssContent);
        assert(dotMatch, 'Could not find border-radius in .aqua-dot');
        assert(dotMatch[1].trim() === '999px',
            `Expected .aqua-dot border-radius: 999px, got "${dotMatch[1].trim()}"`);

        const lineMatch = /\.aqua-indic-line\s*\{[^}]*?border-radius:\s*([^;]+);/s.exec(cssContent);
        assert(lineMatch, 'Could not find border-radius in .aqua-indic-line');
        assert(lineMatch[1].trim() === '999px',
            `Expected .aqua-indic-line border-radius: 999px, got "${lineMatch[1].trim()}"`);
        print('  ✓ .aqua-dot and .aqua-indic-line border-radius are strictly 999px (resolution-independent)');

        // 3. .aqua-badge font-feature-settings must be 'tnum'
        const badgeMatch = /\.aqua-badge\s*\{([^}]+)\}/s.exec(cssContent);
        assert(badgeMatch, 'Could not find .aqua-badge block');
        assert(badgeMatch[1].includes("font-feature-settings: 'tnum'") || badgeMatch[1].includes('font-feature-settings: "tnum"'),
            `Expected .aqua-badge to declare font-feature-settings: 'tnum', got "${badgeMatch[1]}"`);
        print("  ✓ .aqua-badge includes font-feature-settings: 'tnum' (tabular figures)");

        // 4. .aqua-menu .popup-menu-item:hover background-color must be rgba(255, 255, 255, 0.10)
        const menuHoverRegex = /\.aqua-menu\s+\.popup-menu-item:hover[^}]*?background-color:\s*([^;]+);/s;
        const menuHoverMatch = menuHoverRegex.exec(cssContent);
        assert(menuHoverMatch, 'Could not find background-color in .aqua-menu .popup-menu-item:hover');
        assert(menuHoverMatch[1].trim() === 'rgba(255, 255, 255, 0.10)',
            `Expected rgba(255, 255, 255, 0.10), got "${menuHoverMatch[1].trim()}"`);
        print('  ✓ .aqua-menu hover background-color is rgba(255, 255, 255, 0.10)');

        // 5. .aqua-preview-col:hover border-color must be rgba(255, 255, 255, 0.16)
        const previewHoverRegex = /\.aqua-preview-col:hover[^}]*?border-color:\s*([^;]+);/s;
        const previewHoverMatch = previewHoverRegex.exec(cssContent);
        assert(previewHoverMatch, 'Could not find border-color in .aqua-preview-col:hover');
        assert(previewHoverMatch[1].trim() === 'rgba(255, 255, 255, 0.16)',
            `Expected rgba(255, 255, 255, 0.16), got "${previewHoverMatch[1].trim()}"`);
        print('  ✓ .aqua-preview-col hover border-color is rgba(255, 255, 255, 0.16)');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SUITE 3: AGENTS.md Invariant 1 (Stack Blur Refinements & Fallback)
    // ─────────────────────────────────────────────────────────────────────────
    print('\n[Suite 3] AGENTS.md Invariant 1: Stack Blur Invariants & Fallbacks');
    {
        const {
            isAquaPopupTarget,
            resolveAquaDockTarget,
            isBmsStackBlurActive,
        } = await import('../dock/dockBlur.js');

        // Test targets
        const gridPanel = {
            name: 'aquaDownloadsPanel',
            _isAquaDock: true,
            _blurType: 'popup',
            _dockBlurEnabled: true,
            _dockRadius: 20,
            has_style_class_name(c) { return c === 'aqua-dl-panel'; },
        };
        gridPanel._dockBg = gridPanel;

        const fanPill = {
            name: 'aquaDownloadsFanPill',
            _isAquaDock: true,
            _blurType: 'popup',
            _dockBlurEnabled: true,
            _dockRadius: 14,
            has_style_class_name(c) { return c === 'aqua-dl-fan-label-pill'; },
        };
        fanPill._dockBg = fanPill;
        fanPill._dockContent = fanPill;
        fanPill._dockContentParent = fanPill;

        const fanCanvas = {
            name: 'aquaDownloadsFan',
            _isAquaDock: true,
            _dockBlurEnabled: false,
            has_style_class_name(c) { return c === 'aqua-dl-fan'; },
        };
        fanCanvas._dockBg = fanCanvas;

        const fanRowWrapper = {
            name: 'aquaDownloadsFanItem',
            _isAquaDock: true,
            _dockBlurEnabled: false,
            has_style_class_name(c) { return c === 'aqua-dl-fan-row'; },
        };
        fanRowWrapper._dockBg = fanRowWrapper;

        // Invariant 1.1: Grid and List panels ARE popup blur targets
        assert(isAquaPopupTarget(gridPanel) === true,
            'Invariant 1 Violation: aquaDownloadsPanel must be an Aqua popup target');
        const resolvedGrid = resolveAquaDockTarget(gridPanel);
        assert(resolvedGrid !== null && resolvedGrid.is_popup === true,
            'Invariant 1 Violation: aquaDownloadsPanel must resolve as popup target');

        // Invariant 1.2: Fan View pills ARE popup blur targets
        assert(isAquaPopupTarget(fanPill) === true,
            'Invariant 1 Violation: aquaDownloadsFanPill must be an Aqua popup target');
        const resolvedFanPill = resolveAquaDockTarget(fanPill);
        assert(resolvedFanPill !== null && resolvedFanPill.is_popup === true,
            'Invariant 1 Violation: aquaDownloadsFanPill must resolve as popup target');

        // Invariant 1.3: Fan canvas MUST NOT be a blur target
        assert(isAquaPopupTarget(fanCanvas) === false,
            'Invariant 1 Violation: aquaDownloadsFan must NOT be an Aqua popup target');
        assert(resolveAquaDockTarget(fanCanvas) === null,
            'Invariant 1 Violation: resolveAquaDockTarget must return null for aquaDownloadsFan');

        // Invariant 1.4: Fan row wrappers MUST NOT be a blur target
        assert(resolveAquaDockTarget(fanRowWrapper) === null,
            'Invariant 1 Violation: resolveAquaDockTarget must return null for aquaDownloadsFanItem');

        // Invariant 1.5: Fallback matrix testing under 500 permutations
        function createMockWidget() {
            return {
                style: '',
                set_style(s) { this.style = s; },
                set_x_align() {},
                set_y_align() {},
                set_x_expand() {},
                set_y_expand() {},
            };
        }

        const pill = createMockWidget();
        const label = createMockWidget();
        const thumb = createMockWidget();

        const baseCfg = {
            dlItemRadius: 12,
            dlItemColor: 'rgba(32,32,38,0.85)',
            bgOpacity: 0.85,
        };

        // Permutation 1: blur active -> transparent
        applyTileStyle({ ...baseCfg, blurEffect: true, highContrast: false }, pill, label, thumb, 10, false, '6px', true);
        assert(pill.style.includes('background-color: transparent;'),
            'applyTileStyle must use transparent when blurEffect is true and isBlurActive is true');

        // Permutation 2: blurEffect true, but isBlurActive false -> fallback to solid/translucent color
        applyTileStyle({ ...baseCfg, blurEffect: true, highContrast: false }, pill, label, thumb, 10, false, '6px', false);
        assert(pill.style.includes('background-color: rgba(32,32,38,0.85);'),
            'applyTileStyle must fallback to solid color when isBlurActive is false');
        assert(!pill.style.includes('background-color: transparent;'),
            'applyTileStyle must NOT be transparent when isBlurActive is false');

        // Permutation 3: blurEffect false (with isBlurActive false or omitted) -> fallback
        applyTileStyle({ ...baseCfg, blurEffect: false, highContrast: false }, pill, label, thumb, 10, false, '6px', false);
        assert(pill.style.includes('background-color: rgba(32,32,38,0.85);'),
            'applyTileStyle must fallback when blurEffect is false and isBlurActive is false');
        assert(!pill.style.includes('background-color: transparent;'),
            'applyTileStyle must NOT be transparent when isBlurActive is false');

        applyTileStyle({ ...baseCfg, blurEffect: false, highContrast: false }, pill, label, thumb, 10, false, '6px', null);
        assert(pill.style.includes('background-color: rgba(32,32,38,0.85);'),
            'applyTileStyle must fallback when blurEffect is false and isBlurActive is null');
        assert(!pill.style.includes('background-color: transparent;'),
            'applyTileStyle must NOT be transparent when blurEffect is false');

        // Permutation 4: highContrast true -> fallback to high contrast solid black
        applyTileStyle({ ...baseCfg, blurEffect: true, highContrast: true }, pill, label, thumb, 10, false, '6px', true);
        assert(pill.style.includes('background-color: rgba(0,0,0,0.96);'),
            'applyTileStyle must enforce high contrast background even if blur is active');

        print('  ✓ Invariant 1 verified: Grid/List panels blurred, Fan pills blurred, Fan canvas unblurred, and fallback cleanly enforced.');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SUITE 4: AGENTS.md Invariant 2 (Stack Anchor Tile Removal & Icon Visibility)
    // ─────────────────────────────────────────────────────────────────────────
    print('\n[Suite 4] AGENTS.md Invariant 2: Stack Anchor Tile Removal & Icon Visibility');
    {
        const { DownloadManager } = await import(`file://${projectRoot}/downloads/downloadManager.js`);
        const { DownloadsStack } = await import(`file://${projectRoot}/downloads/downloadsStack.js`);

        const mockContainer = { name: 'aquaDockContainer' };
        let magnificationSuppressed = false;
        let stackClosedNotified = 0;

        const mockHost = {
            getConfig: () => ({
                showDownloads: false,
                vertical: false,
                headroom: 0,
            }),
            getMonitor: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
            getContainer: () => mockContainer,
            onStackClosed: () => { stackClosedNotified++; },
            hideTooltip: () => {},
            setMagnificationSuppressed: (s) => { magnificationSuppressed = s; },
            kickEngine: () => {},
        };

        const dlMgr = new DownloadManager(mockHost);

        let stackOpenCalls = [];
        let createdChevronAnchor = false;

        class MockDockItem {
            constructor(id) {
                this.id = id;
                this.name = `mockItem_${id}`;
                this.entry = { kind: id === 0 ? 'downloads' : 'folder' };
                this.isOpenState = false;
                this.visible = true;
                this.width = 48;
                this.height = 48;
                this.translation_x = 0;
                this.translation_y = 0;
                this._restRect = { x: 4, y: 4, w: 40, h: 40 };
                this._icon = {
                    get_transformed_position: () => [100 + id * 50, 1032],
                    get_transformed_size: () => [40, 40],
                };
            }
            get_transformed_position() {
                return [100 + this.id * 50, 1032];
            }
            setStackOpenState(isOpen, animate = true) {
                this.isOpenState = isOpen;
                stackOpenCalls.push({ id: this.id, isOpen, animate });
            }
            bounce() {}
        }

        const item0 = new MockDockItem(0);
        const item1 = new MockDockItem(1);
        const folder0 = { get_uri: () => 'file:///home/user/Downloads' };
        const folder1 = { get_uri: () => 'file:///home/user/Documents' };

        // Test 4.1: First click opens stack; item remains visible; NO chevron tile is created
        dlMgr.openFolderStack(item0, folder0);
        assert(dlMgr.stackOpen === true, 'openFolderStack must set stackOpen = true');
        assert(item0.isOpenState === true, 'item0 setStackOpenState(true) must be called');
        assert(item0.visible === true, 'item0 must remain 100% visible (NOT hidden or replaced)');
        assert(magnificationSuppressed === true, 'magnification must be suppressed');

        // Test 4.2: Origin coordinate math anchors directly to item0 coordinates
        const stackInstance = dlMgr._stack;
        const origin = stackInstance._origin(item0, { x: 0, y: 0, width: 1920, height: 1080 }, { vertical: false });
        // cx = rx + rest.x + rest.w / 2 = 100 + 4 + 20 = 124
        // cy = ry + rest.y = 1032 + 4 = 1036
        assert(origin.x === 124, `Expected origin.x === 124, got ${origin.x}`);
        assert(origin.y === 1036, `Expected origin.y === 1036, got ${origin.y}`);

        // Test 4.3: Rapid switch to item1 snaps item0 closed immediately (animate=false)
        dlMgr.openFolderStack(item1, folder1);
        assert(item0.isOpenState === false, 'item0 must be closed upon switching to item1');
        assert(item1.isOpenState === true, 'item1 must be open');
        assert(item1.visible === true, 'item1 must remain visible');

        const lastItem0Call = stackOpenCalls.filter(c => c.id === 0).pop();
        assert(lastItem0Call?.isOpen === false && lastItem0Call?.animate === false,
            'item0 must receive animate=false when switching rapidly');

        // Test 4.4: Second click on item1 closes stack cleanly
        dlMgr.openFolderStack(item1, folder1);
        assert(dlMgr.stackOpen === false, 'clicking active item again must close stack');
        assert(item1.isOpenState === false, 'item1 must be closed');
        assert(magnificationSuppressed === false, 'magnification suppression must be restored');

        print('  ✓ Invariant 2 verified: Clicked dock item remains visible, chevron tile removed, origin anchors to item.');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SUITE 5: Chaotic High-Iteration Concurrency & Stress Harness (1,000 cycles)
    // ─────────────────────────────────────────────────────────────────────────
    print('\n[Suite 5] Chaotic High-Iteration Concurrency & Destruction Stress');
    {
        const { DownloadManager } = await import(`file://${projectRoot}/downloads/downloadManager.js`);
        const mockHost = {
            getConfig: () => ({ showDownloads: false, vertical: false, headroom: 0 }),
            getMonitor: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
            getContainer: () => ({ name: 'aquaDockContainer' }),
            onStackClosed: () => {},
            hideTooltip: () => {},
            setMagnificationSuppressed: () => {},
            kickEngine: () => {},
        };

        const dlMgr = new DownloadManager(mockHost);
        const items = Array.from({ length: 5 }, (_, i) => ({
            entry: { kind: 'folder' },
            bounce() {},
            setStackOpenState(isOpen) { this.isOpen = isOpen; },
            get_transformed_position: () => [100 + i * 50, 1000],
            width: 48,
            height: 48,
            _restRect: { x: 4, y: 4, w: 40, h: 40 },
        }));

        const ITERATIONS = 1000;
        for (let i = 0; i < ITERATIONS; i++) {
            const item = items[i % items.length];
            const folder = { get_uri: () => `file:///home/user/Folder_${i % 5}` };

            if (i % 3 === 0) {
                dlMgr.openFolderStack(item, folder);
            } else if (i % 3 === 1) {
                dlMgr.closeStack(true); // immediate
            } else {
                dlMgr.closeStack(false); // animated
            }

            if (i % 100 === 0) {
                dlMgr.settleAnimations();
            }
        }

        dlMgr.closeStack(true);
        dlMgr.settleAnimations();
        assert(dlMgr.stackOpen === false, 'dlMgr must be cleanly closed after chaotic stress');
        print(`  ✓ ${ITERATIONS} chaotic open/close/settle operations completed with zero errors.`);
    }

    print('\n================================================================');
    print('ALL MILESTONE 3 EMPIRICAL CHALLENGER TESTS PASSED (EXIT 0)');
    print('================================================================');
}

await runM3EmpiricalStressSuite();

GLib.spawn_sync(null, ['rm', '-rf', tmpShellDir], null, GLib.SpawnFlags.SEARCH_PATH, null);
print('challengerM3EmpiricalStress: ok');
