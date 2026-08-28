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

// Changes that can affect monitor-fit calculations, actor geometry, animation
// model inputs, reserved work-area geometry, or cross-cutting accessibility
// styling keep the proven full relayout path.
export const GEOMETRY_KEYS = Object.freeze(new Set([
    'icon-size',
    'icon-spacing',
    'magnification',
    'zoom-range',
    'magnification-curve',
    'edge-margin',
    'dock-alignment',
    'dock-radius',
    'pill-thickness',
    'pill-thickness-auto',
    'dock-scale',
    'auto-shrink-to-fit',
    'auto-hide-mode',
    'animation-smoothness',
    'spring-tension',
    'spring-damping',
    'bounce-height',
    'bounce-decay',
    'hover-lift',
    'border-width',
    'interface-text-scale',
    'high-contrast',
]));

export const STYLE_KEYS = Object.freeze(new Set([
    'background-opacity',
    'pill-color',
    'border-color',
]));

export const AUTOHIDE_KEYS = Object.freeze(new Set([
    'hide-delay',
    'reveal-pressure',
    'show-autohide-handle',
    'pressure-sense',
    'pressure-sense-sensitivity',
]));

export const TOOLTIP_KEYS = Object.freeze(new Set([
    'show-tooltip',
    'tooltip-delay',
    'tooltip-radius',
    'tooltip-bg-color',
    'tooltip-text-color',
    'tooltip-border-color',
    'tooltip-border-width',
]));

export const ITEM_REFRESH_KEYS = Object.freeze(new Set([
    'indicator-style',
    'indicator-size',
    'indicator-color',
    'show-window-count',
    'show-badges',
    'badge-color',
    'badge-text-color',
    'announce-item-status',
]));

// These settings are consumed lazily by interaction or popup managers through
// the shared runtime config. Updating the config is sufficient; no dock actor
// geometry or repaint work is required immediately.
export const PASSIVE_CONFIG_KEYS = Object.freeze(new Set([
    'click-to-minimize',
    'left-click-action',
    'middle-click-action',
    'scroll-action',
    'drag-to-open',
    'lock-layout',
    'menu-use-gnome-default',
    'menu-radius',
    'menu-bg-color',
    'menu-text-color',
    'menu-border-color',
    'menu-border-width',
    'show-previews',
    'preview-delay',
    'preview-size',
    'preview-window-mode',
    'preview-close-buttons',
    'preview-overflow-mode',
    'preview-page-size',
    'preview-keyboard-navigation',
    'preview-window-actions',
    'downloads-view',
    'downloads-max-files',
    'downloads-sort',
    'downloads-pill-color',
    'downloads-border-radius',
    'downloads-border-color',
    'downloads-border-width',
    'downloads-item-color',
    'downloads-item-radius',
    'downloads-item-border-color',
    'downloads-item-border-width',
    'downloads-item-thumb-color',
    'downloads-item-font-color',
    'reduce-motion',
    'enable-genie-effect',
    'genie-duration',
]));

// Setting name -> properties in SettingsManager.config that can be copied into
// the current monitor-adjusted config without disturbing auto-shrink geometry.
export const SETTING_CONFIG_PROPERTIES = Object.freeze({
    'background-opacity': ['bgOpacity'],
    'pill-color': ['pillColor'],
    'border-color': ['borderColor'],

    'hide-delay': ['hideDelay'],
    'reveal-pressure': ['revealPressure'],
    'show-autohide-handle': ['showAutohideHandle'],
    'pressure-sense': ['pressureSense'],
    'pressure-sense-sensitivity': ['pressureSenseSensitivity'],

    'show-tooltip': ['showTooltip'],
    'tooltip-delay': ['tooltipDelay'],
    'tooltip-radius': ['tooltipRadius'],
    'tooltip-bg-color': ['tooltipBg'],
    'tooltip-text-color': ['tooltipFg'],
    'tooltip-border-color': ['tooltipBorderColor'],
    'tooltip-border-width': ['tooltipBorderWidth'],

    'indicator-style': ['indicatorStyle'],
    'indicator-size': ['indicatorSize'],
    'indicator-color': ['indicatorColor'],
    'show-window-count': ['showWindowCount'],
    'show-badges': ['showBadges'],
    'badge-color': ['badgeColor'],
    'badge-text-color': ['badgeTextColor'],
    'announce-item-status': ['announceItemStatus'],

    'click-to-minimize': ['clickToMinimize'],
    'left-click-action': ['leftClickAction'],
    'middle-click-action': ['middleClickAction'],
    'scroll-action': ['scrollAction'],
    'drag-to-open': ['dragToOpen'],
    'lock-layout': ['layoutLocked'],

    'menu-use-gnome-default': ['menuUseGnomeDefault'],
    'menu-radius': ['menuRadius'],
    'menu-bg-color': ['menuBg'],
    'menu-text-color': ['menuFg'],
    'menu-border-color': ['menuBorderColor'],
    'menu-border-width': ['menuBorderWidth'],

    'show-previews': ['showPreviews'],
    'preview-delay': ['previewDelay'],
    'preview-size': ['previewSize'],
    'preview-window-mode': ['previewWindowMode'],
    'preview-close-buttons': ['previewCloseButtons'],
    'preview-overflow-mode': ['previewOverflowMode'],
    'preview-page-size': ['previewPageSize'],
    'preview-keyboard-navigation': ['previewKeyboardNavigation'],
    'preview-window-actions': ['previewWindowActions'],

    'downloads-view': ['downloadsView'],
    'downloads-max-files': ['downloadsMaxFiles'],
    'downloads-sort': ['downloadsSort'],
    'downloads-pill-color': ['downloadsPillColor'],
    'downloads-border-radius': ['downloadsBorderRadius'],
    'downloads-border-color': ['downloadsBorderColor'],
    'downloads-border-width': ['downloadsBorderWidth'],
    'downloads-item-color': ['dlItemColor'],
    'downloads-item-radius': ['dlItemRadius'],
    'downloads-item-border-color': ['dlItemBorderColor'],
    'downloads-item-border-width': ['dlItemBorderWidth'],
    'downloads-item-thumb-color': ['dlItemThumbColor'],
    'downloads-item-font-color': ['dlItemFontColor'],

    'reduce-motion': ['reduceMotion'],
    'enable-genie-effect': ['enableGenieEffect'],
    'genie-duration': ['genieDuration'],
});

export function hasKnownDirectSettingImpact(key) {
    return STYLE_KEYS.has(key) || AUTOHIDE_KEYS.has(key) ||
        TOOLTIP_KEYS.has(key) || ITEM_REFRESH_KEYS.has(key) ||
        PASSIVE_CONFIG_KEYS.has(key);
}
