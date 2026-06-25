// AquaDockPro — stateless helpers and resource-ownership primitives.
//
// Purpose:   Two unrelated-but-tiny concerns that every module needs: (1) pure
//            functions (clamp, icon compare, safe app lookups) and (2) the
//            resource-tracking primitives — SignalGroup, TimeoutGroup — that
//            enforce the project's "every connect has a disconnect, every
//            timeout has a remove" rule by construction rather than by audit.
// Ownership: Pure functions own nothing. SignalGroup/TimeoutGroup each OWN the
//            ids handed to them and release every id on destroy()/removeAll().
// Cleanup:   Callers must call disconnectAll()/removeAll() (or destroy()) when
//            their owner tears down. A group leaks nothing it was given.
// Cost:      Helpers are O(1). Groups store one small record per live resource.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import { LOG_PREFIX } from './constants.js';

// ── Logging ───────────────────────────────────────────────────────────────────
export function log(msg) {
    console.log(`${LOG_PREFIX}: ${msg}`);
}

export function logError(error, context = '') {
    const where = context ? ` [${context}]` : '';
    const stack = error?.stack ? `\n${error.stack}` : '';
    console.error(`${LOG_PREFIX}:${where} ${error}${stack}`);
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
    try { return Shell.WindowTracker.get_default().get_window_app(win); }
    catch { return null; }
}

export function appWindows(app) {
    try { return app?.get_windows?.() ?? []; }
    catch { return []; }
}

export function launchUri(uri) {
    try { Gio.AppInfo.launch_default_for_uri(uri, null); }
    catch (e) { logError(e, `launchUri ${uri}`); }
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
