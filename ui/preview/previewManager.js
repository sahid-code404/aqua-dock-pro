// AquaDockPro — window-preview popups on hover.
//
// Purpose:   Show live thumbnails of an app's windows the user CAN'T already see
//            (minimized, or on another workspace) when they hover its icon. One
//            popup at a time: a second hover retargets the existing popup with a
//            crossfade (no flicker). The popup is reactive with a short grace
//            period so the user can move onto it and click a thumbnail to raise
//            that window.
// Ownership: OWNS the current popup box, the dying (crossfading-out) box, the
//            open-delay timer and the grace-hide timer. hide(true)/destroy()
//            release every one synchronously.
// Cost:      Built only after the open delay while still hovered. Per-window
//            clones are GPU-cheap. No per-frame cost.

import Clutter from 'gi://Clutter';

import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { clamp, appWindows, logError, TimeoutGroup } from '../../core/utils.js';
import { buildWindowFrame } from './livePreview.js';

const MAX_WINDOWS = 4;
const GRACE_MS = 130;   // window to move pointer from icon onto the popup

export class PreviewManager {
    // getConfig/getGeom: snapshot accessors. getHoverItem: () => current hover.
    constructor(getConfig, getGeom, getHoverItem) {
        this._getConfig = getConfig;
        this._getGeom = getGeom;
        this._getHoverItem = getHoverItem;
        this._box = null;
        this._dying = null;
        this._timers = new TimeoutGroup();
        this._openId = 0;
        this._graceId = 0;
    }

    schedule(item) {
        const cfg = this._getConfig();
        if (!cfg.showPreviews || item.entry.kind !== 'app') { this.hide(true); return; }

        const wins = this._previewableWindows(item);
        if (!wins.length) { this.hide(true); return; }

        this._cancelGrace();
        if (this._box) { this._cancelOpen(); this._build(item, true); return; }

        if (this._openId) return;
        this._openId = this._timers.addOnce(cfg.previewDelay, () => {
            this._openId = 0;
            if (this._getHoverItem() === item) this._build(item, false);
        });
    }

    // Collect windows eligible for live preview — must be hidden (minimized or
    // on another workspace) AND have a valid compositor actor + frame rect so
    // we never fall back to the app-icon placeholder.
    _previewableWindows(item) {
        const ws = global.workspace_manager.get_active_workspace();
        return appWindows(item.entry.app).filter(w => {
            if (!w.minimized && !(ws && !w.located_on_workspace(ws))) return false;
            let actor = null, rect = null;
            try { actor = w.get_compositor_private?.(); } catch { }
            try { rect = w.get_frame_rect(); } catch { }
            return actor && rect && rect.width > 0 && rect.height > 0;
        });
    }

    _build(item, reuse) {
        // Re-filter at build time to avoid stale window state from schedule().
        const wins = this._previewableWindows(item);
        if (!wins.length) { this.hide(true); return; }

        const cfg = this._getConfig();
        const targetW = cfg.previewSize;
        const frameH = Math.round(targetW * 0.62);

        const box = new St.BoxLayout({ style_class: 'aqua-preview-box', reactive: true });
        box.spacing = 10;
        for (const win of wins.slice(0, MAX_WINDOWS)) {
            const btn = new St.Button({ style_class: 'aqua-preview-col', reactive: true, can_focus: true });
            const col = new St.BoxLayout({ vertical: true, style_class: 'aqua-preview-col' });
            col.spacing = 5;
            col.add_child(buildWindowFrame(win, targetW, frameH, item.entry.app.get_icon()));
            col.add_child(new St.Label({
                text: win.get_title() ?? item.label(),
                style_class: 'aqua-preview-title',
            }));
            btn.set_child(col);
            btn.connect('clicked', () => {
                win.activate(global.get_current_time());
                this.hide(true);
            });
            box.add_child(btn);
        }
        // Keep the popup alive while the pointer is over it; dismiss on leave.
        box.connect('enter-event', () => { this._cancelGrace(); return Clutter.EVENT_PROPAGATE; });
        box.connect('leave-event', () => { this.hide(false); return Clutter.EVENT_PROPAGATE; });

        Main.uiGroup.add_child(box);
        const old = this._box;
        this._box = box;
        this._position(box, item);

        if (reuse && old) {
            if (this._dying) { this._destroyBox(this._dying); this._dying = null; }
            this._dying = old;
            box.opacity = 0;
            box.ease({ opacity: 255, duration: 110, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            old.remove_all_transitions();
            old.ease({
                opacity: 0, duration: 110, mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => { if (this._dying === old) this._dying = null; this._destroyBox(old); },
            });
        } else {
            box.opacity = 0;
            box.translation_y = 8;
            box.ease({
                opacity: 255, translation_y: 0, duration: 140,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    _position(box, item) {
        try {
            const geom = this._getGeom();
            const icon = item._icon;
            const [ix, iy] = icon ? icon.get_transformed_position() : item.get_transformed_position();
            const [iw, ih] = icon ? icon.get_transformed_size() : [item.width, item.height];
            const [, w] = box.get_preferred_width(-1);
            const [, h] = box.get_preferred_height(-1);
            const gap = 48;   // clears the tooltip below it
            let px, py;
            if (!geom.vert) { px = ix + iw / 2 - w / 2; py = iy - h - gap; }
            else if (geom.side === 'left') { px = ix + iw + gap; py = iy + ih / 2 - h / 2; }
            else { px = ix - w - gap; py = iy + ih / 2 - h / 2; }
            const mon = Main.layoutManager.primaryMonitor;
            if (mon) {
                px = clamp(px, mon.x + 8, mon.x + mon.width - w - 8);
                py = clamp(py, mon.y + 8, mon.y + mon.height - h - 8);
            }
            box.set_position(Math.round(px), Math.round(py));
        } catch (e) { logError(e, 'preview.position'); }
    }

    // immediate=true destroys now; false gives a grace window for the pointer to
    // land on the popup before it disappears.
    hide(immediate = true) {
        this._cancelOpen();
        if (immediate) { this._hideNow(); return; }
        if (this._graceId) return;
        this._graceId = this._timers.addOnce(GRACE_MS, () => {
            this._graceId = 0;
            this._hideNow();
        });
    }

    _hideNow() {
        if (this._dying) { this._destroyBox(this._dying); this._dying = null; }
        const box = this._box;
        this._box = null;
        if (!box) return;
        box.ease({
            opacity: 0, translation_y: 8, duration: 90,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => this._destroyBox(box),
        });
    }

    _destroyBox(box) {
        try { box.remove_all_transitions(); box.destroy(); } catch { }
    }

    _cancelOpen() {
        if (this._openId) { this._timers.remove(this._openId); this._openId = 0; }
    }

    _cancelGrace() {
        if (this._graceId) { this._timers.remove(this._graceId); this._graceId = 0; }
    }

    destroy() {
        this._timers.removeAll();
        this._openId = 0;
        this._graceId = 0;
        if (this._dying) { this._destroyBox(this._dying); this._dying = null; }
        if (this._box) { this._destroyBox(this._box); this._box = null; }
        this._getConfig = this._getGeom = this._getHoverItem = null;
    }
}
