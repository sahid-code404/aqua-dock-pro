// Helper utilities and resource ownership groups (SignalGroup, TimeoutGroup).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { LOG_PREFIX } from './constants.js';

let _stSettings = null;
let _extensionSettings = null;

function getExtensionSettings() {
    if (!_extensionSettings) {
        try {
            _extensionSettings = new Gio.Settings({
                schema_id: 'org.gnome.shell.extensions.aqua-dock-pro',
            });
        } catch {
            _extensionSettings = null;
        }
    }
    return _extensionSettings;
}

// ── Logging ───────────────────────────────────────────────────────────────────
export function log(msg) {
    console.log(`${LOG_PREFIX}: ${msg}`);
}

export function logError(error, context = '') {
    const where = context ? ` [${context}]` : '';
    const stack = error?.stack ? `\n${error.stack}` : '';
    console.error(`${LOG_PREFIX}:${where} ${error}${stack}`);
}

const warned = new Set();

export function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`${LOG_PREFIX}: ${message}`);
}

export function clearRuntimeWarnings() {
    warned.clear();
    reduceMotionListeners.clear();
    _stSettings = null;
    _extensionSettings = null;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────
export function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
}

export function monitorIndexAtPoint(monitors, x, y) {
    for (let i = 0; i < (monitors?.length ?? 0); i++) {
        const mon = monitors[i];
        if (!mon) continue;
        if (x >= mon.x && x < mon.x + mon.width &&
            y >= mon.y && y < mon.y + mon.height)
            return i;
    }
    return -1;
}

// A focus transition should wake only the monitor that now owns focus. Mutter
// can publish a short null-focus gap while closing a window; attribute that gap
// to the previous monitor so its local close/fullscreen hand-off still settles.
// Moving focus directly to another display must not wake the old display's dock.
export function monitorTransitionTouchesIndex(previousIndex, currentIndex, targetIndex) {
    if (targetIndex < 0) return false;
    return currentIndex === targetIndex ||
        (currentIndex < 0 && previousIndex === targetIndex);
}

export function windowMonitorIndex(window) {
    if (!window || typeof window.get_monitor !== 'function') return -1;
    try {
        const index = window.get_monitor();
        return Number.isInteger(index) && index >= 0 ? index : -1;
    } catch {
        return -1;
    }
}

// Window lifecycle signals can arrive while Mutter is destroying/reparenting an
// actor and get_monitor() is already unavailable. Unknown ownership should not
// be treated as belonging to a specific monitor, but it should trigger a cheap
// reconciliation on each dock so a missed local unmap/minimize cannot leave one
// dock permanently hidden.
export function windowLifecycleMayAffectMonitor(window, targetIndex) {
    if (targetIndex < 0) return false;
    const owner = windowMonitorIndex(window);
    return owner < 0 || owner === targetIndex;
}

// Return monitor indexes in dock-construction order: primary first, then every
// distinct logical monitor. Duplicate geometries can appear transiently during
// mirror/reconfigure operations; building two docks into the same stage rect
// produces double input regions and duplicate animations, so collapse them.
export function monitorIndexesForLayout(monitors, primaryIndex, multiMonitor) {
    if (!monitors?.length) return [];
    const primary = Number.isInteger(primaryIndex) &&
        primaryIndex >= 0 && primaryIndex < monitors.length
        ? primaryIndex : 0;
    if (!multiMonitor) return [primary];

    const ordered = [primary];
    for (let i = 0; i < monitors.length; i++)
        if (i !== primary) ordered.push(i);

    const result = [];
    const seen = new Set();
    for (const index of ordered) {
        const mon = monitors[index];
        if (!mon) continue;
        const key = `${mon.x}:${mon.y}:${mon.width}:${mon.height}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(index);
    }
    return result;
}

// Shell.App.get_icon() returns a fresh GIcon each call, so identity comparison
// is useless; Gio.Icon.equal() compares by value.
export function sameIcon(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    try { return a.equal(b); } catch { return false; }
}

export function getFocusedAppSafe() {
    const win = global.display?.focus_window ?? null;
    if (!win) return null;
    try { return Shell.WindowTracker.get_default().get_window_app(win) ?? null; }
    catch { return null; }
}

export function appWindows(app) {
    try { return app?.get_windows?.() ?? []; }
    catch { return []; }
}

// Return the windows that belong to this dock's configured scope. Keeping this
// in one place prevents indicators and interactions from disagreeing when
// workspace and monitor isolation are enabled together.
export function appWindowsForConfig(app, cfg, activeWorkspace = undefined) {
    const windows = appWindows(app);
    const isolateMonitors = cfg?.isolateMonitors === true;
    const isolateWorkspaces = cfg?.isolateWS === true;
    if (!isolateMonitors && !isolateWorkspaces) return windows;

    let workspace = activeWorkspace;
    if (isolateWorkspaces && workspace === undefined) {
        try { workspace = global.workspace_manager?.get_active_workspace?.() ?? null; }
        catch { workspace = null; }
    }

    return windows.filter(window => {
        if (isolateMonitors) {
            try {
                if (window.get_monitor?.() !== cfg.monitorIndex) return false;
            } catch { return false; }
        }
        if (isolateWorkspaces && workspace) {
            try {
                if (!window.located_on_workspace?.(workspace)) return false;
            } catch { return false; }
        }
        return true;
    });
}

// Interaction policy differs slightly from display/isolation policy. When the
// same dock is present on several monitors, a click/scroll on monitor B should
// prefer that app's windows already on monitor B instead of unexpectedly
// activating a newer window on monitor A. If the app has no local window we
// fall back to the normal configured scope, preserving existing behavior.
export function appWindowsForInteraction(app, cfg, monitorIndex = -1, activeWorkspace = undefined) {
    const windows = appWindowsForConfig(app, cfg, activeWorkspace);
    if (!cfg?.multiMonitor || cfg?.isolateMonitors || monitorIndex < 0 || windows.length < 2)
        return windows;

    const local = windows.filter(window => {
        try { return window.get_monitor?.() === monitorIndex; }
        catch { return false; }
    });
    return local.length ? local : windows;
}

export function launchUri(uri) {
    try { Gio.AppInfo.launch_default_for_uri(uri, null); }
    catch (e) { logError(e, `launchUri ${uri}`); }
}

// Read both Aqua Dock's accessibility override and GNOME's reduced-motion
// preference whenever an animation is about to start. The GSettings object is
// cached, so this adds no per-frame setup or signal ownership.
let reduceMotionOverride = false;
const reduceMotionListeners = new Set();

export function subscribeReduceMotionChanges(callback) {
    if (typeof callback !== 'function') return () => {};
    reduceMotionListeners.add(callback);
    return () => reduceMotionListeners.delete(callback);
}

export function setReduceMotionOverride(enabled) {
    const next = enabled === true;
    if (next === reduceMotionOverride) return;
    reduceMotionOverride = next;
    for (const callback of [...reduceMotionListeners]) {
        try { callback(next); }
        catch (e) { logError(e, 'reduce-motion listener'); }
    }
}

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
    catch { return true; }
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
            try { objs[i].disconnect(ids[i]); } catch { /* object already gone */ }
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
            try { keep = callback(); }
            catch (e) { logError(e, 'TimeoutGroup callback'); keep = GLib.SOURCE_REMOVE; }
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
            try { keep = callback(); }
            catch (e) { logError(e, 'TimeoutGroup idle callback'); keep = GLib.SOURCE_REMOVE; }
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
