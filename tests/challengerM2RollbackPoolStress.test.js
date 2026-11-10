// Empirical Adversarial Stress Test for Milestone 2:
// Separator recycling, pool bounded capacity, transactional rollback on construction failure,
// destroyAll() cleanup, sub-pixel motion dispatch, and badge settling synchronization.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`[EMPIRICAL CHALLENGER ASSERTION FAILED] ${message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup mock Shell resource for imports
// ─────────────────────────────────────────────────────────────────────────────
const tmpShellDir = GLib.dir_make_tmp('aqua-m2challenger-XXXXXX');
const mainJsPath = GLib.build_filenamev([tmpShellDir, 'main.js']);
const popupMenuJsPath = GLib.build_filenamev([tmpShellDir, 'popupMenu.js']);
const configJsPath = GLib.build_filenamev([tmpShellDir, 'config.js']);
const boxpointerJsPath = GLib.build_filenamev([tmpShellDir, 'boxpointer.js']);
const appFavoritesJsPath = GLib.build_filenamev([tmpShellDir, 'appFavorites.js']);
const appMenuJsPath = GLib.build_filenamev([tmpShellDir, 'appMenu.js']);
const dialogJsPath = GLib.build_filenamev([tmpShellDir, 'dialog.js']);
const modalDialogJsPath = GLib.build_filenamev([tmpShellDir, 'modalDialog.js']);
const dndJsPath = GLib.build_filenamev([tmpShellDir, 'dnd.js']);
const xmlPath = GLib.build_filenamev([tmpShellDir, 'shell.gresource.xml']);
const resPath = GLib.build_filenamev([tmpShellDir, 'shell.gresource']);

GLib.file_set_contents(configJsPath, 'export const PACKAGE_VERSION = "50.0";\n');
GLib.file_set_contents(boxpointerJsPath, 'export const PopupAnimation = { FULL: 1, FADE: 2, SLIDE: 3 };\nexport class BoxPointer {}\n');
GLib.file_set_contents(appFavoritesJsPath, 'export function getAppFavorites() { return { getFavorites: () => [], connect: () => 1, disconnect: () => {} }; }\n');
GLib.file_set_contents(appMenuJsPath, 'export class AppMenu { constructor() {} }\n');
GLib.file_set_contents(dialogJsPath, 'export class Dialog { constructor() {} }\n');
GLib.file_set_contents(modalDialogJsPath, 'export class ModalDialog { constructor() {} }\n');
GLib.file_set_contents(dndJsPath, 'export const DragMotionResult = { NO_DROP: 0, COPY_DROP: 1, MOVE_DROP: 2 };\nexport function makeDraggable() { return { connect: () => 1, disconnect: () => {} }; }\n');
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
    <file>boxpointer.js</file>
    <file>appFavorites.js</file>
    <file>appMenu.js</file>
    <file>dialog.js</file>
    <file>modalDialog.js</file>
    <file>dnd.js</file>
  </gresource>
  <gresource prefix="/org/gnome/shell/misc">
    <file>config.js</file>
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

// Track all instantiated actors
let totalActorsInstantiated = 0;
let totalSeparatorsInstantiated = 0;
let totalSeparatorsDestroyed = 0;
const trackedSeparators = new Set();

class MockActor {
    constructor(...args) {
        this.id = ++totalActorsInstantiated;
        this.name = '';
        this.style_class = '';
        this.style = '';
        this.visible = true;
        this._parent = null;
        this.destroyed = false;
        this.transitions = [];
        this.reactive = true;
        this._children = [];
        this.scaleTarget = 1;
        this.scaleCurrent = 1;
        this.vel = 0;
        this._lastBadgeScale = -1;

        if (typeof this._init === 'function') {
            this._init(...args);
        }
    }

    _init(props = {}) {
        if (props) {
            if (props.name) this.name = props.name;
            if (props.style_class) {
                this.style_class = props.style_class;
                if (this.style_class.includes('aqua-separator') || this.style_class.includes('aqua-spacer')) {
                    trackedSeparators.add(this);
                    totalSeparatorsInstantiated++;
                }
            }
        }
    }

    set_style(s) { this.style = s; }
    set_position(x, y) { this.x = x; this.y = y; }
    set_size(w, h) { this.width = w; this.height = h; }
    set_pivot_point(px, py) { this.pivot_x = px; this.pivot_y = py; }
    set_scale(sx, sy) { this.scale_x = sx; this.scale_y = sy; }
    set_gicon(g) { this.gicon = g; }
    set_style_class_name(s) { this.style_class = s; }
    set_clip_to_allocation(v) { this._clipToAllocation = v; }
    connect(sig, cb) { return 1; }
    disconnect(id) {}
    emit(sig, ...args) {}
    queue_relayout() {}
    set_text(t) { this.text = t; }
    set_icon_size(s) { this.icon_size = s; }
    set_icon_name(n) { this.icon_name = n; }
    get_transformed_position() { return [this.x || 0, this.y || 0]; }
    get_transformed_size() { return [this.width || 0, this.height || 0]; }
    remove_all_transitions() { this.transitions = []; }
    get_parent() { return this._parent; }
    is_destroyed() { return this.destroyed; }

    add_child(c) {
        if (!c) return;
        if (!this._children.includes(c)) {
            this._children.push(c);
        }
        c._parent = this;
    }

    remove_child(c) {
        if (!c) return;
        const i = this._children.indexOf(c);
        if (i >= 0) this._children.splice(i, 1);
        if (c._parent === this) c._parent = null;
    }

    destroy_all_children() {
        for (const c of [...this._children]) {
            c.destroy?.();
        }
        this._children = [];
    }

    remove_all_children() {
        for (const c of this._children) {
            if (c._parent === this) c._parent = null;
        }
        this._children = [];
    }

    get_children() {
        return [...this._children];
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (trackedSeparators.has(this)) {
            totalSeparatorsDestroyed++;
        }
        if (this._parent) {
            this._parent.remove_child(this);
            this._parent = null;
        }
        for (const c of [...this._children]) {
            c.destroy?.();
        }
        this._children = [];
    }

    refresh() {}
    setGicon(gicon) { this.gicon = gicon; }
}

GObject.registerClass = function(meta, cls) {
    if (typeof meta === 'function') return meta;
    return cls;
};
St.Widget = MockActor;
St.DrawingArea = MockActor;
St.Icon = MockActor;
St.Label = MockActor;
St.Button = MockActor;
St.Bin = MockActor;
St.BoxLayout = MockActor;
Clutter.FixedLayout = function() {};

// Dynamic module imports
const { DockFactory } = await import('../dock/dockFactory.js');
const { DockController } = await import('../dock/dockController.js');
const { DockItem } = await import('../dock/dockItem.js');

print('================================================================');
print('CHALLENGER EMPIRICAL ADVERSARIAL STRESS TEST: MILESTONE 2 FIX');
print('================================================================\n');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Transactional Layout Error Rollback in DockFactory
// ─────────────────────────────────────────────────────────────────────────────
print('--- 1. Transactional Layout Error Rollback in DockFactory ---');

{
    print('[Test 1.1] Intentional failure on DockItem creation preserves existing chips & separators...');

    const container = new MockActor({ name: 'dockContainer' });
    const factory = new DockFactory(container, null);
    const cfg = { cellW: 64, vertical: false, position: 'bottom' };

    // Initial stable layout: 2 apps, 2 separators
    const initialEntries = [
        { key: 'app_initial_1', kind: 'app' },
        { key: 'sep_initial_1', kind: 'separator' },
        { key: 'app_initial_2', kind: 'app' },
        { key: 'sep_initial_2', kind: 'spacer' },
    ];
    factory.sync(initialEntries, cfg);

    assert(factory.chips.length === 4, 'Initial layout has 4 chips');
    assert(factory.items.length === 2, 'Initial layout has 2 items');
    assert(container.get_children().length === 4, 'Container has 4 child actors');

    // Snapshot existing chips and their actors
    const origChips = [...factory.chips];
    const origSeparators = origChips.filter(c => !c.item).map(c => c.actor);
    const origItems = origChips.filter(c => c.item).map(c => c.actor);

    assert(origSeparators.length === 2, '2 separators in initial layout');
    assert(origSeparators[0].style_class === 'aqua-separator', 'Sep 0 style class is aqua-separator');
    assert(origSeparators[1].style_class === 'aqua-spacer', 'Sep 1 style class is aqua-spacer');
    for (const sep of origSeparators) {
        assert(sep.visible === true, 'Sep is visible');
        assert(sep.get_parent() === container, 'Sep is child of container');
        assert(!sep.destroyed, 'Sep is not destroyed');
    }

    // Now populate the separator pool with 2 spare separators
    factory._separatorPool.push(new MockActor({ style_class: '' }));
    factory._separatorPool.push(new MockActor({ style_class: '' }));
    assert(factory._separatorPool.length === 2, 'Pool has 2 spare separators');
    const sparePoolSepIds = factory._separatorPool.map(s => s.id);

    // Trigger intentional construction failure:
    // Layout contains: 1 reused sep, 1 created sep, 1 reused app, 1 FAILING app
    let thrown = false;
    try {
        const toxicEntries = [
            { key: 'app_initial_1', kind: 'app' },
            { key: 'sep_new_1', kind: 'separator' }, // will pop from pool
            { key: 'sep_new_2', kind: 'separator' }, // will pop from pool
            { key: 'sep_new_3', kind: 'separator' }, // pool empty -> will create new
            {
                get key() { throw new Error('INTENTIONAL_REBUILD_FAILURE_1'); },
                kind: 'app',
            },
        ];
        factory.sync(toxicEntries, cfg);
    } catch (e) {
        thrown = true;
        assert(e.message === 'INTENTIONAL_REBUILD_FAILURE_1', `Expected intentional failure, got ${e.message}`);
    }
    assert(thrown === true, 'Exception must be propagated out of sync()');

    // VERIFICATION: Existing layout must be 100% intact!
    assert(factory.chips.length === 4,
        `Chips length must remain 4 after rollback (got ${factory.chips.length})`);
    assert(factory.items.length === 2,
        `Items length must remain 2 after rollback (got ${factory.items.length})`);

    // Verify chips reference identity
    for (let i = 0; i < 4; i++) {
        assert(factory.chips[i] === origChips[i],
            `Chip ${i} reference must remain identical after rollback!`);
        assert(factory.chips[i].actor === origChips[i].actor,
            `Chip ${i} actor must remain identical after rollback!`);
    }

    // Verify container child actors
    const currentContainerChildren = container.get_children();
    assert(currentContainerChildren.length === 4,
        `Container must still have exactly 4 children (got ${currentContainerChildren.length})`);
    for (const c of currentContainerChildren) {
        assert(origChips.some(chip => chip.actor === c),
            `Container child actor #${c.id} was not in original layout! Stray actor detected.`);
    }

    // Verify visual properties of existing separators
    assert(origSeparators[0].style_class === 'aqua-separator',
        `Sep 0 style_class must remain aqua-separator (got "${origSeparators[0].style_class}")`);
    assert(origSeparators[1].style_class === 'aqua-spacer',
        `Sep 1 style_class must remain aqua-spacer (got "${origSeparators[1].style_class}")`);
    for (const sep of origSeparators) {
        assert(sep.visible === true, 'Original separator must remain visible');
        assert(sep.get_parent() === container, 'Original separator must remain attached to container');
        assert(!sep.destroyed, 'Original separator must not be destroyed');
    }

    // Verify pool recovery: the 2 popped separators must have been recycled back to pool
    assert(factory._separatorPool.length === 2,
        `Separator pool must have 2 returned separators (got ${factory._separatorPool.length})`);
    for (const sep of factory._separatorPool) {
        assert(sep.get_parent() === null,
            `Returned pooled separator #${sep.id} must NOT have a parent (got ${sep.get_parent()})`);
        assert(sep.style_class === '',
            `Returned pooled separator #${sep.id} must have cleared style_class`);
        assert(!sep.destroyed,
            `Returned pooled separator #${sep.id} must not be destroyed`);
        assert(sparePoolSepIds.includes(sep.id),
            `Returned separator #${sep.id} must match one of the original spare IDs`);
    }

    print('  ✓ Rollback after item construction failure: 100% of existing chips & separators remain attached, visible, and undamaged.');
    factory.destroyAll();
}

{
    print('[Test 1.2] Intentional failure during reused item refresh() loop...');

    const container = new MockActor({ name: 'dockContainer' });
    const factory = new DockFactory(container, null);
    const cfg = { cellW: 64, vertical: false, position: 'bottom' };

    let throwOnRefresh = false;
    class MockFailingItem extends MockActor {
        constructor(entry, c) {
            super();
            this.entry = entry;
            this._cfg = c;
            this.refreshCalls = 0;
        }
        refresh() {
            this.refreshCalls++;
            if (throwOnRefresh && this.entry.key === 'app_fail_on_refresh') {
                throw new Error('INTENTIONAL_REFRESH_FAILURE');
            }
        }
    }

    // Populate initial layout with 2 items and 1 separator
    const item1 = new MockFailingItem({ key: 'app_normal', gicon: 'icon1' }, cfg);
    const item2 = new MockFailingItem({ key: 'app_fail_on_refresh', gicon: 'icon2' }, cfg);
    const sepActor = new MockActor({ style_class: 'aqua-separator' });

    factory._items = [item1, item2];
    factory._chips = [
        { entry: item1.entry, actor: item1, item: item1, w: 64 },
        { entry: { key: 'sep_1', kind: 'separator' }, actor: sepActor, item: null, w: 10 },
        { entry: item2.entry, actor: item2, item: item2, w: 64 },
    ];
    container.add_child(item1);
    container.add_child(sepActor);
    container.add_child(item2);

    const prevEntry1 = item1.entry;
    const prevEntry2 = item2.entry;

    // Trigger rebuild where item1 refreshes successfully, then item2 throws in refresh()
    throwOnRefresh = true;
    let thrown = false;
    try {
        const toxicEntries = [
            { key: 'app_normal', gicon: 'new_icon1', kind: 'app' },
            { key: 'app_fail_on_refresh', gicon: 'new_icon2', kind: 'app' },
            { key: 'sep_1', kind: 'separator' },
        ];
        factory.sync(toxicEntries, cfg);
    } catch (e) {
        thrown = true;
        assert(e.message === 'INTENTIONAL_REFRESH_FAILURE', `Caught ${e.message}`);
    }
    assert(thrown === true, 'Error must throw');

    // Verify rollback restored item1's previous entry
    assert(item1.entry === prevEntry1, 'item1 entry rolled back to previousEntry');
    assert(item2.entry === prevEntry2, 'item2 entry rolled back to previousEntry');
    assert(sepActor.get_parent() === container, 'Separator remains child of container');
    assert(sepActor.style_class === 'aqua-separator', 'Separator style class intact');
    assert(sepActor.visible === true, 'Separator remains visible');
    assert(factory.chips.length === 3, 'Chips array unchanged');

    print('  ✓ Rollback during reused item refresh(): items restored to previous entry/cfg, separators undamaged.');
    factory.destroyAll();
}

{
    print('[Test 1.3] 50 consecutive chaotic construction failures...');

    const container = new MockActor({ name: 'dockContainer' });
    const factory = new DockFactory(container, null);
    const cfg = { cellW: 64, vertical: false, position: 'bottom' };

    // Baseline layout
    const baselineEntries = [
        { key: 'b_app_1', kind: 'app' },
        { key: 'b_sep_1', kind: 'separator' },
        { key: 'b_app_2', kind: 'app' },
        { key: 'b_sep_2', kind: 'spacer' },
        { key: 'b_app_3', kind: 'app' },
    ];
    factory.sync(baselineEntries, cfg);
    assert(container.get_children().length === 5, '5 children in container');

    const origActors = factory.chips.map(c => c.actor);

    for (let run = 0; run < 50; run++) {
        const failIndex = run % 8;
        const toxicEntries = [];
        for (let i = 0; i < 10; i++) {
            if (i === failIndex) {
                toxicEntries.push({
                    get key() { throw new Error(`FAIL_CHAOS_${run}_${i}`); },
                    kind: 'app',
                });
            } else if (i % 3 === 1) {
                toxicEntries.push({ key: `sep_run_${run}_${i}`, kind: 'separator' });
            } else {
                toxicEntries.push({ key: `app_run_${run}_${i}`, kind: 'app' });
            }
        }

        let failed = false;
        try {
            factory.sync(toxicEntries, cfg);
        } catch (e) {
            failed = true;
            assert(e.message.startsWith('FAIL_CHAOS_'), `Unexpected error: ${e.message}`);
        }
        assert(failed === true, `Run ${run}: must fail`);

        // Check container and chips integrity after every single failure
        assert(factory.chips.length === 5, `Run ${run}: chips length preserved`);
        assert(container.get_children().length === 5, `Run ${run}: container child count preserved`);
        for (let j = 0; j < 5; j++) {
            assert(factory.chips[j].actor === origActors[j],
                `Run ${run}: actor ${j} corrupted`);
            assert(origActors[j].get_parent() === container,
                `Run ${run}: actor ${j} unparented`);
            assert(origActors[j].visible === true,
                `Run ${run}: actor ${j} visibility lost`);
        }
    }

    print('  ✓ 50 consecutive chaotic construction failures survived with 100% layout preservation.');
    factory.destroyAll();
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 500 Successful Rebuilds: Separator Pool <= 16 & destroyAll() Cleanup
// ─────────────────────────────────────────────────────────────────────────────
print('\n--- 2. 500 Successful Rebuilds: Separator Pool <= 16 & destroyAll() ---');

{
    print('[Test 2.1] 500 rebuilds with dynamic item and separator populations...');

    const container = new MockActor({ name: 'dockContainer' });
    const factory = new DockFactory(container, null);
    const cfg = { cellW: 64, vertical: false, position: 'bottom' };

    let maxObservedPool = 0;
    const TOTAL_REBUILDS = 500;

    for (let cycle = 0; cycle < TOTAL_REBUILDS; cycle++) {
        // Vary entries: between 2 and 40 items
        const numItems = 2 + (cycle % 38);
        const entries = [];

        // Dynamic separator distribution:
        // Every 3rd cycle has 0 separators
        // Every 5th cycle has high density (60%)
        // Others have ~25%
        const sepRatio = (cycle % 3 === 0) ? 0 : ((cycle % 5 === 0) ? 0.6 : 0.25);

        for (let i = 0; i < numItems; i++) {
            const isSep = Math.random() < sepRatio;
            if (isSep) {
                const kind = (i % 2 === 0) ? 'separator' : 'spacer';
                entries.push({ key: `sep_${cycle}_${i}`, kind });
            } else {
                entries.push({ key: `app_${i % 15}`, kind: 'app', gicon: null });
            }
        }

        // Execute sync
        factory.sync(entries, cfg);

        // Verify pool size bound <= 16
        const poolSize = factory._separatorPool.length;
        if (poolSize > maxObservedPool) {
            maxObservedPool = poolSize;
        }
        assert(poolSize <= 16,
            `Cycle ${cycle}: separator pool exceeded capacity 16 (got ${poolSize})`);

        // Verify pool item invariants
        for (const sep of factory._separatorPool) {
            assert(!sep.destroyed,
                `Cycle ${cycle}: destroyed actor found inside separator pool`);
            assert(sep.get_parent() === null,
                `Cycle ${cycle}: pooled separator has dangling parent`);
            assert(sep.style_class === '',
                `Cycle ${cycle}: pooled separator style_class not cleared`);
        }

        // Verify active chip invariants
        const activeSeparators = new Set();
        for (const chip of factory.chips) {
            assert(!chip.actor.destroyed,
                `Cycle ${cycle}: active chip actor is destroyed`);
            assert(chip.actor.get_parent() === container,
                `Cycle ${cycle}: active chip actor not attached to container`);
            assert(chip.actor.visible === true,
                `Cycle ${cycle}: active chip actor is not visible`);

            if (!chip.item) {
                activeSeparators.add(chip.actor);
                assert(chip.actor.style_class === 'aqua-separator' || chip.actor.style_class === 'aqua-spacer',
                    `Cycle ${cycle}: active separator has invalid style_class "${chip.actor.style_class}"`);
            }
        }

        // Zero unmanaged actor leaks: active and pooled sets must be strictly disjoint
        for (const sep of factory._separatorPool) {
            assert(!activeSeparators.has(sep),
                `Cycle ${cycle}: Actor #${sep.id} is BOTH in separator pool AND active in chips!`);
        }
    }

    print(`  ✓ 500 rebuilds completed.`);
    print(`  ✓ Maximum observed pool size: ${maxObservedPool} / 16 (strictly bounded <= 16).`);

    // Verify destroyAll() cleanup
    print('[Test 2.2] Testing destroyAll() destruction safety and pool emptying...');
    const poolSizeBeforeDestroy = factory._separatorPool.length;
    const activeSepsBeforeDestroy = factory.chips.filter(c => !c.item).length;
    const totalSepsBeforeDestroy = poolSizeBeforeDestroy + activeSepsBeforeDestroy;

    factory.destroyAll();

    assert(factory._separatorPool.length === 0,
        `destroyAll() must empty _separatorPool (got ${factory._separatorPool.length})`);
    assert(factory.chips.length === 0,
        `destroyAll() must empty chips (got ${factory.chips.length})`);
    assert(factory.items.length === 0,
        `destroyAll() must empty items (got ${factory.items.length})`);
    assert(factory._container === null,
        'destroyAll() must clear _container');
    assert(factory._onItemCreated === null,
        'destroyAll() must clear _onItemCreated');

    // Verify all tracked separators are destroyed
    let survivingSeparators = 0;
    for (const sep of trackedSeparators) {
        if (!sep.destroyed) survivingSeparators++;
    }
    assert(survivingSeparators === 0,
        `destroyAll() left ${survivingSeparators} undestroyed separator actors! Total tracked: ${trackedSeparators.size}`);

    print(`  ✓ destroyAll() cleanly destroyed all ${totalSepsBeforeDestroy} active & pooled separators (zero leaks, zero survivors).`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Sub-Pixel Motion Accumulation & Badge Scale Synchronization
// ─────────────────────────────────────────────────────────────────────────────
print('\n--- 3. Sub-Pixel Motion Accumulation & Badge Scale Sync ---');

{
    print('[Test 3.1] Continuous sub-pixel mouse movement (0.2px steps) accumulates distance and triggers kicks...');

    class MockEvent {
        constructor(x, y, type = Clutter.EventType.MOTION) {
            this.x = x;
            this.y = y;
            this._type = type;
        }
        get_coords() { return [this.x, this.y]; }
        type() { return this._type; }
    }

    const controller = Object.create(DockController.prototype);
    controller._pointerInContainer = false;
    controller._pointerInMag = false;
    controller._pointerInEdge = false;
    controller._lastPointerX = NaN;
    controller._lastPointerY = NaN;
    controller._drag = { reordering: false };
    controller._updatePressedDrag = () => false;
    controller._autohide = { onDockActivity() {} };
    controller._cancelEndHover = () => {};
    controller._geom = { vert: false, x: 100, y: 800, thick: 70 };

    let kicks = 0;
    let pickCalls = 0;
    let setPointerCalls = 0;

    controller._engine = {
        setPointer(x, y, active) { setPointerCalls++; },
        kick() { kicks++; },
    };
    controller._pickItem = (x, y) => {
        pickCalls++;
        return { x, y };
    };
    controller._setHover = () => {};

    // Simulate mouse moving 200px across the dock in 0.2px steps (1,001 motion events)
    for (let i = 0; i <= 1000; i++) {
        const x = 100 + i * 0.2;
        const y = 835;
        controller._onMotion(new MockEvent(x, y));
    }

    // Since step size is 0.2px, distance accumulates:
    // Step 0: init (pick #1)
    // Step 1: 0.2px (< 0.5) -> skips pick, keeps baseline at step 0
    // Step 2: 0.4px (< 0.5) -> skips pick, keeps baseline at step 0
    // Step 3: 0.6px (>= 0.5) -> triggers pick #2, baseline updates to step 3!
    // Expected picks over 1,000 steps = 1 + floor(1000 / 3) = 334 picks!
    print(`  Dispatches over 200px: kicks=${kicks}, picks=${pickCalls}, setPointerCalls=${setPointerCalls}`);
    assert(pickCalls >= 333 && pickCalls <= 335,
        `Expected ~334 picks across 200px with 0.2px steps, got ${pickCalls}`);
    assert(kicks >= 333 && kicks <= 335,
        `Expected ~334 kicks across 200px with 0.2px steps, got ${kicks}`);
    assert(setPointerCalls === 1001,
        `All 1,001 events must feed engine pointer coordinates (got ${setPointerCalls})`);

    print('  ✓ Sub-pixel motion correctly accumulates without swallowing continuous movement.');
}

{
    print('[Test 3.2] DockItem settleMotion() synchronizes _lastBadgeScale to scaleCurrent...');

    const mockItem = Object.create(DockItem.prototype);
    mockItem._cfg = { vertical: false, position: 'bottom', hoverLift: 16 };
    mockItem._vert = false;
    mockItem._isRight = false;
    mockItem.scaleCurrent = 1.65;
    mockItem._lastBadgeScale = 1.0; // Desynchronized
    mockItem._syncTextureTier = () => {};
    mockItem._badge = {
        visible: true,
        translation_x: 0,
        translation_y: 0,
        get_preferred_width: () => [0, 20],
        get_preferred_height: () => [0, 20],
        remove_all_transitions() {},
    };
    mockItem._badgeW = 20;
    mockItem._badgeH = 20;
    mockItem._baseIconSize = 48;
    mockItem._iconBaseX = 10;
    mockItem._iconBaseY = 10;
    mockItem._pivotX = 0.5;
    mockItem._pivotY = 0.5;
    mockItem._liftProp = 'translation_y';
    mockItem._liftSign = -1;
    mockItem._liftDenom = 1.0;
    mockItem._iconLift = -16;
    mockItem._icon = {
        set_scale() {},
        translation_x: 0,
        translation_y: 0,
    };

    mockItem.settleMotion();

    assert(mockItem._lastBadgeScale === mockItem.scaleCurrent,
        `settleMotion() must synchronize _lastBadgeScale to scaleCurrent (${mockItem.scaleCurrent}), got ${mockItem._lastBadgeScale}`);

    print('  ✓ settleMotion() badge scale synchronization verified.');
}

// Cleanup temp shell dir
GLib.spawn_sync(null, ['rm', '-rf', tmpShellDir], null, GLib.SpawnFlags.SEARCH_PATH, null);

print('\n================================================================');
print('ALL EMPIRICAL CHALLENGER TESTS PASSED WITHOUT DEFECT (EXIT 0)');
print('================================================================\n');
