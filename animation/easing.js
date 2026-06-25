// AquaDockPro — frame-rate-independent easing primitives.
//
// Purpose:   Pure math used by the per-frame loop. The key idea is exponential
//            smoothing driven by elapsed time, not by a fixed per-frame factor —
//            so the same visual settle time holds at 60, 120 or 144 Hz / VRR.
// Ownership: Stateless. No actors, no timers, no allocation.
// Cost:      One exp() per call; callers invoke a handful of times per frame.

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
