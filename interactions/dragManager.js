// AquaDockPro — in-dock reorder and drop-to-pin.
//
// Purpose:   Two drag gestures: (1) press-and-drag a pinned icon to reorder the
//            favourites, and (2) drop an app from the overview grid onto the dock
//            to pin it at a slot. Both temporarily SUSPEND the animation engine
//            (so it stops writing chip translations) and drive the chip slides /
//            flyer themselves, then commit via AppFavorites and resume the engine.
// Ownership: OWNS the in-flight reorder state (incl. its flyer actor), the
//            external-DnD gap state, and the post-drop settle timer. destroy()
//            cancels any active drag and releases all of it.
// Cost:      Event-driven; no per-frame work (the engine is suspended during a
//            drag). Chip slides are short eases.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import { logError, appWindows, TimeoutGroup } from '../core/utils.js';

const START_THRESHOLD = 8;     // px before a press becomes a reorder drag

export class DragManager {
    // host: { getConfig, getGeom, getChips, getItems, container, engine,
    //         onDragStart, onDragEnd }
    constructor(host) {
        this._host = host;
        this._timers = new TimeoutGroup();
        this._reorder = null;
        this._externalDnD = false;
        this._dropGapPos = -1;
        this._dropTimer = 0;
    }

    get reordering() { return !!this._reorder; }
    get externalDnD() { return this._externalDnD; }

    // ── In-dock reorder ───────────────────────────────────────────────────────
    maybeStart(press, px, py) {
        if (!press || press.button !== 1) return false;
        if (Math.hypot(px - press.sx, py - press.sy) < START_THRESHOLD) return false;
        const item = press.item;
        const app = item?.entry?.app;
        const favs = AppFavorites.getAppFavorites();
        if (!app?.get_id || !favs.isFavorite(app.get_id())) return false;

        const favChips = this._host.getChips().filter(c =>
            c.item?.entry?.app?.get_id && favs.isFavorite(c.item.entry.app.get_id()));
        const fromIndex = favChips.findIndex(c => c.item === item);
        if (fromIndex < 0) return false;

        this._host.onDragStart?.();
        const cfg = this._host.getConfig();
        const liftScale = item.scaleCurrent;
        const [iconX, iconY] = item._icon.get_transformed_position();
        const size = cfg.iconSize;
        const visual = size * liftScale;

        item._icon.remove_all_transitions();
        item._icon.opacity = 0;
        item._dragging = true;

        const flyer = new St.Icon({ gicon: app.get_icon(), icon_size: size });
        flyer.set_pivot_point(0.5, 0.5);
        Main.uiGroup.add_child(flyer);
        try { Main.uiGroup.set_child_above_sibling(flyer, this._host.container); } catch { }
        flyer.set_position(Math.round(iconX + (visual - size) / 2), Math.round(iconY + (visual - size) / 2));
        flyer.set_scale(liftScale, liftScale);
        flyer.opacity = 255;
        flyer.ease({ opacity: 240, scale_x: 1.1, scale_y: 1.1, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_QUAD });

        // Floating context badge.
        const badge = new St.Label({ text: '↕  Move' });
        badge.set_style(
            'background: rgba(30,30,36,0.85); color: rgba(255,255,255,0.95); ' +
            'border-radius: 8px; padding: 4px 10px; font-size: 11px; font-weight: 600; ' +
            'border: 1px solid rgba(255,255,255,0.18);');
        badge.set_pivot_point(0.5, 0.5);
        badge.opacity = 0;
        Main.uiGroup.add_child(badge);
        try { Main.uiGroup.set_child_above_sibling(badge, flyer); } catch { }
        badge.ease({ opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD });

        this._host.engine.setSuspended(true);
        this._host.engine.demagnify(220);

        this._reorder = { item, app, favChips, fromIndex, toIndex: fromIndex, flyer, badge, size, mode: 'move' };
        this._connectGlobalCapture();
        this._positionFlyer(px, py);
        return true;
    }

    update(px, py) {
        const r = this._reorder;
        if (!r) return;
        this._positionFlyer(px, py);

        // When the flyer is outside the pill, clear the reorder preview.
        if (!this._isInsidePill(px, py)) {
            this._setBadgeMode(r, 'open');
            if (r.toIndex !== r.fromIndex) {
                r.toIndex = r.fromIndex;
                const prop = this._host.getConfig().vertical ? 'translation_y' : 'translation_x';
                r.favChips.forEach(c => {
                    if (c.item === r.item) return;
                    try { c.actor.remove_transition(prop); c.actor.ease({ [prop]: 0, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD }); } catch { }
                });
            }
            return;
        }

        this._setBadgeMode(r, 'move');

        let p;
        try { p = this._host.container.transform_stage_point(px, py); } catch { return; }
        if (!p?.[0]) return;
        const cfg = this._host.getConfig();
        const vert = cfg.vertical;
        const main = vert ? p[2] : p[1];

        let to = r.favChips.length - 1;
        for (let i = 0; i < r.favChips.length; i++) {
            if (main < r.favChips[i].baseX + r.favChips[i].w / 2) { to = i; break; }
        }
        if (to === r.toIndex) return;
        r.toIndex = to;

        const cell = cfg.cellW;
        const prop = vert ? 'translation_y' : 'translation_x';
        r.favChips.forEach((c, i) => {
            if (c.item === r.item) return;
            let shift = 0;
            if (r.fromIndex < to && i > r.fromIndex && i <= to) shift = -cell;
            else if (r.fromIndex > to && i >= to && i < r.fromIndex) shift = cell;
            try { c.actor.remove_transition(prop); c.actor.ease({ [prop]: shift, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD }); } catch { }
        });
    }

    finish(releaseX, releaseY) {
        const r = this._reorder;
        this._reorder = null;
        if (!r) return;

        this._destroyBadge(r);
        this._disconnectGlobalCapture();
        const insidePill = this._isInsidePill(releaseX, releaseY);

        // Released outside the pill → smart launch (if enabled), or cancel.
        const dragToOpen = this._host.getConfig().dragToOpen;
        if (!insidePill && !dragToOpen) {
            // Feature disabled — just cancel and snap back.
            try { r.flyer.destroy(); } catch { }
            this._restoreIcon(r.item, true);
            this._zeroTranslations();
            this._host.engine.setSuspended(false);
            this._host.engine.kick();
            this._host.onDragEnd?.();
            return;
        }
        if (!insidePill) {
            // Animate flyer fade-out instead of instant destroy.
            try {
                r.flyer.ease({
                    opacity: 0, scale_x: 0.5, scale_y: 0.5, duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => { try { r.flyer.destroy(); } catch { } },
                });
            } catch { try { r.flyer.destroy(); } catch { } }
            this._restoreIcon(r.item, true);
            this._zeroTranslations();
            this._host.engine.setSuspended(false);
            this._host.engine.kick();
            this._host.onDragEnd?.();
            // Smart launch: minimized → restore, visible → new window, not running → launch.
            try {
                const wins = appWindows(r.app);
                const t = global.get_current_time();
                if (wins.length === 0) {
                    // Not running — just launch.
                    r.app.open_new_window(-1);
                } else {
                    const allMinimized = wins.every(w => w.minimized);
                    if (allMinimized) {
                        // All minimized — restore them.
                        for (const w of wins) { w.unminimize(); w.activate(t); }
                    } else {
                        // Already visible — open a new window.
                        r.app.open_new_window(-1);
                    }
                }
            } catch (e) { logError(e, 'drag-launch'); }
            return;
        }

        // Released inside the pill → commit reorder if position changed.
        const targetChip = r.favChips[r.toIndex];
        if (targetChip && r.flyer) {
            const [tx, ty] = targetChip.actor.get_transformed_position();
            r.flyer.ease({
                x: Math.round(tx + (targetChip.w - r.size) / 2),
                y: Math.round(ty + (targetChip.actor.height - r.size) / 2),
                scale_x: 1, scale_y: 1, opacity: 0, duration: 220,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => { try { r.flyer.destroy(); } catch { } },
            });
        } else { try { r.flyer.destroy(); } catch { } }

        this._restoreIcon(r.item, true);
        this._zeroTranslations();

        if (r.toIndex !== r.fromIndex) {
            try { AppFavorites.getAppFavorites().moveFavoriteToPos(r.app.get_id(), r.toIndex); }
            catch (e) { logError(e, 'reorder commit'); }
        }
        this._host.engine.setSuspended(false);
        this._host.engine.kick();
        this._host.onDragEnd?.();
    }

    // Check if stage coordinates fall within the dock pill region.
    _isInsidePill(sx, sy) {
        if (sx == null || sy == null) return true;   // fallback: treat as inside
        const geom = this._host.getGeom();
        if (!geom) return true;
        return sx >= geom.x && sx < geom.x + geom.width &&
               sy >= geom.y && sy < geom.y + geom.height;
    }

    _setBadgeMode(r, mode) {
        if (!r.badge || r.mode === mode) return;
        r.mode = mode;
        if (mode === 'open') {
            r.badge.text = '↗  Open';
            r.badge.ease({ scale_x: 1.08, scale_y: 1.08, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        } else {
            r.badge.text = '↕  Move';
            r.badge.ease({ scale_x: 1.0, scale_y: 1.0, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        }
    }

    _destroyBadge(r) {
        if (r.badge) {
            try { r.badge.remove_all_transitions(); r.badge.destroy(); } catch { }
            r.badge = null;
        }
    }

    cancel() {
        const r = this._reorder;
        this._reorder = null;
        if (r) {
            this._disconnectGlobalCapture();
            this._destroyBadge(r);
            try { r.flyer.destroy(); } catch { }
            this._restoreIcon(r.item, false);
            this._zeroTranslations();
            this._host.engine.setSuspended(false);
            this._host.engine.kick();
            this._host.onDragEnd?.();
        }
    }

    // ── Pointer poll during drag ─────────────────────────────────────────────
    // Polls global.get_pointer() at ~60 fps so the flyer tracks the cursor
    // even when it's over windows outside the dock. Detects button-up via
    // the modifier mask — zero event-routing conflicts.
    _connectGlobalCapture() {
        if (this._dragPollId) return;
        this._dragPollId = this._timers.add(16, () => {
            if (!this._reorder) { this._dragPollId = 0; return GLib.SOURCE_REMOVE; }
            let px, py, mods;
            try { [px, py, mods] = global.get_pointer(); } catch { return GLib.SOURCE_CONTINUE; }
            this.update(px, py);
            // Button1 released?
            if (!(mods & Clutter.ModifierType.BUTTON1_MASK)) {
                this._dragPollId = 0;
                this.finish(px, py);
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _disconnectGlobalCapture() {
        if (this._dragPollId) { this._timers.remove(this._dragPollId); this._dragPollId = 0; }
    }

    _positionFlyer(px, py) {
        const r = this._reorder;
        if (!r) return;
        r.flyer.set_position(Math.round(px - r.size / 2), Math.round(py - r.size / 2));
        // Badge sits above the flyer.
        if (r.badge) {
            const [, bw] = r.badge.get_preferred_width(-1);
            r.badge.set_position(
                Math.round(px - (bw || 0) / 2),
                Math.round(py - r.size / 2 - 28));
        }
    }

    _restoreIcon(item, animate) {
        const icon = item?._icon;
        if (!icon) return;
        item._dragging = false;
        try { icon.remove_all_transitions(); } catch { }
        try { item.relayout(this._host.getConfig(), 0); } catch { }
        if (!animate) { try { icon.opacity = 255; } catch { } return; }
        try { icon.opacity = 0; icon.ease({ opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD }); }
        catch { try { icon.opacity = 255; } catch { } }
    }

    _zeroTranslations() {
        const prop = this._host.getConfig().vertical ? 'translation_y' : 'translation_x';
        for (const c of this._host.getChips()) {
            try { c.actor.remove_transition(prop); c.actor[prop] = 0; } catch { }
        }
    }

    // ── Drop-to-pin (DND delegate; called by GNOME on container._delegate) ────
    _dragApp(source) {
        const app = source?.app ?? source?._delegate?.app ?? null;
        return app?.get_id ? app : null;
    }

    _dropIndex(main) {
        const favs = AppFavorites.getAppFavorites();
        let pos = 0;
        for (const chip of this._host.getChips()) {
            const app = chip.item?.entry?.app;
            if (!app?.get_id || !favs.isFavorite(app.get_id())) continue;
            if (main > chip.baseX + chip.w / 2) pos++;
        }
        return pos;
    }

    handleDragOver(source, _actor, x, y, _time) {
        if (!this._dragApp(source)) return DND.DragMotionResult.CONTINUE;
        this._host.onDragStart?.();
        if (!this._externalDnD) {
            this._externalDnD = true;
            this._host.engine.setSuspended(true);
            this._host.engine.snapToRest();
            this._dropGapPos = -1;
        }
        const vert = this._host.getConfig().vertical;
        const pos = this._dropIndex(vert ? y : x);
        if (pos !== this._dropGapPos) { this._dropGapPos = pos; this._showDropGap(pos); }
        return DND.DragMotionResult.COPY_DROP;
    }

    _showDropGap(pos) {
        const favs = AppFavorites.getAppFavorites();
        const cfg = this._host.getConfig();
        const prop = cfg.vertical ? 'translation_y' : 'translation_x';
        const gap = Math.round(cfg.cellW * 0.6);
        let favIdx = 0;
        for (const chip of this._host.getChips()) {
            const app = chip.item?.entry?.app;
            if (!app?.get_id || !favs.isFavorite(app.get_id())) continue;
            const shift = favIdx >= pos ? gap : 0;
            try { chip.actor.remove_transition(prop); chip.actor.ease({ [prop]: shift, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD }); } catch { }
            favIdx++;
        }
    }

    acceptDrop(source, _actor, x, y, _time) {
        const app = this._dragApp(source);
        if (!app) return false;
        const id = app.get_id();
        const favs = AppFavorites.getAppFavorites();
        const vert = this._host.getConfig().vertical;
        const pos = this._dropIndex(vert ? y : x);

        this._externalDnD = false;
        this._dropGapPos = -1;
        // Keep the engine suspended briefly so the favourites-changed rebuild
        // doesn't magnify-flicker the new icons; resume after it settles.
        if (this._dropTimer) this._timers.remove(this._dropTimer);
        this._dropTimer = this._timers.addOnce(400, () => {
            this._dropTimer = 0;
            this._host.engine.setSuspended(false);
            this._host.engine.kick();
        });

        try {
            if (favs.isFavorite(id)) favs.moveFavoriteToPos(id, pos);
            else favs.addFavoriteAtPos(id, pos);
        } catch (e) {
            logError(e, 'pin-on-drop');
            this._host.engine.setSuspended(false);
            return false;
        }
        this._host.onDragEnd?.();
        return true;
    }

    // Drag ended without dropping on us — clear the gap and resume.
    clearDrop() {
        if (!this._externalDnD) return;
        this._externalDnD = false;
        this._dropGapPos = -1;
        this._zeroTranslations();
        this._host.engine.setSuspended(false);
        this._host.engine.kick();
    }

    destroy() {
        this._timers.removeAll();
        this._dragPollId = 0;
        this._dropTimer = 0;
        this.cancel();
        this._externalDnD = false;
        this._host = null;
    }
}
