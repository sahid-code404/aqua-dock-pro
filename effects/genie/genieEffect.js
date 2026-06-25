// AquaDockPro — genie (magic-lamp) minimize integration.
//
// Purpose:   Make windows minimize/restore INTO their dock icon. Rather than a
//            custom shader, it feeds GNOME each window's icon geometry (the
//            icon's resting on-screen rect) via Meta's set_icon_geometry, so the
//            compositor's own minimize animation flies to the right spot — for
//            BOTH title-bar minimizes and dock-initiated ones. For dock-initiated
//            minimize/restore it also briefly tunes the global animation speed to
//            the configured genie duration.
// Ownership: OWNS the slow-down restore timer and the window-created idle ids.
//            destroy() cancels both and restores the user's animation speed.
// Cost:      Geometry updates are O(running windows), run on relayout / window
//            create — never per frame. set_icon_geometry is a cheap WM call.

import GLib from 'gi://GLib';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { clamp, appWindows, logError, TimeoutGroup } from '../../core/utils.js';

export class GenieController {
    // host: { getConfig, getGeom, getChips, getItems }
    constructor(host) {
        this._host = host;
        this._timers = new TimeoutGroup();
        this._restoreId = 0;
        this._slowPrev = 1;
    }

    get enabled() { return !!this._host?.getConfig().enableGenieEffect; }

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
            const rect = this.iconRestRect(item, chip);
            if (!rect) return;
            if (rect.x <= 0 && rect.y <= 0) return;     // dock not allocated yet
            for (const win of windows) win.set_icon_geometry(rect);
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
        if (!this._restoreId) {
            try { this._slowPrev = stSettings.slow_down_factor; } catch { this._slowPrev = 1; }
        }
        try { stSettings.slow_down_factor = factor; } catch { }
        try { fn(); } catch (e) { logError(e, 'genie fn'); }
        if (this._restoreId) this._timers.remove(this._restoreId);
        this._restoreId = this._timers.addOnce(dur + 60, () => {
            this._restoreId = 0;
            try { stSettings.slow_down_factor = this._slowPrev ?? 1; } catch { }
        });
    }

    destroy() {
        // Restore animation speed before clearing timers.
        if (this._restoreId) {
            try { St.Settings.get().slow_down_factor = this._slowPrev ?? 1; } catch { }
        }
        this._timers.removeAll();
        this._restoreId = 0;
        this._host = null;
    }
}
