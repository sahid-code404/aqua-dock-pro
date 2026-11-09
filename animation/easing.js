// Frame-rate-independent exponential smoothing primitives.
// Settle time remains invariant across 60/120/144 Hz and VRR.

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
    return -Math.expm1(-dtMs / tauMs);
}
