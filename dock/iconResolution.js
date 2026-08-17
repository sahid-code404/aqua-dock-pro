// Resolution tier selection with hysteresis for magnified icons.

const TIER_HYSTERESIS = 1.025;

export function stableArtworkSourceSize(visualSize, preferredSize = 0) {
    return Math.max(32, Math.round(visualSize), Math.round(preferredSize));
}

export function peakTierThresholds(zoomMax, out = {}) {
    zoomMax = Math.max(1, zoomMax);
    const boundary = Math.sqrt(zoomMax);
    out.enabled = zoomMax > 1;
    out.boundary = boundary;
    out.up = Math.min(zoomMax, boundary * TIER_HYSTERESIS);
    out.down = Math.max(1, boundary / TIER_HYSTERESIS);
    return out;
}

export function usePeakTier(scale, thresholds, wasPeak = false, force = false) {
    if (!thresholds.enabled) return false;
    if (force) return scale >= thresholds.boundary;

    return wasPeak
        ? scale > thresholds.down
        : scale >= thresholds.up;
}
