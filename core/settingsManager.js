// Gio.Settings wrapper and derived configuration snapshot generator.

import { clamp, logError, TimeoutGroup } from './utils.js';
import {
    ICON_BOT,
    SETTINGS_DEBOUNCE_MS,
    STRUCTURAL_KEYS,
} from './constants.js';
import { migrateSettings } from './settingsMigration.js';
import { parseCustomItems } from '../services/customItems.js';

const SETTINGS_RETRY_DELAYS_MS = [250, 500, 1000, 2000];

// Pill thickness derived from icon size when auto mode is on: 25 px
// of vertical breathing room around the icon, clamped to the schema's range.
function autoPillThickness(iconSize) {
    return Math.max(36, Math.min(120, iconSize + 25));
}

// Derive the full runtime configuration from raw settings. Pure function of the
// settings object: same keys in, same snapshot out. Kept module-private so the
// only supported way to read config is the cached `config` getter.
function computeConfig(s) {
    const scale = clamp(s.get_double('dock-scale'), 0.5, 2.0);
    const iconSize = Math.round(s.get_int('icon-size') * scale);
    const zoomMax = Math.max(1, s.get_double('magnification'));
    const renderSize = Math.round(iconSize * zoomMax);
    const pillThickness = s.get_boolean('pill-thickness-auto')
        ? autoPillThickness(s.get_int('icon-size'))
        : s.get_int('pill-thickness');
    const dockH = Math.round(pillThickness * scale);
    const hoverLift = Math.round(s.get_int('hover-lift') * scale);
    const requestedSpacing = s.get_int('icon-spacing');
    // The original dock used two independently rounded 6px side paddings.
    // Preserve that exact geometry for the new 12px default at fractional
    // scales, while user-selected values retain exact single-pixel steps.
    const iconSpacing = requestedSpacing === 12
        ? Math.round(requestedSpacing * scale / 2) * 2
        : Math.round(requestedSpacing * scale);
    const cellPad = iconSpacing / 2;
    const iconTopAtRest = dockH - ICON_BOT - iconSize;
    const headroom = Math.max(0, renderSize - iconSize + hoverLift - iconTopAtRest) + 10;
    const position = s.get_string('dock-position');
    const vertical = position === 'left' || position === 'right';
    const autoHideMode = s.get_string('auto-hide-mode');

    return {
        // ── Sizing / geometry ──
        scale,
        iconSize,
        zoomMax,
        renderSize,
        placeIconSourceSize: Math.max(32, renderSize),
        cellW: iconSize + iconSpacing,
        cellPad,
        iconSpacing,
        dockH,
        headroom,
        hitH: headroom + dockH,
        vertical,
        // Pre-computed for per-frame hot paths (avoids repeated division).
        invZoom: 1 / zoomMax,
        liftDenom: 1 / Math.max(0.001, zoomMax - 1),
        position,
        alignment: s.get_string('dock-alignment'),
        multiMonitor: s.get_boolean('multi-monitor'),
        isolateMonitors: s.get_boolean('isolate-monitors'),
        autoShrink: s.get_boolean('auto-shrink-to-fit'),
        zoomRange: Math.round(s.get_int('zoom-range') * scale),
        magnificationCurve: s.get_double('magnification-curve'),
        edgeMargin: s.get_int('edge-margin'),
        dockRadius: s.get_int('dock-radius'),
        hoverLift,

        // ── Background / chrome ──
        bgOpacity: s.get_double('background-opacity'),
        pillColor: s.get_string('pill-color'),
        borderColor: s.get_string('border-color'),
        borderWidth: s.get_int('border-width'),

        // ── Sections / behaviour ──
        showApps: s.get_boolean('show-apps-button'),
        appsButtonPosition: s.get_int('apps-button-position'),
        appsIcon: s.get_string('apps-button-icon'),
        showDownloads: s.get_boolean('show-downloads'),
        showCustomFolder: s.get_boolean('show-custom-folder'),
        customFolderUri: s.get_string('custom-folder-uri'),
        useFolderMetadataIcons: s.get_boolean('use-folder-metadata-icons'),
        showCustomDockItems: s.get_boolean('show-custom-dock-items'),
        customDockItems: parseCustomItems(s.get_strv('custom-dock-items')),
        showMountedDevices: s.get_boolean('show-mounted-devices'),
        showRemovableDevices: s.get_boolean('show-removable-devices'),
        showNetworkDevices: s.get_boolean('show-network-devices'),
        showFixedDevices: s.get_boolean('show-fixed-devices'),
        hiddenMountedDevices: s.get_strv('hidden-mounted-devices'),
        showTrash: s.get_boolean('show-trash'),
        clickToMinimize: s.get_boolean('click-to-minimize'),
        leftClickAction: s.get_string('left-click-action'),
        middleClickAction: s.get_string('middle-click-action'),
        scrollAction: s.get_string('scroll-action'),
        dragToOpen: s.get_boolean('drag-to-open'),
        layoutLocked: s.get_boolean('lock-layout'),
        isolateWS: s.get_boolean('isolate-workspaces'),

        // ── Auto-hide ──
        autoHideMode,
        autoHideActive: autoHideMode !== 'never',
        hideDelay: s.get_int('hide-delay'),
        revealPressure: s.get_int('reveal-pressure'),
        showAutohideHandle: s.get_boolean('show-autohide-handle'),
        pressureSense: s.get_boolean('pressure-sense'),
        pressureSenseSensitivity: s.get_double('pressure-sense-sensitivity'),

        // ── Animation / physics ──
        tau: s.get_int('animation-smoothness'),
        springTension: s.get_double('spring-tension'),
        springDamping: s.get_double('spring-damping'),
        bounceHeight: Math.round(s.get_int('bounce-height') * scale),
        bounceDecay: clamp(s.get_double('bounce-decay'), 0.30, 0.95),

        // ── Genie ──
        enableGenieEffect: s.get_boolean('enable-genie-effect'),
        genieDuration: s.get_int('genie-duration'),

        // ── Tooltip ──
        showTooltip: s.get_boolean('show-tooltip'),
        tooltipDelay: s.get_int('tooltip-delay'),
        tooltipRadius: s.get_int('tooltip-radius'),
        tooltipBg: s.get_string('tooltip-bg-color'),
        tooltipFg: s.get_string('tooltip-text-color'),
        tooltipBorderColor: s.get_string('tooltip-border-color'),
        tooltipBorderWidth: s.get_int('tooltip-border-width'),

        // ── Context menu ──
        menuRadius: s.get_int('menu-radius'),
        menuBg: s.get_string('menu-bg-color'),
        menuFg: s.get_string('menu-text-color'),
        menuBorderColor: s.get_string('menu-border-color'),
        menuBorderWidth: s.get_int('menu-border-width'),

        // ── Previews ──
        showPreviews: s.get_boolean('show-previews'),
        previewDelay: s.get_int('preview-delay'),
        previewSize: Math.round(s.get_int('preview-size') * scale),
        previewWindowMode: s.get_string('preview-window-mode'),
        previewCloseButtons: s.get_boolean('preview-close-buttons'),
        previewOverflowMode: s.get_string('preview-overflow-mode'),
        previewPageSize: s.get_int('preview-page-size'),
        previewKeyboardNavigation: s.get_boolean('preview-keyboard-navigation'),
        previewWindowActions: s.get_boolean('preview-window-actions'),

        // ── Indicators / badges ──
        indicatorStyle: s.get_string('indicator-style'),
        indicatorSize: s.get_int('indicator-size'),
        indicatorColor: s.get_string('indicator-color'),
        showWindowCount: s.get_boolean('show-window-count'),
        showBadges: s.get_boolean('show-badges'),
        badgeColor: s.get_string('badge-color'),
        badgeTextColor: s.get_string('badge-text-color'),

        // ── Downloads stack ──
        downloadsView: s.get_string('downloads-view'),
        downloadsMaxFiles: s.get_int('downloads-max-files'),
        downloadsSort: s.get_string('downloads-sort'),
        downloadsPillColor: s.get_string('downloads-pill-color'),
        downloadsBorderRadius: s.get_int('downloads-border-radius'),
        downloadsBorderColor: s.get_string('downloads-border-color'),
        downloadsBorderWidth: s.get_int('downloads-border-width'),
        dlItemColor: s.get_string('downloads-item-color'),
        dlItemRadius: s.get_int('downloads-item-radius'),
        dlItemBorderColor: s.get_string('downloads-item-border-color'),
        dlItemBorderWidth: s.get_int('downloads-item-border-width'),
        dlItemThumbColor: s.get_string('downloads-item-thumb-color'),
        dlItemFontColor: s.get_string('downloads-item-font-color'),

        // ── Accessibility ──
        reduceMotion: s.get_boolean('reduce-motion'),
        highContrast: s.get_boolean('high-contrast'),
        interfaceTextScale: s.get_double('interface-text-scale'),
        announceItemStatus: s.get_boolean('announce-item-status'),

    };
}

export class SettingsManager {
    constructor(settings, bus) {
        this._settings = settings;
        this._bus = bus;
        migrateSettings(settings);
        this._config = computeConfig(settings);

        this._pendingStructural = false;
        this._pendingKeys = new Set();
        this._timers = new TimeoutGroup();
        this._flushId = 0;
        this._retryCount = 0;

        this._changedId = settings.connect('changed', (_s, key) => this._onChanged(key));
    }

    // The cached, fully-derived snapshot. Stable reference between flushes.
    get config() {
        return this._config;
    }

    // Escape hatch for consumers that must register a keybinding or write a
    // setting. Prefer `config` everywhere else.
    get raw() {
        return this._settings;
    }

    _onChanged(key) {
        this._pendingKeys.add(key);
        if (STRUCTURAL_KEYS.has(key)) this._pendingStructural = true;
        this._retryCount = 0;

        this._scheduleFlush(SETTINGS_DEBOUNCE_MS);
    }

    _scheduleFlush(delay) {
        if (this._flushId) this._timers.remove(this._flushId);
        this._flushId = this._timers.addOnce(delay, () => {
            this._flushId = 0;
            this._flush();
        });
    }

    _flush() {
        const structural = this._pendingStructural;
        const keys = new Set(this._pendingKeys);
        let nextConfig;
        try { nextConfig = computeConfig(this._settings); }
        catch (e) {
            // Preserve the failed batch and retry transient GSettings/read
            // failures a few times with bounded backoff. Permanent failures do
            // not create an endless timer/log loop; the next real settings
            // change resets the retry budget and tries the complete batch again.
            logError(e, 'computeConfig');
            if (this._retryCount < SETTINGS_RETRY_DELAYS_MS.length) {
                const delay = SETTINGS_RETRY_DELAYS_MS[this._retryCount++];
                this._scheduleFlush(delay);
            }
            return;
        }

        this._retryCount = 0;
        this._pendingStructural = false;
        this._pendingKeys.clear();
        this._config = nextConfig;
        this._bus.emit('settings-changed', {
            structural,
            keys,
            config: this._config,
        });
    }

    destroy() {
        this._timers.removeAll();
        this._flushId = 0;
        this._retryCount = 0;
        if (this._changedId && this._settings) {
            this._settings.disconnect(this._changedId);
            this._changedId = 0;
        }
        this._pendingKeys.clear();
        this._bus = null;
        this._settings = null;
        this._config = null;
    }
}
