// Resolution tier selection with hysteresis for magnified icons.

const TIER_HYSTERESIS = 1.025;

/**
 * Computes a stable, discrete texture source size for icon rasterization to avoid blurry scaling.
 *
 * @param {number} visualSize - Rendered pixel dimension of the icon.
 * @param {number} [preferredSize=0] - Optional preferred source icon size.
 * @returns {number} Clamped source texture dimension in pixels (minimum 32).
 */
export function stableArtworkSourceSize(visualSize, preferredSize = 0) {
    return Math.max(32, Math.round(visualSize), Math.round(preferredSize));
}

/**
 * Calculates hysteresis thresholds for transitioning to high-resolution icon artwork under magnification.
 * Prevents rapid texture swapping and thrashing near the magnification boundary.
 *
 * @param {number} zoomMax - Maximum magnification zoom factor.
 * @param {object} [out={}] - Optional reusable output object.
 * @returns {{ enabled: boolean, boundary: number, up: number, down: number }} Calculated tier thresholds.
 */
export function peakTierThresholds(zoomMax, out = {}) {
    zoomMax = Math.max(1, zoomMax);
    const boundary = Math.sqrt(zoomMax);
    out.enabled = zoomMax > 1;
    out.boundary = boundary;
    out.up = Math.min(zoomMax, boundary * TIER_HYSTERESIS);
    out.down = Math.max(1, boundary / TIER_HYSTERESIS);
    return out;
}

/**
 * Evaluates whether high-resolution icon artwork should be loaded for a current magnification scale.
 * Implements Schmitt trigger hysteresis to avoid texture thrashing.
 *
 * @param {number} scale - Current magnification scale factor.
 * @param {{ enabled: boolean, boundary: number, up: number, down: number }} thresholds - Hysteresis thresholds.
 * @param {boolean} [wasPeak=false] - Whether peak tier was active in the previous frame.
 * @param {boolean} [force=false] - If true, bypasses hysteresis and checks boundary directly.
 * @returns {boolean} True if peak resolution tier artwork should be used.
 */
export function usePeakTier(scale, thresholds, wasPeak = false, force = false) {
    if (!thresholds.enabled) return false;
    if (force) return scale >= thresholds.boundary;

    return wasPeak
        ? scale > thresholds.down
        : scale >= thresholds.up;
}
