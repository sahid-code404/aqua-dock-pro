import {
    monitorIndexAtPoint,
    monitorIndexesForLayout,
    monitorTransitionTouchesIndex,
} from '../core/utils.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const monitors = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 1920, y: 0, width: 2560, height: 1440 },
    // Transient mirror/clone duplicate of monitor 0.
    { x: 0, y: 0, width: 1920, height: 1080 },
];

const ordered = monitorIndexesForLayout(monitors, 1, true);
assert(ordered.join(',') === '1,0',
    'multi-monitor topology should keep primary first and collapse duplicate geometries');

const single = monitorIndexesForLayout(monitors, 1, false);
assert(single.length === 1 && single[0] === 1,
    'single-monitor mode must keep only the primary monitor');

const fallbackPrimary = monitorIndexesForLayout(monitors, 99, true);
assert(fallbackPrimary[0] === 0,
    'invalid primary index must fall back to monitor 0');

assert(monitorIndexesForLayout([], 0, true).length === 0,
    'empty monitor snapshots must not invent a dock target');

assert(monitorIndexAtPoint(monitors.slice(0, 2), 1919, 500) === 0,
    'point just inside monitor 0 resolved to the wrong monitor');
assert(monitorIndexAtPoint(monitors.slice(0, 2), 1920, 500) === 1,
    'shared-boundary point should resolve to the monitor that owns that coordinate');
assert(monitorIndexAtPoint(monitors.slice(0, 2), -10, 500) === -1,
    'point outside every monitor should return -1');

assert(monitorTransitionTouchesIndex(0, 0, 1) === false,
    'focus changes confined to monitor 0 must not wake monitor 1');
assert(monitorTransitionTouchesIndex(0, 1, 0) === true &&
    monitorTransitionTouchesIndex(0, 1, 1) === true,
    'focus crossing monitors must update both the old and new monitor');
assert(monitorTransitionTouchesIndex(0, -1, 0) === true &&
    monitorTransitionTouchesIndex(0, -1, 1) === false,
    'transient null focus while closing a window must only update its previous monitor');

print('monitorTopology: ok');
