// Dedicated Empirical Stress Test Suite for Milestone 3 Challenger 2:
// 1. downloads/fanGeometry.js: N in [1, 24], bit-exact equivalence (|delta| < 1e-12), monotonic arc progression, orientations
// 2. LRU Cache Stress:
//    - services/fileService.js: 600+ insertions, size bound <= 128, LRU refresh & eviction, clearIconCaches purge
//    - dock/dockLayout.js: 600+ insertions, size bounds (ALPHA_CACHE <= 128, PILL_STYLE_CACHE <= 64), LRU order, clearDockLayoutCache purge
//    - downloads/tileStyle.js: getRowStyles caching, capacity bound <= 64, clearTileStyleCache purge
// 3. Invariant Stress: 500 simulated BMS enable/disable cycles and dock anchor queries (reject stacks, accept anchor)

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function assert(condition, message) {
    if (!condition) {
        throw new Error(`[CHALLENGE 2 ASSERTION FAILED] ${message}`);
    }
}

// Set up mock GNOME Shell UI resource for modules importing resource:///org/gnome/shell/ui/main.js
const tmpShellDir = GLib.dir_make_tmp('aqua-m3stress-XXXXXX');
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

// Import target modules
const {
    STACK_CLEARANCE,
    aboveDockY,
    fanOrientation,
    sideFanX,
    FAN_CELL_OFFSETS,
    getFanCellOffsets,
} = await import('../downloads/fanGeometry.js');

const {
    getCachedThemedIcon,
    getCachedFileIcon,
    getCachedIconForExtension,
    clearFileIconCache,
    clearThemedIconCache,
    clearIconCaches,
} = await import('../services/fileService.js');

const {
    applyAlpha,
    pillStyle,
    clearDockLayoutCache,
} = await import('../dock/dockLayout.js');

const {
    getRowStyles,
    clearTileStyleCache,
    NORMAL_ROW_STYLES,
    HOVER_ROW_STYLES,
} = await import('../downloads/tileStyle.js');

const {
    isAquaPopupTarget,
    resolveAquaDockTarget,
    registerBmsTarget,
    unregisterBmsTarget,
    cleanupBms,
} = await import('../dock/dockBlur.js');

print('=== Aqua Dock Pro Milestone 3 Challenger 2: Geometry & LRU Cache Stress Suite ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// PART 1: downloads/fanGeometry.js EMPIRICAL STRESS
// ─────────────────────────────────────────────────────────────────────────────
print('[Part 1] Testing fanGeometry.js for N in [1, 24], bit-exact equivalence, monotonicity, & orientations...');

assert(Object.isFrozen(FAN_CELL_OFFSETS), 'FAN_CELL_OFFSETS top-level array must be deeply frozen');
assert(FAN_CELL_OFFSETS.length === 13, 'FAN_CELL_OFFSETS must have length 13 (indices 0..12)');

// Mathematical reference calculation
function computeReferenceCells(n) {
    const cells = new Array(n);
    for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 0;
        const x = Math.pow(t, 1.35);
        const y = -i;
        const angle = n > 1 ? Math.atan2(45 * x, (i * 60) || 1) : 0;
        const normX = x;
        const normY = n > 1 ? -i / (n - 1) : 0;
        cells[i] = { x, y, angle, t, normX, normY };
    }
    return cells;
}

const EPSILON = 1e-12;

for (let n = 1; n <= 24; n++) {
    const refCells = computeReferenceCells(n);
    let testedCells;

    if (n <= 12) {
        testedCells = FAN_CELL_OFFSETS[n];
        assert(Array.isArray(testedCells), `FAN_CELL_OFFSETS[${n}] must be an array`);
        assert(Object.isFrozen(testedCells), `FAN_CELL_OFFSETS[${n}] array must be frozen`);
        assert(getFanCellOffsets(n) === testedCells, `getFanCellOffsets(${n}) must return frozen LUT instance by reference`);
    } else {
        testedCells = getFanCellOffsets(n);
        assert(Array.isArray(testedCells), `getFanCellOffsets(${n}) must return dynamically computed array for n > 12`);
    }

    assert(testedCells.length === n, `Cell count for n=${n} must be exactly ${n}`);

    // Verify bit-exact equivalence against mathematical formula (|delta| < 1e-12)
    for (let i = 0; i < n; i++) {
        const cell = testedCells[i];
        const ref = refCells[i];

        if (n <= 12) {
            assert(Object.isFrozen(cell), `Cell [${i}] in LUT for n=${n} must be frozen`);
        }

        const dx = Math.abs(cell.x - ref.x);
        const dy = Math.abs(cell.y - ref.y);
        const dAngle = Math.abs(cell.angle - ref.angle);
        const dt = Math.abs(cell.t - ref.t);
        const dNormX = Math.abs(cell.normX - ref.normX);
        const dNormY = Math.abs(cell.normY - ref.normY);

        assert(dx < EPSILON, `n=${n}, i=${i}: x mismatch |${cell.x} - ${ref.x}| = ${dx} >= ${EPSILON}`);
        assert(dy < EPSILON, `n=${n}, i=${i}: y mismatch |${cell.y} - ${ref.y}| = ${dy} >= ${EPSILON}`);
        assert(dAngle < EPSILON, `n=${n}, i=${i}: angle mismatch |${cell.angle} - ${ref.angle}| = ${dAngle} >= ${EPSILON}`);
        assert(dt < EPSILON, `n=${n}, i=${i}: t mismatch |${cell.t} - ${ref.t}| = ${dt} >= ${EPSILON}`);
        assert(dNormX < EPSILON, `n=${n}, i=${i}: normX mismatch |${cell.normX} - ${ref.normX}| = ${dNormX} >= ${EPSILON}`);
        assert(dNormY < EPSILON, `n=${n}, i=${i}: normY mismatch |${cell.normY} - ${ref.normY}| = ${dNormY} >= ${EPSILON}`);

        // Boundary constraints
        if (i === 0) {
            assert(cell.x === 0 && cell.y === 0 && cell.angle === 0 && cell.t === 0,
                `n=${n}: root cell (i=0) must be exactly at origin with zero deflection`);
        }
        if (i === n - 1 && n > 1) {
            assert(Math.abs(cell.x - 1.0) < EPSILON, `n=${n}: terminal cell x must reach normalized 1.0`);
            assert(cell.y === -(n - 1), `n=${n}: terminal cell y must be -(n-1)`);
            assert(Math.abs(cell.t - 1.0) < EPSILON, `n=${n}: terminal cell t must reach 1.0`);
            assert(Math.abs(cell.normX - 1.0) < EPSILON, `n=${n}: terminal cell normX must reach 1.0`);
            assert(Math.abs(cell.normY - (-1.0)) < EPSILON, `n=${n}: terminal cell normY must reach -1.0`);
            assert(cell.angle > 0, `n=${n}: terminal cell angle must be positive deflection`);
        }
    }

    // Monotonic arc progression assertions
    for (let i = 0; i < n - 1; i++) {
        const c0 = testedCells[i];
        const c1 = testedCells[i + 1];

        // x must be monotonically non-decreasing (strictly increasing for n > 1)
        assert(c1.x > c0.x, `n=${n}: x must strictly increase from index ${i} to ${i + 1}`);
        // y must be strictly decreasing by exactly 1 step
        assert(c1.y === c0.y - 1, `n=${n}: y must decrease by exactly 1 from index ${i} to ${i + 1}`);
        // t must strictly increase
        assert(c1.t > c0.t, `n=${n}: t must strictly increase from index ${i} to ${i + 1}`);
        // normY must strictly decrease
        assert(c1.normY < c0.normY, `n=${n}: normY must strictly decrease from index ${i} to ${i + 1}`);
        // angle must be non-negative
        assert(c0.angle >= 0 && c1.angle >= 0, `n=${n}: angle must remain non-negative`);
    }
}
print('  ✓ All 24 item counts validated: bit-exact to < 1e-12 with monotonic arc progression.');

// Multi-Orientation & Screen Coordinate Stress Testing
{
    const monitorConfigs = [
        { x: 0, y: 0, width: 1920, height: 1080 },
        { x: 1920, y: 0, width: 2560, height: 1440 },
        { x: -1920, y: 0, width: 1920, height: 1200 },
        { x: 0, y: 1080, width: 3840, height: 2160 },
        { x: 100, y: 50, width: 1600, height: 900 },
    ];

    for (const mon of monitorConfigs) {
        const mid = mon.x + mon.width / 2;

        // Left dock
        const oLeft = fanOrientation('left', mon.x + 30, mon);
        assert(oLeft.curveSign === 1 && oLeft.thumbnailFirst === true,
            'left dock must have curveSign=1 and thumbnailFirst=true');
        const xLeft = sideFanX('left', mon.x + 30, 80, 300);
        assert(xLeft === mon.x + 30 + 40 + STACK_CLEARANCE, 'sideFanX left calculation');

        // Right dock
        const oRight = fanOrientation('right', mon.x + mon.width - 30, mon);
        assert(oRight.curveSign === -1 && oRight.thumbnailFirst === false,
            'right dock must have curveSign=-1 and thumbnailFirst=false');
        const xRight = sideFanX('right', mon.x + mon.width - 30, 80, 300);
        assert(xRight === (mon.x + mon.width - 30) - 40 - STACK_CLEARANCE - 300, 'sideFanX right calculation');

        // Bottom dock: test points to the left of center, right of center, and center
        const oBottomLeft = fanOrientation('bottom', mid - 50, mon);
        assert(oBottomLeft.curveSign === -1 && oBottomLeft.thumbnailFirst === false,
            'bottom dock left of center must curve left (-1)');

        const oBottomRight = fanOrientation('bottom', mid + 50, mon);
        assert(oBottomRight.curveSign === 1 && oBottomRight.thumbnailFirst === false,
            'bottom dock right of center must curve right (1)');

        const oBottomCenter = fanOrientation('bottom', mid, mon);
        assert(oBottomCenter.curveSign === -1 && oBottomCenter.thumbnailFirst === false,
            'bottom dock at center must curve left (-1)');

        assert(sideFanX('bottom', mid, 80, 300) === null, 'sideFanX for bottom must be null');

        // aboveDockY clearance check
        const iconTop = mon.y + mon.height - 70;
        const popupBottom = 200;
        const yTop = aboveDockY(iconTop, popupBottom);
        assert(iconTop - (yTop + popupBottom) === STACK_CLEARANCE,
            'aboveDockY must maintain exact STACK_CLEARANCE');
    }
}
print('  ✓ Multi-orientation & multi-monitor coordinates verified across 5 complex layouts.');

// ─────────────────────────────────────────────────────────────────────────────
// PART 2: LRU CACHE STRESS
// ─────────────────────────────────────────────────────────────────────────────
print('\n[Part 2] Testing LRU Caches under heavy insertion (500+ items), capacity bounds, & eviction...');

// 2A: services/fileService.js GIcon Caches
print('  [2A] services/fileService.js icon caching stress...');
{
    clearIconCaches();

    // 1. Stress _themedIconCache with 600 unique icon queries
    const NUM_THEMED = 600;
    const themedRefs = new Array(NUM_THEMED);
    for (let i = 0; i < NUM_THEMED; i++) {
        const name = `test-themed-icon-${i}`;
        const icon = getCachedThemedIcon(name);
        assert(icon !== null && icon instanceof Gio.ThemedIcon, `Failed to create themed icon ${name}`);
        themedRefs[i] = icon;
    }

    // Capacity bound: MAX_ICON_CACHE_ENTRIES is 128.
    // The last 128 items inserted (indices 472 to 599) should be retained and return identical references.
    let retainedThemed = 0;
    for (let i = NUM_THEMED - 128; i < NUM_THEMED; i++) {
        const name = `test-themed-icon-${i}`;
        const hit = getCachedThemedIcon(name);
        assert(hit === themedRefs[i], `Item ${i} must return cached identity reference`);
        retainedThemed++;
    }
    assert(retainedThemed === 128, `Exactly 128 items must be retained (got ${retainedThemed})`);

    // The first 472 items (indices 0 to 471) should have been evicted.
    let evictedThemed = 0;
    for (let i = 0; i < NUM_THEMED - 128; i++) {
        const name = `test-themed-icon-${i}`;
        const miss = getCachedThemedIcon(name);
        // Querying an evicted item re-creates a new GObject instance
        assert(miss !== themedRefs[i], `Evicted item ${i} must NOT return old reference`);
        evictedThemed++;
    }
    assert(evictedThemed === 472, `Exactly 472 items must have been evicted (got ${evictedThemed})`);

    // 2. Test LRU Recency Refresh behavior on _themedIconCache
    clearThemedIconCache();
    const lruThemed = new Array(128);
    for (let i = 0; i < 128; i++) {
        lruThemed[i] = getCachedThemedIcon(`lru-icon-${i}`);
    }
    // Oldest is index 0. Access index 0 to refresh it to MRU position.
    const ref0 = getCachedThemedIcon('lru-icon-0');
    assert(ref0 === lruThemed[0], 'Accessing index 0 must return cached instance');

    // Insert 1 new item: 'lru-icon-128'.
    // If index 0 was properly refreshed, the evicted item must be index 1, NOT index 0!
    const newThemed128 = getCachedThemedIcon('lru-icon-128');
    assert(newThemed128 !== null, 'New item 128 must be created');

    // Assert index 0 survived because it was refreshed:
    const survivor0 = getCachedThemedIcon('lru-icon-0');
    assert(survivor0 === lruThemed[0], 'Index 0 must survive eviction due to LRU recency refresh');

    // Assert index 1 was evicted:
    const victim1 = getCachedThemedIcon('lru-icon-1');
    assert(victim1 !== lruThemed[1], 'Index 1 must have been evicted as the true LRU element');

    // 3. Test _fileIconCache with 600 unique file paths
    clearFileIconCache();
    const NUM_FILES = 600;
    const fileRefs = new Array(NUM_FILES);
    for (let i = 0; i < NUM_FILES; i++) {
        const path = `/tmp/stress-thumbnail-${i}.png`;
        const icon = getCachedFileIcon(path);
        assert(icon !== null && icon instanceof Gio.FileIcon, `Failed to create file icon for ${path}`);
        fileRefs[i] = icon;
    }

    // Assert last 128 items retained (indices 472 to 599)
    for (let i = NUM_FILES - 128; i < NUM_FILES; i++) {
        const path = `/tmp/stress-thumbnail-${i}.png`;
        assert(getCachedFileIcon(path) === fileRefs[i], `File icon ${i} must be cached`);
    }

    // Assert earlier 472 items evicted (indices 0 to 471)
    for (let i = 0; i < NUM_FILES - 128; i++) {
        const path = `/tmp/stress-thumbnail-${i}.png`;
        assert(getCachedFileIcon(path) !== fileRefs[i], `File icon ${i} must have been evicted`);
    }

    // Test LRU Recency Refresh behavior on _fileIconCache
    clearFileIconCache();
    const lruFiles = new Array(128);
    for (let i = 0; i < 128; i++) {
        lruFiles[i] = getCachedFileIcon(`/tmp/lru-path-${i}.png`);
    }
    // Refresh path 0
    getCachedFileIcon('/tmp/lru-path-0.png');
    // Insert path 128
    getCachedFileIcon('/tmp/lru-path-128.png');
    // Path 0 must survive, path 1 must be evicted
    assert(getCachedFileIcon('/tmp/lru-path-0.png') === lruFiles[0],
        'File path 0 must survive eviction due to LRU recency refresh');
    assert(getCachedFileIcon('/tmp/lru-path-1.png') !== lruFiles[1],
        'File path 1 must be evicted as the true LRU element');

    // 4. Test complete purge via clearIconCaches()
    clearIconCaches();
    const recheckedThemed = getCachedThemedIcon('lru-icon-0');
    assert(recheckedThemed !== lruThemed[0], 'clearIconCaches() must purge themed icon cache');
    const recheckedFile = getCachedFileIcon('/tmp/lru-path-0.png');
    assert(recheckedFile !== lruFiles[0], 'clearIconCaches() must purge file icon cache');
}
print('  ✓ fileService.js: strict size bound (<= 128), LRU eviction order, & purge verified.');

// 2B: dock/dockLayout.js LRU Caches (ALPHA_CACHE and PILL_STYLE_CACHE)
print('  [2B] dock/dockLayout.js ALPHA_CACHE & PILL_STYLE_CACHE stress...');
{
    // Instrument RegExp.prototype[Symbol.match] to detect cache misses vs hits
    let regexMatchCount = 0;
    const origMatch = RegExp.prototype[Symbol.match];
    RegExp.prototype[Symbol.match] = function(...args) {
        regexMatchCount++;
        return origMatch.apply(this, args);
    };

    try {
        clearDockLayoutCache();

        // 1. Test ALPHA_CACHE: capacity bound <= 128
        const NUM_COLORS = 600;
        const colorPalette = new Array(NUM_COLORS);
        for (let i = 0; i < NUM_COLORS; i++) {
            const hex = '#' + i.toString(16).padStart(6, '0');
            colorPalette[i] = hex;
            applyAlpha(hex, 0.75);
        }

        // The last 128 colors (indices 472 to 599) must be in cache -> zero regex matches
        let last128AlphaHits = 0;
        for (let i = NUM_COLORS - 128; i < NUM_COLORS; i++) {
            const countBefore = regexMatchCount;
            applyAlpha(colorPalette[i], 0.75);
            if (regexMatchCount === countBefore) {
                last128AlphaHits++;
            }
        }
        assert(last128AlphaHits === 128,
            `ALPHA_CACHE: expected exactly 128 hits for most recent entries (got ${last128AlphaHits})`);

        // The first 472 colors (indices 0 to 471) must have been evicted -> regex match count increments
        let evictedAlphaCount = 0;
        for (let i = 0; i < NUM_COLORS - 128; i++) {
            const countBefore = regexMatchCount;
            applyAlpha(colorPalette[i], 0.75);
            if (regexMatchCount > countBefore) {
                evictedAlphaCount++;
            }
        }
        assert(evictedAlphaCount === 472,
            `ALPHA_CACHE: expected exactly 472 evicted entries (got ${evictedAlphaCount})`);

        // 2. Test ALPHA_CACHE LRU order: accessing oldest refreshes it
        clearDockLayoutCache();
        const lruColors = new Array(128);
        for (let i = 0; i < 128; i++) {
            lruColors[i] = '#a0' + i.toString(16).padStart(4, '0');
            applyAlpha(lruColors[i], 0.5);
        }

        // Refresh lruColors[0]
        const beforeRefresh = regexMatchCount;
        applyAlpha(lruColors[0], 0.5);
        assert(regexMatchCount === beforeRefresh, 'Hit on lruColors[0] must not trigger regex');

        // Insert new color 128
        applyAlpha('#a0ffff', 0.5);

        // Check lruColors[0]: must STILL be in cache (0 regex matches)
        const check0 = regexMatchCount;
        applyAlpha(lruColors[0], 0.5);
        assert(regexMatchCount === check0, 'lruColors[0] must survive eviction due to LRU recency refresh');

        // Check lruColors[1]: was oldest, must have been evicted (regex matches > 0)
        const check1 = regexMatchCount;
        applyAlpha(lruColors[1], 0.5);
        assert(regexMatchCount > check1, 'lruColors[1] must have been evicted');

        // 3. Test PILL_STYLE_CACHE: capacity bound <= 64
        clearDockLayoutCache();
        const NUM_CONFIGS = 600;
        const configList = new Array(NUM_CONFIGS);
        for (let i = 0; i < NUM_CONFIGS; i++) {
            const cfg = {
                dockRadius: 12 + (i % 16),
                borderWidth: 1,
                borderColor: '#ffffff',
                pillColor: '#' + i.toString(16).padStart(6, '0'),
                bgOpacity: 0.82,
            };
            configList[i] = cfg;
            pillStyle(cfg);
        }

        // Flush ALPHA_CACHE by inserting 130 dummy colors so ALPHA_CACHE hits do not mask PILL_STYLE_CACHE misses
        for (let d = 0; d < 130; d++) {
            applyAlpha('#b0' + d.toString(16).padStart(4, '0'), 0.5);
        }

        // The last 64 configs (indices 536 to 599) must be in PILL_STYLE_CACHE -> applyAlpha is NOT called
        let last64PillHits = 0;
        for (let i = NUM_CONFIGS - 64; i < NUM_CONFIGS; i++) {
            const countBefore = regexMatchCount;
            pillStyle(configList[i]);
            if (regexMatchCount === countBefore) {
                last64PillHits++;
            }
        }
        assert(last64PillHits === 64,
            `PILL_STYLE_CACHE: expected exactly 64 hits for most recent configs (got ${last64PillHits})`);

        // Flush ALPHA_CACHE again
        for (let d = 0; d < 130; d++) {
            applyAlpha('#c0' + d.toString(16).padStart(4, '0'), 0.5);
        }

        // The first 536 configs (indices 0 to 535) must have been evicted -> applyAlpha is called, triggering regex
        let evictedPillCount = 0;
        for (let i = 0; i < NUM_CONFIGS - 64; i++) {
            const countBefore = regexMatchCount;
            pillStyle(configList[i]);
            if (regexMatchCount > countBefore) {
                evictedPillCount++;
            }
            // Flush ALPHA_CACHE to ensure subsequent misses are detected
            applyAlpha('#d0' + (i % 100).toString(16).padStart(4, '0'), 0.1);
        }
        assert(evictedPillCount === 536,
            `PILL_STYLE_CACHE: expected exactly 536 evicted configs (got ${evictedPillCount})`);

        // 4. Test PILL_STYLE_CACHE LRU order: accessing oldest refreshes it
        clearDockLayoutCache();
        const lruConfigs = new Array(64);
        for (let i = 0; i < 64; i++) {
            lruConfigs[i] = {
                dockRadius: 10 + i,
                borderWidth: 1,
                borderColor: '#ffffff',
                pillColor: '#e0' + i.toString(16).padStart(4, '0'),
                bgOpacity: 0.8,
            };
            pillStyle(lruConfigs[i]);
        }

        // Refresh lruConfigs[0]
        pillStyle(lruConfigs[0]);

        // Insert new config 64
        pillStyle({
            dockRadius: 99,
            borderWidth: 1,
            borderColor: '#ffffff',
            pillColor: '#e0ffff',
            bgOpacity: 0.8,
        });

        // Flush ALPHA_CACHE
        for (let d = 0; d < 130; d++) {
            applyAlpha('#f0' + d.toString(16).padStart(4, '0'), 0.5);
        }

        // lruConfigs[0] must survive (0 regex calls)
        const checkPill0 = regexMatchCount;
        pillStyle(lruConfigs[0]);
        assert(regexMatchCount === checkPill0,
            'lruConfigs[0] must survive eviction due to LRU recency refresh');

        // lruConfigs[1] must have been evicted
        const checkPill1 = regexMatchCount;
        pillStyle(lruConfigs[1]);
        assert(regexMatchCount > checkPill1,
            'lruConfigs[1] must have been evicted from PILL_STYLE_CACHE');

        // 5. Test complete purge via clearDockLayoutCache()
        clearDockLayoutCache();
        for (let d = 0; d < 130; d++) {
            applyAlpha('#f1' + d.toString(16).padStart(4, '0'), 0.5);
        }
        const purgeCount = regexMatchCount;
        pillStyle(lruConfigs[0]);
        assert(regexMatchCount > purgeCount, 'clearDockLayoutCache() must purge PILL_STYLE_CACHE');
    } finally {
        RegExp.prototype[Symbol.match] = origMatch;
    }
}
print('  ✓ dockLayout.js: ALPHA_CACHE (<= 128) & PILL_STYLE_CACHE (<= 64) size bounds, LRU order, & purge verified.');

// 2C: downloads/tileStyle.js Style Caching
print('  [2C] downloads/tileStyle.js getRowStyles caching & bounds stress...');
{
    clearTileStyleCache();
    assert(NORMAL_ROW_STYLES.size === 0, 'NORMAL_ROW_STYLES must start empty');
    assert(HOVER_ROW_STYLES.size === 0, 'HOVER_ROW_STYLES must start empty');

    // Insert 600 unique style variations
    const NUM_TILE_STYLES = 600;
    const testCfgList = new Array(NUM_TILE_STYLES);
    for (let i = 0; i < NUM_TILE_STYLES; i++) {
        const cfg = {
            bgOpacity: 0.15 + (i % 60) / 100,
            dockRadius: 8 + (i % 20),
            dlItemRadius: 6 + (i % 15),
            dlItemBorderWidth: 1 + (i % 3),
            dlItemBorderColor: '#' + i.toString(16).padStart(6, '0'),
            dlItemFontColor: '#ffffff',
            downloadsItemColor: `rgba(${i % 256}, 30, 40, 0.8)`,
        };
        testCfgList[i] = cfg;
        getRowStyles(cfg, 10 + (i % 5), '0 12px');
    }

    // Capacity bound: MAX_ROW_STYLE_CACHE is 64
    assert(NORMAL_ROW_STYLES.size <= 64,
        `NORMAL_ROW_STYLES size (${NORMAL_ROW_STYLES.size}) must be bounded to <= 64`);
    assert(HOVER_ROW_STYLES.size <= 64,
        `HOVER_ROW_STYLES size (${HOVER_ROW_STYLES.size}) must be bounded to <= 64`);
    assert(NORMAL_ROW_STYLES.size === HOVER_ROW_STYLES.size,
        'NORMAL_ROW_STYLES and HOVER_ROW_STYLES must maintain identical size');

    // Verify cache hit returns identical frozen object references
    const latestCfg = testCfgList[NUM_TILE_STYLES - 1];
    const hit1 = getRowStyles(latestCfg, 10 + ((NUM_TILE_STYLES - 1) % 5), '0 12px');
    const hit2 = getRowStyles(latestCfg, 10 + ((NUM_TILE_STYLES - 1) % 5), '0 12px');
    assert(hit1.normal === hit2.normal, 'getRowStyles must return identical normal style reference on cache hit');
    assert(hit1.hover === hit2.hover, 'getRowStyles must return identical hover style reference on cache hit');
    assert(Object.isFrozen(hit1.normal), 'Precomputed normal style must be frozen');
    assert(Object.isFrozen(hit1.hover), 'Precomputed hover style must be frozen');

    // Complete purge test
    clearTileStyleCache();
    assert(NORMAL_ROW_STYLES.size === 0, 'clearTileStyleCache() must purge NORMAL_ROW_STYLES');
    assert(HOVER_ROW_STYLES.size === 0, 'clearTileStyleCache() must purge HOVER_ROW_STYLES');

    const fresh = getRowStyles(latestCfg, 10 + ((NUM_TILE_STYLES - 1) % 5), '0 12px');
    assert(fresh.normal !== hit1.normal, 'Post-purge getRowStyles must allocate new frozen style object');
}
print('  ✓ tileStyle.js: getRowStyles caching, capacity bound (<= 64), & purge verified.');

// ─────────────────────────────────────────────────────────────────────────────
// PART 3: INVARIANT STRESS: 500 BMS CYCLES & DOCK ANCHOR / STACK CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────
print('\n[Part 3] Invariant Stress: 500 simulated BMS enable/disable cycles & anchor/stack queries...');
{
    const CYCLES = 500;
    for (let c = 0; c < CYCLES; c++) {
        // Toggle simulated Blur My Shell state
        const bmsDockBlurActive = (c % 2 === 0);
        const bmsPopupActive = (c % 3 !== 0);

        globalThis.global = {
            blur_my_shell: {
                _dash_to_dock_blur: { enabled: bmsDockBlurActive },
                _popup: {
                    enabled: bmsPopupActive,
                    settings: {
                        settings: {
                            STATIC_BLUR: (c % 4 === 0),
                            PIPELINE: c % 2 === 0 ? 'pipeline_default' : 'pipeline_custom',
                        },
                    },
                },
            },
        };

        // Construct mock stack containers (Fan, Grid, List views and items)
        const mockFan = {
            name: 'aquaDownloadsFan',
            _isAquaDock: true,
            _dockBlurEnabled: false,
            has_style_class_name: cls => cls === 'aqua-dl-fan-panel',
        };

        const mockPanel = {
            name: 'aquaDownloadsPanel',
            _isAquaDock: true,
            _dockBlurEnabled: true,
            _blurType: 'popup',
            _dockRadius: 20,
            has_style_class_name: cls => cls === 'aqua-dl-panel',
        };
        mockPanel._dockBg = mockPanel;

        const mockGrid = {
            name: 'aquaDownloadsPanel',
            _isAquaDock: true,
            _dockBlurEnabled: true,
            _blurType: 'popup',
            _dockRadius: 20,
            has_style_class_name: cls => cls === 'aqua-dl-grid' || cls === 'aqua-dl-panel',
        };
        mockGrid._dockBg = mockGrid;

        const mockList = {
            name: 'aquaDownloadsPanel',
            _isAquaDock: true,
            _dockBlurEnabled: true,
            _blurType: 'popup',
            _dockRadius: 20,
            has_style_class_name: cls => cls === 'aqua-dl-list' || cls === 'aqua-dl-panel',
        };
        mockList._dockBg = mockList;

        const mockFanCard = {
            _isAquaDock: true,
            _dockBlurEnabled: false,
            has_style_class_name: () => false,
        };

        const mockPanelRow = {
            _isAquaDock: true,
            _dockBlurEnabled: false,
            has_style_class_name: cls => cls === 'aqua-dl-row',
        };

        // Construct mock Down-Chevron drawer anchor containers
        const mockAnchorByName = {
            name: 'aquaStackAnchor',
            _isAquaDock: true,
            _blurType: 'popup',
            _dockBlurEnabled: true,
            _dockRadius: 16,
            get_dock_radius: () => 16,
            width: 48,
            height: 48,
            has_allocation: () => true,
            get_children: () => [],
            insert_child_below() {},
            connect: () => 1,
            disconnect: () => {},
        };
        mockAnchorByName._dockBg = mockAnchorByName;

        const mockAnchorByClass = {
            name: 'customDrawerAnchor',
            _isAquaDock: true,
            _blurType: 'popup',
            _dockBlurEnabled: true,
            _dockRadius: 18,
            get_dock_radius: () => 18,
            width: 48,
            height: 48,
            has_allocation: () => true,
            get_children: () => [],
            insert_child_below() {},
            connect: () => 1,
            disconnect: () => {},
            has_style_class_name: cls => cls === 'aqua-stack-anchor-tile',
        };
        mockAnchorByClass._dockBg = mockAnchorByClass;

        // Invariant 1: Fan view stacks strictly avoid blur; Grid & List view panels enable blur (2026-10-30 user directive)
        assert(isAquaPopupTarget(mockFan) === false,
            `Cycle ${c}: isAquaPopupTarget must reject Fan stack`);
        assert(isAquaPopupTarget(mockPanel) === true,
            `Cycle ${c}: isAquaPopupTarget must accept Panel stack`);
        assert(isAquaPopupTarget(mockGrid) === true,
            `Cycle ${c}: isAquaPopupTarget must accept Grid view`);
        assert(isAquaPopupTarget(mockList) === true,
            `Cycle ${c}: isAquaPopupTarget must accept List view`);
        assert(isAquaPopupTarget(mockFanCard) === false,
            `Cycle ${c}: isAquaPopupTarget must reject Fan item card`);
        assert(isAquaPopupTarget(mockPanelRow) === false,
            `Cycle ${c}: isAquaPopupTarget must reject Panel row item`);

        // Fan view resolveAquaDockTarget must return null; Grid & List panels must resolve as popup targets
        assert(resolveAquaDockTarget(mockFan) === null,
            `Cycle ${c}: resolveAquaDockTarget must return null for Fan stack`);
        assert(resolveAquaDockTarget(mockPanel) !== null,
            `Cycle ${c}: resolveAquaDockTarget must resolve Panel stack`);
        assert(resolveAquaDockTarget(mockGrid) !== null,
            `Cycle ${c}: resolveAquaDockTarget must resolve Grid view`);
        assert(resolveAquaDockTarget(mockList) !== null,
            `Cycle ${c}: resolveAquaDockTarget must resolve List view`);

        // Invariant 2: Down-Chevron drawer anchor MUST ALWAYS be accepted by isAquaPopupTarget
        assert(isAquaPopupTarget(mockAnchorByName) === true,
            `Cycle ${c}: isAquaPopupTarget must accept aquaStackAnchor by name`);
        assert(isAquaPopupTarget(mockAnchorByClass) === true,
            `Cycle ${c}: isAquaPopupTarget must accept aquaStackAnchor by style class`);

        // Invariant 2: resolveAquaDockTarget must resolve anchor as a popup blur target
        const targetByName = resolveAquaDockTarget(mockAnchorByName);
        assert(targetByName !== null, `Cycle ${c}: resolveAquaDockTarget must resolve mockAnchorByName`);
        assert(targetByName.is_popup === true, `Cycle ${c}: targetByName.is_popup must be true`);
        assert(targetByName.background === mockAnchorByName, `Cycle ${c}: targetByName background identity`);

        const targetByClass = resolveAquaDockTarget(mockAnchorByClass);
        assert(targetByClass !== null, `Cycle ${c}: resolveAquaDockTarget must resolve mockAnchorByClass`);
        assert(targetByClass.is_popup === true, `Cycle ${c}: targetByClass.is_popup must be true`);

        // Exercise registration / unregistration cycle
        registerBmsTarget(mockAnchorByName);
        unregisterBmsTarget(mockAnchorByName);

        if (c % 100 === 0) {
            cleanupBms();
        }
    }
    cleanupBms();
}
print('  ✓ 500 BMS enable/disable cycles passed: Invariant 1 (stacks rejected) & Invariant 2 (anchor accepted) strictly held.\n');

print('challengerM3CacheStress: ok — All empirical stress tests passed (geometry, LRU caches, & invariants).');
