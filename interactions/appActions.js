// AquaDockPro — click activation policy for app/apps/trash icons.
//
// Purpose:   Turn a left/middle click on an icon into the right window action —
//            launch (with a launch-bounce watch), raise, cycle, or minimize —
//            matching the dock's "smart click" behaviour. Extracted from the
//            controller so the orchestrator stays small and the (fiddly) click
//            rules live in one testable place.
// Ownership: OWNS the launch-watch signal connections (per app) and their
//            timeout group. destroy() releases all of them.
// Cost:      O(windows) per click. No background or per-frame work.

import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { TimeoutGroup, getFocusedAppSafe, appWindows, launchUri, logError } from '../core/utils.js';

const LAUNCH_LOCK_US = 1200 * 1000;
const LAUNCH_WATCH_MS = 8000;

export class AppActions {
    constructor(getConfig, genie = null) {
        this._getConfig = getConfig;
        this._genie = genie;
        this._timers = new TimeoutGroup();
        this._launching = new Map();   // app -> { stateId, timeoutId }
        this._lastClickItem = null;
    }

    activate(item, button) {
        const entry = item.entry;
        if (entry.kind === 'apps') {
            Main.overview.visible ? Main.overview.hide() : Main.overview.showApps();
            return;
        }
        if (entry.kind === 'trash') { launchUri('trash:///'); return; }
        if (entry.kind !== 'app' || !entry.app) return;
        this._activateApp(entry.app, item, button);
    }

    _activateApp(app, item, button) {
        const cfg = this._getConfig();
        const windows = appWindows(app);
        const focusApp = getFocusedAppSafe();
        const ws = global.workspace_manager.get_active_workspace();
        const onHere = windows.filter(w => !w.minimized && (!ws || w.located_on_workspace(ws)));
        const focusedHere = focusApp === app && onHere.some(w => w.has_focus());

        if (button === 2) { this._launch(app, item); return; }
        if (windows.length === 0) {
            if (app.get_state() === Shell.AppState.STARTING || this._launching.has(app)) {
                this._lastClickItem = item; return;
            }
            this._launch(app, item); return;
        }

        const repeat = this._lastClickItem === item;
        if (onHere.length === 0) { this._raise(windows, item); this._lastClickItem = item; return; }
        if (button === 1 && onHere.length > 1 && !focusedHere && !repeat) {
            this._raise(windows, item); this._lastClickItem = item; return;
        }
        if (focusedHere && onHere.length > 1) {
            const cur = onHere.findIndex(w => w.has_focus());
            onHere[(cur + 1) % onHere.length].activate(global.get_current_time());
            this._lastClickItem = item; return;
        }
        if (cfg.clickToMinimize && (focusedHere || (repeat && focusApp === app))) {
            const wins = (onHere.find(w => w.has_focus()) ? [onHere.find(w => w.has_focus())] : onHere);
            this._minimize(item, wins);
            item.bounce(Math.max(8, Math.round(cfg.bounceHeight * 0.5)), { decay: cfg.bounceDecay });
            this._lastClickItem = null; return;
        }
        this._raise(windows, item); this._lastClickItem = item;
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
        const sorted = windows.slice().sort((a, b) =>
            (b.get_user_time?.() ?? 0) - (a.get_user_time?.() ?? 0));
        const target = sorted[0];
        if (!target) { if (Main.overview.visible) Main.overview.hide(); return; }
        const doRaise = () => {
            try { if (target.minimized) target.unminimize(); Main.activateWindow(target, t); }
            catch { try { target.activate(t); } catch { } }
        };
        // Restore genies out of the icon when un-minimizing a hidden window.
        if (this._genie?.enabled && target.minimized && item) {
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
        this._lastClickItem = item;
        if (Main.overview.visible) Main.overview.hide();
        this._beginLaunchWatch(app, item);
    }

    // Bounce the icon while the app starts; stop as soon as it maps a window.
    _beginLaunchWatch(app, item) {
        if (this._launching.has(app)) return;
        const cfg = this._getConfig();
        const launching = () => this._launching.has(app);
        item.bounce(cfg.bounceHeight, { state: 'launch', repeat: launching, decay: cfg.bounceDecay });

        const rec = { stateId: 0, timeoutId: 0 };
        const stop = () => {
            if (!this._launching.has(app)) return;
            this._launching.delete(app);
            if (rec.stateId) { try { app.disconnect(rec.stateId); } catch { } }
            if (rec.timeoutId) this._timers.remove(rec.timeoutId);
            item.stopBounce();
        };
        rec.stateId = app.connect('windows-changed', () => { if (appWindows(app).length) stop(); });
        rec.timeoutId = this._timers.addOnce(LAUNCH_WATCH_MS, () => { rec.timeoutId = 0; stop(); });
        this._launching.set(app, rec);
        if (appWindows(app).length > 0) stop();
    }

    destroy() {
        for (const [app, rec] of this._launching) {
            if (rec.stateId) { try { app.disconnect(rec.stateId); } catch { } }
            if (rec.timeoutId) this._timers.remove(rec.timeoutId);
        }
        this._launching.clear();
        this._timers.removeAll();
        this._lastClickItem = null;
        this._getConfig = null;
    }
}
