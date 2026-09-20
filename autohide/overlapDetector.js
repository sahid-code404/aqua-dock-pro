// Intellihide window overlap detector.
// Tracks active workspace windows to detect dock collision.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import { monitorInFullscreen } from '../compat/shell.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {
    chooseStableWindowInventory,
    frameOverlapsDock,
    windowVisibleForDodge,
} from './overlapPolicy.js';

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

        const vert = geom.vert;
        const rx = geom.x, ry = geom.y;
        const rw = vert ? geom.thick : geom.width;
        const rh = vert ? geom.height : geom.thick;

        // Intellihide is a window-policy decision, not a compositor-paint
        // decision. Prefer Meta.Window inventories so a close/open animation
        // cannot temporarily make a still-valid covering window disappear just
        // because its Clutter actor is being unmapped/rebuilt. This was the main
        // source of one-frame dock reveals during app open/close, including on a
        // single monitor. Actor enumeration remains only as a compatibility
        // fallback for Shell variants lacking the stable inventories.
        let displayWindows = null;
        let workspaceWindows = null;
        let actorWindows = null;
        try { displayWindows = global.display?.list_all_windows?.() ?? null; }
        catch { displayWindows = null; }
        if (!Array.isArray(displayWindows)) {
            try { workspaceWindows = ws.list_windows?.() ?? null; }
            catch { workspaceWindows = null; }
        }
        if (!Array.isArray(displayWindows) && !Array.isArray(workspaceWindows)) {
            try {
                actorWindows = (global.get_window_actors?.() ?? [])
                    .map(actor => actor?.meta_window)
                    .filter(Boolean);
            } catch {
                actorWindows = [];
            }
        }
        const windows = chooseStableWindowInventory(
            displayWindows, workspaceWindows, actorWindows);

        let overlapped = false;
        const active = new Set();
        for (let i = 0, len = windows.length; i < len; i++) {
            const win = windows[i];
            if (!win) continue;

            let frame;
            try {
                // Do not use Meta.Window.is_hidden() here. During map/unmap
                // effects Mutter can transiently report a hidden state while
                // the window is still visibly covering the dock.
                const handledType = HANDLED_TYPES.has(win.get_window_type());
                let locatedOnWorkspace = null;
                if (ws && typeof win.located_on_workspace === 'function')
                    locatedOnWorkspace = Boolean(win.located_on_workspace(ws));

                if (!windowVisibleForDodge({
                    minimized: Boolean(win.minimized),
                    handledType,
                    locatedOnWorkspace,
                })) continue;

                // The frame rectangle is the source of truth for monitor
                // ownership. A window may span monitors, and get_monitor() can
                // change during a transition; neither should make a covered
                // dock momentarily look clear.
                frame = win.get_frame_rect();
            } catch {
                continue;
            }

            active.add(win);
            if (!this._tracked.has(win)) this._track(win);
            if (overlapped || !frame) continue;   // keep tracking the rest, but answer known

            if (frameOverlapsDock(frame, {
                x: rx,
                y: ry,
                width: rw,
                height: rh,
            }, TOL))
                overlapped = true;
        }

        // Windows can stay alive while moving to another workspace/monitor.
        // Stop retaining their move/resize signals as soon as they leave this
        // detector's scope; they will be tracked again if they return.
        for (const win of [...this._tracked]) {
            if (!active.has(win)) this._untrack(win);
        }
        return overlapped;
    }

    _track(win) {
        if (!win || this._tracked.has(win)) return;
        try {
            // Timestamp-based throttle: no timer, no leak, no closure risk.
            // 100_000 µs = 100ms minimum gap between callbacks.
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
            try { win.disconnectObject(this); } catch { }
        }
    }

    _untrack(win) {
        if (!win || !this._tracked.delete(win)) return;
        try { win.disconnectObject(this); } catch { }
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
