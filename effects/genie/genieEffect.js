// Magic-lamp (genie) minimize/restore animation controller.

import GLib from 'gi://GLib';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { animationsEnabled, clamp, appWindows, logError, TimeoutGroup } from '../../core/utils.js';

// St.Settings.slow_down_factor is process-global. Multiple monitor controllers
// can start genie animations at once, so the latest controller temporarily owns
// the override and restores the original value once the final animation ends.
let slowDownOwner = null;
let slowDownPrevious = 1;
let slowDownApplied = null;

function captureExternalSlowDownChange(stSettings) {
    if (!slowDownOwner || slowDownApplied === null) return;
    try {
        const current = stSettings.slow_down_factor;
        if (current !== slowDownApplied) slowDownPrevious = current;
    } catch { }
}

function restoreSlowDown(stSettings) {
    try {
        // Do not overwrite a value another Shell component changed while the
        // genie override was active.
        if (slowDownApplied === null || stSettings.slow_down_factor === slowDownApplied)
            stSettings.slow_down_factor = slowDownPrevious;
    } catch { }
    slowDownPrevious = 1;
    slowDownApplied = null;
}

export class GenieController {
    // host: { getConfig, getGeom, getMonitorIndex, getChips, getItems }
    constructor(host) {
        this._host = host;
        this._timers = new TimeoutGroup();
        this._restoreId = 0;
    }

    get enabled() {
        return !!this._host?.getConfig().enableGenieEffect && animationsEnabled();
    }

    // The icon's resting on-screen rect (independent of live magnification).
    iconRestRect(item, chip = null) {
        const geom = this._host.getGeom();
        if (!item || !geom) return null;
        chip = chip ?? this._host.getChips().find(c => c.item === item);
        if (!chip) return null;
        const cfg = this._host.getConfig();
        const r = item._restRect;
        const vert = geom.vert;
        const ox = geom.x + (vert ? 0 : chip.baseX);
        const oy = geom.y + (vert ? chip.baseX : 0);
        if (r) {
            return new Mtk.Rectangle({
                x: Math.round(ox + r.x), y: Math.round(oy + r.y),
                width: Math.max(1, r.w), height: Math.max(1, r.h),
            });
        }
        const size = Math.max(1, cfg.iconSize);
        return new Mtk.Rectangle({
            x: Math.round(ox + (item.width - size) / 2),
            y: Math.round(oy + (item.height - size) / 2),
            width: size, height: size,
        });
    }

    setIconGeometry(item, windows, chip = null) {
        if (!this.enabled || !item || !windows?.length) return;
        try {
            const cfg = this._host.getConfig();
            const monitorIndex = this._host.getMonitorIndex?.() ?? -1;
            const targets = cfg.multiMonitor ? windows.filter(win => {
                try { return win.get_monitor() === monitorIndex; }
                catch { return false; }
            }) : windows;
            if (!targets.length) return;
            const rect = this.iconRestRect(item, chip);
            if (!rect) return;
            for (const win of targets) win.set_icon_geometry(rect);
        } catch (e) { logError(e, 'setIconGeometry'); }
    }

    // Point every running app's windows at their dock icon (so any minimize
    // genies in). Walks chips to avoid O(n²).
    updateAllIconGeometry() {
        if (!this.enabled || !this._host.getGeom()) return;
        for (const chip of this._host.getChips()) {
            const app = chip.item?.entry?.app;
            if (!app?.get_windows) continue;
            const wins = appWindows(app);
            if (wins.length) this.setIconGeometry(chip.item, wins, chip);
        }
    }

    // New windows get their geometry a tick later (the app↔window link isn't
    // ready on 'window-created').
    onWindowCreated(win) {
        if (!this.enabled || !win) return;
        this._timers.addIdle(() => {
            let app = null;
            try { app = Shell.WindowTracker.get_default().get_window_app(win); } catch { }
            const appId = app?.get_id?.();
            if (appId) {
                const item = this._host.getItems().find(it => it.entry?.app?.get_id?.() === appId);
                if (item) this.setIconGeometry(item, [win]);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // Run `fn` (the minimize/restore) with the animation speed tuned to the
    // configured genie duration, then restore the user's speed.
    withDuration(fn) {
        if (!this.enabled) { fn(); return; }
        const stSettings = St.Settings.get();
        const dur = clamp(this._host.getConfig().genieDuration ?? 120, 50, 1000);
        const factor = clamp(dur / 250, 0.4, 4.0);

        // If another Shell component changed the global factor while we owned
        // it, preserve that newer value as the baseline before applying another
        // genie override.
        captureExternalSlowDownChange(stSettings);

        // Transfer ownership without restoring in between animations. Otherwise
        // a second dock could capture an already-overridden value and leave it
        // behind after both timer callbacks run.
        if (slowDownOwner && slowDownOwner !== this)
            slowDownOwner._cancelSlowDownRestore();
        if (!slowDownOwner) {
            try { slowDownPrevious = stSettings.slow_down_factor; }
            catch { slowDownPrevious = 1; }
        }
        slowDownOwner = this;
        this._cancelSlowDownRestore();
        try {
            stSettings.slow_down_factor = factor;
            slowDownApplied = factor;
        } catch {
            slowDownApplied = null;
        }
        try { fn(); } catch (e) { logError(e, 'genie fn'); }
        this._restoreId = this._timers.addOnce(dur + 60, () => {
            this._restoreId = 0;
            if (slowDownOwner !== this) return;
            slowDownOwner = null;
            restoreSlowDown(stSettings);
        });
    }

    settleMotion() {
        if (slowDownOwner !== this) return;
        slowDownOwner = null;
        this._cancelSlowDownRestore();
        restoreSlowDown(St.Settings.get());
    }

    _cancelSlowDownRestore() {
        if (!this._restoreId) return;
        this._timers.remove(this._restoreId);
        this._restoreId = 0;
    }

    destroy() {
        // Restore animation speed before clearing timers, but only if nobody
        // else changed that process-global setting while the override was live.
        if (slowDownOwner === this) {
            slowDownOwner = null;
            restoreSlowDown(St.Settings.get());
        }
        this._timers.removeAll();
        this._restoreId = 0;
        this._host = null;
    }
}
