import {
    STACK_CLEARANCE,
    aboveDockY,
    fanOrientation,
    sideFanX,
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

print('fanGeometry: ok');
