// Autohide and intellihide policy manager.
// Listens for window/focus changes and controls when the dock slides in/out.

import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    SignalGroup,
    TimeoutGroup,
    monitorTransitionTouchesIndex,
    windowLifecycleMayAffectMonitor,
    windowMonitorIndex,
} from '../core/utils.js';
import { VisibilityController } from './visibilityController.js';
import { OverlapDetector } from './overlapDetector.js';
import { PressureBarrier } from './pressureBarrier.js';
import { hasFullscreenWindow, windowKeepsDockHidden } from './fullscreenPolicy.js';
import { shouldHoldShownForMagnification } from './overlapPolicy.js';
import { monitorInFullscreen } from '../compat/shell.js';

const DEBOUNCE_HIDE_MS = 200;
const FULLSCREEN_CLEAR_CONFIRM_MS = 120;
const MAGNIFICATION_RECHECK_MS = 50;
const SHARED_EDGE_REVEAL_MS = 90;
// Dodge/intellihide reveal must be based on a stable no-overlap state. Window
// open/close effects can briefly publish an intermediate stacking snapshot even
// when another local window still covers the dock.
const DODGE_REVEAL_CONFIRM_MS = 260;
const WINDOW_TRANSITION_MAX_MS = 1400;
const HIDDEN_RECONCILE_MS = 900;
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
        this._pressure = new PressureBarrier(
            host.getConfig, host.getMonitor, host.getGeom,
            () => this._vis.hidden,
            () => !this._pointerButtonDown(),
            () => this._reveal());

        this._hideId = 0;
        this._revealId = 0;
        this._debounceId = 0;
        this._idleId = 0;
        this._fullscreenClearId = 0;
        this._fullscreenSignalCheckId = 0;
        this._dodgeRevealId = 0;
        this._hiddenReconcileId = 0;
        this._fullscreenBlocked = false;
        this._lastRawFullscreen = false;
        this._lastFocusMonitor = -1;
        this._windowTransitions = new Map();
        this._transitionTimeouts = new Map();
        this._transitionReleaseId = 0;
        this._enabled = false;
    }

    get hidden() { return this._vis.hidden; }

    // ── Lifecycle ───────────────────────────────────────────────────────────
    enable() {
        if (this._enabled) return;
        this._enabled = true;
        this._lastFocusMonitor = this._focusedMonitor();
        this._lastRawFullscreen = this._rawFullscreenBlocksDock();
        this._connect();
        this.queueIntellihide();
    }

    disable() {
        this._enabled = false;
        this._cancelHide();
        this._cancelReveal();
        this._cancelDebounce();
        this._cancelFullscreenClear();
        this._cancelDodgeReveal();
        this._cancelHiddenReconcile();
        this._clearWindowTransitions();
        this._overlap.clear();
        this._timers.removeAll();
        this._hideId = 0;
        this._revealId = 0;
        this._debounceId = 0;
        this._idleId = 0;
        this._fullscreenClearId = 0;
        this._fullscreenSignalCheckId = 0;
        this._dodgeRevealId = 0;
        this._hiddenReconcileId = 0;
        this._transitionReleaseId = 0;
        this._fullscreenBlocked = false;
        this._lastRawFullscreen = false;
        this._lastFocusMonitor = -1;
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
    onRelayout(reevaluateVisibility = true) {
        const geom = this._host.getGeom();
        if (!geom) return;
        const cfg = this._host.getConfig();
        // Dodge mode is the only policy that needs live window move/resize
        // subscriptions. Release them immediately when another policy becomes
        // active instead of retaining callbacks until the windows disappear.
        if (cfg.autoHideMode !== 'dodge') this._overlap.clear();
        this._host.chrome.applyStrip(geom.strip);
        this._host.chrome.applyAutohideHandle(geom.autohideHandle);
        this._host.chrome.setAutohideHandleVisible(
            this._vis.hidden && cfg.showAutohideHandle, false);
        if (this._vis.hidden) this._host.chrome.hideEdgeZone();
        else this._host.chrome.applyEdgeZone(geom.edgeZone);

        // App/model reconciliation can change dock width without changing the
        // visibility policy on this monitor. Preserve the current hidden/shown
        // state in that case; local WM/focus/overlap signals own visibility.
        if (reevaluateVisibility) this.queueIntellihide();
    }

    settleMotion() {
        const geom = this._host.getGeom();
        if (!geom) return;
        this._vis.settle(geom);
        const cfg = this._host.getConfig();
        this._host.chrome.setAutohideHandleVisible(
            this._vis.hidden && cfg.showAutohideHandle, false);
    }

    // ── Pointer hooks called by the controller ───────────────────────────────
    onDockActivity() {
        this._cancelHide();
        if (this._transitionBlocksReveal()) return;
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

        // Display focus/restack signals are global. In multi-monitor mode they
        // must not make every dock re-run its visibility policy when a window
        // opens/closes on one display. Route them only to the monitor whose
        // focus actually changed (or whose focused stack is being restacked).
        s.connect(d, 'restacked', () => {
            if (this._focusedStackTouchesThisMonitor())
                this.queueIntellihide();
        });
        s.connect(d, 'notify::focus-window', () => this._onFocusWindowChanged());
        s.connect(d, 'grab-op-end', (...args) => {
            const window = this._windowFromSignalArgs(args);
            if (window ? this._windowOnThisMonitor(window)
                : this._focusedStackTouchesThisMonitor())
                this.queueIntellihide();
        });

        // Fullscreen notifications are also process-global. Compare the raw
        // fullscreen state for this dock's monitor and only reevaluate when that
        // local state actually changed.
        s.connect(d, 'in-fullscreen-changed', () => this._onFullscreenSignal());

        const wm = global.window_manager;
        // Window lifecycle is owned here, in one place, and routed by monitor.
        // The controller handles only app-model refreshes so the same event
        // cannot drive two visibility evaluations at different times.
        const onWindowLeaving = actor => {
            const window = actor?.meta_window ?? null;
            const monitor = this._monitorIndex();
            if (!windowLifecycleMayAffectMonitor(window, monitor)) return;

            // Only a definitely local actor owns the compositor-transition
            // guard/fullscreen hand-off. Unknown ownership still reconciles all
            // docks, but never claims a specific monitor.
            if (this._windowOnThisMonitor(window)) {
                this._beginWindowTransition(actor);
                this._onCoveringWindowLeaving(window);
            }
            this.queueIntellihide();
        };
        const onWindowArriving = actor => {
            const window = actor?.meta_window ?? null;
            if (!windowLifecycleMayAffectMonitor(window, this._monitorIndex())) return;
            this.queueIntellihide();
        };
        s.connect(wm, 'destroy', (_wm, actor) => onWindowLeaving(actor));
        s.connect(wm, 'minimize', (_wm, actor) => onWindowLeaving(actor));
        s.connect(wm, 'map', (_wm, actor) => onWindowArriving(actor));
        s.connect(wm, 'unminimize', (_wm, actor) => onWindowArriving(actor));
        s.connect(wm, 'size-change', (...args) => {
            const window = this._windowFromSignalArgs(args);
            if (window ? this._windowOnThisMonitor(window)
                : this._focusedStackTouchesThisMonitor())
                this.queueIntellihide();
        });

        s.connect(global.workspace_manager, 'active-workspace-changed', () => this.queueIntellihide());
        s.connect(Main.overview, 'showing', () => { this._cancelHide(); this._setHidden(false, true); });
        s.connect(Main.overview, 'hidden', () => this.queueIntellihide());
    }

    _focusedMonitor() {
        try { return global.display?.focus_window?.get_monitor?.() ?? -1; }
        catch { return -1; }
    }

    _monitorIndex() {
        return this._host.getMonitorIndex?.() ?? -1;
    }

    _windowOnThisMonitor(window) {
        const monitor = this._monitorIndex();
        return monitor >= 0 && windowMonitorIndex(window) === monitor;
    }

    _windowFromSignalArgs(args) {
        for (const value of args ?? []) {
            const window = value?.meta_window ?? value;
            if (typeof window?.get_monitor === 'function' &&
                (typeof window?.get_frame_rect === 'function' ||
                 typeof window?.located_on_workspace === 'function'))
                return window;
        }
        return null;
    }

    _focusedStackTouchesThisMonitor() {
        const monitor = this._monitorIndex();
        const current = this._focusedMonitor();
        if (current === monitor) return true;
        // During close/open transitions Mutter can publish a momentary null
        // focus. Attribute that transient state only to the previous monitor.
        return current < 0 && this._lastFocusMonitor === monitor;
    }

    _onFocusWindowChanged() {
        const monitor = this._monitorIndex();
        const previous = this._lastFocusMonitor;
        const current = this._focusedMonitor();
        this._lastFocusMonitor = current;
        if (monitorTransitionTouchesIndex(previous, current, monitor))
            this.updateIntellihide();
    }

    _onFullscreenSignal() {
        const sample = () => {
            const raw = this._rawFullscreenBlocksDock();
            if (raw === this._lastRawFullscreen) return;
            this._lastRawFullscreen = raw;
            this.updateIntellihide();
        };

        sample();
        // One idle recheck covers Shell versions where the signal is emitted
        // just before the monitor fullscreen flag/window inventory settles.
        if (this._fullscreenSignalCheckId) return;
        this._fullscreenSignalCheckId = this._timers.addIdle(() => {
            this._fullscreenSignalCheckId = 0;
            sample();
            return false;
        });
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

        // A hidden dock must not be revealed from an intermediate WM snapshot.
        // Wait for every concurrent destroy/minimize effect on this monitor to
        // finish, then re-evaluate once on the next idle turn.
        if (this._transitionBlocksReveal()) {
            this._cancelHide();
            this._cancelReveal();
            return;
        }

        const fullscreen = this._fullscreenBlocksDock();

        if (mode !== 'dodge') this._cancelDodgeReveal();

        // Fullscreen temporarily behaves like forced autohide on this monitor,
        // but it must remain revealable. Once the pointer reaches the dock/edge
        // zone (or an interaction is active), keep it open above the fullscreen
        // window. Otherwise use the normal hide delay instead of vanishing on
        // the same frame as the fullscreen transition.
        if (fullscreen) {
            if (this._host.isInteractionActive?.() || this._pointerReallyInside()) {
                this._cancelHide();
                this._setHidden(false, true);
                return;
            }
            if (this._vis.hidden) {
                this._cancelHide();
                return;
            }
            this._scheduleHide(null, true);
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
        // A middle icon can keep several neighbours magnified. Delay hiding
        // only while the dock is already shown. The animation engine also runs
        // briefly after model/layout changes (for example when an app opens or
        // closes); treating that generic engine activity as "dock interaction"
        // used to reveal an already-hidden dock and then hide it again.
        if (shouldHoldShownForMagnification(
            this._vis.hidden, Boolean(this._host.isMagnifying?.()))) {
            this._cancelHide();
            this._scheduleHide();
            return;
        }
        if (mode === 'always') { this._scheduleHide(); return; }
        if (mode === 'dodge') {
            if (this._overlap.isOverlapped()) {
                this._cancelDodgeReveal();
                this._scheduleHide();
            } else {
                this._cancelHide();
                if (this._vis.hidden) this._scheduleDodgeReveal();
                else this._cancelDodgeReveal();
            }
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
    _scheduleHide(delayMs = null, force = false) {
        const cfg = this._host.getConfig();
        if (this._hideId || (!force && cfg.autoHideMode === 'never')) return;
        const delay = delayMs ?? cfg.hideDelay;
        this._hideId = this._timers.addOnce(delay, () => {
            this._hideId = 0;
            if (this._pointerReallyInside() || this._host.isInteractionActive?.()) return;
            // The configured hide delay is paid once. If magnification is still
            // contracting afterwards, poll only that visual dependency at a
            // short bounded cadence instead of repeatedly charging hideDelay.
            if (this._host.isMagnifying?.()) {
                this._scheduleHide(MAGNIFICATION_RECHECK_MS, force);
                return;
            }
            const live = this._host.getConfig();
            if (force) {
                // Fullscreen may have ended during the timer. Re-run the normal
                // policy rather than hiding a dock that should now stay visible.
                if (!this._fullscreenBlocksDock()) {
                    this.updateIntellihide();
                    return;
                }
            } else if (live.autoHideMode === 'dodge' && !this._overlap.isOverlapped()) {
                return;
            }
            this._setHidden(true, true);
        });
    }

    _cancelHide() {
        if (this._hideId) { this._timers.remove(this._hideId); this._hideId = 0; }
    }

    _scheduleDodgeReveal() {
        if (this._dodgeRevealId || !this._enabled || !this._vis.hidden) return;

        // Confirm one stable no-overlap sample after the WM transition settles.
        // Do not restart this timer for every local restack/focus notification:
        // on multi-monitor setups those signals can arrive continuously and
        // starve the reveal forever, leaving an otherwise valid dock hidden.
        this._dodgeRevealId = this._timers.addOnce(DODGE_REVEAL_CONFIRM_MS, () => {
            this._dodgeRevealId = 0;
            if (!this._enabled || !this._vis.hidden) return;

            const cfg = this._host.getConfig();
            if (cfg.autoHideMode !== 'dodge' || Main.overview.visible ||
                this._transitionBlocksReveal())
                return;

            // Require a fresh final overlap sample. Lifecycle routing is already
            // monitor-local, so a second local window check is sufficient without
            // an indefinitely resettable quiet-period debounce.
            if (this._overlap.isOverlapped()) return;
            this._setHidden(false, true);
        });
    }

    _cancelDodgeReveal() {
        if (!this._dodgeRevealId) return;
        this._timers.remove(this._dodgeRevealId);
        this._dodgeRevealId = 0;
    }

    _beginReveal() {
        this._cancelReveal();
        if (this._pointerButtonDown()) return;
        const cfg = this._host.getConfig();
        const sharedEdge = this._host.getGeom?.()?.sharedEdge === true;

        // Pressure sensing only makes sense at a physical screen edge where the
        // pointer is stopped by the compositor. At an internal monitor seam the
        // pointer can cross immediately, so pressure polling may never reach its
        // threshold and the dock can look permanently gone. Use the local seam
        // strip and dwell timer there instead.
        if (cfg.pressureSense && !sharedEdge) {
            this._pressure.begin();
            return;
        }

        const delay = cfg.revealPressure > 0
            ? cfg.revealPressure
            : (sharedEdge ? SHARED_EDGE_REVEAL_MS : 0);
        if (delay <= 0) { this._setHidden(false, true, true); return; }
        this._revealId = this._timers.addOnce(delay, () => {
            this._revealId = 0;
            if (!this._pointerButtonDown()) this._setHidden(false, true, true);
        });
    }

    _cancelReveal() {
        if (this._revealId) { this._timers.remove(this._revealId); this._revealId = 0; }
        this._pressure.cancel();
    }

    _reveal() {
        if (this._pointerButtonDown()) return;
        this._cancelHide();
        this._cancelDodgeReveal();
        this._setHidden(false, true, true);
    }

    // ── Slide + side effects ──────────────────────────────────────────────────
    _setHidden(hidden, animate, userReveal = false) {
        const cfg = this._host.getConfig();
        if (hidden) this._cancelDodgeReveal();
        const fullscreen = this._fullscreenBlocksDock();
        if (!hidden && !userReveal && this._transitionBlocksReveal()) hidden = true;
        else if (!fullscreen && cfg.autoHideMode === 'never' && hidden) hidden = false;
        const geom = this._host.getGeom();
        if (!geom) return;

        // The hidden rim remains visible in fullscreen and acts as a subtle
        // affordance that the dock can still be revealed on that monitor.
        this._host.chrome.setAutohideHandleVisible(
            hidden && cfg.showAutohideHandle, animate);

        // A hidden side dock can be geometrically parked beyond an internal
        // monitor seam. Remove the real dock container from Shell's interactive
        // chrome while hidden so its offscreen allocation can never steal input
        // from the neighbouring display. The dedicated edge strip owns reveal.
        this._host.chrome.setContainerReactive?.(!hidden);

        const changed = this._vis.setHidden(hidden, geom, animate, () => this._host.kickEngine());
        if (hidden) this._scheduleHiddenReconcile();
        else this._cancelHiddenReconcile();
        if (!changed) return;

        if (hidden) {
            this._host.chrome.hideEdgeZone();
            this._host.clearHover?.();
        } else {
            this._host.chrome.applyEdgeZone(geom.edgeZone);
        }
    }

    // A hidden dock is safety-checked periodically while hidden. This is not the
    // normal visibility driver; it is a low-frequency recovery path for Mutter
    // lifecycle/focus signals that can be lost during multi-monitor animation,
    // hotplug, or actor destruction. It prevents a valid dock from remaining
    // offscreen forever.
    _scheduleHiddenReconcile() {
        if (this._hiddenReconcileId || !this._enabled || !this._vis.hidden) return;
        this._hiddenReconcileId = this._timers.addOnce(HIDDEN_RECONCILE_MS, () => {
            this._hiddenReconcileId = 0;
            if (!this._enabled || !this._vis.hidden) return;
            this.updateIntellihide();
            if (this._enabled && this._vis.hidden)
                this._scheduleHiddenReconcile();
        });
    }

    _cancelHiddenReconcile() {
        if (!this._hiddenReconcileId) return;
        this._timers.remove(this._hiddenReconcileId);
        this._hiddenReconcileId = 0;
    }

    // ── Window-transition guard ───────────────────────────────────────────────
    _beginWindowTransition(actor) {
        if (!this._enabled || Main.overview.visible || !actor ||
            this._windowTransitions.has(actor)) return;

        const window = actor.meta_window;
        const monitor = this._host.getMonitorIndex?.() ?? -1;
        if (!window || monitor < 0) return;
        try {
            if (window.get_monitor?.() !== monitor) return;
        } catch {
            return;
        }

        if (this._transitionReleaseId) {
            this._timers.remove(this._transitionReleaseId);
            this._transitionReleaseId = 0;
        }

        const ids = [];
        const finish = () => this._finishWindowTransition(actor);
        try {
            const id = actor.connect('effects-completed', finish);
            if (id) ids.push(id);
        } catch { }
        try {
            const id = actor.connect('hide', finish);
            if (id) ids.push(id);
        } catch { }
        try {
            const id = actor.connect('destroy', finish);
            if (id) ids.push(id);
        } catch { }
        if (!ids.length) return;

        this._windowTransitions.set(actor, ids);

        // Never allow a missed effects-completed/hide/destroy signal to become a
        // permanent reveal lock. The guard is only for short compositor effects.
        const timeoutId = this._timers.addOnce(WINDOW_TRANSITION_MAX_MS, () => {
            this._transitionTimeouts.delete(actor);
            this._finishWindowTransition(actor);
        });
        this._transitionTimeouts.set(actor, timeoutId);

        if (this._vis.hidden) this._cancelReveal();
    }

    _finishWindowTransition(actor) {
        const ids = this._windowTransitions.get(actor);
        if (!ids) return;
        this._windowTransitions.delete(actor);

        const timeoutId = this._transitionTimeouts.get(actor);
        if (timeoutId) {
            this._timers.remove(timeoutId);
            this._transitionTimeouts.delete(actor);
        }

        for (const id of ids) {
            try { actor.disconnect(id); } catch { }
        }

        if (!this._windowTransitions.size && this._enabled && !this._transitionReleaseId) {
            // Effects are complete, but focus/restack/input-region notifications
            // from the same compositor turn may still be queued. One idle turn
            // gives those notifications a consistent final window snapshot.
            this._transitionReleaseId = this._timers.addIdle(() => {
                this._transitionReleaseId = 0;
                this.updateIntellihide();
                return false;
            });
        }
    }

    _clearWindowTransitions() {
        if (this._transitionReleaseId) {
            this._timers.remove(this._transitionReleaseId);
            this._transitionReleaseId = 0;
        }
        for (const [actor, ids] of this._windowTransitions) {
            for (const id of ids) {
                try { actor.disconnect(id); } catch { }
            }
        }
        this._windowTransitions.clear();
        for (const timeoutId of this._transitionTimeouts.values())
            this._timers.remove(timeoutId);
        this._transitionTimeouts.clear();
    }

    _transitionBlocksReveal() {
        return this._enabled && !Main.overview.visible && this._vis.hidden &&
            (this._windowTransitions.size > 0 || this._transitionReleaseId !== 0);
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

        const rawFullscreen = this._rawFullscreenBlocksDock();
        this._lastRawFullscreen = rawFullscreen;
        if (rawFullscreen) {
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
        if (this._fullscreenClearId) {
            this._timers.remove(this._fullscreenClearId);
            this._fullscreenClearId = 0;
        }
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
