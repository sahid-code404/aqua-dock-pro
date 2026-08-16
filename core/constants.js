// Immutable process-wide constants for Aqua Dock Pro.

// ── Identity ────────────────────────────────────────────────────────────────
export const LOG_PREFIX = 'AquaDockPro';

// ── Layout geometry (logical px, pre-scale) ──────────────────────────────────
export const ICON_BOT = 8;
export const BG_PAD_X = 10;
export const DOT_SIZE = 5;
export const SEP_W = 2;
export const SEP_PAD = 8;

// ── Physics ──────────────────────────────────────────────────────────────────
export const SETTLE_EPS = 0.002;

// ── Settings pipeline ────────────────────────────────────────────────────────
export const SETTINGS_DEBOUNCE_MS = 120;

// These keys are consumed directly by GNOME/GSettings or by migration code and
// do not require a dock config rebuild, relayout, item refresh, or repaint.
export const DOCK_NOOP_KEYS = Object.freeze(new Set([
    'settings-version',
    'focus-dock-shortcut',
]));

// Keys that change the dock's structure or the set of runtime services.
export const STRUCTURAL_KEYS = Object.freeze(new Set([
    'dock-position',
    'multi-monitor',
    'isolate-monitors',
    'show-apps-button',
    'apps-button-position',
    'apps-button-icon',
    'show-downloads',
    'show-custom-folder',
    'custom-folder-uri',
    'use-folder-metadata-icons',
    'show-custom-dock-items',
    'custom-dock-items',
    'show-mounted-devices',
    'show-removable-devices',
    'show-network-devices',
    'show-fixed-devices',
    'hidden-mounted-devices',
    'show-trash',
    'isolate-workspaces',
]));
