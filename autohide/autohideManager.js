// Autohide and intellihide policy manager.
// Listens for window/focus changes and controls when the dock slides in/out.

import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SignalGroup, TimeoutGroup } from '../core/utils.js';
import { VisibilityController } from './visibilityController.js';
import { OverlapDetector } from './overlapDetector.js';
import { PressureBarrier } from './pressureBarrier.js';
import { hasFullscreenWindow, windowKeepsDockHidden } from './fullscreenPolicy.js';
import { monitorInFullscreen } from '../compat/shell.js';

const DEBOUNCE_HIDE_MS = 200;
const FULLSCREEN_CLEAR_CONFIRM_MS = 120;
const POINTER_BUTTON_MASK =
    Clutter.ModifierType.BUTTON1_MASK |
    Clutter.ModifierType.BUTTON2_MASK |
    Clutter.ModifierType.BUTTON3_MASK |
    Clutter.ModifierType.BUTTON4_MASK |
    Clutter.ModifierType.BUTTON5_MASK;

export class AutohideManager {
    // host: { chrome, getGeom, getConfig, getMonitor, getMonitorIndex,
    //         kickEngine, isMagnifying, clearHover, isInteractionActive }
    constructor(host) {
        this._host = host;
        this._signals = new SignalGroup();
        this._timers = new TimeoutGroup();

        this._vis = new VisibilityController(host.chrome.container);
        this._overlap = new OverlapDetector(host.getGeom, host.getMonitorIndex,
            () => this._debounceCheckHide());
        this._pressure = new PressureBarrier(host.getConfig, host.getMonitor,
            () => this._vis.hidden,
            () => !this._pointerButtonDown(),
            () => this._reveal());

        this._hideId = 0;
        this._revealId = 0;
        this._debounceId = 0;
        this._idleId = 0;
        this._fullscreenClearId = 0;
        this._fullscreenBlocked = false;
        this._enabled = false;
    }

    get hidden() { return this._vis.hidden; }

    // ── Lifecycle ───────────────────────────────────────────────────────────
    enable() {
        if (this._enabled) return;
        this._enabled = true;
        this._connect();
        this.queueIntellihide();
    }

    disable() {
        this._enabled = false;
        this._cancelHide();
        this._cancelReveal();
        this._cancelDebounce();
        this._cancelFullscreenClear();
        this._timers.removeAll();
        this._hideId = 0;
        this._revealId = 0;
        this._debounceId = 0;
        this._idleId = 0;
        this._fullscreenClearId = 0;
        this._fullscreenBlocked = false;
        this._signals.disconnectAll();
        this._setHidden(false, false);   // show before tearing down
        this._host.chrome.setAutohideHandleVisible(false, false);
    }

    destroy() {
        this.disable();
        this._pressure.destroy();
        this._overlap.destroy();
        this._vis.destroy();
        this._host = null;
    }

    // Re-apply edge/strip geometry and keep the container at the right place
    // after a relayout.
    onRelayout() {
        const geom = this._host.getGeom();
        if (!geom) return;
        this._host.chrome.applyStrip(geom.strip);
        this._host.chrome.applyAutohideHandle(geom.autohideHandle);
        this._host.chrome.setAutohideHandleVisible(
            this._vis.hidden && this._host.getConfig().showAutohideHandle &&
            !this._fullscreenBlocksDock(), false);
        if (this._vis.hidden) this._host.chrome.hideEdgeZone();
        else this._host.chrome.applyEdgeZone(geom.edgeZone);
        this.queueIntellihide();
    }

    // ── Pointer hooks called by the controller ───────────────────────────────
    onDockActivity() {
        this._cancelHide();
        if (this._vis.hidden && !this._pointerButtonDown())
            this._setHidden(false, true);
    }

    onDockLeft() {
        this._debounceCheckHide();
    }

    // ── Signal wiring ─────────────────────────────────────────────────────────
    _connect() {
        const s = this._signals;
        const strip = this._host.chrome.strip;

        s.connect(strip, 'enter-event', () => { this._cancelHide(); this._beginReveal(); });
        // Keep a pending hide cancelled while the pointer rides the edge; the
        // PressureBarrier's own poll handles dwell accumulation.
        s.connect(strip, 'motion-event', () => {
            this._cancelHide();
            if (this._pointerButtonDown()) this._cancelReveal();
        });
        // When the pointer leaves the strip (moved off-edge), queue a hide
        // check — if it didn't land on the dock/edge-zone, auto-hide fires.
        s.connect(strip, 'leave-event', () => { this._cancelReveal(); this._debounceCheckHide(); });

        const d = global.display;
        s.connect(d, 'restacked', () => this.queueIntellihide());
        // Focus changes are infrequent and can expose an already-fullscreen
        // window immediately after a covering window disappears. Evaluate
        // synchronously so the dock cannot survive that hand-off for one frame.
        s.connect(d, 'notify::focus-window', () => this.updateIntellihide());
        s.connect(d, 'grab-op-end', () => this.queueIntellihide());
        // Positive fullscreen transitions must hide immediately. A transient
        // negative reading is held by _fullscreenBlocksDock() until confirmed.
        s.connect(d, 'in-fullscreen-changed', () => this.updateIntellihide());

        const wm = global.window_manager;
        // Shell.WM emits destroy/minimize before the compositor effect has
        // completed. If that window is covering a fullscreen window, pre-hide
        // now rather than waiting for the later restack/fullscreen signals.
        s.connect(wm, 'destroy', (_wm, actor) =>
            this._onCoveringWindowLeaving(actor?.meta_window));
        s.connect(wm, 'minimize', (_wm, actor) =>
            this._onCoveringWindowLeaving(actor?.meta_window));
        s.connect(wm, 'size-change', () => this.queueIntellihide());

        s.connect(global.workspace_manager, 'active-workspace-changed', () => this.queueIntellihide());
        s.connect(Main.overview, 'showing', () => { this._cancelHide(); this._setHidden(false, true); });
        s.connect(Main.overview, 'hidden', () => this.queueIntellihide());
    }

    // ── Intellihide ───────────────────────────────────────────────────────────
    queueIntellihide() {
        if (this._idleId) return;
        this._idleId = this._timers.addIdle(() => {
            this._idleId = 0;
            this.updateIntellihide();
            return false;
        });
    }

    updateIntellihide() {
        if (!this._enabled) return;
        const cfg = this._host.getConfig();
        const mode = cfg.autoHideMode;

        // Fullscreen owns visibility on the dock's monitor. Cancelling here
        // also stops a reveal armed just before the fullscreen transition.
        if (this._fullscreenBlocksDock()) {
            this._forceFullscreenHidden();
            return;
        }
        if (mode === 'never' || Main.overview.visible || this._host.isInteractionActive?.()) {
            this._cancelHide();
            this._setHidden(false, true);
            return;
        }
        if (this._pointerReallyInside()) {
            this._cancelHide();
            this._setHidden(false, true);
            return;
        }
        // A middle icon can keep several neighbours magnified. Do not start
        // the dock's slide until that shared pill has settled, otherwise the
        // slide and the shrinking pill compete for the same visible surface.
        if (this._host.isMagnifying?.()) {
            this._cancelHide();
            this._setHidden(false, true);
            this._scheduleHide();
            return;
        }
        if (mode === 'always') { this._scheduleHide(); return; }
        if (mode === 'dodge') {
            if (this._overlap.isOverlapped()) this._scheduleHide();
            else { this._cancelHide(); this._setHidden(false, true); }
            return;
        }
    }

    _debounceCheckHide() {
        this._cancelDebounce();
        this._debounceId = this._timers.addOnce(DEBOUNCE_HIDE_MS, () => {
            this._debounceId = 0;
            this.updateIntellihide();
        });
    }

    _cancelDebounce() {
        if (this._debounceId) { this._timers.remove(this._debounceId); this._debounceId = 0; }
    }

    // ── Hide / reveal timers ──────────────────────────────────────────────────
    _scheduleHide() {
        const cfg = this._host.getConfig();
        if (this._hideId || cfg.autoHideMode === 'never') return;
        this._hideId = this._timers.addOnce(cfg.hideDelay, () => {
            this._hideId = 0;
            if (this._pointerReallyInside() || this._host.isInteractionActive?.()) return;
            // Continue waiting in short, bounded checks while magnification
            // finishes; the next check applies the normal hide policy.
            if (this._host.isMagnifying?.()) { this._scheduleHide(); return; }
            const live = this._host.getConfig();
            if (live.autoHideMode === 'dodge' && !this._overlap.isOverlapped()) return;
            this._setHidden(true, true);
        });
    }

    _cancelHide() {
        if (this._hideId) { this._timers.remove(this._hideId); this._hideId = 0; }
    }

    _beginReveal() {
        this._cancelReveal();
        if (this._fullscreenBlocksDock() || this._pointerButtonDown()) return;
        const cfg = this._host.getConfig();
        if (cfg.pressureSense) { this._pressure.begin(); return; }
        if (cfg.revealPressure <= 0) { this._setHidden(false, true); return; }
        this._revealId = this._timers.addOnce(cfg.revealPressure, () => {
            this._revealId = 0;
            if (!this._pointerButtonDown()) this._setHidden(false, true);
        });
    }

    _cancelReveal() {
        if (this._revealId) { this._timers.remove(this._revealId); this._revealId = 0; }
        this._pressure.cancel();
    }

    _reveal() {
        if (this._fullscreenBlocksDock() || this._pointerButtonDown()) return;
        this._cancelHide();
        this._setHidden(false, true);
    }

    // ── Slide + side effects ──────────────────────────────────────────────────
    _setHidden(hidden, animate) {
        const cfg = this._host.getConfig();
        const fullscreen = this._fullscreenBlocksDock();
        if (fullscreen) hidden = true;
        else if (cfg.autoHideMode === 'never' && hidden) hidden = false;
        const geom = this._host.getGeom();
        if (!geom) return;

        this._host.chrome.setAutohideHandleVisible(
            hidden && cfg.showAutohideHandle && !fullscreen, animate);
        const changed = this._vis.setHidden(hidden, geom, animate, () => this._host.kickEngine());
        if (!changed) return;

        if (hidden) {
            this._host.chrome.hideEdgeZone();
            this._host.clearHover?.();
        } else {
            this._host.chrome.applyEdgeZone(geom.edgeZone);
        }
    }

    // ── Fullscreen policy ────────────────────────────────────────────────────
    _forceFullscreenHidden() {
        this._cancelHide();
        this._cancelReveal();
        this._cancelDebounce();
        this._setHidden(true, false);
    }

    _onCoveringWindowLeaving(window) {
        if (!this._enabled || Main.overview.visible || !window) return;

        const monitor = this._host.getMonitorIndex?.() ?? -1;
        if (monitor < 0) return;

        let workspace;
        try {
            workspace = global.workspace_manager.get_active_workspace();
            if (window.get_monitor?.() !== monitor) return;
            if (workspace && typeof window.located_on_workspace === 'function' &&
                !window.located_on_workspace(workspace))
                return;
        } catch {
            return;
        }

        // Meta.Display.list_all_windows() keeps Meta.Window objects independent
        // of compositor actor visibility. Exclude the window that is leaving:
        // only a different fullscreen window underneath should pre-hide us.
        let windows = null;
        try { windows = global.display?.list_all_windows?.() ?? null; }
        catch { windows = null; }
        if (!windows) {
            try { windows = workspace?.list_windows?.() ?? null; }
            catch { windows = null; }
        }
        if (!windows) return;

        for (const candidate of windows) {
            if (candidate === window) continue;
            if (!windowKeepsDockHidden(candidate, monitor, workspace)) continue;
            this._fullscreenBlocked = true;
            this._cancelFullscreenClear();
            this._forceFullscreenHidden();
            return;
        }
    }

    _rawFullscreenBlocksDock() {
        const monitor = this._host.getMonitorIndex?.() ?? -1;
        if (monitor < 0) return false;
        if (monitorInFullscreen(monitor)) return true;

        let workspace = null;
        try { workspace = global.workspace_manager.get_active_workspace(); }
        catch { }

        // list_all_windows() is the stable Meta.Window inventory. Unlike actor
        // lists, it is not tied to whether a window is currently mapped/painted.
        try {
            const windows = global.display?.list_all_windows?.();
            if (windows) return hasFullscreenWindow(windows, monitor, workspace);
        } catch { }

        // Compatibility fallback for Shell versions where the display inventory
        // is unavailable. Keep the old workspace/actor sources as a last resort.
        try {
            const windows = workspace?.list_windows?.();
            if (windows && hasFullscreenWindow(windows, monitor, workspace))
                return true;
        } catch { }
        try {
            const actors = global.get_window_actors?.() ?? [];
            for (const actor of actors) {
                if (windowKeepsDockHidden(actor?.meta_window, monitor, workspace))
                    return true;
            }
        } catch { }

        return false;
    }

    _fullscreenBlocksDock() {
        if (!this._enabled || Main.overview.visible) return false;

        if (this._rawFullscreenBlocksDock()) {
            this._fullscreenBlocked = true;
            this._cancelFullscreenClear();
            return true;
        }

        // Leaving fullscreen is the only ambiguous edge. Window destruction,
        // focus changes and restacking can make both Mutter's monitor flag and
        // the workspace window list temporarily report no fullscreen window.
        // Keep the previous fullscreen ownership until one short recheck agrees.
        if (this._fullscreenBlocked) {
            this._scheduleFullscreenClear();
            return true;
        }
        return false;
    }

    _scheduleFullscreenClear() {
        if (this._fullscreenClearId || !this._enabled) return;
        this._fullscreenClearId = this._timers.addOnce(FULLSCREEN_CLEAR_CONFIRM_MS, () => {
            this._fullscreenClearId = 0;
            if (!this._enabled) return;

            if (this._rawFullscreenBlocksDock()) {
                this._fullscreenBlocked = true;
                return;
            }

            this._fullscreenBlocked = false;
            this.updateIntellihide();
        });
    }

    _cancelFullscreenClear() {
        if (!this._fullscreenClearId) return;
        this._timers.remove(this._fullscreenClearId);
        this._fullscreenClearId = 0;
    }

    _pointerButtonDown() {
        try { return Boolean(global.get_pointer()[2] & POINTER_BUTTON_MASK); }
        catch { return false; }
    }

    // ── Pointer-in-dock truth ─────────────────────────────────────────────────
    _pointerReallyInside() {
        const geom = this._host.getGeom();
        if (!geom) return false;
        let px, py;
        try { [px, py] = global.get_pointer(); } catch { return false; }

        const c = this._host.chrome.container;
        if (c && !this._vis.hidden &&
            px >= geom.x && px < geom.x + c.width &&
            py >= geom.y && py < geom.y + c.height)
            return true;

        const ez = this._host.chrome.edgeZone;
        if (ez && ez.width > 0 && ez.height > 0 &&
            px >= ez.x && px < ez.x + ez.width && py >= ez.y && py < ez.y + ez.height)
            return true;

        const mz = this._host.chrome.magZone;
        if (mz && mz.width > 0 && mz.height > 0 &&
            px >= mz.x && px < mz.x + mz.width && py >= mz.y && py < mz.y + mz.height)
            return true;

        return false;
    }
}
