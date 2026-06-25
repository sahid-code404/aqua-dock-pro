// AquaDockPro — settings ownership and the derived configuration snapshot.
//
// Purpose:   Wrap the extension's Gio.Settings into one authority that (1) owns
//            the single `changed` connection, (2) debounces bursts, (3) derives
//            an immutable, fully-computed `config` snapshot (sizes, geometry,
//            colours, behaviour flags) so consumers never re-read raw keys or
//            recompute geometry on hot paths, and (4) announces changes through
//            the EventBus with a `structural` flag for rebuild-vs-refresh.
// Ownership: OWNS the `changed` signal id and the debounce timeout id, plus the
//            cached config object. The raw Gio.Settings is owned by the GNOME
//            Extension base; we only borrow and disconnect our own handler.
// Cleanup:   destroy() removes the timeout, disconnects the signal, drops refs.
// Caching:   `config` is recomputed only on flush (post-debounce), never per
//            read. Consumers hold the reference and re-read fields for free.
//            Pre-computed derived constants (invZoom, liftDenom) eliminate
//            repeated division in per-frame hot paths.
// Cost:      One signal, at most one live timeout. Recompute is ~80 key reads,
//            amortised to once per settle of a slider drag.

import GLib from 'gi://GLib';

import { clamp, logError, TimeoutGroup } from './utils.js';
import {
    CELL_PAD,
    ICON_BOT,
    SETTINGS_DEBOUNCE_MS,
    STRUCTURAL_KEYS,
} from './constants.js';

// Pill thickness derived from icon size when auto mode is on: a constant ~28 px
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
    const cellPad = Math.round(CELL_PAD * scale);
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
        cellW: iconSize + cellPad * 2,
        cellPad,
        dockH,
        headroom,
        hitH: headroom + dockH,
        vertical,
        // Pre-computed for per-frame hot paths (avoids repeated division).
        invZoom: 1 / zoomMax,
        liftDenom: 1 / Math.max(0.001, zoomMax - 1),
        position,
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
        appsIcon: s.get_string('apps-button-icon'),
        showDownloads: s.get_boolean('show-downloads'),
        showTrash: s.get_boolean('show-trash'),
        clickToMinimize: s.get_boolean('click-to-minimize'),
        dragToOpen: s.get_boolean('drag-to-open'),
        isolateWS: s.get_boolean('isolate-workspaces'),

        // ── Auto-hide ──
        autoHideMode,
        autoHideActive: autoHideMode !== 'never',
        hideDelay: s.get_int('hide-delay'),
        revealPressure: s.get_int('reveal-pressure'),
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

    };
}

export class SettingsManager {
    constructor(settings, bus) {
        this._settings = settings;
        this._bus = bus;
        this._config = computeConfig(settings);

        this._pendingStructural = false;
        this._pendingKeys = new Set();
        this._timers = new TimeoutGroup();
        this._flushId = 0;

        this._changedId = settings.connect('changed', (_s, key) => this._onChanged(key));
    }

    // The cached, fully-derived snapshot. Stable reference between flushes.
    get config() {
        return this._config;
    }

    // Escape hatch for the rare consumer that needs a raw key not promoted into
    // the snapshot (e.g. prefs round-trips). Prefer `config` everywhere else.
    get raw() {
        return this._settings;
    }

    _onChanged(key) {
        this._pendingKeys.add(key);
        if (STRUCTURAL_KEYS.has(key)) this._pendingStructural = true;

        if (this._flushId) this._timers.remove(this._flushId);
        this._flushId = this._timers.addOnce(SETTINGS_DEBOUNCE_MS, () => {
            this._flushId = 0;
            this._flush();
        });
    }

    _flush() {
        const structural = this._pendingStructural;
        const keys = this._pendingKeys;
        this._pendingStructural = false;
        this._pendingKeys = new Set();

        try { this._config = computeConfig(this._settings); }
        catch (e) { logError(e, 'computeConfig'); return; }

        this._bus.emit('settings-changed', {
            structural,
            keys,
            config: this._config,
        });
    }

    destroy() {
        this._timers.removeAll();
        this._flushId = 0;
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
