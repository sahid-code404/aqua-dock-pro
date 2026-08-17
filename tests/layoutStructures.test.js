import { computeLayout } from '../dock/dockLayout.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const base = {
    scale: 1,
    iconSize: 60,
    zoomMax: 2.6,
    renderSize: 156,
    placeIconSourceSize: 156,
    cellW: 72,
    cellPad: 6,
    iconSpacing: 12,
    dockH: 85,
    headroom: 120,
    hoverLift: 20,
    invZoom: 1 / 2.6,
    liftDenom: 1 / 1.6,
    vertical: false,
    position: 'bottom',
    alignment: 'center',
    edgeMargin: 8,
    borderWidth: 2,
    autoHideActive: false,
    autoShrink: true,
    zoomRange: 120,
    magnificationCurve: 2,
    tau: 120,
    springTension: 0.8,
    springDamping: 0.78,
};

const monitor = { x: 0, y: 0, width: 420, height: 900 };
const structures = Array.from({ length: 40 }, (_, index) => ({
    item: null,
    entry: { key: `sep:${index}`, kind: 'separator' },
}));
const chips = [
    { item: {}, entry: { key: 'app:test', kind: 'app' } },
    ...structures,
];
const result = computeLayout({ ...base }, chips, monitor);
const available = monitor.width - 2 * base.edgeMargin - 8;

assert(result.cfg.shrunk === true,
    'structure-heavy screen-fit layout did not enter the shrink path');
assert(result.cfg.structureScale < 1,
    'fixed structures were not compressed when they dominated the available span');
assert(result.geom.width <= available,
    'structure-heavy screen-fit layout still exceeded the monitor');

const normal = computeLayout({ ...base }, [
    { item: {}, entry: { key: 'app:one', kind: 'app' } },
    { item: null, entry: { key: 'sep:normal', kind: 'separator' } },
    { item: null, entry: { key: 'spacer:normal', kind: 'spacer' } },
    { item: {}, entry: { key: 'app:two', kind: 'app' } },
], { x: 0, y: 0, width: 1600, height: 900 });

assert(normal.cfg.structureScale === undefined,
    'normal fitting layouts should not enter structural compression');
assert(normal.geom.width === 20 + 2 * base.cellW + 18 + 12,
    'normal separator/spacer geometry changed');

print('layoutStructures: ok');
