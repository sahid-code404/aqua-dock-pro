// AquaDockPro — autohide / intellihide orchestration.
//
// Purpose:   Decide WHEN the dock hides and reveals. Wires the reveal strip and
//            edge zone, listens to the WM/focus/overview signals that change
//            overlap, and runs the intellihide state machine (never / always /
//            dodge). Delegates HOW-to-slide to VisibilityController, overlap to
//            OverlapDetector, and the dwell gesture to PressureBarrier — so this
//            file is pure policy + timer/ signal ownership.
// Ownership: OWNS a SignalGroup (strip/edge/WM signals), a TimeoutGroup (hide/
//            reveal/debounce/idle), and the three helper objects. disable()/
//            destroy() release every one and leave the dock shown.
// Cost:      All work is event-driven and coalesced (idle-queued intellihide,
//            debounced hide checks). No per-frame cost.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SignalGroup, TimeoutGroup } from '../core/utils.js';
import { VisibilityController } from './visibilityController.js';
import { OverlapDetector } from './overlapDetector.js';
import { PressureBarrier } from './pressureBarrier.js';

const DEBOUNCE_HIDE_MS = 200;

export class AutohideManager {
    // host: { chrome, getGeom, getConfig, kickEngine, clearHover, isDragActive }
    constructor(host) {
        this._host = host;
        this._signals = new SignalGroup();
        this._timers = new TimeoutGroup();

        this._vis = new VisibilityController(host.chrome.container);
        this._overlap = new OverlapDetector(host.getGeom, host.getConfig,
            () => this._debounceCheckHide());
        this._pressure = new PressureBarrier(host.getConfig,
            () => this._vis.hidden, () => this._reveal());

        this._hideId = 0;
        this._revealId = 0;
        this._debounceId = 0;
        this._idleId = 0;
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
        this._timers.removeAll();
        this._signals.disconnectAll();
        this._setHidden(false, false);   // show before tearing down
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
        if (this._vis.hidden) this._host.chrome.hideEdgeZone();
        else this._host.chrome.applyEdgeZone(geom.edgeZone);
        this.queueIntellihide();
    }

    // ── Pointer hooks called by the controller ───────────────────────────────
    onDockActivity() {
        this._cancelHide();
        if (this._vis.hidden) this._setHidden(false, true);
    }

    onDockLeft() {
        this._debounceCheckHide();
    }

    // ── Signal wiring ─────────────────────────────────────────────────────────
    _connect() {
        const s = this._signals;
        const strip = this._host.chrome.strip;
        const edge = this._host.chrome.edgeZone;

        s.connect(strip, 'enter-event', () => { this._cancelHide(); this._beginReveal(); });
        // Keep a pending hide cancelled while the pointer rides the edge; the
        // PressureBarrier's own poll handles dwell accumulation.
        s.connect(strip, 'motion-event', () => this._cancelHide());
        // When the pointer leaves the strip (moved off-edge), queue a hide
        // check — if it didn't land on the dock/edge-zone, auto-hide fires.
        s.connect(strip, 'leave-event', () => { this._cancelReveal(); this._debounceCheckHide(); });

        s.connect(edge, 'enter-event', () => this.onDockActivity());
        s.connect(edge, 'motion-event', () => this.onDockActivity());
        s.connect(edge, 'leave-event', () => this.onDockLeft());

        const d = global.display;
        s.connect(d, 'restacked', () => this.queueIntellihide());
        s.connect(d, 'notify::focus-window', () => this.queueIntellihide());
        s.connect(d, 'grab-op-end', () => this.queueIntellihide());
        s.connect(d, 'in-fullscreen-changed', () => this.updateIntellihide());

        const wm = global.window_manager;
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

        if (mode === 'never' || Main.overview.visible || this._host.isDragActive?.()) {
            this._cancelHide();
            this._setHidden(false, true);
            return;
        }
        if (this._pointerReallyInside()) {
            this._cancelHide();
            this._setHidden(false, true);
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
            if (this._pointerReallyInside()) return;
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
        const cfg = this._host.getConfig();
        if (cfg.pressureSense) { this._pressure.begin(); return; }
        if (cfg.revealPressure <= 0) { this._setHidden(false, true); return; }
        this._revealId = this._timers.addOnce(cfg.revealPressure, () => {
            this._revealId = 0;
            this._setHidden(false, true);
        });
    }

    _cancelReveal() {
        if (this._revealId) { this._timers.remove(this._revealId); this._revealId = 0; }
        this._pressure.cancel();
    }

    _reveal() {
        this._cancelHide();
        this._setHidden(false, true);
    }

    // ── Slide + side effects ──────────────────────────────────────────────────
    _setHidden(hidden, animate) {
        const cfg = this._host.getConfig();
        if (cfg.autoHideMode === 'never' && hidden) hidden = false;
        const geom = this._host.getGeom();
        if (!geom) return;

        const changed = this._vis.setHidden(hidden, geom, animate, () => this._host.kickEngine());
        if (!changed) return;

        if (hidden) {
            this._host.chrome.hideEdgeZone();
            this._host.clearHover?.();
        } else {
            this._host.chrome.applyEdgeZone(geom.edgeZone);
        }
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
