// Helper utilities and resource ownership groups (SignalGroup, TimeoutGroup).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { LOG_PREFIX } from './constants.js';
export { deepFreeze } from './constants.js';

let _stSettings = null;
let _extensionSettings = null;

function getExtensionSettings() {
    if (!_extensionSettings) {
        try {
            _extensionSettings = new Gio.Settings({
                schema_id: 'org.gnome.shell.extensions.aqua-dock-pro',
            });
        } catch {
            /* intentionally ignored: schema lookup may fail in early startup or test harness */
            _extensionSettings = null;
        }
    }
    return _extensionSettings;
}

// ── Logging ───────────────────────────────────────────────────────────────────
/**
 * Emits a formatted debug log message prefixed with the extension logging identifier.
 *
 * @param {string} msg - Message to output.
 * @returns {void}
 */
export function log(msg) {
    console.log(`${LOG_PREFIX}: ${msg}`);
}

/**
 * Formats and logs an error with an optional contextual description and stack trace.
 *
 * @param {Error|string} error - Error object or error message string.
 * @param {string} [context=''] - Optional context tag describing where the error occurred.
 * @returns {void}
 */
export function logError(error, context = '') {
    const where = context ? ` [${context}]` : '';
    const stack = error?.stack ? `\n${error.stack}` : '';
    console.error(`${LOG_PREFIX}:${where} ${error}${stack}`);
}

const warned = new Set();

/**
 * Emits a console warning exactly once per unique key to prevent journald spam.
 *
 * @param {string} key - Unique identifier for deduplication.
 * @param {string} message - Warning message to output.
 * @returns {void}
 */
export function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`${LOG_PREFIX}: ${message}`);
}

/**
 * Clears the set of recorded runtime warning keys and cached GSettings handles during teardown.
 *
 * @returns {void}
 */
export function clearRuntimeWarnings() {
    warned.clear();
    reduceMotionListeners.clear();
    _stSettings = null;
    _extensionSettings = null;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────
/**
 * Clamps a numeric value between a minimum and maximum boundary.
 *
 * @param {number} v - Input number.
 * @param {number} min - Lower boundary.
 * @param {number} max - Upper boundary.
 * @returns {number} Clamped numeric result.
 */
export function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
}

// Shell.App.get_icon() returns a fresh GIcon each call, so identity comparison
// is useless; Gio.Icon.equal() compares by value.
/**
 * Compares two Gio.Icon instances by value equality rather than object identity.
 *
 * @param {Gio.Icon|null} a - First icon.
 * @param {Gio.Icon|null} b - Second icon.
 * @returns {boolean} True if both icons represent identical resources.
 */
export function sameIcon(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    try { return a.equal(b); } catch { /* intentionally ignored: icon comparison failed on disparate GIcon types */ return false; }
}

/**
 * Safely resolves the Shell.App owning the currently focused window on the display.
 *
 * @returns {Shell.App|null} The focused application instance or null.
 */
export function getFocusedAppSafe() {
    const win = global.display?.focus_window ?? null;
    if (!win) return null;
    try { return Shell.WindowTracker.get_default().get_window_app(win) ?? null; }
    catch { /* intentionally ignored: app lookup failed on unmanaged or closing window */ return null; }
}

/**
 * Safely retrieves all open windows belonging to a Shell.App instance.
 *
 * @param {Shell.App|null} app - Application instance.
 * @returns {Meta.Window[]} Array of Meta.Window instances.
 */
export function appWindows(app) {
    try { return app?.get_windows?.() ?? []; }
    catch { /* intentionally ignored: window list query failed on disposed app */ return []; }
}

// Return the windows that belong to this dock's configured scope. Keeping this
// in one place prevents indicators and interactions from disagreeing when
// workspace and monitor isolation are enabled together.
/**
 * Filters an application's windows according to dock monitor and workspace isolation settings.
 * Ensures consistent window counts across dock items, indicators, and window previews.
 *
 * @param {Shell.App|null} app - Application instance.
 * @param {object} cfg - Dock configuration containing isolateMonitors, isolateWS, and monitorIndex.
 * @param {Meta.Workspace|null} [activeWorkspace=undefined] - Optional explicit workspace override.
 * @returns {Meta.Window[]} Filtered array of matching windows.
 */
export function appWindowsForConfig(app, cfg, activeWorkspace = undefined) {
    const windows = appWindows(app);
    const isolateMonitors = cfg?.isolateMonitors === true;
    const isolateWorkspaces = cfg?.isolateWS === true;
    if (!isolateMonitors && !isolateWorkspaces) return windows;

    let workspace = activeWorkspace;
    if (isolateWorkspaces && workspace === undefined) {
        try { workspace = global.workspace_manager?.get_active_workspace?.() ?? null; }
        catch { /* intentionally ignored: workspace query failed during workspace switch */ workspace = null; }
    }

    return windows.filter(window => {
        if (isolateMonitors) {
            try {
                if (window.get_monitor?.() !== cfg.monitorIndex) return false;
            } catch { /* intentionally ignored: monitor query failed on destroyed window */ return false; }
        }
        if (isolateWorkspaces && workspace) {
            try {
                if (!window.located_on_workspace?.(workspace)) return false;
            } catch { /* intentionally ignored: workspace query failed on destroyed window */ return false; }
        }
        return true;
    });
}

/**
 * Launches a URI using the default desktop application handler via GIO.
 *
 * @param {string} uri - URI string to launch.
 * @returns {void}
 */
export function launchUri(uri) {
    try { Gio.AppInfo.launch_default_for_uri(uri, null); }
    catch (e) { logError(e, `launchUri ${uri}`); }
}

// Read both Aqua Dock's accessibility override and GNOME's reduced-motion
// preference whenever an animation is about to start. The GSettings object is
// cached, so this adds no per-frame setup or signal ownership.
let reduceMotionOverride = false;
const reduceMotionListeners = new Set();

/**
 * Subscribes a listener callback to changes in the reduced motion accessibility override.
 *
 * @param {Function} callback - Callback invoked with (enabled: boolean).
 * @returns {Function} Unsubscribe closure.
 */
export function subscribeReduceMotionChanges(callback) {
    if (typeof callback !== 'function') return () => {};
    reduceMotionListeners.add(callback);
    return () => reduceMotionListeners.delete(callback);
}

/**
 * Sets a runtime override for the reduced motion setting, notifying registered listeners.
 *
 * @param {boolean} enabled - True to force reduced motion animations.
 * @returns {void}
 */
export function setReduceMotionOverride(enabled) {
    const next = enabled === true;
    if (next === reduceMotionOverride) return;
    reduceMotionOverride = next;
    for (const callback of [...reduceMotionListeners]) {
        try { callback(next); }
        catch (e) { logError(e, 'reduce-motion listener'); }
    }
}

/**
 * Evaluates whether UI animations should run based on GNOME Shell accessibility and extension preferences.
 *
 * @returns {boolean} True if animations are permitted; false if reduced motion is requested.
 */
export function animationsEnabled() {
    if (reduceMotionOverride) return false;
    try {
        const extensionSettings = getExtensionSettings();
        if (extensionSettings?.get_boolean('reduce-motion')) return false;

        const settings = _stSettings ??= St.Settings.get();
        if (!settings.enable_animations) return false;

        // GNOME 51 adds a separate reduced-motion preference. GJS exposes the
        // new property as reducedMotion; keep the underscore fallback for older
        // bindings so one package remains safe across Shell 50 and 51.
        const reduce = St.ReducedMotion?.REDUCE;
        const reducedMotion = settings.reducedMotion ?? settings.reduced_motion;
        return reduce === undefined || reducedMotion !== reduce;
    }
    catch { /* intentionally ignored: St settings query failed fallback to standard animation */ return true; }
}

// ── SignalGroup ────────────────────────────────────────────────────────────────
// Owns a batch of GObject signal connections. Every connect() made through the
// group is released exactly once by disconnectAll(); failed connects are never
// recorded, so disconnectAll() can never touch a stale id.
export class SignalGroup {
    constructor() {
        // Flat parallel arrays keep this allocation-light: no per-connection
        // wrapper object is created.
        this._objects = [];
        this._ids = [];
    }

    connect(obj, signal, callback) {
        if (!obj) return 0;
        let id = 0;
        try { id = obj.connect(signal, callback); }
        catch (e) { logError(e, `SignalGroup.connect '${signal}'`); return 0; }
        if (id) {
            this._objects.push(obj);
            this._ids.push(id);
        }
        return id;
    }

    disconnectAll() {
        const objs = this._objects;
        const ids = this._ids;
        for (let i = ids.length - 1; i >= 0; i--) {
            try { objs[i].disconnect(ids[i]); } catch { /* intentionally ignored: timeline or object already disposed */ }
        }
        objs.length = 0;
        ids.length = 0;
    }

    get size() { return this._ids.length; }
}

// ── TimeoutGroup ───────────────────────────────────────────────────────────────
// Owns GLib timeout/idle sources. A source that completes on its own (callback
// returns GLib.SOURCE_REMOVE) deregisters itself, so removeAll() and explicit
// remove() never call Source.remove() on a dead id.
export class TimeoutGroup {
    constructor() {
        this._ids = new Set();
    }

    // Repeating or self-terminating timer. The callback's return value is honoured
    // verbatim (GLib.SOURCE_CONTINUE to repeat, GLib.SOURCE_REMOVE to stop).
    add(intervalMs, callback, priority = GLib.PRIORITY_DEFAULT) {
        let id = 0;
        id = GLib.timeout_add(priority, intervalMs, () => {
            let keep = GLib.SOURCE_REMOVE;
            try {
                const ret = callback();
                keep = ret === GLib.SOURCE_CONTINUE ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
            } catch (e) {
                logError(e, 'TimeoutGroup callback');
                keep = GLib.SOURCE_REMOVE;
            }
            if (keep !== GLib.SOURCE_CONTINUE) this._ids.delete(id);
            return keep;
        });
        this._ids.add(id);
        return id;
    }

    // Fire-once convenience: callback's return value is ignored; the source is
    // always removed after one shot.
    addOnce(delayMs, callback, priority = GLib.PRIORITY_DEFAULT) {
        return this.add(delayMs, () => {
            try { callback(); } catch (e) { logError(e, 'TimeoutGroup.addOnce callback'); }
            return GLib.SOURCE_REMOVE;
        }, priority);
    }

    addIdle(callback, priority = GLib.PRIORITY_DEFAULT_IDLE) {
        let id = 0;
        id = GLib.idle_add(priority, () => {
            let keep = GLib.SOURCE_REMOVE;
            try {
                const ret = callback();
                keep = ret === GLib.SOURCE_CONTINUE ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
            } catch (e) {
                logError(e, 'TimeoutGroup idle callback');
                keep = GLib.SOURCE_REMOVE;
            }
            if (keep !== GLib.SOURCE_CONTINUE) this._ids.delete(id);
            return keep;
        });
        this._ids.add(id);
        return id;
    }

    remove(id) {
        if (id && this._ids.delete(id)) GLib.source_remove(id);
    }

    removeAll() {
        for (const id of this._ids) GLib.source_remove(id);
        this._ids.clear();
    }

    get size() { return this._ids.size; }
}
