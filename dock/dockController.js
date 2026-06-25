// AquaDockPro — dock orchestration (the de-godded core).
//
// Purpose:   Compose the dock from its parts and own their interplay: build the
//            chrome, the chip factory, the app tracker and the animation engine;
//            relayout on monitor/settings/chip changes; route pointer motion to
//            the engine; and turn clicks/scrolls into launch/activate/minimize/
//            cycle actions. Each concern lives in its own module — this file only
//            connects them and holds the small amount of glue state.
// Ownership: OWNS chrome, factory, tracker, engine and the sub-managers
//            (autohide, tooltip, menu, preview, downloads, trash, app actions),
//            plus the SignalGroup of shell connections. destroy() releases every
//            one, in reverse order.
// Cleanup:   destroy() — safe after a partial build.
// Cost:      Pointer handlers do O(1) bookkeeping then kick the engine. Clicks
//            pick via one transform + O(chips) scan. No per-frame work here.

import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SignalGroup, TimeoutGroup, appWindows, logError, log } from '../core/utils.js';
import { buildNotificationMap } from '../services/notificationService.js';
import { AppTracker } from '../services/appTracker.js';
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

const MOVE_THRESHOLD = 10;     // px of pointer travel that cancels a click

export class DockController {
    constructor(settings, bus, state) {
        this._settings = settings;
        this._bus = bus;
        this._state = state;

        this._signals = new SignalGroup();
        this._timers = new TimeoutGroup();

        this._cfg = settings.config;
        this._geom = null;
        this._pointerInContainer = false;
        this._pointerInMag = false;
        this._pointerInEdge = false;
        this._press = null;
        this._edgePress = null;
        this._hoverItem = null;

        this._chrome = new DockChrome();
        this._factory = new DockFactory(this._chrome.container, item => this._wireItem(item));
        this._tracker = new AppTracker(() => this._settings.config);
        this._engine = new AnimationEngine();
        this._engine.attach(this._chrome.container);
        this._autohide = new AutohideManager({
            chrome: this._chrome,
            getGeom: () => this._geom,
            getConfig: () => this._cfg,
            kickEngine: () => this._engine.kick(),
            clearHover: () => this._endHover(),
            isDragActive: () => false,
        });
        this._tooltip = new TooltipManager(() => this._cfg);
        this._tooltip.style();
        this._preview = new PreviewManager(() => this._cfg, () => this._geom, () => this._hoverItem);
        this._menu = new MenuManager({
            container: this._chrome.container,
            getConfig: () => this._cfg,
            getGeom: () => this._geom,
            onOpen: () => { this._tooltip.hide(); this._preview.hide(true); this._hoverItem = null; },
            onClose: () => this._autohide?.onDockLeft(),
            holdItem: item => { this._engine.setHeldItem(item); this._engine.kick(); },
            releaseHold: () => { this._engine.setHeldItem(null); this._engine.kick(); },
            onTrashEmptied: () => this._refreshItems(),
        });
        this._downloads = new DownloadManager({
            getConfig: () => this._cfg,
            getDownloadsItem: () => this._findItem('downloads'),
            isHidden: () => this._autohide?.hidden ?? false,
            kickEngine: () => this._engine.kick(),
            onStackClosed: () => this._autohide?.onDockLeft(),
        });
        this._trash = new TrashWatcher({
            getConfig: () => this._cfg,
            getTrashItem: () => this._findItem('trash'),
            getTrashGicon: full => this._tracker.trashGicon(full),
            kickEngine: () => this._engine.kick(),
            setTrashFull: full => this._tracker.setTrashFull(full),
        });
        this._genie = new GenieController({
            getConfig: () => this._cfg,
            getGeom: () => this._geom,
            getChips: () => this._factory.chips,
            getItems: () => this._factory.items,
        });
        this._appActions = new AppActions(() => this._cfg, this._genie);
        this._drag = new DragManager({
            getConfig: () => this._cfg,
            getGeom: () => this._geom,
            getChips: () => this._factory.chips,
            getItems: () => this._factory.items,
            container: this._chrome.container,
            engine: this._engine,
            onDragStart: () => { this._endHover(); this._autohide?.onDockActivity(); },
            onDragEnd: () => { this._press = null; this._edgePress = null; this._autohide?.onDockLeft(); },
        });
        // GNOME's DnD calls handleDragOver/acceptDrop on the container's delegate.
        this._chrome.container._delegate = this._drag;
        // Track the tooltip to the hovered icon as it magnifies (runs only while
        // the frame loop is alive; free once the dock settles).
        this._engine.setFrameHook(() => {
            if (this._tooltip.shown && this._hoverItem)
                this._tooltip.position(this._hoverItem, this._geom);
        });

        this._connectSignals();
        this._tracker.start(() => this._onEntriesChanged());
        this._onEntriesChanged();    // initial sync + first layout
        this._autohide.enable();
        this._downloads.enable();
        this._trash.enable();
        this._chrome.hideDash(this._cfg);
        log('dock built');
    }

    _findItem(kind) {
        for (const chip of this._factory.chips)
            if (chip.item && chip.entry.kind === kind) return chip.item;
        return null;
    }

    // ── Wiring ──────────────────────────────────────────────────────────────
    _wireItem(item) {
        // When a bounce settles, the engine's loop has idled; restart it so
        // hover magnification resumes immediately.
        item.onBounceSettled = () => this._engine.kick();
        // Keep the tooltip glued to the icon while it bounces.
        item.onComposed = () => {
            if (this._tooltip.shown && this._hoverItem === item)
                this._tooltip.position(item, this._geom);
        };
    }

    _connectSignals() {
        const s = this._signals;
        const c = this._chrome.container;
        const mz = this._chrome.magZone;
        const ez = this._chrome.edgeZone;

        s.connect(c, 'motion-event', (_a, ev) => this._onMotion(ev, true));
        s.connect(c, 'enter-event', (_a, ev) => this._onMotion(ev, true));
        s.connect(c, 'leave-event', () => this._onContainerLeave());
        s.connect(c, 'captured-event', (_a, ev) => this._onCaptured(ev));
        s.connect(c, 'scroll-event', (_a, ev) => this._onScroll(ev));

        s.connect(mz, 'enter-event', (_a, ev) => this._onMagMotion(ev));
        s.connect(mz, 'motion-event', (_a, ev) => this._onMagMotion(ev));
        s.connect(mz, 'leave-event', () => this._onMagLeave());
        s.connect(mz, 'button-press-event', (_a, ev) => this._onMagPress(ev));
        s.connect(mz, 'button-release-event', (_a, ev) => this._onMagRelease(ev));

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

        s.connect(Main.layoutManager, 'monitors-changed', () => this.relayout());
        const wm = global.window_manager;
        for (const sig of ['map', 'destroy', 'minimize', 'unminimize'])
            s.connect(wm, sig, () => { this._scheduleRefreshItems(); this._autohide?.queueIntellihide(); });
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

        // ── Notification badge refresh ────────────────────────────────────
        // Subscribe to messageTray so badges update in real time when
        // notifications arrive or are dismissed. Each source's count
        // signal is tracked individually for clean disconnection.
        const tray = Main.messageTray;
        if (tray) {
            this._traySourceSignals = new Map();
            const onTray = () => this._scheduleRefreshItems();

            const watchSource = src => {
                if (!src || this._traySourceSignals.has(src)) return;
                const ids = [];
                // GNOME 50: Source emits notify::count when notifications
                // change, and notification-added/notification-removed for
                // individual events. Subscribe to all for maximum coverage.
                try { ids.push(src.connect('notify::count', onTray)); } catch { }
                try { ids.push(src.connect('notification-added', onTray)); } catch { }
                try { ids.push(src.connect('notification-removed', onTray)); } catch { }
                if (ids.length) this._traySourceSignals.set(src, ids);
            };
            const unwatchSource = src => {
                const ids = this._traySourceSignals?.get(src);
                if (!ids) return;
                for (const id of ids) { try { src.disconnect(id); } catch { } }
                this._traySourceSignals.delete(src);
            };
            s.connect(tray, 'source-added', (_t, src) => {
                watchSource(src);
                onTray();
            });
            s.connect(tray, 'source-removed', (_t, src) => {
                unwatchSource(src);
                onTray();
            });
            // Pick up any sources that already exist when the dock starts.
            try {
                for (const src of (tray.getSources?.() ?? [])) watchSource(src);
            } catch { }
        }
    }

    // ── Entry / layout ────────────────────────────────────────────────────
    _onEntriesChanged() {
        const changed = this._factory.sync(this._tracker.getEntries(), this._cfg);
        if (changed) this.relayout();
        else this._engine.kick();
    }

    _refreshItems() {
        const notifMap = buildNotificationMap();
        for (const item of this._factory.items) {
            try { item.refresh(notifMap); } catch (e) { logError(e, 'item.refresh'); }
        }
    }

    // Coalesced version: rapid-fire WM signals (map/destroy/minimize) produce
    // one refresh pass per 60ms window instead of one per signal.
    _scheduleRefreshItems() {
        if (this._refreshId) return;
        this._refreshId = this._timers.addOnce(60, () => {
            this._refreshId = 0;
            this._refreshItems();
        });
    }

    relayout() {
        const mon = Main.layoutManager.primaryMonitor;
        if (!mon) return;
        const fs = global.display.get_monitor_in_fullscreen(Main.layoutManager.primaryIndex);
        const { cfg, geom } = computeLayout(this._settings.config, this._factory.chips, mon, fs);
        this._cfg = cfg;
        this._geom = geom;

        this._chrome.applyContainer(geom, this._autohide?.hidden ?? false);
        this._chrome.applyPill(geom);
        this._chrome.applyPillStyle(pillStyle(cfg));
        this._chrome.applyStrut(geom.strut);
        this._chrome.applyStrip(geom.strip);
        this._chrome.applyMagZoneConst();
        if (this._autohide?.hidden) this._chrome.hideEdgeZone();
        else this._chrome.applyEdgeZone(geom.edgeZone);

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
        this.relayout();
        this._refreshItems();
        this._tooltip?.style();
        this._chrome.enforceDashGap(this._cfg);
    }

    // ── Pointer ─────────────────────────────────────────────────────────────
    _onMotion(ev, inContainer) {
        const [x, y] = ev.get_coords();
        if (inContainer) this._pointerInContainer = true;
        // A reorder drag takes over: it owns the chip translations and the flyer.
        if (this._drag.reordering) { this._drag.update(x, y); return Clutter.EVENT_STOP; }
        if (this._press && this._drag.maybeStart(this._press, x, y)) return Clutter.EVENT_STOP;
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
        if (this._press && this._drag.maybeStart(this._press, x, y)) return Clutter.EVENT_STOP;
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
        if (this._press && this._drag.maybeStart(this._press, x, y)) return Clutter.EVENT_STOP;
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
        const item = this._pickItemRedirected(sx, sy);
        if (!item) return Clutter.EVENT_PROPAGATE;
        this._edgePress = { item, sx, sy, button };
        return Clutter.EVENT_STOP;
    }

    _onEdgeRelease(ev) {
        let button, sx, sy;
        try { button = ev.get_button(); [sx, sy] = ev.get_coords(); }
        catch { return Clutter.EVENT_PROPAGATE; }
        const press = this._edgePress;
        this._edgePress = null;
        const item = press?.item ?? this._pickItemRedirected(sx, sy);
        if (!item) return Clutter.EVENT_PROPAGATE;
        if (press && Math.hypot(sx - press.sx, sy - press.sy) > MOVE_THRESHOLD)
            return Clutter.EVENT_PROPAGATE;
        this._dispatch(item, button);
        return Clutter.EVENT_STOP;
    }

    // Update which icon is hovered and drive its tooltip. Suppressed while a
    // menu is open or the dock is hidden.
    _setHover(item) {
        if (this._menu.active || this._autohide?.hidden || this._downloads?.stackOpen) item = null;
        if (item === this._hoverItem) return;
        this._hoverItem = item;
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
            const tt = chip.actor[transProp] ?? 0;
            const bx = chip.baseX + tt;
            if (bx - 12 > main) break;
            if (main > bx + chip.w + 12) continue;
            const dist = Math.abs(main - (bx + chip.w * 0.5));
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
        const item = this._pickItemRedirected(sx, sy);
        if (!item) return Clutter.EVENT_PROPAGATE;
        this._press = { item, sx, sy, button };
        return Clutter.EVENT_STOP;
    }

    _onMagRelease(ev) {
        let button, sx, sy;
        try { button = ev.get_button(); [sx, sy] = ev.get_coords(); }
        catch { return Clutter.EVENT_PROPAGATE; }
        const press = this._press;
        this._press = null;
        if (this._drag.reordering) { this._drag.finish(sx, sy); return Clutter.EVENT_STOP; }
        const item = press?.item ?? this._pickItemRedirected(sx, sy);
        if (!item) return Clutter.EVENT_PROPAGATE;
        if (press && Math.hypot(sx - press.sx, sy - press.sy) > MOVE_THRESHOLD)
            return Clutter.EVENT_PROPAGATE;
        this._dispatch(item, button);
        return Clutter.EVENT_STOP;
    }

    _handleButton(type, button, sx, sy, item) {
        if (type === Clutter.EventType.BUTTON_PRESS) {
            this._press = item ? { item, sx, sy, button } : null;
            return item ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        }
        const press = this._press;
        this._press = null;
        if (this._drag.reordering) { this._drag.finish(sx, sy); return Clutter.EVENT_STOP; }
        const target = press?.item ?? item;
        if (!target) return Clutter.EVENT_PROPAGATE;
        if (press && Math.hypot(sx - press.sx, sy - press.sy) > MOVE_THRESHOLD)
            return Clutter.EVENT_PROPAGATE;
        this._dispatch(target, button);
        return Clutter.EVENT_STOP;
    }

    // Downloads opens its stack on any button; otherwise right-click opens the
    // context menu and left/middle activate.
    _dispatch(item, button) {
        if (item.entry.kind === 'downloads') {
            try { this._downloads.openStack(item); }
            catch (e) { logError(e, 'openStack'); }
            return;
        }
        if (button === 3) {
            try { this._menu.openFor(item); }
            catch (e) { logError(e, 'openMenu'); }
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
        const wins = appWindows(item.entry.app);
        if (!wins.length) return Clutter.EVENT_PROPAGATE;
        const dir = ev.get_scroll_direction();
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
        // Disconnect per-source tray signals before the bulk disconnectAll().
        if (this._traySourceSignals) {
            for (const [src, ids] of this._traySourceSignals) {
                for (const id of ids) { try { src.disconnect(id); } catch { } }
            }
            this._traySourceSignals.clear();
            this._traySourceSignals = null;
        }
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
        this._factory?.destroyAll(); this._factory = null;
        this._chrome?.destroy(); this._chrome = null;
        this._geom = null;
    }
}
