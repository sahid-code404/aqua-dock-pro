// Helper utilities and resource ownership groups (SignalGroup, TimeoutGroup).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { LOG_PREFIX } from './constants.js';

let _Shell = null;
function getShell() {
    if (!_Shell) {
        try { _Shell = imports.gi.Shell; } catch { _Shell = null; }
    }
    return _Shell;
}

let _St = null;
let _stSettings = null;
function getSt() {
    if (!_St) {
        try { _St = imports.gi.St; } catch { _St = null; }
    }
    return _St;
}

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
}

// ── Pure helpers ───────────────────────────────────────────────────────────────
export function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
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
    try { return getShell()?.WindowTracker.get_default().get_window_app(win) ?? null; }
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

export function launchUri(uri) {
    try { Gio.AppInfo.launch_default_for_uri(uri, null); }
    catch (e) { logError(e, `launchUri ${uri}`); }
}

// Read both Aqua Dock's accessibility override and GNOME's reduced-motion
// preference whenever an animation is about to start. The GSettings object is
// cached, so this adds no per-frame setup or signal ownership.
let reduceMotionOverride = false;

export function setReduceMotionOverride(enabled) {
    reduceMotionOverride = enabled === true;
}

export function animationsEnabled() {
    if (reduceMotionOverride) return false;
    try {
        const extensionSettings = getExtensionSettings();
        if (extensionSettings?.get_boolean('reduce-motion')) return false;

        const StModule = getSt();
        if (!StModule) return true;

        const settings = _stSettings ??= StModule.Settings.get();
        if (!settings.enable_animations) return false;

        // GNOME 51 adds a separate reduced-motion preference. Keep this
        // feature check so the same package continues to run on GNOME 50.
        const reduce = StModule.ReducedMotion?.REDUCE;
        return reduce === undefined || settings.reduced_motion !== reduce;
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
