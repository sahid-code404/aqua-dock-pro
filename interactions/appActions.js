// Click activation policy for launching, focusing, cycling, and minimizing app windows.

import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    TimeoutGroup,
    getFocusedAppSafe,
    appWindows,
    appWindowsForConfig,
    launchUri,
    logError,
} from '../core/utils.js';

const LAUNCH_LOCK_US = 1200 * 1000;
const LAUNCH_WATCH_MS = 8000;

function windowMinimized(win) {
    try { return Boolean(win?.minimized); }
    catch { return false; }
}

function windowVisibleOnWorkspace(win, workspace) {
    try {
        if (!win || win.minimized) return false;
        return !workspace || Boolean(win.located_on_workspace?.(workspace));
    } catch {
        return false;
    }
}

function windowHasFocus(win) {
    try { return Boolean(win?.has_focus?.()); }
    catch { return false; }
}

function windowUserTime(win) {
    try { return win?.get_user_time?.() ?? 0; }
    catch { return 0; }
}

export class AppActions {
    constructor(getConfig, genie = null) {
        this._getConfig = getConfig;
        this._genie = genie;
        this._timers = new TimeoutGroup();
        this._launching = new Map();   // app -> { item, stateId, itemDestroyId, timeoutId }
        this._lastClickKey = null;
        this._launchLockApp = null;
        this._launchLockAt = 0;
    }

    activate(item, button) {
        const entry = item.entry;
        if (entry.kind === 'apps') {
            Main.overview.visible ? Main.overview.hide() : Main.overview.showApps();
            return;
        }
        if (entry.kind === 'mount') { this._openUri(item, entry.uri); return; }
        if (entry.kind === 'location') { this._openUri(item, entry.uri); return; }
        if (entry.kind === 'trash') { this._openUri(item, 'trash:///'); return; }
        if (entry.kind !== 'app' || !entry.app) return;
        this._activateApp(entry.app, item, button);
    }

    // URI entries do not have a Shell.App/window lifecycle to watch, but they
    // should still receive the same immediate launch feedback as app icons.
    _openUri(item, uri) {
        const cfg = this._getConfig();
        try { item.bounce(cfg.bounceHeight, { decay: cfg.bounceDecay }); } catch { }
        launchUri(uri);
    }

    _activateApp(app, item, button) {
        const cfg = this._getConfig();
        const clickKey = item.entry?.key ?? app.get_id?.() ?? null;
        let action = button === 2 ? cfg.middleClickAction : cfg.leftClickAction;
        if (action === 'nothing') return;
        if (action === 'new-window') { this._launch(app, item); return; }
        if (button === 2 && action === 'smart') button = 1;

        const windows = appWindowsForConfig(app, cfg);
        const focusApp = getFocusedAppSafe();
        let ws = null;
        try { ws = global.workspace_manager.get_active_workspace(); } catch { }
        const onHere = windows.filter(w => windowVisibleOnWorkspace(w, ws));
        const focusedIndex = focusApp === app ? onHere.findIndex(windowHasFocus) : -1;
        const focusedHere = focusedIndex >= 0;

        if (windows.length === 0) {
            if (app.get_state() === Shell.AppState.STARTING || this._launching.has(app)) {
                this._lastClickKey = clickKey; return;
            }
            this._launch(app, item); return;
        }

        if (action === 'minimize') {
            const visible = windows.filter(w => !windowMinimized(w));
            if (visible.length) this._minimize(item, visible);
            else this._raise(windows, item);
            this._lastClickKey = null;
            return;
        }
        if (action === 'cycle') {
            this._cycle(windows);
            this._lastClickKey = clickKey;
            return;
        }

        const repeat = this._lastClickKey === clickKey;
        if (onHere.length === 0) { this._raise(windows, item); this._lastClickKey = clickKey; return; }
        if (button === 1 && onHere.length > 1 && !focusedHere && !repeat) {
            this._raise(windows, item); this._lastClickKey = clickKey; return;
        }
        if (focusedHere && onHere.length > 1) {
            try { onHere[(focusedIndex + 1) % onHere.length].activate(global.get_current_time()); }
            catch { }
            this._lastClickKey = clickKey; return;
        }
        if (cfg.clickToMinimize && (focusedHere || (repeat && focusApp === app))) {
            const wins = focusedHere ? [onHere[focusedIndex]] : onHere;
            this._minimize(item, wins);
            try { item.bounce(Math.max(8, Math.round(cfg.bounceHeight * 0.5)), { decay: cfg.bounceDecay }); }
            catch { }
            this._lastClickKey = null; return;
        }
        this._raise(windows, item); this._lastClickKey = clickKey;
    }

    _cycle(windows, backwards = false) {
        if (!windows.length) return;
        const focused = windows.findIndex(windowHasFocus);
        const start = focused >= 0 ? focused : (backwards ? 0 : windows.length - 1);
        const offset = backwards ? -1 : 1;
        const target = windows[(start + offset + windows.length) % windows.length];
        try {
            if (windowMinimized(target)) target.unminimize();
            Main.activateWindow(target, global.get_current_time());
        } catch { try { target.activate(global.get_current_time()); } catch { } }
    }

    cycle(windows, backwards = false) {
        this._cycle(windows, backwards);
    }

    // Minimize, genie-ing into the dock icon when the effect is enabled.
    _minimize(item, windows) {
        const doMin = () => { for (const w of windows) { try { w.minimize(); } catch { } } };
        if (this._genie?.enabled) {
            this._genie.setIconGeometry(item, windows);
            this._genie.withDuration(doMin);
        } else {
            doMin();
        }
    }

    _raise(windows, item = null) {
        const t = global.get_current_time();
        const sorted = windows.slice().sort((a, b) => windowUserTime(b) - windowUserTime(a));
        const target = sorted[0];
        if (!target) { if (Main.overview.visible) Main.overview.hide(); return; }
        const minimized = windowMinimized(target);
        const doRaise = () => {
            try { if (windowMinimized(target)) target.unminimize(); Main.activateWindow(target, t); }
            catch { try { target.activate(t); } catch { } }
        };
        // Restore genies out of the icon when un-minimizing a hidden window.
        if (this._genie?.enabled && minimized && item) {
            this._genie.setIconGeometry(item, [target]);
            this._genie.withDuration(doRaise);
        } else {
            doRaise();
        }
        if (Main.overview.visible) Main.overview.hide();
    }

    _launch(app, item) {
        const now = GLib.get_monotonic_time();
        if (this._launchLockApp === app && now - (this._launchLockAt || 0) < LAUNCH_LOCK_US) return;
        this._launchLockApp = app;
        this._launchLockAt = now;
        try {
            if (app.get_state() === Shell.AppState.RUNNING) app.open_new_window(-1);
            else app.activate();
        } catch (e) { logError(e, 'launch'); return; }
        this._lastClickKey = item.entry?.key ?? app.get_id?.() ?? null;
        if (Main.overview.visible) Main.overview.hide();
        this._beginLaunchWatch(app, item);
    }

    // Bounce the icon while the app starts; stop as soon as it maps a window.
    _beginLaunchWatch(app, item) {
        if (this._launching.has(app)) return;
        const cfg = this._getConfig();
        const rec = { item, stateId: 0, itemDestroyId: 0, timeoutId: 0 };
        const launching = () => this._launching.has(app);
        const stop = (itemDestroyed = false) => {
            if (!this._launching.has(app)) return;
            this._launching.delete(app);
            if (rec.stateId) { try { app.disconnect(rec.stateId); } catch { } }
            if (rec.timeoutId) this._timers.remove(rec.timeoutId);
            if (rec.itemDestroyId && !itemDestroyed) {
                try { item.disconnect(rec.itemDestroyId); } catch { }
            }
            rec.stateId = rec.itemDestroyId = rec.timeoutId = 0;
            rec.item = null;
            if (!itemDestroyed) {
                try { item.stopBounce(); } catch { }
            }
        };

        // Publish ownership before connecting anything. If any later setup step
        // throws, stop() can reliably unwind every earlier signal/timer instead
        // of leaving a partially registered launch watch behind.
        this._launching.set(app, rec);
        try {
            rec.stateId = app.connect('windows-changed', () => {
                if (appWindows(app).length) stop();
            });
            rec.itemDestroyId = item.connect('destroy', () => stop(true));
            rec.timeoutId = this._timers.addOnce(LAUNCH_WATCH_MS, () => {
                rec.timeoutId = 0;
                stop();
            });
            item.bounce(cfg.bounceHeight, {
                state: 'launch', repeat: launching, decay: cfg.bounceDecay,
            });
            if (appWindows(app).length > 0) stop();
        } catch (error) {
            stop();
            logError(error, 'launch watch');
        }
    }

    destroy() {
        for (const [app, rec] of this._launching) {
            if (rec.stateId) { try { app.disconnect(rec.stateId); } catch { } }
            if (rec.timeoutId) this._timers.remove(rec.timeoutId);
            if (rec.itemDestroyId) {
                // DockController destroys AppActions before its item actors, so
                // the connection is still live here.
                try { rec.item?.disconnect(rec.itemDestroyId); } catch { }
            }
            rec.item = null;
        }
        this._launching.clear();
        this._timers.removeAll();
        this._lastClickKey = null;
        this._launchLockApp = null;
        this._launchLockAt = 0;
        this._getConfig = null;
        this._genie = null;
    }
}
