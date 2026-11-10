// Intellihide window overlap detector.
// Tracks active workspace windows to detect dock collision.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { monitorInFullscreen } from '../compat/shell.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const TOL = 4;   // px tolerance so a window just touching the dock isn't "overlap"

const HANDLED_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
]);

export class OverlapDetector {
    // getGeom: () => layout geom (for the pill rect); getMonitorIndex: () =>
    // the monitor hosting this dock. onWindowChange is the debounced
    // re-evaluation callback fired when a tracked window moves/resizes.
    constructor(getGeom, getMonitorIndex, onWindowChange) {
        this._getGeom = getGeom;
        this._getMonitorIndex = getMonitorIndex;
        this._onWindowChange = onWindowChange;
        this._tracked = new Set();
        this._active = new Set();
    }

    isOverlapped() {
        if (Main.overview.visible) return false;
        const geom = this._getGeom();
        if (!geom) return false;

        const monIndex = this._getMonitorIndex?.() ?? -1;
        if (monIndex < 0) return false;
        if (monitorInFullscreen(monIndex)) return true;

        const ws = global.workspace_manager.get_active_workspace();
        if (!ws) return false;

        const rx = geom.x, ry = geom.y;
        const rw = geom.width;
        const rh = geom.height;

        let actors;
        try { actors = global.get_window_actors?.() ?? []; }
        catch { return false; }

        let overlapped = false;
        const active = this._active;
        active.clear();
        for (let i = 0, len = actors.length; i < len; i++) {
            const win = actors[i]?.meta_window;
            if (!win) continue;

            let frame;
            try {
                if (win.minimized || win.is_hidden?.()) continue;
                if (!win.located_on_workspace(ws)) continue;
                if (win.get_monitor() !== monIndex) continue;
                if (!HANDLED_TYPES.has(win.get_window_type())) continue;
                frame = win.get_frame_rect();
            } catch {
                continue;
            }

            active.add(win);
            if (!this._tracked.has(win)) this._track(win);
            if (overlapped || !frame) continue;

            if (frame.x + TOL < rx + rw && frame.x + frame.width - TOL > rx &&
                frame.y + TOL < ry + rh && frame.y + frame.height - TOL > ry)
                overlapped = true;
        }

        for (const win of this._tracked) {
            if (!active.has(win)) this._untrack(win);
        }
        active.clear();
        return overlapped;
    }

    _track(win) {
        if (!win || this._tracked.has(win)) return;
        try {
            let lastFire = 0;
            const onChange = () => {
                const now = GLib.get_monotonic_time();
                if (now - lastFire < 100_000) return;
                lastFire = now;
                this._onWindowChange?.();
            };
            win.connectObject(
                'position-changed', onChange,
                'size-changed', onChange,
                'unmanaging', () => this._untrack(win),
                this);
            this._tracked.add(win);
        } catch {
                        try { win.disconnectObject(this); } catch {}
        }
    }

    _untrack(win) {
        if (!win || !this._tracked.delete(win)) return;
        try { win.disconnectObject(this); } catch {}
    }

    clear() {
        for (const win of [...this._tracked])
            this._untrack(win);
    }

    destroy() {
        this.clear();
        this._getGeom = null;
        this._getMonitorIndex = null;
        this._onWindowChange = null;
    }
}
