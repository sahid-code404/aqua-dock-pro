// Main dock controller wiring layout, signals, input handling, and services.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SignalGroup, TimeoutGroup, appWindowsForConfig, logError, log } from '../core/utils.js';
import {
    currentNotificationMap,
    notificationSignalsReliable,
    subscribeNotificationChanges,
} from '../services/notificationService.js';
import { AppTracker } from '../services/appTracker.js';
import { MountedDevices } from '../services/mountedDevices.js';
import { AnimationEngine } from '../animation/animationEngine.js';
import { AutohideManager } from '../autohide/autohideManager.js';
import { TooltipManager } from '../interactions/tooltipManager.js';
import { MenuManager } from '../menus/menuManager.js';
import { PreviewManager } from '../ui/preview/previewManager.js';
import { AppActions } from '../interactions/appActions.js';
import { DragManager } from '../interactions/dragManager.js';
import { GenieController } from '../effects/genie/genieEffect.js';
import { DownloadManager } from '../downloads/downloadManager.js';
import { TrashWatcher } from '../services/trashWatcher.js';
import { DockChrome } from './dock.js';
import { DockFactory } from './dockFactory.js';
import { computeLayout, pillStyle } from './dockLayout.js';
import {
    monitorInFullscreen,
    setDropDelegate,
} from '../compat/shell.js';

const MOVE_THRESHOLD = 10;     // px of pointer travel that cancels a click

export class DockController {
    constructor(settings, {
        monitorIndex = Main.layoutManager.primaryIndex,
        manageDash = true,
    } = {}) {
        this._settings = settings;
        this._monitorIndex = monitorIndex;
        this._manageDash = manageDash;

        this._signals = new SignalGroup();
        this._timers = new TimeoutGroup();

        this._cfg = { ...settings.config, monitorIndex };
        this._geom = null;
        this._pointerInContainer = false;
        this._pointerInMag = false;
        this._pointerInEdge = false;
        this._press = null;
        this._hoverItem = null;
        this._focusItem = null;
        this._focusLeaveId = 0;
        this._stageCaptureId = 0;
        this._notificationMap = null;
        this._notificationUnsubscribe = null;
        this._refreshNotificationsPending = false;

        try { this._build(); }
        catch (e) {
            this.destroy();
            throw e;
        }
    }

    _build() {
        this._chrome = new DockChrome();
        this._factory = new DockFactory(this._chrome.container, item => this._wireItem(item));
        // VolumeMonitor can wake on several system signals. Avoid creating it
        // when the entire mounted-devices feature is disabled; this key is
        // structural, so enabling it later rebuilds the service cleanly.
        this._mountedDevices = this._cfg.showMountedDevices
            ? new MountedDevices(() => this._cfg)
            : null;
        this._tracker = new AppTracker(
            () => this._cfg,
            () => this._mountedDevices?.entries ?? [],
        );
        this._engine = new AnimationEngine();
        this._engine.attach(this._chrome.container);
        this._autohide = new AutohideManager({
            chrome: this._chrome,
            getGeom: () => this._geom,
            getConfig: () => this._cfg,
            getMonitor: () => this._getMonitor(),
            getMonitorIndex: () => this._monitorIndex,
            kickEngine: () => this._engine.kick(),
            isMagnifying: () => this._engine?.animating ?? false,
            clearHover: () => this._endHover(),
            isInteractionActive: () => this._isDockBusy(),
        });
        this._tooltip = new TooltipManager(
            () => this._cfg,
            () => this._hoverItem,
            () => this._getMonitor(),
        );
        this._tooltip.style();
        this._preview = new PreviewManager(
            () => this._cfg,
            () => this._geom,
            () => this._hoverItem,
            () => this._getMonitor(),
            () => {
                if (!this._pointerInContainer && !this._pointerInMag && !this._pointerInEdge)
                    this._autohide?.onDockLeft();
            },
        );
        this._menu = new MenuManager({
            container: this._chrome.container,
            getConfig: () => this._cfg,
            getGeom: () => this._geom,
            isLayoutLocked: () => this._settings.raw.get_boolean('lock-layout'),
            onOpen: () => { this._tooltip.hide(); this._preview.hide(true); this._hoverItem = null; },
            onClose: () => this._autohide?.onDockLeft(),
            holdItem: item => { this._engine.setHeldItem(item); this._engine.kick(); },
            releaseHold: () => { this._engine.setHeldItem(null); this._engine.kick(); },
            onTrashEmptied: () => this._refreshItems(false),
            onToggleLayoutLock: () => {
                const raw = this._settings.raw;
                raw.set_boolean('lock-layout', !raw.get_boolean('lock-layout'));
            },
        });
        this._downloads = new DownloadManager({
            getConfig: () => this._cfg,
            getMonitor: () => this._getMonitor(),
            getDownloadsItem: () => this._findItem('downloads'),
            isHidden: () => this._autohide?.hidden ?? false,
            kickEngine: () => this._engine.kick(),
            onStackClosed: () => this._autohide?.onDockLeft(),
        });
        this._trash = this._cfg.showTrash ? new TrashWatcher({
            getConfig: () => this._cfg,
            getTrashItem: () => this._findItem('trash'),
            getTrashGicon: full => this._tracker.trashGicon(full),
            kickEngine: () => this._engine.kick(),
            setTrashFull: full => this._tracker.setTrashFull(full),
        }) : null;
        this._genie = new GenieController({
            getConfig: () => this._cfg,
            getGeom: () => this._geom,
            getChips: () => this._factory.chips,
            getItems: () => this._factory.items,
            getMonitorIndex: () => this._monitorIndex,
        });
        this._appActions = new AppActions(() => this._cfg, this._genie);
        this._drag = new DragManager({
            getConfig: () => this._cfg,
            getGeom: () => this._geom,
            getChips: () => this._factory.chips,
            container: this._chrome.container,
            engine: this._engine,
            setAppsButtonPosition: position =>
                this._settings.raw.set_int('apps-button-position', position),
            onDragStart: () => { this._endHover(); this._autohide?.onDockActivity(); },
            onDragEnd: () => { this._press = null; this._autohide?.onDockLeft(); },
        });
        // GNOME's DnD calls handleDragOver/acceptDrop on the container's delegate.
        setDropDelegate(this._chrome.container, this._drag);
        // Track the tooltip to the hovered icon as it magnifies (runs only while
        // the frame loop is alive; free once the dock settles).
        this._engine.setFrameHook(() => {
            if (this._tooltip.shown && this._hoverItem) {
                // Only reposition when the icon's scale changed — avoids
                // expensive get_transformed_position/Size every frame.
                const sc = this._hoverItem.scaleCurrent;
                if (sc !== this._lastTooltipScale) {
                    this._lastTooltipScale = sc;
                    this._tooltip.position(this._hoverItem, this._geom);
                }
            }
        });

        this._connectSignals();
        this._syncNotificationSubscription();
        this._mountedDevices?.start(() => this._onEntriesChanged());
        this._tracker.start(() => this._onEntriesChanged());
        this._onEntriesChanged();    // initial sync + first layout
        this._refreshItems();        // seed badges before the first shell event
        this._autohide.enable();
        this._downloads.enable();
        this._trash?.enable();
        if (this._manageDash) this._chrome.hideDash(this._cfg);
        log(`dock built on monitor ${this._monitorIndex}`);
    }

    _getMonitor() {
        return Main.layoutManager.monitors?.[this._monitorIndex] ?? null;
    }

    _findItem(kind) {
        for (const chip of this._factory.chips)
            if (chip.item && chip.entry.kind === kind) return chip.item;
        return null;
    }

    get monitorIndex() { return this._monitorIndex; }
    get keyboardFocusActive() { return Boolean(this._focusItem); }

    _isDockBusy() {
        return Boolean(
            this._drag?.reordering ||
            this._drag?.externalDnD ||
            this._menu?.active ||
            this._downloads?.stackOpen ||
            this._preview?.active ||
            this._focusItem
        );
    }

    // ── Wiring ──────────────────────────────────────────────────────────────
    _wireItem(item) {
        // When a bounce settles, the engine's loop has idled; restart it so
        // hover magnification resumes immediately.
        item.onAnimationSettled = () => this._engine.kick();
        // Keep the tooltip glued to the icon while it bounces.
        item.onComposed = () => {
            if (this._tooltip.shown && this._hoverItem === item)
                this._tooltip.position(item, this._geom);
        };
        item.connect('key-focus-in', () => this._onItemFocus(item));
        item.connect('key-focus-out', () => this._scheduleFocusLeave());
        item.connect('key-press-event', (_actor, event) => this._onItemKey(item, event));
    }

    focusFirst() {
        const item = this._factory?.items?.[0];
        if (!item || !this._geom) return false;
        try {
            if (monitorInFullscreen(this._monitorIndex) && !Main.overview.visible)
                return false;
            this._autohide?.onDockActivity();
            item.grab_key_focus();
            return true;
        } catch (e) {
            logError(e, 'focus dock');
            return false;
        }
    }

    exitKeyboardFocus() {
        if (!this._focusItem) {
            this._disableFocusPointerExit();
            return false;
        }

        if (this._focusLeaveId) {
            this._timers.remove(this._focusLeaveId);
            this._focusLeaveId = 0;
        }

        // Clear our state before moving key focus. The resulting focus-out
        // signal then sees that cleanup is already complete and stays idle.
        const focusItem = this._focusItem;
        this._focusItem = null;
        this._disableFocusPointerExit();
        try {
            const focused = global.stage.get_key_focus?.();
            if (focused === focusItem ||
                (focused && this._factory?.items.includes(focused)))
                global.stage.set_key_focus(null);
        } catch { }

        if (!this._menu?.active) this._engine?.setHeldItem(null);
        if (!this._pointerInContainer && !this._pointerInMag && !this._pointerInEdge) {
            this._endHover();
            this._autohide?.onDockLeft();
        }
        this._engine?.kick();
        return true;
    }

    _onItemFocus(item) {
        if (this._focusLeaveId) {
            this._timers.remove(this._focusLeaveId);
            this._focusLeaveId = 0;
        }
        this._focusItem = item;
        this._enableFocusPointerExit();
        this._autohide?.onDockActivity();
        this._engine.setHeldItem(item);
        this._engine.kick();
        this._setHover(item);
    }

    _scheduleFocusLeave() {
        if (!this._focusItem || this._focusLeaveId) return;
        this._focusLeaveId = this._timers.addIdle(() => {
            this._focusLeaveId = 0;
            const focused = global.stage.get_key_focus?.();
            if (focused && this._factory?.items.includes(focused)) return false;
            this._focusItem = null;
            this._disableFocusPointerExit();
            if (!this._menu?.active) this._engine?.setHeldItem(null);
            this._endHover();
            this._autohide?.onDockLeft();
            return false;
        });
    }

    _onItemKey(item, event) {
        const items = this._factory.items;
        const index = items.indexOf(item);
        if (index < 0) return Clutter.EVENT_PROPAGATE;

        const symbol = event.get_key_symbol();
        const state = event.get_state?.() ?? 0;
        const menuKey = symbol === Clutter.KEY_Menu ||
            (symbol === Clutter.KEY_F10 && (state & Clutter.ModifierType.SHIFT_MASK));
        if (menuKey) {
            this._menu.openFor(item);
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter ||
            symbol === Clutter.KEY_space) {
            // Hand focus back before activation. Dispatch comes second so a
            // configured preview or Downloads stack remains open afterwards.
            this.exitKeyboardFocus();
            this._dispatch(item, 1);
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Escape) {
            this.exitKeyboardFocus();
            return Clutter.EVENT_STOP;
        }

        let next = index;
        if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Up ||
            symbol === Clutter.KEY_ISO_Left_Tab ||
            (symbol === Clutter.KEY_Tab && (state & Clutter.ModifierType.SHIFT_MASK)))
            next = Math.max(0, index - 1);
        else if (symbol === Clutter.KEY_Right || symbol === Clutter.KEY_Down ||
            symbol === Clutter.KEY_Tab)
            next = Math.min(items.length - 1, index + 1);
        else if (symbol === Clutter.KEY_Home)
            next = 0;
        else if (symbol === Clutter.KEY_End)
            next = items.length - 1;
        else
            return Clutter.EVENT_PROPAGATE;

        items[next]?.grab_key_focus();
        return Clutter.EVENT_STOP;
    }

    _connectSignals() {
        const s = this._signals;
        const c = this._chrome.container;
        const mz = this._chrome.magZone;
        const ez = this._chrome.edgeZone;

        s.connect(c, 'motion-event', (_a, ev) => this._onMotion(ev));
        s.connect(c, 'enter-event', (_a, ev) => this._onMotion(ev));
        s.connect(c, 'leave-event', () => this._onContainerLeave());
        s.connect(c, 'captured-event', (_a, ev) => this._onCaptured(ev));
        s.connect(c, 'scroll-event', (_a, ev) => this._onScroll(ev));

        s.connect(mz, 'enter-event', (_a, ev) => this._onMagMotion(ev));
        s.connect(mz, 'motion-event', (_a, ev) => this._onMagMotion(ev));
        s.connect(mz, 'leave-event', () => this._onMagLeave());
        s.connect(mz, 'button-press-event', (_a, ev) => this._onMagPress(ev));
        s.connect(mz, 'button-release-event', (_a, ev) => this._onMagRelease(ev));
        s.connect(mz, 'scroll-event', (_a, ev) => this._onScroll(ev));

        // Edge zone: the gap between the dock pill and the screen edge.
        // Forwards pointer tracking (for magnification), clicks (to activate
        // dock items underneath), and scroll — mirroring the original AquaDock
        // behaviour.
        s.connect(ez, 'enter-event', (_a, ev) => this._onEdgeMotion(ev));
        s.connect(ez, 'motion-event', (_a, ev) => this._onEdgeMotion(ev));
        s.connect(ez, 'leave-event', () => this._onEdgeLeave());
        s.connect(ez, 'button-press-event', (_a, ev) => this._onEdgePress(ev));
        s.connect(ez, 'button-release-event', (_a, ev) => this._onEdgeRelease(ev));
        s.connect(ez, 'scroll-event', (_a, ev) => this._onScroll(ev));

        const wm = global.window_manager;
        for (const sig of ['map', 'destroy', 'minimize', 'unminimize'])
            s.connect(wm, sig, () => {
                this._scheduleRefreshItems(false);
                this._autohide?.queueIntellihide();
            });
        s.connect(global.display, 'window-created', (_d, win) => this._genie.onWindowCreated(win));
        for (const sig of ['item-drag-end', 'item-drag-cancelled'])
            s.connect(Main.overview, sig, () => this._drag.clearDrop());
        s.connect(Main.overview, 'showing', () => {
            this._chrome.enforceDashGap(this._cfg);
            this._chrome.raiseAboveOverview();
        });
        // GNOME re-shows the dash when DnD starts in the overview; squash it.
        s.connect(Main.overview, 'item-drag-begin', () => {
            this._chrome.enforceDashGap(this._cfg);
        });
    }

    _syncNotificationSubscription() {
        if (this._cfg.showBadges) {
            if (!this._notificationUnsubscribe) {
                this._notificationUnsubscribe = subscribeNotificationChanges(
                    () => this._scheduleRefreshItems(true));
            }
            return;
        }

        if (this._notificationUnsubscribe) {
            this._notificationUnsubscribe();
            this._notificationUnsubscribe = null;
        }
        this._notificationMap = null;
    }

    // ── Entry / layout ────────────────────────────────────────────────────
    _onEntriesChanged() {
        const entries = this._tracker.getEntries();
        const heldItem = this._menu?.heldItem;
        if (heldItem && !entries.some(entry => entry.key === heldItem.entry?.key))
            this._menu.closeNow();
        const changed = this._factory.sync(entries, this._cfg);
        if (this._hoverItem && !this._factory.items.includes(this._hoverItem))
            this._endHover();
        if (this._focusItem && !this._factory.items.includes(this._focusItem))
            this.exitKeyboardFocus();
        if (changed) this.relayout();
        else this._engine.kick();
    }

    _refreshItems(refreshNotifications = true) {
        // Message-tray traversal is unnecessary when badges are disabled.
        // Passing null also tells DockItem to preserve its cached count until
        // the feature is enabled and the next snapshot is requested.
        let notifMap = null;
        if (this._cfg.showBadges) {
            const reliable = notificationSignalsReliable();
            if (refreshNotifications || !this._notificationMap || !reliable) {
                // Reliable tray signals refresh the shared snapshot before
                // subscribers run. Only probe Shell directly as a compatibility
                // fallback when those signals are incomplete.
                this._notificationMap = currentNotificationMap(
                    !reliable && !refreshNotifications);
            }
            notifMap = this._notificationMap;
        } else {
            this._notificationMap = null;
        }
        let activeWorkspace;
        if (this._cfg.isolateWS) {
            try { activeWorkspace = global.workspace_manager.get_active_workspace(); }
            catch { }
        }
        for (const item of this._factory.items) {
            if (item.entry.kind !== 'app') continue;
            try { item.refresh(notifMap, activeWorkspace); }
            catch (e) { logError(e, 'item.refresh'); }
        }
    }

    // Coalesced version: rapid-fire WM signals (map/destroy/minimize) produce
    // one refresh pass per 60ms window instead of one per signal.
    _scheduleRefreshItems(notificationsChanged = false) {
        if (notificationsChanged) this._refreshNotificationsPending = true;
        if (this._refreshId) return;
        this._refreshId = this._timers.addOnce(60, () => {
            this._refreshId = 0;
            const refreshNotifications = this._refreshNotificationsPending;
            this._refreshNotificationsPending = false;
            this._refreshItems(refreshNotifications);
        });
    }

    relayout() {
        const mon = this._getMonitor();
        if (!mon) return;
        const fs = monitorInFullscreen(this._monitorIndex);
        const base = { ...this._settings.config, monitorIndex: this._monitorIndex };
        const { cfg, geom } = computeLayout(base, this._factory.chips, mon, fs);
        this._cfg = cfg;
        this._geom = geom;

        this._chrome.applyContainer(geom, this._autohide?.hidden ?? false);
        this._chrome.applyPill(geom);
        this._chrome.applyPillStyle(pillStyle(cfg));
        this._chrome.applyAccessibility(cfg);
        this._chrome.applyStrut(geom.strut);
        this._chrome.applyMagZoneConst();

        for (const chip of this._factory.chips) {
            if (chip.item) {
                chip.actor.set_position(chip.itemPos.x, chip.itemPos.y);
                chip.item.relayout(cfg, 0);
            } else if (chip.box) {
                chip.actor.set_position(chip.box.x, chip.box.y);
                chip.actor.set_size(chip.box.w, chip.box.h);
            }
        }

        this._engine.setModel({
            chips: this._factory.chips,
            items: this._factory.items,
            cfg, geom,
            bg: this._chrome.bg,
            magZone: this._chrome.magZone,
        });
        this._engine.kick();
        this._tooltip?.invalidateMonitor();
        this._genie?.updateAllIconGeometry();
        this._autohide?.onRelayout();
    }

    // In-place refresh for non-structural settings changes.
    applySettings() {
        const next = this._settings.config;
        if (next.layoutLocked && !this._cfg.layoutLocked)
            this._drag?.cancelLayoutChanges();
        this.relayout();
        this._syncNotificationSubscription();
        this._refreshItems();
        this._tooltip?.style();
        if (this._manageDash) this._chrome.enforceDashGap(this._cfg);
    }

    // ── Pointer ─────────────────────────────────────────────────────────────
    _enableFocusPointerExit() {
        if (this._stageCaptureId) return;
        try {
            this._stageCaptureId = global.stage.connect(
                'captured-event', (_stage, ev) => this._onStageCaptured(ev));
        } catch { }
    }

    _disableFocusPointerExit() {
        if (!this._stageCaptureId) return;
        try { global.stage.disconnect(this._stageCaptureId); }
        catch { }
        this._stageCaptureId = 0;
    }

    _onStageCaptured(ev) {
        if (!this._focusItem) return Clutter.EVENT_PROPAGATE;

        let type;
        try { type = ev.type(); }
        catch { return Clutter.EVENT_PROPAGATE; }
        if (type === Clutter.EventType.BUTTON_PRESS ||
            type === Clutter.EventType.TOUCH_BEGIN)
            this.exitKeyboardFocus();
        return Clutter.EVENT_PROPAGATE;
    }

    _onMotion(ev) {
        const [x, y] = ev.get_coords();
        this._pointerInContainer = true;
        // A reorder drag takes over: it owns the chip translations and the flyer.
        if (this._drag.reordering) { this._drag.update(x, y); return Clutter.EVENT_STOP; }
        if (this._updatePressedDrag(x, y)) return Clutter.EVENT_STOP;
        this._autohide?.onDockActivity();
        this._cancelEndHover();
        this._engine.setPointer(x, y, true);
        this._engine.kick();
        this._setHover(this._pickItem(x, y));
        return Clutter.EVENT_PROPAGATE;
    }

    _onMagMotion(ev) {
        const [x, y] = ev.get_coords();
        this._pointerInMag = true;
        if (this._drag.reordering) { this._drag.update(x, y); return Clutter.EVENT_STOP; }
        if (this._updatePressedDrag(x, y)) return Clutter.EVENT_STOP;
        this._autohide?.onDockActivity();
        this._cancelEndHover();
        this._engine.setPointer(x, y, true);
        this._engine.kick();
        this._setHover(this._pickItemRedirected(x, y));
        return Clutter.EVENT_PROPAGATE;
    }

    _onContainerLeave() {
        this._pointerInContainer = false;
        if (!this._pointerInMag && !this._pointerInEdge) this._scheduleEndHover();
        return Clutter.EVENT_PROPAGATE;
    }

    _onMagLeave() {
        this._pointerInMag = false;
        if (!this._pointerInContainer && !this._pointerInEdge) this._scheduleEndHover();
        return Clutter.EVENT_PROPAGATE;
    }

    // ── Edge zone pointer forwarding ────────────────────────────────────────
    _onEdgeMotion(ev) {
        const [x, y] = ev.get_coords();
        this._pointerInEdge = true;
        if (this._drag.reordering) { this._drag.update(x, y); return Clutter.EVENT_STOP; }
        if (this._updatePressedDrag(x, y)) return Clutter.EVENT_STOP;
        this._autohide?.onDockActivity();
        this._cancelEndHover();
        this._engine.setPointer(x, y, true);
        this._engine.kick();
        this._setHover(this._pickItemRedirected(x, y));
        return Clutter.EVENT_PROPAGATE;
    }

    _onEdgeLeave() {
        this._pointerInEdge = false;
        if (!this._pointerInContainer && !this._pointerInMag) {
            this._scheduleEndHover();
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onEdgePress(ev) {
        let button, sx, sy;
        try { button = ev.get_button(); [sx, sy] = ev.get_coords(); }
        catch { return Clutter.EVENT_PROPAGATE; }
        if (button !== 1 && button !== 2 && button !== 3)
            return Clutter.EVENT_PROPAGATE;
        const item = this._pickItemRedirected(sx, sy);
        if (!item) return Clutter.EVENT_PROPAGATE;
        this._press = { item, sx, sy, button };
        return Clutter.EVENT_STOP;
    }

    _onEdgeRelease(ev) {
        let button, sx, sy;
        try { button = ev.get_button(); [sx, sy] = ev.get_coords(); }
        catch { return Clutter.EVENT_PROPAGATE; }
        if (this._drag.reordering) {
            this._press = null;
            this._drag.finish(sx, sy);
            return Clutter.EVENT_STOP;
        }
        const item = this._takePress(button, sx, sy);
        if (!item) return Clutter.EVENT_PROPAGATE;
        this._dispatch(item, button);
        return Clutter.EVENT_STOP;
    }

    // Update which icon is hovered and drive its tooltip. Suppressed while a
    // menu is open or the dock is hidden.
    _setHover(item) {
        if (this._menu.active || this._autohide?.hidden || this._downloads?.stackOpen) item = null;
        if (item === this._hoverItem) return;
        this._hoverItem = item;
        this._lastTooltipScale = -1; // force tooltip reposition on new hover
        if (!item) { this._tooltip.hide(); this._preview.hide(false); return; }
        if (this._cfg.showTooltip) this._tooltip.scheduleShow(item, this._geom);
        else this._tooltip.hide();
        this._preview.schedule(item);
    }

    _endHover() {
        this._cancelEndHover();
        this._hoverItem = null;
        this._tooltip.hide();
        this._preview.hide(false);
        this._engine.setPointer(0, 0, false);
        this._engine.kick();   // let icons spring back, then the loop self-stops
    }

    // Deferred endHover — gives the next zone's enter-event one frame (16 ms)
    // to fire and cancel, preventing tooltip flicker during zone transitions.
    _scheduleEndHover() {
        if (this._endHoverId) return;
        this._endHoverId = this._timers.addOnce(16, () => {
            this._endHoverId = 0;
            if (!this._engine) return;  // destroyed
            if (!this._drag?.reordering) this._press = null;
            this._endHover();
            this._autohide?.onDockLeft();
        });
    }

    _cancelEndHover() {
        if (this._endHoverId) { this._timers.remove(this._endHoverId); this._endHoverId = 0; }
    }

    // ── Picking ─────────────────────────────────────────────────────────────
    _pickItem(stageX, stageY) {
        const geom = this._geom;
        if (!geom) return null;
        let p;
        try { p = this._chrome.container.transform_stage_point(stageX, stageY); }
        catch { return null; }
        if (!p?.[0]) return null;
        const vert = geom.vert;
        const main = vert ? p[2] : p[1];
        const cross = vert ? p[1] : p[2];
        const pickLow = geom.pick.low, pickHigh = geom.pick.high;
        if (cross < pickLow || cross > pickHigh) return null;
        const chips = this._factory.chips;
        const transProp = vert ? 'translation_y' : 'translation_x';
        let best = null, bestDist = Infinity;
        for (const chip of chips) {
            if (!chip.item) continue;
            const tt = Number.isFinite(chip.spreadOffset)
                ? chip.spreadOffset
                : (chip.actor[transProp] ?? 0);
            const bx = chip.baseX + tt;
            if (bx - 12 > main) break;
            if (main > bx + chip.w + 12) continue;
            const dist = Math.abs(main - (chip.center + tt));
            if (dist < bestDist) { best = chip.item; bestDist = dist; }
        }
        return best;
    }

    // Redirect the cross-axis coordinate into the pill centre (for the mag zone,
    // which sits outside the pill band).
    _pickItemRedirected(stageX, stageY) {
        const geom = this._geom;
        if (!geom) return null;
        if (geom.vert) stageX = geom.x + geom.thick / 2;
        else stageY = geom.y + geom.thick / 2;
        return this._pickItem(stageX, stageY);
    }

    // ── Clicks ──────────────────────────────────────────────────────────────
    _onCaptured(ev) {
        let type;
        try { type = ev.type(); } catch { return Clutter.EVENT_PROPAGATE; }
        if (type !== Clutter.EventType.BUTTON_PRESS && type !== Clutter.EventType.BUTTON_RELEASE)
            return Clutter.EVENT_PROPAGATE;
        let button, sx, sy;
        try { button = ev.get_button(); [sx, sy] = ev.get_coords(); }
        catch { return Clutter.EVENT_PROPAGATE; }
        if (button !== 1 && button !== 2 && button !== 3) return Clutter.EVENT_PROPAGATE;
        const item = this._pickItem(sx, sy);
        return this._handleButton(type, button, sx, sy, item);
    }

    _onMagPress(ev) {
        let button, sx, sy;
        try { button = ev.get_button(); [sx, sy] = ev.get_coords(); }
        catch { return Clutter.EVENT_PROPAGATE; }
        if (button !== 1 && button !== 2 && button !== 3)
            return Clutter.EVENT_PROPAGATE;
        const item = this._pickItemRedirected(sx, sy);
        if (!item) return Clutter.EVENT_PROPAGATE;
        this._press = { item, sx, sy, button };
        return Clutter.EVENT_STOP;
    }

    _onMagRelease(ev) {
        let button, sx, sy;
        try { button = ev.get_button(); [sx, sy] = ev.get_coords(); }
        catch { return Clutter.EVENT_PROPAGATE; }
        if (this._drag.reordering) {
            this._press = null;
            this._drag.finish(sx, sy);
            return Clutter.EVENT_STOP;
        }
        const item = this._takePress(button, sx, sy);
        if (!item) return Clutter.EVENT_PROPAGATE;
        this._dispatch(item, button);
        return Clutter.EVENT_STOP;
    }

    _handleButton(type, button, sx, sy, item) {
        if (type === Clutter.EventType.BUTTON_PRESS) {
            this._press = item ? { item, sx, sy, button } : null;
            return item ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        }
        if (this._drag.reordering) {
            this._press = null;
            this._drag.finish(sx, sy);
            return Clutter.EVENT_STOP;
        }
        const target = this._takePress(button, sx, sy);
        if (!target) return Clutter.EVENT_PROPAGATE;
        this._dispatch(target, button);
        return Clutter.EVENT_STOP;
    }

    // A release is a dock click only when its matching press began on the dock.
    // One record is shared by all three hit zones because magnification can move
    // an icon from one zone to another between press and release.
    _takePress(button, sx, sy) {
        const press = this._press;
        this._press = null;
        if (!press || press.button !== button || !press.item) return null;
        if (Math.hypot(sx - press.sx, sy - press.sy) > MOVE_THRESHOLD) return null;
        return press.item;
    }

    _updatePressedDrag(x, y) {
        const press = this._press;
        if (!press) return false;
        const distance = Math.hypot(x - press.sx, y - press.sy);
        if (this._drag.maybeStart(press, x, y, distance)) return true;
        if (distance > MOVE_THRESHOLD)
            this._press = null;
        return false;
    }

    // Downloads opens its stack on any button; otherwise right-click opens the
    // context menu and left/middle activate.
    _dispatch(item, button) {
        if (item.entry.kind === 'downloads') {
            try { this._downloads.openStack(item); }
            catch (e) { logError(e, 'openStack'); }
            return;
        }
        if (item.entry.kind === 'folder') {
            try {
                const folder = Gio.File.new_for_uri(item.entry.uri);
                this._downloads.openFolderStack(item, folder, item.entry.name, item.entry.gicon);
            } catch (e) { logError(e, 'open folder stack'); }
            return;
        }
        if (button === 3) {
            try { this._menu.openFor(item); }
            catch (e) { logError(e, 'openMenu'); }
            return;
        }
        if (button === 1 && item.entry.kind === 'app' &&
            this._cfg.leftClickAction === 'preview') {
            this._preview.showNow(item);
            return;
        }
        try { this._appActions.activate(item, button); }
        catch (e) { logError(e, 'activate'); }
    }

    // ── Scroll to minimize / restore ─────────────────────────────────────────
    _onScroll(ev) {
        let sx, sy;
        try { [sx, sy] = ev.get_coords(); } catch { return Clutter.EVENT_PROPAGATE; }
        const item = this._pickItem(sx, sy) ?? this._pickItemRedirected(sx, sy);
        if (!item || item.entry.kind !== 'app') return Clutter.EVENT_PROPAGATE;
        if (this._cfg.scrollAction === 'nothing') return Clutter.EVENT_PROPAGATE;
        const wins = appWindowsForConfig(item.entry.app, this._cfg);
        if (!wins.length) return Clutter.EVENT_PROPAGATE;
        const dir = ev.get_scroll_direction();
        if (this._cfg.scrollAction === 'cycle') {
            if (dir !== Clutter.ScrollDirection.UP && dir !== Clutter.ScrollDirection.DOWN)
                return Clutter.EVENT_PROPAGATE;
            this._appActions.cycle(wins, dir === Clutter.ScrollDirection.UP);
            return Clutter.EVENT_STOP;
        }
        if (dir === Clutter.ScrollDirection.DOWN) {
            const t = global.get_current_time();
            for (const w of wins) { try { w.unminimize(); w.activate(t); } catch { } }
        } else if (dir === Clutter.ScrollDirection.UP) {
            for (const w of wins) { try { w.minimize(); } catch { } }
        } else {
            return Clutter.EVENT_PROPAGATE;
        }
        return Clutter.EVENT_STOP;
    }

    // ── Teardown ────────────────────────────────────────────────────────────
    destroy() {
        // Cancel coalesced timers.
        this._timers.removeAll();
        this._refreshId = 0;
        this._endHoverId = 0;
        this._focusLeaveId = 0;
        this._refreshNotificationsPending = false;
        this._notificationMap = null;
        if (this._notificationUnsubscribe) {
            this._notificationUnsubscribe();
            this._notificationUnsubscribe = null;
        }
        this._focusItem = null;
        this._disableFocusPointerExit();
        this._signals.disconnectAll();
        this._drag?.destroy(); this._drag = null;
        this._appActions?.destroy(); this._appActions = null;
        this._genie?.destroy(); this._genie = null;
        this._downloads?.destroy(); this._downloads = null;
        this._trash?.destroy(); this._trash = null;
        this._menu?.destroy(); this._menu = null;
        this._preview?.destroy(); this._preview = null;
        this._tooltip?.destroy(); this._tooltip = null;
        this._autohide?.destroy(); this._autohide = null;
        this._engine?.destroy(); this._engine = null;
        this._tracker?.destroy(); this._tracker = null;
        this._mountedDevices?.destroy(); this._mountedDevices = null;
        this._factory?.destroyAll(); this._factory = null;
        this._chrome?.destroy(); this._chrome = null;
        this._geom = null;
    }
}
