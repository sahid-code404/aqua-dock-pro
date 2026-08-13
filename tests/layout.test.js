import { computeLayout, magnifiedOverflow } from '../dock/dockLayout.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const monitor = { x: 100, y: 50, width: 1600, height: 900 };
const base = {
    scale: 1,
    iconSize: 60,
    zoomMax: 2.6,
    renderSize: 156,
    cellW: 72,
    cellPad: 6,
    dockH: 85,
    headroom: 120,
    hoverLift: 20,
    invZoom: 1 / 2.6,
    liftDenom: 1 / 1.6,
    vertical: false,
    position: 'bottom',
    alignment: 'center',
    edgeMargin: 8,
    autoHideActive: false,
    zoomRange: 120,
    magnificationCurve: 2,
    tau: 120,
    springTension: 0.8,
    springDamping: 0.78,
};

function chips() {
    return [{ item: {} }, { item: {} }, { item: null }, { item: {} }];
}

const centered = computeLayout({ ...base }, chips(), monitor).geom;
const start = computeLayout({ ...base, alignment: 'start' }, chips(), monitor).geom;
const end = computeLayout({ ...base, alignment: 'end' }, chips(), monitor).geom;
assert(start.x < centered.x && centered.x < end.x, 'horizontal alignment order is wrong');
assert(start.x >= monitor.x && end.x + end.width <= monitor.x + monitor.width,
    'aligned dock must stay inside its monitor');

const left = computeLayout({
    ...base,
    vertical: true,
    position: 'left',
    alignment: 'end',
}, chips(), monitor).geom;
assert(left.y >= monitor.y && left.y + left.height <= monitor.y + monitor.height,
    'vertical dock must stay inside its monitor');
assert(centered.strut?.h > 0, 'always-visible dock should reserve work area');
assert(computeLayout({ ...base }, chips(), monitor, true).geom.strut === null,
    'fullscreen dock must not reserve work area');

// The overflow input zone must end at the transformed icon edge. At peak zoom
// that is icon growth + hover lift - the icon's resting inset in the pill.
const peakOverflow = 104;
assert(magnifiedOverflow(centered.magZone, base.zoomMax) === peakOverflow,
    'bottom magnification zone should match the peak icon overflow');
assert(magnifiedOverflow(centered.magZone, 1) === 0,
    'resting icons should not create an overflow input zone');
assert(magnifiedOverflow(centered.magZone, 1.1) === 0,
    'input zone should stay collapsed while the icon remains inside the pill');
assert(magnifiedOverflow(left.magZone, base.zoomMax) === peakOverflow,
    'vertical magnification zone should use the same icon-edge geometry');
assert(centered.magZone.mainPad === 48,
    'the overflow zone should reserve only the peak icon side overhang');

print('layout: ok');
