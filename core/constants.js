// AquaDockPro — immutable, process-wide constants.
//
// Purpose:   Single source of truth for compile-time-style constants that are
//            referenced across modules: log identity, layout magic numbers, the
//            settings debounce window, and the structural-key set that decides
//            whether a settings change needs a full dock rebuild or a cheap
//            in-place refresh.
// Ownership: Stateless module. Holds no resources, owns nothing, never mutated.
// Cleanup:   None required.
// Cost:      Zero runtime cost; all values are frozen primitives/sets.

// ── Identity ────────────────────────────────────────────────────────────────
export const LOG_PREFIX = 'AquaDockPro';

// ── Layout geometry (logical px, pre-scale) ──────────────────────────────────
// These describe the resting dock metrics before the user's dock-scale factor
// is applied. They are intentionally small integers so derived geometry stays
// pixel-aligned after rounding.
export const CELL_PAD = 6;       // horizontal padding inside one icon cell
export const ICON_BOT = 8;       // gap between a resting icon and the pill bottom
export const BG_PAD_X = 10;      // padding between the end chips and the pill edge
export const DOT_SIZE = 5;       // running-indicator dot size
export const SEP_W = 3;          // separator line thickness
export const SEP_PAD = 8;        // padding on each side of a separator

// ── Physics ──────────────────────────────────────────────────────────────────
export const SETTLE_EPS = 0.002; // below this a spring is considered at rest

// ── Settings pipeline ────────────────────────────────────────────────────────
// Coalesce bursts of `changed` signals (e.g. dragging a slider) into a single
// recompute/emit. 120 ms tracks the reference behaviour: responsive yet free of
// per-step rebuild hitches.
export const SETTINGS_DEBOUNCE_MS = 120;

// Keys that change the dock's STRUCTURE — the chip set, directory watchers, or
// the chrome/strut layout — and therefore require a full rebuild. Everything
// else (opacity, radius, magnification, spring/bounce params, delays, indicator
// colour/style, …) is pure geometry/style/runtime state, applied in place.
export const STRUCTURAL_KEYS = Object.freeze(new Set([
    'dock-position',
    'auto-hide-mode',
    'show-apps-button',
    'apps-button-icon',
    'show-downloads',
    'show-trash',
    'isolate-workspaces',
]));
