// In-dock reorder and drag-to-pin drop manager.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import { logError, appWindowsForConfig, TimeoutGroup } from '../core/utils.js';
import { _ } from '../core/i18n.js';
import { dragSourceApp } from '../compat/shell.js';

const START_THRESHOLD = 8;     // px before a press becomes a reorder drag

function chipAppId(chip) {
    return chip?.item?.entry?.app?.get_id?.() ?? null;
}

function insertAppsButton(favorites, appsChip, position) {
    const visible = favorites.slice();
    if (!appsChip) return visible;

    const appsIndex = Math.max(0, Math.min(position ?? 0, visible.length));
    visible.splice(appsIndex, 0, appsChip);
    return visible;
}

function movableChipsFor(chips, favorites, appsPosition) {
    const favoriteChips = chips.filter(chip => {
        const id = chipAppId(chip);
        return id && favorites.isFavorite(id);
    });
    const appsChip = chips.find(chip => chip.item?.entry?.kind === 'apps') ?? null;
    return {
        favoriteChips,
        appsChip,
        visibleChips: insertAppsButton(favoriteChips, appsChip, appsPosition),
    };
}

export class DragManager {
    // host: { getConfig, getGeom, getChips, getItems, container, engine,
    //         setAppsButtonPosition, onDragStart, onDragEnd }
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
        const isAppsButton = item?.entry?.kind === 'apps';
        const app = item?.entry?.app;
        const favs = AppFavorites.getAppFavorites();
        if (!isAppsButton && (!app?.get_id || !favs.isFavorite(app.get_id()))) return false;
        const cfg = this._host.getConfig();
        // Locking protects layout changes, not drag-to-open.  The launcher has
        // no launch target of its own, so only pinned app icons can begin the
        // non-reordering drag while locked.
        if (cfg.layoutLocked && (isAppsButton || !cfg.dragToOpen)) return false;
        const canReorder = !cfg.layoutLocked;

        const { appsChip, visibleChips: movableChips } = movableChipsFor(
            this._host.getChips(), favs, cfg.appsButtonPosition);
        const fromIndex = movableChips.findIndex(c => c.item === item);
        if (fromIndex < 0) return false;

        const previewSlots = movableChips.map(chip => chip.baseX);

        this._host.onDragStart?.();
        const liftScale = item.scaleCurrent;
        const [iconX, iconY] = item._icon.get_transformed_position();
        const size = cfg.iconSize;
        const visual = size * liftScale;

        item._icon.remove_all_transitions();
        item._icon.opacity = 0;
        item._dragging = true;

        const flyer = new St.Icon({ gicon: app?.get_icon?.() ?? item.entry.gicon, icon_size: size });
        flyer.set_pivot_point(0.5, 0.5);
        Main.uiGroup.add_child(flyer);
        try { Main.uiGroup.set_child_above_sibling(flyer, this._host.container); } catch { }
        flyer.set_position(Math.round(iconX + (visual - size) / 2), Math.round(iconY + (visual - size) / 2));
        flyer.set_scale(liftScale, liftScale);
        flyer.opacity = 255;
        flyer.ease({ opacity: 240, scale_x: 1.1, scale_y: 1.1, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_QUAD });

        // Floating context badge.
        const badge = new St.Label({ text: canReorder ? `↕  ${_('Move')}` : `↗  ${_('Open')}` });
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

        this._reorder = {
            item, app, isAppsButton, movableChips, appsChip, previewSlots,
            fromIndex, toIndex: fromIndex, flyer, badge, size,
            canReorder, mode: canReorder ? 'move' : 'open',
        };
        this._connectGlobalCapture();
        this._positionFlyer(px, py);
        return true;
    }

    update(px, py) {
        const r = this._reorder;
        if (!r) return;
        this._positionFlyer(px, py);

        // Layout lock leaves the visual order untouched; this drag exists only
        // to let the app be released outside the dock and opened.
        if (!r.canReorder) {
            this._setBadgeMode(r, 'open');
            return;
        }

        // When the flyer is outside the pill, clear the reorder preview.
        if (!this._isInsidePill(px, py)) {
            this._setBadgeMode(r, 'open');
            if (r.toIndex !== r.fromIndex) {
                r.toIndex = r.fromIndex;
                this._showReorderPreview(r, r.fromIndex);
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

        let to = r.movableChips.length - 1;
        for (let i = 0; i < r.movableChips.length; i++) {
            if (main < r.movableChips[i].baseX + r.movableChips[i].w / 2) { to = i; break; }
        }
        if (to === r.toIndex) return;
        r.toIndex = to;
        this._showReorderPreview(r, to);
    }

    _showReorderPreview(r, toIndex) {
        const visible = r.movableChips.slice();
        const [moved] = visible.splice(r.fromIndex, 1);
        visible.splice(toIndex, 0, moved);
        const prop = this._host.getConfig().vertical ? 'translation_y' : 'translation_x';
        for (let i = 0; i < visible.length; i++) {
            const chip = visible[i];
            // The flyer represents the dragged icon. Moving its hidden actor is
            // unnecessary; every other reorderable chip moves into its projected
            // visible slot.
            if (chip.item === r.item) continue;
            const shift = r.previewSlots[i] - chip.baseX;
            try {
                chip.actor.remove_transition(prop);
                chip.actor.ease({
                    [prop]: shift,
                    duration: 180,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } catch { }
        }
    }

    finish(releaseX, releaseY) {
        const r = this._reorder;
        this._reorder = null;
        if (!r) return;

        this._destroyBadge(r);
        this._disconnectGlobalCapture();
        const insidePill = this._isInsidePill(releaseX, releaseY);

        // The Applications launcher only reorders. Dropping it outside the dock
        // must not try to treat it as a launchable Shell.App.
        if (!insidePill && r.isAppsButton) {
            try { r.flyer.destroy(); } catch { }
            this._restoreIcon(r.item, true);
            this._zeroTranslations();
            this._host.engine.setSuspended(false);
            this._host.engine.kick();
            this._host.onDragEnd?.();
            return;
        }

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
                const cfg = this._host.getConfig();
                const wins = appWindowsForConfig(r.app, cfg);
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
        const targetChip = r.movableChips[r.toIndex];
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

        if (!this._host.getConfig().layoutLocked && r.toIndex !== r.fromIndex) {
            const reordered = r.movableChips.slice();
            const [moved] = reordered.splice(r.fromIndex, 1);
            reordered.splice(r.toIndex, 0, moved);
            // The launcher position is stored separately from GNOME's favourite
            // order.  Keep it in sync even when a *different* app crosses it,
            // otherwise the next structural rebuild would put it back in the
            // old slot.
            const appsPosition = reordered.indexOf(r.appsChip);
            if (appsPosition >= 0) {
                try { this._host.setAppsButtonPosition?.(appsPosition); }
                catch (e) { logError(e, 'move Applications button'); }
            }
            if (!r.isAppsButton) {
                const appPosition = reordered
                    .filter(chip => chip !== r.appsChip)
                    .findIndex(chip => chip.item === r.item);
                try { AppFavorites.getAppFavorites().moveFavoriteToPos(r.app.get_id(), appPosition); }
                catch (e) { logError(e, 'reorder commit'); }
            }
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
            r.badge.text = `↗  ${_('Open')}`;
            r.badge.ease({ scale_x: 1.08, scale_y: 1.08, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        } else {
            r.badge.text = `↕  ${_('Move')}`;
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

    cancelLayoutChanges() {
        this.cancel();
        this.clearDrop();
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
        const app = dragSourceApp(source);
        return app?.get_id ? app : null;
    }

    _dropSlot(main) {
        const favs = AppFavorites.getAppFavorites();
        const cfg = this._host.getConfig();
        const { visibleChips } = movableChipsFor(
            this._host.getChips(), favs, cfg.appsButtonPosition);
        let slot = 0;
        for (const chip of visibleChips) {
            if (main > chip.baseX + chip.w / 2) slot++;
        }
        return slot;
    }

    handleDragOver(source, _actor, x, y, _time) {
        if (this._host.getConfig().layoutLocked)
            return DND.DragMotionResult.NO_DROP;
        if (!this._dragApp(source)) return DND.DragMotionResult.CONTINUE;
        this._host.onDragStart?.();
        if (!this._externalDnD) {
            this._externalDnD = true;
            this._host.engine.setSuspended(true);
            this._host.engine.snapToRest();
            this._dropGapPos = -1;
        }
        const vert = this._host.getConfig().vertical;
        const slot = this._dropSlot(vert ? y : x);
        if (slot !== this._dropGapPos) { this._dropGapPos = slot; this._showDropGap(slot); }
        return DND.DragMotionResult.COPY_DROP;
    }

    _showDropGap(slot) {
        const favs = AppFavorites.getAppFavorites();
        const cfg = this._host.getConfig();
        const prop = cfg.vertical ? 'translation_y' : 'translation_x';
        const gap = Math.round(cfg.cellW * 0.6);
        const { visibleChips } = movableChipsFor(
            this._host.getChips(), favs, cfg.appsButtonPosition);

        // Preview a slot in the combined favourites + Applications section.
        // Treating the launcher as a real slot makes the regions immediately
        // before and after it distinct, and it keeps preview and commit aligned.
        for (let index = 0; index < visibleChips.length; index++) {
            const chip = visibleChips[index];
            const shift = index >= slot ? gap : 0;
            try { chip.actor.remove_transition(prop); chip.actor.ease({ [prop]: shift, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD }); } catch { }
        }
    }

    acceptDrop(source, _actor, x, y, _time) {
        if (this._host.getConfig().layoutLocked) {
            this.clearDrop();
            return false;
        }
        const app = this._dragApp(source);
        if (!app) return false;
        const id = app.get_id();
        const favs = AppFavorites.getAppFavorites();
        const vert = this._host.getConfig().vertical;
        const cfg = this._host.getConfig();
        const { appsChip, visibleChips } = movableChipsFor(
            this._host.getChips(), favs, cfg.appsButtonPosition);
        const slot = this._dropSlot(vert ? y : x);

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
            const sourceIndex = visibleChips.findIndex(chip => chipAppId(chip) === id);
            const reordered = visibleChips.slice();
            let favoritePosition;

            if (sourceIndex >= 0) {
                // A favourite dragged in from another Shell surface keeps the
                // same combined ordering rule as an in-dock reorder.
                const [sourceChip] = reordered.splice(sourceIndex, 1);
                const targetSlot = Math.max(0, Math.min(
                    slot > sourceIndex ? slot - 1 : slot, reordered.length));
                reordered.splice(targetSlot, 0, sourceChip);
                favoritePosition = reordered
                    .filter(chip => chip !== appsChip)
                    .findIndex(chip => chip === sourceChip);
            } else {
                // A new favourite occupies the visible drop slot. Its favourite
                // position deliberately ignores the Applications launcher.
                const targetSlot = Math.max(0, Math.min(slot, reordered.length));
                reordered.splice(targetSlot, 0, null);
                favoritePosition = reordered
                    .slice(0, targetSlot)
                    .filter(chip => chip !== appsChip).length;
            }

            const currentAppsPosition = visibleChips.indexOf(appsChip);
            const appsPosition = reordered.indexOf(appsChip);
            if (appsChip && appsPosition >= 0 && appsPosition !== currentAppsPosition)
                this._host.setAppsButtonPosition?.(appsPosition);

            if (favs.isFavorite(id)) favs.moveFavoriteToPos(id, favoritePosition);
            else favs.addFavoriteAtPos(id, favoritePosition);
        } catch (e) {
            logError(e, 'pin-on-drop');
            if (this._dropTimer) { this._timers.remove(this._dropTimer); this._dropTimer = 0; }
            this._zeroTranslations();
            this._host.engine.setSuspended(false);
            this._host.engine.kick();
            this._host.onDragEnd?.();
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
        this._host.onDragEnd?.();
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
