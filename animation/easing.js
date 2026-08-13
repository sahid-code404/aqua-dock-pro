// Frame-rate-independent exponential smoothing primitives.
// Settle time remains invariant across 60/120/144 Hz and VRR.

// Critically-damped-style approach toward a target. `tauMs` is the time
// constant: larger = slower/softer. Returns the new value; caller keeps state.
//   k = 1 - e^(-dt/tau)   →   value += (target - value) * k
export function smoothTowards(value, target, dtMs, tauMs) {
    if (tauMs <= 0) return target;
    const k = 1 - Math.exp(-dtMs / tauMs);
    return value + (target - value) * k;
}

// The smoothing factor alone, for callers that smooth several fields with one
// shared time constant (compute k once, reuse).
export function smoothFactor(dtMs, tauMs) {
    if (tauMs <= 0) return 1;
    return 1 - Math.exp(-dtMs / tauMs);
}
