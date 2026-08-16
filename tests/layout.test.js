import {
    computeLayout,
    indicatorMetrics,
    indicatorPosition,
    magnifiedOverflow,
    pillStyle,
} from '../dock/dockLayout.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function paintedHandleRect(handle) {
    return {
        x: handle.x + handle.clip.x,
        y: handle.y + handle.clip.y,
        w: handle.clip.w,
        h: handle.clip.h,
    };
}

const monitor = { x: 100, y: 50, width: 1600, height: 900 };
const base = {
    scale: 1,
    iconSize: 60,
    zoomMax: 2.6,
    renderSize: 156,
    placeIconSourceSize: 156,
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
    borderWidth: 2,
    autoHideActive: false,
    autoShrink: true,
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

for (const layout of [centered, left, computeLayout({
    ...base,
    vertical: true,
    position: 'right',
}, chips(), monitor).geom]) {
    const handle = layout.autohideHandle;
    const visible = paintedHandleRect(handle);
    assert(handle.w === layout.width && handle.h === layout.height,
        'hidden-dock marker must preserve the live pill dimensions');
    assert(visible.w >= 1 && visible.h >= 1,
        'hidden-dock marker must retain a visible edge');
    assert(visible.x >= monitor.x && visible.y >= monitor.y &&
        visible.x + visible.w <= monitor.x + monitor.width &&
        visible.y + visible.h <= monitor.y + monitor.height,
    'visible hidden-dock rim escaped its monitor');
    if (layout.side === 'bottom')
        assert(visible.y + visible.h === monitor.y + monitor.height &&
            handle.clip.h === base.borderWidth,
        'bottom hidden-dock rim is not flush with the monitor edge');
    else if (layout.side === 'left')
        assert(visible.x === monitor.x && handle.clip.x === handle.w - base.borderWidth,
            'left hidden-dock rim is not flush with the monitor edge');
    else
        assert(visible.x + visible.w === monitor.x + monitor.width && handle.clip.x === 0,
            'right hidden-dock rim is not flush with the monitor edge');
}

// The overflow input zone adds a small cushion beyond the transformed icon edge,
// but only after the icon has actually grown outside the pill.
const peakIconOverflow = 104;
const peakOverflow = peakIconOverflow + centered.magZone.hoverReach;
assert(magnifiedOverflow(centered.magZone, base.zoomMax) === peakOverflow,
    'bottom magnification zone should include the hover cushion at peak size');
assert(magnifiedOverflow(centered.magZone, 1) === 0,
    'resting icons should not create an overflow input zone');
assert(magnifiedOverflow(centered.magZone, 1.1) === 0,
    'input zone should stay collapsed while the icon remains inside the pill');
assert(magnifiedOverflow(left.magZone, base.zoomMax) === peakOverflow,
    'vertical magnification zone should use the same icon-edge geometry');
assert(centered.magZone.hoverReach > 0 && centered.magZone.hoverReach < 12,
    'hover cushion should stay below the tooltip gap');
assert(centered.magZone.mainPad === 48,
    'the overflow zone should reserve only the peak icon side overhang');

const bottomLayout = computeLayout({ ...base, autoHideActive: true }, chips(), monitor).geom;
const bottomHandle = bottomLayout.autohideHandle;
const bottomRim = paintedHandleRect(bottomHandle);
assert(bottomHandle.w === bottomLayout.bg.w && bottomHandle.h === bottomLayout.bg.h,
    'bottom hidden-dock marker does not clone the pill size');
assert(bottomHandle.x === bottomLayout.x && bottomRim.x === bottomLayout.x,
    'bottom hidden-dock rim does not follow dock alignment');
assert(bottomRim.h === base.borderWidth &&
    bottomRim.y + bottomRim.h === monitor.y + monitor.height,
    'bottom hidden-dock rim does not expose the configured border thickness');

const longerBottom = computeLayout(
    { ...base, autoHideActive: true },
    [...chips(), { item: {} }, { item: {} }],
    monitor).geom;
assert(longerBottom.autohideHandle.w === longerBottom.width &&
    longerBottom.autohideHandle.w > bottomHandle.w,
    'hidden-dock rim length did not follow a growing pill');

const startHandle = computeLayout({
    ...base,
    alignment: 'start',
    autoHideActive: true,
}, chips(), monitor).geom;
const endHandle = computeLayout({
    ...base,
    alignment: 'end',
    autoHideActive: true,
}, chips(), monitor).geom;
assert(paintedHandleRect(startHandle.autohideHandle).x === startHandle.x &&
    paintedHandleRect(endHandle.autohideHandle).x === endHandle.x,
    'hidden-dock rim did not follow non-centred alignment');

const leftLayout = computeLayout({
    ...base,
    vertical: true,
    position: 'left',
    autoHideActive: true,
}, chips(), monitor).geom;
const rightLayout = computeLayout({
    ...base,
    vertical: true,
    position: 'right',
    autoHideActive: true,
}, chips(), monitor).geom;
const leftHandle = leftLayout.autohideHandle;
const rightHandle = rightLayout.autohideHandle;
const leftRim = paintedHandleRect(leftHandle);
const rightRim = paintedHandleRect(rightHandle);
assert(leftHandle.h === leftLayout.height && leftRim.x === monitor.x &&
    leftRim.w === base.borderWidth,
    'left hidden-dock marker does not expose the pill rim');
assert(rightHandle.h === rightLayout.height &&
    rightRim.x + rightRim.w === monitor.x + monitor.width &&
    rightRim.w === base.borderWidth,
    'right hidden-dock marker does not expose the pill rim');

const borderlessHandle = computeLayout({
    ...base,
    borderWidth: 0,
    autoHideActive: true,
}, chips(), monitor).geom.autohideHandle;
assert(paintedHandleRect(borderlessHandle).h === 1,
    'borderless pill should retain a one-pixel background rim');

const oversizedBottom = computeLayout({
    ...base,
    autoHideActive: true,
    autoShrink: false,
}, Array.from({ length: 30 }, () => ({ item: {} })), monitor).geom.autohideHandle;
const oversizedBottomRim = paintedHandleRect(oversizedBottom);
assert(oversizedBottomRim.x === monitor.x &&
    oversizedBottomRim.w === monitor.width &&
    oversizedBottom.x + oversizedBottom.clip.x === monitor.x &&
    oversizedBottom.clip.w === monitor.width,
    'oversized horizontal pill rim was not clipped to its monitor');

const oversizedLeft = computeLayout({
    ...base,
    vertical: true,
    position: 'left',
    autoHideActive: true,
    autoShrink: false,
}, Array.from({ length: 30 }, () => ({ item: {} })), monitor).geom.autohideHandle;
const oversizedLeftRim = paintedHandleRect(oversizedLeft);
assert(oversizedLeftRim.y === monitor.y &&
    oversizedLeftRim.h === monitor.height &&
    oversizedLeft.y + oversizedLeft.clip.y === monitor.y &&
    oversizedLeft.clip.h === monitor.height,
    'oversized vertical pill rim was not clipped to its monitor');

const narrowMonitor = { x: 0, y: 0, width: 500, height: 900 };
const crowdedChips = () => Array.from({ length: 12 }, () => ({ item: {} }));
const automaticChips = crowdedChips();
const automatic = computeLayout({ ...base, dockRadius: 25 }, automaticChips, narrowMonitor);
const manual = computeLayout({ ...base, dockRadius: 25, autoShrink: false }, crowdedChips(), narrowMonitor);
assert(automatic.cfg.shrunk && automatic.cfg.iconSize < base.iconSize,
    'enabled screen-fit shrinking did not reduce an overflowing dock');
assert(automatic.cfg.placeIconSourceSize === base.placeIconSourceSize,
    'screen-fit shrinking changed the stable folder artwork source size');
assert(automatic.cfg.dockRadius === Math.round(25 * automatic.cfg.dockH / base.dockH),
    'screen-fit shrinking did not preserve the configured corner proportion');
for (const chip of automaticChips)
    assert(chip.center === chip.baseX + chip.w / 2,
        'screen-fit layout retained a stale chip centre');
assert(manual.cfg.shrunk !== true, 'manual sizing unexpectedly entered the shrink path');
assert(manual.cfg.iconSize === base.iconSize && manual.cfg.cellPad === base.cellPad &&
    manual.cfg.dockH === base.dockH && manual.cfg.dockRadius === 25,
    'manual sizing changed configured dock geometry');
assert(manual.geom.width > narrowMonitor.width,
    'manual sizing should preserve an intentionally oversized dock');
const zeroGap = computeLayout({
    ...base,
    cellPad: 0,
    cellW: base.iconSize,
    iconSpacing: 0,
}, crowdedChips(), narrowMonitor).cfg;
assert(zeroGap.shrunk && zeroGap.cellPad === 0 && zeroGap.iconSpacing === 0,
    'screen-fit shrinking increased a zero icon gap');

const extremeMonitor = { x: 0, y: 0, width: 420, height: 900 };
const extremeChips = () => Array.from({ length: 48 }, () => ({ item: {} }));
const extreme = computeLayout({
    ...base,
    cellPad: 24,
    cellW: base.iconSize + 48,
    iconSpacing: 48,
}, extremeChips(), extremeMonitor);
const extremeAvailable = extremeMonitor.width - 2 * base.edgeMargin - 8;
assert(extreme.cfg.shrunk && extreme.geom.width <= extremeAvailable,
    'minimum-size screen-fit shrinking left a crowded dock off-screen');
assert(extreme.cfg.iconSpacing <= 48,
    'screen-fit shrinking increased configured icon spacing');

const fittingAutomatic = computeLayout({ ...base }, chips(), monitor).geom;
const fittingManual = computeLayout({ ...base, autoShrink: false }, chips(), monitor).geom;
assert(JSON.stringify(fittingAutomatic) === JSON.stringify(fittingManual),
    'the toggle changed a dock that already fits its monitor');

const structuredChips = [
    { item: {}, entry: { key: 'first', kind: 'app' } },
    { item: null, entry: { key: 'gap', kind: 'spacer' } },
    { item: null, entry: { key: 'line', kind: 'separator' } },
    { item: {}, entry: { key: 'last', kind: 'app' } },
];
const structured = computeLayout({ ...base }, structuredChips, monitor).geom;
for (const chip of structuredChips)
    assert(chip.center === chip.baseX + chip.w / 2,
        'layout did not retain the stable main-axis chip centre');
assert(structuredChips[1].w === 12 && structuredChips[2].w === 18,
    'custom spacers and separators do not preserve their visual widths');
assert(structuredChips[1].box.w === 12 && structuredChips[1].box.h === base.dockH,
    'horizontal spacer allocation is incorrect');
assert(structured.width === 2 * 10 + 2 * base.cellW + 12 + 18,
    'custom structures were not included in the dock pill span');

const contrastStyle = pillStyle({
    highContrast: true,
    borderWidth: 0,
    dockRadius: 14,
    bgOpacity: 0.4,
});
assert(contrastStyle.includes('2px solid #ffffff') &&
    contrastStyle.includes('rgba(0,0,0,0.96)'),
    'high-contrast dock styling lost its strong outline or opaque fill');

// A non-shrunk dock keeps the historical indicator geometry exactly.
const fullIndicator = indicatorMetrics({
    ...base,
    indicatorStyle: 'glow-dots',
    indicatorSize: 5,
}, 4);
assert(fullIndicator.indicW === 32 && fullIndicator.indicH === 5 &&
    fullIndicator.gap === 4 && fullIndicator.outerPad === 3,
    'full-size running indicator geometry changed');

// Every responsive style must keep its complete painted bounds, including
// glow halos, inside both a horizontal and vertical dock item.
for (const position of ['bottom', 'left', 'right']) {
    for (const style of ['dot', 'dots', 'line', 'pill', 'glow', 'glow-dots']) {
        const vertical = position !== 'bottom';
        const cfg = {
            ...automatic.cfg,
            vertical,
            position,
            indicatorStyle: style,
            indicatorSize: 5,
        };
        const metrics = indicatorMetrics(cfg, 4);
        const restGap = Math.round((cfg.dockH - cfg.iconSize) / 2);
        let restRect;
        if (!vertical) {
            restRect = {
                x: Math.round((cfg.cellW - cfg.iconSize) / 2),
                y: cfg.dockH - restGap - cfg.iconSize,
                w: cfg.iconSize,
                h: cfg.iconSize,
            };
        } else if (position === 'left') {
            restRect = {
                x: restGap,
                y: Math.round((cfg.cellW - cfg.iconSize) / 2),
                w: cfg.iconSize,
                h: cfg.iconSize,
            };
        } else {
            restRect = {
                x: cfg.dockH - restGap - cfg.iconSize,
                y: Math.round((cfg.cellW - cfg.iconSize) / 2),
                w: cfg.iconSize,
                h: cfg.iconSize,
            };
        }
        const pos = indicatorPosition(cfg, metrics, restRect, 0);
        assert(pos.x - metrics.outerPad >= 0 &&
            pos.y - metrics.outerPad >= 0,
        `${position}/${style} indicator started outside its item`);
        const itemW = vertical ? cfg.dockH : cfg.cellW;
        const itemH = vertical ? cfg.cellW : cfg.dockH;
        assert(pos.x + metrics.indicW + metrics.outerPad <= itemW &&
            pos.y + metrics.indicH + metrics.outerPad <= itemH,
        `${position}/${style} indicator ended outside its item`);
    }
}

print('layout: ok');
