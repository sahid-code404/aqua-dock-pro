// Frame-rate-independent exponential smoothing primitives.
// Settle time remains invariant across 60/120/144 Hz and VRR.

// Critically-damped-style approach toward a target. `tauMs` is the time
// constant: larger = slower/softer.
/**
 * Asymptotically interpolates a scalar value towards a target using exponential decay.
 * Guarantees frame-rate-independent settling across 60 Hz, 120 Hz, 144 Hz, and VRR displays.
 *
 * @param {number} value - Initial or current numeric value.
 * @param {number} target - Target numeric value to approach.
 * @param {number} dtMs - Elapsed delta time since the previous tick in milliseconds.
 * @param {number} tauMs - Exponential time constant in milliseconds (larger yields softer motion).
 * @returns {number} The updated smoothed value after dtMs.
 */
export function smoothTowards(value, target, dtMs, tauMs) {
    if (tauMs <= 0) return target;
    const k = 1 - Math.exp(-dtMs / tauMs);
    return value + (target - value) * k;
}

// The smoothing factor alone, for callers that smooth several fields with one
// shared time constant (compute k once, reuse).
/**
 * Calculates the dimensionless exponential smoothing factor k for a given delta time and time constant.
 * Allows callers to compute the factor once and reuse it across multiple vector components.
 *
 * @param {number} dtMs - Elapsed delta time since the previous tick in milliseconds.
 * @param {number} tauMs - Exponential time constant in milliseconds.
 * @returns {number} Interpolation factor in the normalized range [0, 1].
 */
export function smoothFactor(dtMs, tauMs) {
    if (tauMs <= 0) return 1;
    return 1 - Math.exp(-dtMs / tauMs);
}
