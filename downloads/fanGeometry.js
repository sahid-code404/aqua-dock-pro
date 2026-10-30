// Pure orientation helpers shared by the fan layout and its regression tests.

// Keep an opened folder stack visibly separate from the dock item that opened
// it. This is screen-space clearance, so it stays consistent as icons resize.
export const STACK_CLEARANCE = 18;

/**
 * Determines curvature direction and thumbnail positioning for Downloads fan views based on dock placement.
 *
 * @param {string} position - Screen edge position ('bottom', 'left', 'right').
 * @param {number} originX - Horizontal center coordinate of the triggering dock item.
 * @param {object} monitor - Monitor geometry rect { x, width }.
 * @returns {{ curveSign: number, thumbnailFirst: boolean }} Curvature sign (+1 or -1) and thumbnail ordering flag.
 */
export function fanOrientation(position, originX, monitor) {
    const pos = (position ?? 'bottom').toLowerCase();
    if (pos === 'left')
        return { curveSign: 1, thumbnailFirst: true };
    if (pos === 'right')
        return { curveSign: -1, thumbnailFirst: false };

    const middle = monitor.x + monitor.width / 2;
    return {
        curveSign: originX > middle ? 1 : -1,
        thumbnailFirst: false,
    };
}

/**
 * Computes the horizontal stage coordinate for a fan stack opened from a side dock.
 *
 * @param {string} position - Screen edge position ('left' or 'right').
 * @param {number} originX - Item horizontal center in stage coordinates.
 * @param {number} dockThickness - Thickness of the dock pill.
 * @param {number} panelWidth - Width of the opened stack panel.
 * @param {number} [clearance=STACK_CLEARANCE] - Gap clearance between dock and stack.
 * @returns {number|null} Horizontal stage position, or null if dock is on the bottom.
 */
export function sideFanX(
    position, originX, dockThickness, panelWidth, clearance = STACK_CLEARANCE
) {
    const pos = (position ?? 'bottom').toLowerCase();
    if (pos === 'left')
        return originX + dockThickness / 2 + clearance;
    if (pos === 'right')
        return originX - dockThickness / 2 - clearance - panelWidth;
    return null;
}

/**
 * Computes the vertical stage coordinate for a stack popup anchored above a bottom dock.
 *
 * @param {number} iconTop - Top coordinate of the triggering dock icon in stage coordinates.
 * @param {number} popupBottom - Height / bottom offset of the popup panel.
 * @param {number} [clearance=STACK_CLEARANCE] - Clearance gap between icon and panel.
 * @returns {number} Vertical stage coordinate for the popup panel.
 */
export function aboveDockY(iconTop, popupBottom, clearance = STACK_CLEARANCE) {
    return iconTop - popupBottom - clearance;
}

/**
 * Precompute fan cell coordinates for item counts N in [1, 12].
 * Returns a frozen array of length 13 where index N holds an array of N frozen cell offsets.
 * Each cell contains:
 * - x: normalized curve offset (Math.pow(t, 1.35)) in [0, 1]
 * - y: vertical step multiplier (-i)
 * - angle: tangent deflection angle along the curve in radians
 * - t: normalized index progress (i / (N - 1)) in [0, 1]
 * - normX: normalized horizontal progress in [0, 1]
 * - normY: normalized vertical progress in [0, -1]
 */
function buildFanCellOffsets() {
    const lut = new Array(13);
    for (let n = 1; n <= 12; n++) {
        const cells = new Array(n);
        for (let i = 0; i < n; i++) {
            const t = n > 1 ? i / (n - 1) : 0;
            const x = Math.pow(t, 1.35);
            const y = -i;
            const angle = n > 1 ? Math.atan2(45 * x, (i * 60) || 1) : 0;
            cells[i] = Object.freeze({
                x,
                y,
                angle,
                t,
                normX: x,
                normY: n > 1 ? -i / (n - 1) : 0,
            });
        }
        lut[n] = Object.freeze(cells);
    }
    return Object.freeze(lut);
}

export const FAN_CELL_OFFSETS = buildFanCellOffsets();

/**
 * Retrieve fan cell offsets for item count n.
 * Uses O(1) frozen LUT for n in [1, 12]; dynamically computes for any unexpected n > 12.
 *
 * @param {number} n - Item count
 * @returns {Array<{ x: number, y: number, angle: number, t: number, normX: number, normY: number }>}
 */
export function getFanCellOffsets(n) {
    if (n >= 1 && n <= 12 && FAN_CELL_OFFSETS[n])
        return FAN_CELL_OFFSETS[n];

    const cells = new Array(n);
    for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 0;
        const x = Math.pow(t, 1.35);
        const y = -i;
        const angle = n > 1 ? Math.atan2(45 * x, (i * 60) || 1) : 0;
        cells[i] = { x, y, angle, t, normX: x, normY: n > 1 ? -i / (n - 1) : 0 };
    }
    return cells;
}
