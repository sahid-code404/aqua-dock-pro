// Pure orientation helpers shared by the fan layout and its regression tests.

// Keep an opened folder stack visibly separate from the dock item that opened
// it. This is screen-space clearance, so it stays consistent as icons resize.
export const STACK_CLEARANCE = 18;

export function fanOrientation(position, originX, monitor) {
    if (position === 'left')
        return { curveSign: 1, thumbnailFirst: true };
    if (position === 'right')
        return { curveSign: -1, thumbnailFirst: false };

    const middle = monitor.x + monitor.width / 2;
    return {
        curveSign: originX > middle ? 1 : -1,
        thumbnailFirst: false,
    };
}

export function sideFanX(
    position, originX, dockThickness, panelWidth, clearance = STACK_CLEARANCE
) {
    if (position === 'left')
        return originX + dockThickness / 2 + clearance;
    if (position === 'right')
        return originX - dockThickness / 2 - clearance - panelWidth;
    return null;
}

export function aboveDockY(iconTop, popupBottom, clearance = STACK_CLEARANCE) {
    return iconTop - popupBottom - clearance;
}
