import {
    STACK_CLEARANCE,
    aboveDockY,
    fanOrientation,
    sideFanX,
    FAN_CELL_OFFSETS,
    getFanCellOffsets,
} from '../downloads/fanGeometry.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const monitor = { x: 100, y: 50, width: 1600, height: 900 };
const left = fanOrientation('left', 150, monitor);
const right = fanOrientation('right', 1650, monitor);
assert(left.curveSign === 1 && left.thumbnailFirst,
    'left-dock fan is not mirrored toward the right');
assert(right.curveSign === -1 && !right.thumbnailFirst,
    'right-dock fan is not mirrored toward the left');

const thickness = 84;
const panelWidth = 320;
const clearance = STACK_CLEARANCE;
const leftOrigin = 150;
const leftX = sideFanX('left', leftOrigin, thickness, panelWidth);
assert(leftX === leftOrigin + thickness / 2 + clearance,
    'left fan does not clear the dock edge');
const rightOrigin = 1650;
const rightX = sideFanX('right', rightOrigin, thickness, panelWidth);
assert(rightX + panelWidth === rightOrigin - thickness / 2 - clearance,
    'right fan does not clear the dock edge');

const iconTop = 800;
const popupBottom = 144;
const popupY = aboveDockY(iconTop, popupBottom);
assert(iconTop - (popupY + popupBottom) === STACK_CLEARANCE,
    'bottom fan does not keep its configured distance from the dock icon');

const bottomLeft = fanOrientation('bottom', 300, monitor);
const bottomRight = fanOrientation('bottom', 1500, monitor);
assert(bottomLeft.curveSign === -1 && bottomRight.curveSign === 1 &&
    !bottomLeft.thumbnailFirst && !bottomRight.thumbnailFirst,
    'bottom fan orientation changed');

// ── FAN_CELL_OFFSETS LUT verification ─────────────────────────────────────────
assert(Object.isFrozen(FAN_CELL_OFFSETS), 'FAN_CELL_OFFSETS must be frozen');
for (let n = 1; n <= 12; n++) {
    const list = FAN_CELL_OFFSETS[n];
    assert(Array.isArray(list) && list.length === n, `Length must match ${n}`);
    assert(Object.isFrozen(list), `LUT for ${n} must be frozen`);
    assert(list[0].x === 0 && list[0].y === 0 && list[0].angle === 0, `Base cell for ${n}`);
    if (n > 1) {
        assert(list[n - 1].x === 1, `Last cell x must be 1 for ${n}`);
        assert(list[n - 1].y === -(n - 1), `Last cell y must be -(n-1) for ${n}`);
        assert(list[n - 1].angle > 0, `Last cell angle must be positive for ${n}`);
    }
}

// Fallback verification for n > 12
const fallback = getFanCellOffsets(15);
assert(fallback.length === 15 && fallback[14].x === 1 && fallback[14].y === -14,
    'getFanCellOffsets fallback for n > 12');

print('fanGeometry: ok');
