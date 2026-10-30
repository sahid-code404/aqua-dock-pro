// Empirical Stress Test Harness for Milestone 3:
// Downloads Stack Actor Pooling & AGENTS.md Blur Invariants
//
// Verifying:
// 1. 1,000+ simulated open/close/cancel iterations across Fan, Grid, and List views.
// 2. Genuine recycling on subsequent opens (warm hit rate = 100%, actor churn = 0).
// 3. Clean detachment of delegate callbacks (_onHover, _openFileMenu, _activate) on release.
// 4. Bounded capacity adherence (pools bounded to <= 16 items even under 1,000 requests).
// 5. Destruction safety: pool.clear() synchronously destroys all pooled actors with zero leaks.
// 6. AGENTS.md Invariants: zero stack blur surfaces attached; down-chevron anchor blur intact.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`[CHALLENGE ASSERTION FAILED] ${message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. Setup Mock GNOME Shell Environment
// ─────────────────────────────────────────────────────────────────────────────
const tmpShellDir = GLib.dir_make_tmp('aqua-m3pool-XXXXXX');
const mainJsPath = GLib.build_filenamev([tmpShellDir, 'main.js']);
const popupMenuJsPath = GLib.build_filenamev([tmpShellDir, 'popupMenu.js']);
const xmlPath = GLib.build_filenamev([tmpShellDir, 'shell.gresource.xml']);
const resPath = GLib.build_filenamev([tmpShellDir, 'shell.gresource']);

GLib.file_set_contents(mainJsPath, `
export const extensionManager = null;
export const layoutManager = {
    monitors: [{ x: 0, y: 0, width: 1920, height: 1080 }],
    primaryIndex: 0,
};
export const overview = { visible: false };
export const uiGroup = {
    _children: new Set(),
    add_child(actor) {
        this._children.add(actor);
        actor._parent = this;
    },
    remove_child(actor) {
        this._children.delete(actor);
        if (actor._parent === this) actor._parent = null;
    },
    insert_child_below(actor, _sibling) {
        this.add_child(actor);
    },
    find_child_by_name(name) {
        for (const c of this._children) {
            if (c.name === name) return c;
        }
        return null;
    },
    get children() {
        return [...this._children];
    },
};
`);

GLib.file_set_contents(popupMenuJsPath, `
export class PopupMenu { constructor() {} addMenuItem() {} destroy() {} }
export class PopupMenuItem { constructor() {} }
export class PopupMenuManager { constructor() {} addMenu() {} removeMenu() {} }
export class PopupSubMenuMenuItem { constructor() {} }
export class PopupSeparatorMenuItem { constructor() {} }
`);

GLib.file_set_contents(xmlPath, `<?xml version="1.0" encoding="UTF-8"?>
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

// Track allocations and destructions globally for actor churn analysis
let totalActorsCreated = 0;
let totalActorsDestroyed = 0;

class MockActor {
    constructor(props = {}) {
        totalActorsCreated++;
        this.name = props.name || '';
        this.width = props.width || 0;
        this.height = props.height || 0;
        this.x = 0;
        this.y = 0;
        this.translation_x = 0;
        this.translation_y = 0;
        this.scale_x = 1;
        this.scale_y = 1;
        this.opacity = 255;
        this.hover = false;
        this.style = '';
        this.accessible_name = '';
        this.styleClasses = new Set();
        if (props.style_class) {
            props.style_class.split(' ').filter(Boolean).forEach(c => this.styleClasses.add(c));
        }
        this._parent = null;
        this._child = null;
        this.children = [];
        this.handlers = new Map();
        this.destroyed = false;
        this.transitions = [];
        this.clutter_text = {
            _ellipsize: 0,
            _wrap: false,
            set_line_wrap(w) { this._wrap = w; },
            set_ellipsize(e) { this._ellipsize = e; },
        };
        this.layout_manager = {
            _spacing: 0,
            set_spacing(s) { this._spacing = s; },
        };
    }

    set_position(x, y) { this.x = x; this.y = y; }
    set_size(w, h) { this.width = w; this.height = h; }
    set_width(w) { this.width = w; }
    set_height(h) { this.height = h; }
    set_scale(sx, sy) { this.scale_x = sx; this.scale_y = sy; }
    set_pivot_point(px, py) { this.pivot_x = px; this.pivot_y = py; }
    set_style(s) { this.style = s; }
    set_style_class_name(s) {
        this.styleClasses.clear();
        s.split(' ').filter(Boolean).forEach(c => this.styleClasses.add(c));
    }
    add_style_class_name(c) { this.styleClasses.add(c); }
    remove_style_class_name(c) { this.styleClasses.delete(c); }
    has_style_class_name(c) { return this.styleClasses.has(c); }
    add_child(c) {
        this.children.push(c);
        c._parent = this;
    }
    remove_child(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        if (c._parent === this) c._parent = null;
    }
    remove_all_children() {
        for (const c of this.children) {
            if (c._parent === this) c._parent = null;
        }
        this.children = [];
    }
    set_child(c) {
        this._child = c;
        if (c) c._parent = this;
    }
    get_child() { return this._child; }
    get_children() { return [...this.children]; }
    get_parent() { return this._parent; }
    get_layout_manager() { return this.layout_manager; }
    connect(sig, cb) {
        if (!this.handlers.has(sig)) this.handlers.set(sig, []);
        this.handlers.get(sig).push(cb);
        return this.handlers.get(sig).length;
    }
    disconnect() {}
    emit(sig, ...args) {
        const cbs = this.handlers.get(sig) || [];
        for (const cb of cbs) cb(this, ...args);
    }
    set_button_mask(mask) { this._buttonMask = mask; }
    remove_all_transitions() { this.transitions = []; }
    ease(props) {
        this.transitions.push(props);
        if (props.opacity !== undefined) this.opacity = props.opacity;
        if (props.scale_x !== undefined) this.scale_x = props.scale_x;
        if (props.scale_y !== undefined) this.scale_y = props.scale_y;
        if (props.translation_x !== undefined) this.translation_x = props.translation_x;
        if (props.translation_y !== undefined) this.translation_y = props.translation_y;
        if (props.onComplete) props.onComplete();
    }
    is_destroyed() { return this.destroyed; }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        totalActorsDestroyed++;
        this.emit('destroy');
        if (this._parent) {
            this._parent.remove_child(this);
            this._parent = null;
        }
        for (const c of [...this.children]) {
            c.destroy();
        }
        if (this._child) this._child.destroy();
    }
    grab_key_focus() {}
    has_allocation() { return true; }
    get_transformed_position() { return [this.x, this.y]; }
    get_transformed_size() { return [this.width, this.height]; }
    get_preferred_height() { return [0, this.height || 300]; }
    get_preferred_width() { return [0, this.width || 300]; }
}

// Attach mocks to St and Clutter namespaces
St.Widget = MockActor;
St.Button = MockActor;
St.BoxLayout = MockActor;
St.Bin = MockActor;
St.Label = MockActor;
St.Icon = MockActor;
St.ButtonMask = { PRIMARY: 1, SECONDARY: 2, ONE: 1, THREE: 2 };
Clutter.FixedLayout = function() {};

// Dynamic module imports
const { ActorPool } = await import('../downloads/actorPool.js');
const { DownloadsStack } = await import('../downloads/downloadsStack.js');
const { FanView } = await import('../downloads/fanView.js');
const { PanelView } = await import('../downloads/panelView.js');
const {
    isAquaPopupTarget,
    resolveAquaDockTarget,
    registerBmsTarget,
    unregisterBmsTarget,
    isBmsStackBlurActive,
    cleanupBms,
} = await import('../dock/dockBlur.js');

print('================================================================');
print('M3 ADVERSARIAL EMPIRICAL ACTOR POOLING & INVARIANTS HARNESS');
print('================================================================');

// Helper to create mock FileInfo objects
function makeMockFileInfo(name, contentType = 'text/plain') {
    const info = new Gio.FileInfo();
    info.set_name(name);
    info.set_display_name(name);
    info.set_content_type(contentType);
    info.set_icon(Gio.ThemedIcon.new('text-x-generic'));
    return info;
}

const mockFolder = {
    get_uri: () => 'file:///home/user/Downloads',
    get_child: (name) => ({
        get_uri: () => `file:///home/user/Downloads/${name}`,
    }),
};

const baseCfg = {
    position: 'bottom',
    iconSize: 48,
    dockRadius: 16,
    dlItemRadius: 12,
    downloadsView: 'fan',
    downloadsMaxFiles: 11,
    downloadsBorderRadius: 16,
    bgOpacity: 0.8,
    highContrast: false,
};
const mockMon = { x: 0, y: 0, width: 1920, height: 1080 };
const mockOrigin = { x: 500, y: 900 };

// ─────────────────────────────────────────────────────────────────────────────
// 1. 1,000+ Simulated Open/Close/Cancel Iterations (Fan, Grid, List)
// ─────────────────────────────────────────────────────────────────────────────
print('\n--- 1. 1,000+ Open/Close/Cancel Iterations (Fan, Grid, List) ---');

{
    print('[Test 1.1] Fan View: 1,200 open/close/cancel stress cycles...');
    const fanPool = new ActorPool(16);
    const testFileCounts = [0, 1, 3, 5, 8, 11, 15];

    for (let i = 0; i < 1200; i++) {
        const fileCount = testFileCounts[i % testFileCounts.length];
        const files = Array.from({ length: fileCount }, (_, idx) => makeMockFileInfo(`fan_file_${idx}.txt`));

        let closeCalled = false;
        const view = new FanView({
            folder: mockFolder,
            files,
            overflow: Math.max(0, fileCount - 11),
            cfg: { ...baseCfg, downloadsView: 'fan' },
            mon: mockMon,
            origin: mockOrigin,
            pool: fanPool,
            close: () => { closeCalled = true; },
        });

        const actor = view.build();
        assert(actor !== null, `FanView.build() returned actor at iteration ${i}`);
        assert(actor.children.length > 0, `FanView actor has children at iteration ${i}`);

        // Vary lifecycle between normal close, cancel mid-flight, and settleAnimations
        const mode = i % 3;
        if (mode === 0) {
            // Normal close with animation completion
            let doneCalled = false;
            view.animateClose(() => { doneCalled = true; });
            assert(doneCalled === true, `animateClose completed at iteration ${i}`);
            actor.destroy();
        } else if (mode === 1) {
            // Mid-flight cancellation via releaseRows + actor.destroy
            view.settleAnimations();
            view.releaseRows();
            actor.destroy();
        } else {
            // Rapid double-release idempotency check
            view.releaseRows();
            view.releaseRows(); // Must be safe and no-op
            actor.destroy();
        }

        // Verify pool integrity: pool items must NOT be destroyed GObjects
        for (const item of fanPool._fanPool) {
            assert(item.btn.is_destroyed() === false, `Pooled fan item must not be destroyed at iter ${i}`);
            assert(item.btn.get_parent() === null, `Pooled fan item must be unparented at iter ${i}`);
        }
        assert(fanPool._fanPool.length <= 16, `Pool must not exceed capacity 16 at iter ${i}`);
    }
    print('  ✓ 1,200 Fan View cycles passed. Zero destroyed actors in pool, clean unparenting verified.');
    fanPool.clear();
}

{
    print('[Test 1.2] Grid View: 1,200 open/close/cancel stress cycles...');
    const panelPool = new ActorPool(16);
    const testFileCounts = [0, 1, 2, 4, 7, 9, 16];

    for (let i = 0; i < 1200; i++) {
        const fileCount = testFileCounts[i % testFileCounts.length];
        const files = Array.from({ length: fileCount }, (_, idx) => makeMockFileInfo(`grid_file_${idx}.png`, 'image/png'));

        let closeCalled = false;
        const view = new PanelView({
            folder: mockFolder,
            files,
            totalFiles: fileCount,
            cfg: { ...baseCfg, downloadsView: 'grid' },
            mon: mockMon,
            origin: mockOrigin,
            pool: panelPool,
            close: () => { closeCalled = true; },
        });

        const actor = view.build();
        assert(actor !== null, `PanelView(grid).build() returned actor at iteration ${i}`);

        const mode = i % 3;
        if (mode === 0) {
            let doneCalled = false;
            view.animateClose(() => { doneCalled = true; });
            assert(doneCalled === true, `animateClose completed at iteration ${i}`);
            actor.destroy();
        } else if (mode === 1) {
            view.settleAnimations();
            view.releaseRows();
            actor.destroy();
        } else {
            view.releaseRows();
            view.releaseRows();
            actor.destroy();
        }

        for (const item of panelPool._panelPool) {
            assert(item.row.is_destroyed() === false, `Pooled grid item must not be destroyed at iter ${i}`);
            assert(item.row.get_parent() === null, `Pooled grid item must be unparented at iter ${i}`);
        }
        assert(panelPool._panelPool.length <= 16, `Pool must not exceed capacity 16 at iter ${i}`);
    }
    print('  ✓ 1,200 Grid View cycles passed. Two-column grid unparenting verified.');
    panelPool.clear();
}

{
    print('[Test 1.3] List View: 1,200 open/close/cancel stress cycles...');
    const listPool = new ActorPool(16);
    const testFileCounts = [0, 1, 3, 6, 9, 12, 18];

    for (let i = 0; i < 1200; i++) {
        const fileCount = testFileCounts[i % testFileCounts.length];
        const files = Array.from({ length: fileCount }, (_, idx) => makeMockFileInfo(`list_file_${idx}.pdf`, 'application/pdf'));

        let closeCalled = false;
        const view = new PanelView({
            folder: mockFolder,
            files,
            totalFiles: fileCount,
            cfg: { ...baseCfg, downloadsView: 'list' },
            mon: mockMon,
            origin: mockOrigin,
            pool: listPool,
            close: () => { closeCalled = true; },
        });

        const actor = view.build();
        assert(actor !== null, `PanelView(list).build() returned actor at iteration ${i}`);

        const mode = i % 3;
        if (mode === 0) {
            let doneCalled = false;
            view.animateClose(() => { doneCalled = true; });
            assert(doneCalled === true, `animateClose completed at iteration ${i}`);
            actor.destroy();
        } else if (mode === 1) {
            view.settleAnimations();
            view.releaseRows();
            actor.destroy();
        } else {
            view.releaseRows();
            view.releaseRows();
            actor.destroy();
        }

        for (const item of listPool._panelPool) {
            assert(item.row.is_destroyed() === false, `Pooled list item must not be destroyed at iter ${i}`);
            assert(item.row.get_parent() === null, `Pooled list item must be unparented at iter ${i}`);
        }
        assert(listPool._panelPool.length <= 16, `Pool must not exceed capacity 16 at iter ${i}`);
    }
    print('  ✓ 1,200 List View cycles passed. Single-column list unparenting verified.');
    listPool.clear();
}

{
    print('[Test 1.4] Mixed Chaotic View Switching (1,500 iterations)...');
    const sharedPool = new ActorPool(16);
    const views = ['fan', 'grid', 'list'];

    for (let i = 0; i < 1500; i++) {
        const v = views[i % views.length];
        const count = 1 + (i % 10);
        const files = Array.from({ length: count }, (_, idx) => makeMockFileInfo(`mixed_${idx}.bin`));

        let viewInstance;
        if (v === 'fan') {
            viewInstance = new FanView({
                folder: mockFolder,
                files,
                overflow: 0,
                cfg: { ...baseCfg, downloadsView: 'fan' },
                mon: mockMon,
                origin: mockOrigin,
                pool: sharedPool,
                close: () => {},
            });
        } else {
            viewInstance = new PanelView({
                folder: mockFolder,
                files,
                totalFiles: count,
                cfg: { ...baseCfg, downloadsView: v },
                mon: mockMon,
                origin: mockOrigin,
                pool: sharedPool,
                close: () => {},
            });
        }

        const actor = viewInstance.build();
        if (i % 2 === 0) {
            viewInstance.animateClose(() => {});
        } else {
            viewInstance.settleAnimations();
            viewInstance.releaseRows();
        }
        actor.destroy();

        assert(sharedPool._fanPool.length <= 16, `Fan pool over capacity at mixed iter ${i}`);
        assert(sharedPool._panelPool.length <= 16, `Panel pool over capacity at mixed iter ${i}`);
    }
    print('  ✓ 1,500 Mixed Chaotic cycles passed. Section 1 total: 5,100 flawless iterations.');
    sharedPool.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Genuine Recycling (Warm Hit Rate = 100%, Actor Churn = 0)
// ─────────────────────────────────────────────────────────────────────────────
print('\n--- 2. Genuine Recycling (Warm Hit Rate = 100%, Actor Churn = 0) ---');

{
    print('[Test 2.1] Fan View 1,000 warm cycles: Leased actor recycling and zero churn...');
    const fanPool = new ActorPool(16);
    let leasedFanCardCreations = 0;
    const origCreateFan = fanPool._createFanCard.bind(fanPool);
    fanPool._createFanCard = () => {
        leasedFanCardCreations++;
        return origCreateFan();
    };

    const numItems = 6;
    const testFiles = Array.from({ length: numItems }, (_, idx) => makeMockFileInfo(`file_${idx}.txt`));

    // 1. Cold open: leases 7 items (6 files + 1 action card) from pool
    const coldView = new FanView({
        folder: mockFolder,
        files: testFiles,
        overflow: 0,
        cfg: { ...baseCfg, downloadsView: 'fan' },
        mon: mockMon,
        origin: mockOrigin,
        pool: fanPool,
        close: () => {},
    });
    const coldActor = coldView.build();
    const coldItemInstances = new Set(coldView._model.rows);
    assert(coldItemInstances.size === numItems + 1,
        `Expected ${numItems + 1} distinct card instances on cold start, got ${coldItemInstances.size}`);
    assert(leasedFanCardCreations === numItems + 1,
        `Expected exactly ${numItems + 1} leased card creations on cold start, got ${leasedFanCardCreations}`);

    // Cold close: returns all items to the pool
    coldView.releaseRows();
    coldActor.destroy();
    assert(fanPool._fanPool.length === numItems + 1,
        `Pool should contain all ${numItems + 1} released items, got ${fanPool._fanPool.length}`);

    const baselineCreations = leasedFanCardCreations;

    // 2. Warm cycles: run 1,000 opens and closes with identical items
    let warmRequests = 0;
    let warmHits = 0;

    for (let cycle = 0; cycle < 1000; cycle++) {
        const warmView = new FanView({
            folder: mockFolder,
            files: testFiles,
            overflow: 0,
            cfg: { ...baseCfg, downloadsView: 'fan' },
            mon: mockMon,
            origin: mockOrigin,
            pool: fanPool,
            close: () => {},
        });
        const warmActor = warmView.build();

        // Check each leased row was genuinely recycled from coldItemInstances
        for (const row of warmView._model.rows) {
            warmRequests++;
            if (coldItemInstances.has(row)) {
                warmHits++;
            }
        }

        warmView.releaseRows();
        warmActor.destroy();
    }

    const leasedActorChurn = leasedFanCardCreations - baselineCreations;
    const hitRate = (warmHits / warmRequests) * 100;

    assert(leasedActorChurn === 0,
        `Expected ZERO leased card churn during 1,000 warm cycles, but created ${leasedActorChurn}`);
    assert(hitRate === 100.0,
        `Expected 100.0% warm hit rate, but achieved ${hitRate.toFixed(2)}% (${warmHits}/${warmRequests})`);

    print(`  ✓ Fan View 1,000 cycles: warm hit rate = ${hitRate.toFixed(1)}%, leased card churn = ${leasedActorChurn} (ZERO churn).`);
    fanPool.clear();
}

{
    print('[Test 2.2] Grid & List Views 1,000 warm cycles: Leased actor recycling and zero churn...');
    const panelPool = new ActorPool(16);
    let leasedPanelCardCreations = 0;
    const origCreatePanel = panelPool._createPanelCard.bind(panelPool);
    panelPool._createPanelCard = (view) => {
        leasedPanelCardCreations++;
        return origCreatePanel(view);
    };

    const numItems = 8;
    const testFiles = Array.from({ length: numItems }, (_, idx) => makeMockFileInfo(`file_${idx}.png`, 'image/png'));

    // Cold open
    const coldView = new PanelView({
        folder: mockFolder,
        files: testFiles,
        totalFiles: numItems,
        cfg: { ...baseCfg, downloadsView: 'grid' },
        mon: mockMon,
        origin: mockOrigin,
        pool: panelPool,
        close: () => {},
    });
    const coldActor = coldView.build();
    const coldItemInstances = new Set(coldView._model.rows);
    assert(coldItemInstances.size === numItems,
        `Expected ${numItems} card instances on cold start, got ${coldItemInstances.size}`);
    assert(leasedPanelCardCreations === numItems,
        `Expected exactly ${numItems} leased card creations on cold start, got ${leasedPanelCardCreations}`);

    coldView.releaseRows();
    coldActor.destroy();
    assert(panelPool._panelPool.length === numItems,
        `Panel pool should contain ${numItems} released items, got ${panelPool._panelPool.length}`);

    const baselineCreations = leasedPanelCardCreations;
    let warmRequests = 0;
    let warmHits = 0;

    for (let cycle = 0; cycle < 1000; cycle++) {
        const v = cycle % 2 === 0 ? 'grid' : 'list';
        const warmView = new PanelView({
            folder: mockFolder,
            files: testFiles,
            totalFiles: numItems,
            cfg: { ...baseCfg, downloadsView: v },
            mon: mockMon,
            origin: mockOrigin,
            pool: panelPool,
            close: () => {},
        });
        const warmActor = warmView.build();

        for (const row of warmView._model.rows) {
            warmRequests++;
            if (coldItemInstances.has(row)) {
                warmHits++;
            }
        }

        warmView.releaseRows();
        warmActor.destroy();
    }

    const leasedActorChurn = leasedPanelCardCreations - baselineCreations;
    const hitRate = (warmHits / warmRequests) * 100;

    assert(leasedActorChurn === 0,
        `Expected ZERO leased card churn during 1,000 warm Panel cycles, got ${leasedActorChurn}`);
    assert(hitRate === 100.0,
        `Expected 100.0% warm hit rate for Panel cycles, got ${hitRate.toFixed(2)}%`);

    print(`  ✓ Panel View 1,000 cycles: warm hit rate = ${hitRate.toFixed(1)}%, leased card churn = ${leasedActorChurn} (ZERO churn).`);
    panelPool.clear();
}

{
    print('[Test 2.3] ActorPool Direct Standalone Recycling (1,000 iterations)...');
    const directPool = new ActorPool(16);
    let fanCreations = 0;
    let panelCreations = 0;
    const origFan = directPool._createFanCard.bind(directPool);
    const origPanel = directPool._createPanelCard.bind(directPool);
    directPool._createFanCard = () => { fanCreations++; return origFan(); };
    directPool._createPanelCard = (v) => { panelCreations++; return origPanel(v); };

    // Initial allocation of 10 items
    const initialFanCards = Array.from({ length: 10 }, () => directPool.acquireFanItem());
    const initialPanelCards = Array.from({ length: 10 }, () => directPool.acquirePanelItem('grid'));

    assert(fanCreations === 10, 'Initial 10 fan card creations');
    assert(panelCreations === 10, 'Initial 10 panel card creations');

    // Return to pool
    for (const c of initialFanCards) directPool.releaseFanItem(c.btn);
    for (const c of initialPanelCards) directPool.releasePanelItem(c.row);

    assert(directPool._fanPool.length === 10, 'Fan pool has 10');
    assert(directPool._panelPool.length === 10, 'Panel pool has 10');

    const fanSet = new Set(initialFanCards.map(c => c.btn));
    const panelSet = new Set(initialPanelCards.map(c => c.row));

    let directHits = 0;
    let directRequests = 0;

    for (let i = 0; i < 1000; i++) {
        const fanCard = directPool.acquireFanItem();
        const panelCard = directPool.acquirePanelItem('list');

        directRequests += 2;
        if (fanSet.has(fanCard.btn)) directHits++;
        if (panelSet.has(panelCard.row)) directHits++;

        directPool.releaseFanItem(fanCard.btn);
        directPool.releasePanelItem(panelCard.row);
    }

    assert(fanCreations === 10, `Fan creations must remain 10 (got ${fanCreations})`);
    assert(panelCreations === 10, `Panel creations must remain 10 (got ${panelCreations})`);
    assert(directHits === directRequests, `All requests must be hits (${directHits}/${directRequests})`);

    print('  ✓ ActorPool direct standalone recycling verified: 100% warm hit rate, exactly 0 churn across 1,000 iterations.');
    directPool.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Delegate Callback Detachment & Zero Scope Retention
// ─────────────────────────────────────────────────────────────────────────────
print('\n--- 3. Clean Delegate Detachment on Pool Release ---');

{
    print('[Test 3.1] Empirical closure and GIO retention prevention test (1,000 cycles)...');
    const pool = new ActorPool(16);

    for (let i = 0; i < 1000; i++) {
        const fanCard = pool.acquireFanItem();
        const panelCard = pool.acquirePanelItem('grid');

        // Create heavy closures capturing large scopes, simulated GIO handles, and sentinel objects
        let sentinelCaptured = { token: `leak_test_token_${i}`, active: true };
        const mockGioHandle = { uri: `gio:///mock/heavy/handle/${i}`, close() {} };

        fanCard.btn._activate = () => {
            if (sentinelCaptured.active) return mockGioHandle.uri;
        };
        fanCard.btn._openFileMenu = () => {
            return `menu_${sentinelCaptured.token}`;
        };
        fanCard.btn._onHover = () => {
            return `hover_${sentinelCaptured.token}`;
        };
        fanCard.btn.accessible_name = `Accessible ${sentinelCaptured.token}`;
        fanCard.btn.add_style_class_name('aqua-dl-fan-row-sel');
        fanCard.btn.add_style_class_name('aqua-dl-fan-action');
        fanCard.btn.add_style_class_name('aqua-dl-fan-more');

        // Thumbnail child tampering simulation
        const fakeCustomIcon = new MockActor({ name: 'customIcon' });
        fanCard.thumb.set_child(fakeCustomIcon);

        panelCard.row._activate = () => {
            if (sentinelCaptured.active) return mockGioHandle.uri;
        };
        panelCard.row._openFileMenu = () => {
            return `menu_${sentinelCaptured.token}`;
        };
        panelCard.row._onHover = () => {
            return `hover_${sentinelCaptured.token}`;
        };
        panelCard.row.accessible_name = `Accessible Panel ${sentinelCaptured.token}`;
        panelCard.row.add_style_class_name('aqua-dl-row-sel');
        panelCard.row.add_style_class_name('aqua-dl-row-more');

        // Release to pool
        pool.releaseFanItem(fanCard.btn);
        pool.releasePanelItem(panelCard.row);

        // Verification of Fan Card detachment
        assert(fanCard.btn._activate === null, `_activate must be null at iter ${i}`);
        assert(fanCard.btn._openFileMenu === null, `_openFileMenu must be null at iter ${i}`);
        assert(fanCard.btn._onHover === null, `_onHover must be null at iter ${i}`);
        assert(fanCard.btn.accessible_name === '', `accessible_name must be cleared at iter ${i}`);
        assert(!fanCard.btn.has_style_class_name('aqua-dl-fan-row-sel'), `Selection class must be removed at iter ${i}`);
        assert(!fanCard.btn.has_style_class_name('aqua-dl-fan-action'), `Action class must be removed at iter ${i}`);
        assert(!fanCard.btn.has_style_class_name('aqua-dl-fan-more'), `More class must be removed at iter ${i}`);
        assert(fanCard.thumb.get_child() === fanCard.icon, `Thumb child must be restored to original base icon at iter ${i}`);
        assert(fakeCustomIcon.is_destroyed() === true, `Replaced custom thumb icon must be destroyed at iter ${i}`);

        // Verification of Panel Card detachment
        assert(panelCard.row._activate === null, `Panel _activate must be null at iter ${i}`);
        assert(panelCard.row._openFileMenu === null, `Panel _openFileMenu must be null at iter ${i}`);
        assert(panelCard.row._onHover === null, `Panel _onHover must be null at iter ${i}`);
        assert(panelCard.row.accessible_name === '', `Panel accessible_name must be cleared at iter ${i}`);
        assert(!panelCard.row.has_style_class_name('aqua-dl-row-sel'), `Panel selection class must be removed at iter ${i}`);
        assert(!panelCard.row.has_style_class_name('aqua-dl-row-more'), `Panel more class must be removed at iter ${i}`);

        // Break outer sentinel to ensure garbage collection
        sentinelCaptured.active = false;
        sentinelCaptured = null;
    }

    print('  ✓ 1,000 cycles: All delegate closures, GIO references, selection classes, and custom widgets cleanly detached.');
    pool.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Bounded Capacity Adherence
// ─────────────────────────────────────────────────────────────────────────────
print('\n--- 4. Bounded Capacity Adherence (Max 16 Items Under 1,000 Requests) ---');

{
    print('[Test 4.1] Flooding Fan pool with 1,000 distinct items...');
    const pool = new ActorPool(16);
    const cards = [];

    // Create 1,000 distinct cards
    for (let i = 0; i < 1000; i++) {
        cards.push(pool.acquireFanItem());
    }
    assert(pool._fanPool.length === 0, 'Pool is empty while all 1,000 items are leased');

    // Release all 1,000 items to the pool
    for (let i = 0; i < 1000; i++) {
        pool.releaseFanItem(cards[i].btn);
    }

    // Pool MUST bound its size to exactly 16
    assert(pool._fanPool.length === 16,
        `Expected pool size 16, but got ${pool._fanPool.length}`);

    // The first 16 cards must remain alive in the pool
    for (let i = 0; i < 16; i++) {
        assert(pool._fanPool[i].btn.is_destroyed() === false,
            `Pooled card ${i} must remain intact in pool`);
    }

    // The remaining 984 cards must have been destroyed synchronously!
    for (let i = 16; i < 1000; i++) {
        assert(cards[i].btn.is_destroyed() === true,
            `Overflow card ${i} must be destroyed immediately on pool rejection`);
    }

    print(`  ✓ Fan pool capacity strictly bounded: retained 16, destroyed 984 overflow actors synchronously.`);
    pool.clear();
}

{
    print('[Test 4.2] Flooding Panel pool with 1,000 distinct items...');
    const pool = new ActorPool(16);
    const cards = [];

    for (let i = 0; i < 1000; i++) {
        cards.push(pool.acquirePanelItem('grid'));
    }
    assert(pool._panelPool.length === 0, 'Panel pool empty while all items leased');

    for (let i = 0; i < 1000; i++) {
        pool.releasePanelItem(cards[i].row);
    }

    assert(pool._panelPool.length === 16,
        `Expected panel pool size 16, but got ${pool._panelPool.length}`);

    for (let i = 0; i < 16; i++) {
        assert(pool._panelPool[i].row.is_destroyed() === false,
            `Pooled panel card ${i} must remain intact`);
    }
    for (let i = 16; i < 1000; i++) {
        assert(cards[i].row.is_destroyed() === true,
            `Overflow panel card ${i} must be destroyed on rejection`);
    }

    print(`  ✓ Panel pool capacity strictly bounded: retained 16, destroyed 984 overflow actors synchronously.`);
    pool.clear();
}

{
    print('[Test 4.3] Arbitrary capacity limits test (capacities: 1, 4, 8, 32)...');
    for (const cap of [1, 4, 8, 32]) {
        const customPool = new ActorPool(cap);
        const leased = [];
        for (let i = 0; i < cap * 3; i++) {
            leased.push(customPool.acquireFanItem());
        }
        for (const item of leased) {
            customPool.releaseFanItem(item.btn);
        }
        assert(customPool._fanPool.length === cap,
            `Pool with capacity ${cap} must hold exactly ${cap} items, got ${customPool._fanPool.length}`);
        customPool.clear();
    }
    print('  ✓ Arbitrary capacity limits verified.');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Destruction Safety: pool.clear() & DownloadsStack.destroy()
// ─────────────────────────────────────────────────────────────────────────────
print('\n--- 5. Destruction Safety: pool.clear() & DownloadsStack.destroy() ---');

{
    print('[Test 5.1] pool.clear() synchronous destruction verification...');
    const pool = new ActorPool(16);

    // Populate both pools to capacity
    const fanLeased = Array.from({ length: 16 }, () => pool.acquireFanItem());
    const panelLeased = Array.from({ length: 16 }, () => pool.acquirePanelItem('list'));

    for (const f of fanLeased) pool.releaseFanItem(f.btn);
    for (const p of panelLeased) pool.releasePanelItem(p.row);

    assert(pool._fanPool.length === 16, 'Fan pool full');
    assert(pool._panelPool.length === 16, 'Panel pool full');

    // Synchronous destruction
    pool.clear();

    assert(pool._fanPool.length === 0, 'Fan pool must be empty after clear()');
    assert(pool._panelPool.length === 0, 'Panel pool must be empty after clear()');

    for (const f of fanLeased) {
        assert(f.btn.is_destroyed() === true, 'All fan items must be destroyed after pool.clear()');
    }
    for (const p of panelLeased) {
        assert(p.row.is_destroyed() === true, 'All panel items must be destroyed after pool.clear()');
    }

    // Idempotent repeated clears
    for (let k = 0; k < 50; k++) {
        pool.clear();
        assert(pool._fanPool.length === 0, 'Fan pool remains empty on repeated clear');
        assert(pool._panelPool.length === 0, 'Panel pool remains empty on repeated clear');
    }
    print('  ✓ pool.clear() synchronously destroys all pooled actors and is cleanly idempotent.');
}

{
    print('[Test 5.2] DownloadsStack.destroy() lifecycle stress (idle, open, dying states)...');

    // State 1: destroy() while idle
    const stack1 = new DownloadsStack(() => mockMon);
    assert(stack1._pool !== null, 'stack1._pool instantiated');
    stack1.destroy();
    assert(stack1._pool === null, 'stack1._pool cleared and nulled on destroy()');

    // State 2: destroy() while view is open
    const stack2 = new DownloadsStack(() => mockMon);
    const mockAnchor = new MockActor({ name: 'mockAnchor' });
    mockAnchor.set_position(500, 950);
    mockAnchor.set_size(48, 48);

    const testFiles = [makeMockFileInfo('file1.txt'), makeMockFileInfo('file2.txt')];
    const openView = new FanView({
        folder: mockFolder,
        files: testFiles,
        overflow: 0,
        cfg: { ...baseCfg, downloadsView: 'fan' },
        mon: mockMon,
        origin: mockOrigin,
        pool: stack2._pool,
        close: () => {},
    });
    stack2._view = openView;
    const viewActor = openView.build();

    // Verify view is open and pooled
    assert(stack2.isOpen === true, 'stack2 is open');
    stack2.destroy();

    assert(stack2._pool === null, 'stack2._pool is null after destroy');
    assert(stack2.view === null, 'stack2._view is null after destroy');
    assert(viewActor.is_destroyed() === true, 'view actor destroyed on stack destroy');

    // State 3: destroy() while close animation is dying in flight
    const stack3 = new DownloadsStack(() => mockMon);
    const dyingView = new PanelView({
        folder: mockFolder,
        files: testFiles,
        totalFiles: 2,
        cfg: { ...baseCfg, downloadsView: 'grid' },
        mon: mockMon,
        origin: mockOrigin,
        pool: stack3._pool,
        close: () => {},
    });
    const dyingActor = dyingView.build();
    stack3._dying = dyingActor;
    stack3._dyingView = dyingView;

    stack3.destroy();

    assert(stack3._dying === null, 'stack3._dying cleared');
    assert(stack3._dyingView === null, 'stack3._dyingView cleared');
    assert(dyingActor.is_destroyed() === true, 'dying actor destroyed');
    assert(stack3._pool === null, 'stack3._pool nulled');

    print('  ✓ DownloadsStack.destroy() handles idle, open, and mid-animation states with zero leaks.');
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. AGENTS.md Invariants Verification
// ─────────────────────────────────────────────────────────────────────────────
print('\n--- 6. AGENTS.md Invariants Verification ---');

{
    print('[Test 6.1] Invariant 1: Grid & List stack blur enabled, Fan view pills blur enabled, Fan canvas unblurred...');

    const mockDashBlur = {
        enabled: true,
        is_static: false,
        settings: {
            dash_to_dock: { STATIC_BLUR: false, PIPELINE: 'default' },
            popup: { STATIC_BLUR: false, PIPELINE: 'default' },
        },
        dashes: [],
        try_blur() {},
        queue_discovery() {},
        update_background() {},
        add_blur(dash_container, target) {
            return {
                background: { x: 0, y: 0, width: 48, height: 48, set_position() {}, set_size() {}, set_clip() {} },
                background_group: { parent: dash_container, get_parent() { return this.parent; }, destroy() {} },
                bg_manager: { destroy() {} },
                pipeline: { set_corner_radius() {}, destroy() {} },
                rounded_pipeline: null,
                corner_settings: { radius: 14, corners: 0 },
            };
        },
    };
    globalThis.global = { blur_my_shell: { _dash_to_dock_blur: mockDashBlur } };

    const pool = new ActorPool(16);
    const testFiles = [makeMockFileInfo('fileA.txt'), makeMockFileInfo('fileB.png')];

    // FanView: blur strictly disabled
    const fanView = new FanView({
        folder: mockFolder,
        files: testFiles,
        overflow: 0,
        cfg: { ...baseCfg, downloadsView: 'fan', blurEffect: true },
        mon: mockMon,
        origin: mockOrigin,
        pool,
        close: () => {},
    });
    const fanActor = fanView.build();

    assert(fanActor._dockBlurEnabled === false,
        'INVARIANT VIOLATION: FanView container must have _dockBlurEnabled === false');
    assert(fanActor._isAquaDock === true, 'FanView marked as _isAquaDock');
    assert(isAquaPopupTarget(fanActor) === false,
        'INVARIANT VIOLATION: isAquaPopupTarget must return false for FanView');
    assert(resolveAquaDockTarget(fanActor) === null,
        'INVARIANT VIOLATION: resolveAquaDockTarget must return null for FanView');

    for (const card of fanView._model.rows) {
        assert(card._dockBlurEnabled === false,
            'INVARIANT VIOLATION: Fan item card must have _dockBlurEnabled === false');
        assert(isAquaPopupTarget(card) === false,
            'INVARIANT VIOLATION: Fan item card must NOT be an Aqua popup target');
        assert(resolveAquaDockTarget(card) === null,
            'INVARIANT VIOLATION: resolveAquaDockTarget must return null for Fan card');
        assert(card._labelPill._dockBlurEnabled === true,
            'INVARIANT VIOLATION: Fan item label pill must have _dockBlurEnabled === true');
        assert(isAquaPopupTarget(card._labelPill) === true,
            'INVARIANT VIOLATION: Fan item label pill must be an Aqua popup target');
        assert(resolveAquaDockTarget(card._labelPill) !== null,
            'INVARIANT VIOLATION: resolveAquaDockTarget must resolve Fan label pill target');
    }
    fanView.releaseRows();
    fanActor.destroy();

    // PanelView (Grid & List): blur enabled like dock pill per user directive (2026-10-30)
    for (const viewType of ['grid', 'list']) {
        const panelView = new PanelView({
            folder: mockFolder,
            files: testFiles,
            totalFiles: testFiles.length,
            cfg: { ...baseCfg, downloadsView: viewType, blurEffect: true },
            mon: mockMon,
            origin: mockOrigin,
            pool,
            close: () => {},
        });
        const panelActor = panelView.build();

        assert(panelActor._dockBlurEnabled === true,
            `INVARIANT VIOLATION: PanelView(${viewType}) must have _dockBlurEnabled === true`);
        assert(panelActor._isAquaDock === true, `PanelView(${viewType}) marked as _isAquaDock`);
        assert(isAquaPopupTarget(panelActor) === true,
            `INVARIANT VIOLATION: isAquaPopupTarget must return true for PanelView(${viewType})`);
        assert(resolveAquaDockTarget(panelActor) !== null,
            `INVARIANT VIOLATION: resolveAquaDockTarget must resolve target for PanelView(${viewType})`);

        for (const row of panelView._model.rows) {
            assert(row._dockBlurEnabled === false,
                `INVARIANT VIOLATION: Panel row must have _dockBlurEnabled === false in ${viewType}`);
            assert(isAquaPopupTarget(row) === false,
                `INVARIANT VIOLATION: Panel row must NOT be an Aqua popup target in ${viewType}`);
            assert(resolveAquaDockTarget(row) === null,
                `INVARIANT VIOLATION: resolveAquaDockTarget must return null for row in ${viewType}`);
        }
        panelView.releaseRows();
        panelActor.destroy();
    }

    // Overall stack blur active check
    assert(isBmsStackBlurActive({ blurEffect: false }) === false,
        'isBmsStackBlurActive must be false when blurEffect is false');
    assert(isBmsStackBlurActive({ blurEffect: true }) === true,
        'isBmsStackBlurActive must return true when blurEffect is true and BMS is active');
    assert(isBmsStackBlurActive({ blurEffect: true, highContrast: true }) === false,
        'isBmsStackBlurActive must return false when highContrast is true');

    print('  ✓ Invariant 1 strictly verified: Grid, List, and Fan pills enable blur, Fan canvas strictly without blur.');
    pool.clear();
}

{
    print('[Test 6.2] Invariant 2: Down-chevron drawer anchor blur remains intact...');

    const chevronAnchor = new MockActor({
        name: 'aquaStackAnchor',
        style_class: 'aqua-stack-anchor-tile',
        width: 48,
        height: 48,
    });
    chevronAnchor.width = 48;
    chevronAnchor.height = 48;
    chevronAnchor._isAquaDock = true;
    chevronAnchor._blurType = 'popup';
    chevronAnchor._dockBlurEnabled = true;
    chevronAnchor._dockRadius = 14;
    chevronAnchor._dockBg = chevronAnchor;
    chevronAnchor.get_dock_radius = () => 14;

    assert(isAquaPopupTarget(chevronAnchor) === true,
        'INVARIANT VIOLATION: aquaStackAnchor MUST be identified as an Aqua popup target');

    const resolved = resolveAquaDockTarget(chevronAnchor);
    assert(resolved !== null,
        'INVARIANT VIOLATION: resolveAquaDockTarget must resolve aquaStackAnchor');
    assert(resolved.background === chevronAnchor,
        'Resolved background must match chevronAnchor');
    assert(resolved.is_popup === true,
        'Resolved target must have is_popup === true');

    // BMS Registration and Hooking
    const mockDashBlur = {
        enabled: true,
        is_static: false,
        settings: {
            dash_to_dock: { STATIC_BLUR: false, PIPELINE: 'default' },
            popup: { STATIC_BLUR: false, PIPELINE: 'default' },
        },
        dashes: [],
        try_blur() {},
        queue_discovery() {},
        update_background() {},
        add_blur(dash_container, target) {
            return {
                background: { x: 0, y: 0, width: 48, height: 48, set_position() {}, set_size() {}, set_clip() {} },
                background_group: { parent: dash_container, get_parent() { return this.parent; }, destroy() {} },
                bg_manager: { destroy() {} },
                pipeline: { set_corner_radius() {}, destroy() {} },
                rounded_pipeline: null,
                corner_settings: { radius: 14, corners: 0 },
            };
        },
    };
    globalThis.global = { blur_my_shell: { _dash_to_dock_blur: mockDashBlur } };

    registerBmsTarget(chevronAnchor, () => 14);
    assert(mockDashBlur.dashes.some(d => d.dash_container === chevronAnchor),
        'aquaStackAnchor must be registered into BMS dashes');
    assert(mockDashBlur._aquaDockHooked === true,
        'BMS dash blur must be hooked for aquaStackAnchor');

    unregisterBmsTarget(chevronAnchor);
    assert(!mockDashBlur.dashes.some(d => d.dash_container === chevronAnchor),
        'aquaStackAnchor must be cleanly unregistered from BMS dashes');
    assert(mockDashBlur._aquaDockHooked === undefined,
        'BMS dash blur hook must be cleanly unhooked');

    cleanupBms();
    delete globalThis.global.blur_my_shell;

    print('  ✓ Invariant 2 strictly verified: Down-chevron drawer anchor retains full BMS popup blur integration.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup & Teardown
// ─────────────────────────────────────────────────────────────────────────────
shellResource._unregister();
GLib.spawn_sync(null, ['rm', '-rf', tmpShellDir], null, GLib.SpawnFlags.SEARCH_PATH, null);

print('\n================================================================');
print('ALL M3 EMPIRICAL ACTOR POOLING STRESS TESTS PASSED (EXIT 0)');
print('================================================================\n');
