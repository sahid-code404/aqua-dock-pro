// Window hover preview popup manager and lifecycle.

import Clutter from 'gi://Clutter';

import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    animationsEnabled,
    clamp,
    appWindowsForConfig,
    logError,
    TimeoutGroup,
} from '../../core/utils.js';
import { _, format, ngettext } from '../../core/i18n.js';
import { buildWindowFrame } from './livePreview.js';
import { previewPagePlan } from './previewPaging.js';

const LEGACY_MAX_WINDOWS = 4;
const GRACE_MS = 130;   // window to move pointer from icon onto the popup

export class PreviewManager {
    // getConfig/getGeom are snapshot accessors; getHoverItem returns the current
    // dock hover; getMonitor returns its monitor geometry. onClose lets the
    // controller resume autohide after dismissal.
    constructor(getConfig, getGeom, getHoverItem, getMonitor, onClose = null) {
        this._getConfig = getConfig;
        this._getGeom = getGeom;
        this._getHoverItem = getHoverItem;
        this._getMonitor = getMonitor;
        this._onClose = onClose;
        this._box = null;
        this._dying = null;
        this._timers = new TimeoutGroup();
        this._openId = 0;
        this._graceId = 0;
        this._windowRefreshId = 0;
        this._pendingItem = null;
        this._windowMenu = null;
        this._windowMenuManager = null;
        this._windowMenuStateId = 0;
    }

    get active() { return Boolean(this._box); }

    showNow(item) {
        if (!item || item.entry.kind !== 'app') return false;
        this._cancelOpen();
        this._cancelGrace();
        const cfg = this._getConfig();
        this._build(item, Boolean(this._box), true, 0, cfg.previewKeyboardNavigation);
        return Boolean(this._box);
    }

    schedule(item) {
        const cfg = this._getConfig();
        if (!cfg.showPreviews || item.entry.kind !== 'app') { this.hide(true); return; }

        this._cancelGrace();
        if (this._box) { this._cancelOpen(); this._build(item, true); return; }

        const wins = this._previewableWindows(item);
        if (!wins.length) { this.hide(true); return; }

        // A pointer can cross several icons before the delay expires. Reuse the
        // timer, but let it resolve against the most recent valid target.
        this._pendingItem = item;
        if (this._openId) return;
        this._openId = this._timers.addOnce(cfg.previewDelay, () => {
            this._openId = 0;
            const nextItem = this._pendingItem;
            this._pendingItem = null;
            if (nextItem && this._getHoverItem() === nextItem)
                this._build(nextItem, false);
        });
    }

    // Collect windows eligible for live preview — must be hidden (minimized or
    // on another workspace) AND have a valid compositor actor + frame rect so
    // we never fall back to the app-icon placeholder.
    _previewableWindows(item, forceAll = false) {
        const cfg = this._getConfig();
        const showAll = forceAll || cfg.previewWindowMode === 'all';
        const ws = global.workspace_manager.get_active_workspace();
        return appWindowsForConfig(item.entry.app, cfg, ws).filter(w => {
            if (!showAll && !w.minimized && !(ws && !w.located_on_workspace(ws))) return false;
            let actor = null, rect = null;
            try { actor = w.get_compositor_private?.(); } catch { }
            try { rect = w.get_frame_rect(); } catch { }
            return actor && rect && rect.width > 0 && rect.height > 0;
        });
    }

    _queueWindowRefresh(item, box, forceAll, page, focusPreview) {
        if (this._windowRefreshId) return;
        this._windowRefreshId = this._timers.addIdle(() => {
            this._windowRefreshId = 0;
            if (this._box === box)
                this._build(item, true, forceAll, page, focusPreview);
            return false;
        });
    }

    _build(item, reuse, forceAll = false, requestedPage = 0, focusPreview = false) {
        this._destroyWindowMenu();
        this._cancelGrace();
        // Re-filter at build time to avoid stale window state from schedule().
        const wins = this._previewableWindows(item, forceAll);
        if (!wins.length) { this.hide(true); return; }

        const cfg = this._getConfig();
        const targetW = cfg.previewSize;
        const frameH = Math.round(targetW * 0.62);
        const monitor = this._getMonitor?.();
        const plan = previewPagePlan({
            total: wins.length,
            targetWidth: targetW,
            monitorWidth: monitor?.width ?? targetW * LEGACY_MAX_WINDOWS + 62,
            mode: cfg.previewOverflowMode,
            requestedSize: cfg.previewOverflowMode === 'pages'
                ? cfg.previewPageSize : LEGACY_MAX_WINDOWS,
            requestedPage,
        });
        const { paged, page, pageCount } = plan;
        const shown = wins.slice(plan.start, plan.end);

        const box = new St.BoxLayout({
            style_class: 'aqua-preview-box',
            orientation: paged ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
            reactive: true,
            can_focus: true,
        });
        if (cfg.highContrast) box.add_style_class_name('aqua-high-contrast');
        box.set_style(`font-size: ${cfg.interfaceTextScale ?? 1}em;`);
        box.get_layout_manager().set_spacing(10);
        const tiles = paged
            ? new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL })
            : box;
        if (paged) {
            tiles.get_layout_manager().set_spacing(10);
            box.add_child(tiles);
        }
        const focusables = [];
        const fallbackIcon = item.entry.app.get_icon();
        const titleStyle =
            `font-size: ${(9 * (cfg.interfaceTextScale ?? 1)).toFixed(2)}pt;`;
        for (const win of shown) {
            const windowTitle = win.get_title() || item.label();
            const btn = new St.Button({
                style_class: 'aqua-preview-col',
                reactive: true,
                can_focus: true,
                accessible_name: windowTitle,
            });
            if (cfg.previewWindowActions)
                btn.set_button_mask(St.ButtonMask.ONE | St.ButtonMask.THREE);
            const col = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'aqua-preview-content',
            });
            col.get_layout_manager().set_spacing(5);
            col.add_child(buildWindowFrame(win, targetW, frameH, fallbackIcon));
            const title = new St.Label({
                text: windowTitle,
                style_class: 'aqua-preview-title',
                x_expand: true,
            });
            title.set_style(titleStyle);

            // A window can disappear while its preview is open. Rebuild on the
            // next idle turn so the clone is never left pointing at a dead
            // compositor actor. connectObject ties this signal to the popup.
            try {
                win.connectObject('unmanaging', () =>
                    this._queueWindowRefresh(item, box, forceAll, page, focusPreview), box);
            } catch { }

            if (cfg.previewCloseButtons) {
                const titleRow = new St.BoxLayout({ x_expand: true });
                titleRow.get_layout_manager().set_spacing(5);
                titleRow.add_child(title);
                const close = new St.Button({
                    label: '×',
                    style_class: 'aqua-preview-close',
                    can_focus: true,
                    accessible_name: format(_('Close %s'), title.text),
                });
                close.connect('clicked', () => {
                    if (this._box !== box) return;
                    try { win.delete(global.get_current_time()); }
                    catch (e) { logError(e, 'preview close window'); }
                });
                titleRow.add_child(close);
                col.add_child(titleRow);
            } else {
                col.add_child(title);
            }
            btn.set_child(col);
            btn.connect('clicked', (_button, mouseButton) => {
                if (this._box !== box) return;
                if (cfg.previewWindowActions && mouseButton === Clutter.BUTTON_SECONDARY) {
                    this._openWindowMenu(btn, win, box);
                    return;
                }
                try { win.activate(global.get_current_time()); }
                catch (e) { logError(e, 'preview activate window'); }
                this.hide(true);
            });
            if (cfg.previewWindowActions) {
                btn.connect('key-press-event', (_button, event) => {
                    const symbol = event.get_key_symbol();
                    const state = event.get_state?.() ?? 0;
                    if (symbol !== Clutter.KEY_Menu &&
                        !(symbol === Clutter.KEY_F10 && state & Clutter.ModifierType.SHIFT_MASK))
                        return Clutter.EVENT_PROPAGATE;
                    this._openWindowMenu(btn, win, box);
                    return Clutter.EVENT_STOP;
                });
            }
            tiles.add_child(btn);
            focusables.push(btn);
        }
        if (!paged && wins.length > shown.length) {
            box.add_child(new St.Label({
                text: format(ngettext('+%d more window', '+%d more windows',
                    wins.length - shown.length), wins.length - shown.length),
                style_class: 'aqua-preview-more',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        if (paged && pageCount > 1) {
            const navigation = new St.BoxLayout({
                style_class: 'aqua-preview-navigation',
                x_align: Clutter.ActorAlign.CENTER,
            });
            navigation.get_layout_manager().set_spacing(8);
            const previous = new St.Button({
                label: '‹',
                style_class: 'aqua-preview-page-button',
                can_focus: true,
                reactive: true,
                accessible_name: _('Previous window page'),
            });
            previous.reactive = page > 0;
            previous.opacity = page > 0 ? 255 : 96;
            previous.connect('clicked', () => {
                if (this._box === box && page > 0)
                    this._build(item, true, forceAll, page - 1, true);
            });
            const status = new St.Label({
                text: format(_('Page %d of %d'), page + 1, pageCount),
                style_class: 'aqua-preview-page-status',
                y_align: Clutter.ActorAlign.CENTER,
            });
            status.set_style(
                `font-size: ${(9 * (cfg.interfaceTextScale ?? 1)).toFixed(2)}pt;`);
            const next = new St.Button({
                label: '›',
                style_class: 'aqua-preview-page-button',
                can_focus: true,
                reactive: true,
                accessible_name: _('Next window page'),
            });
            next.reactive = page < pageCount - 1;
            next.opacity = page < pageCount - 1 ? 255 : 96;
            next.connect('clicked', () => {
                if (this._box === box && page < pageCount - 1)
                    this._build(item, true, forceAll, page + 1, true);
            });
            navigation.add_child(previous);
            navigation.add_child(status);
            navigation.add_child(next);
            box.add_child(navigation);
            if (page > 0) focusables.push(previous);
            if (page < pageCount - 1) focusables.push(next);
        }
        box.connect('key-press-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Escape) {
                this.hide(true);
                return Clutter.EVENT_STOP;
            }
            if (paged && symbol === Clutter.KEY_Page_Up && page > 0) {
                this._build(item, true, forceAll, page - 1, true);
                return Clutter.EVENT_STOP;
            }
            if (paged && symbol === Clutter.KEY_Page_Down && page < pageCount - 1) {
                this._build(item, true, forceAll, page + 1, true);
                return Clutter.EVENT_STOP;
            }
            const directional = symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right;
            if (directional || symbol === Clutter.KEY_Home || symbol === Clutter.KEY_End) {
                const focused = global.stage.get_key_focus?.();
                const current = focusables.indexOf(focused);
                let next = current;
                if (symbol === Clutter.KEY_Home) next = 0;
                else if (symbol === Clutter.KEY_End) next = focusables.length - 1;
                else if (symbol === Clutter.KEY_Left) next = Math.max(0, current - 1);
                else next = Math.min(focusables.length - 1, Math.max(0, current + 1));
                if (focusables[next]) {
                    focusables[next].grab_key_focus();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });
        // Keep the popup alive while the pointer is over it; dismiss on leave.
        box.connect('enter-event', () => {
            if (this._box === box) this._cancelGrace();
            return Clutter.EVENT_PROPAGATE;
        });
        box.connect('leave-event', () => {
            if (this._box === box && !this._windowMenu?.isOpen) this.hide(false);
            return Clutter.EVENT_PROPAGATE;
        });

        Main.uiGroup.add_child(box);
        const old = this._box;
        this._box = box;
        this._position(box, item);

        if (focusPreview && focusables.length) {
            try { focusables[0].grab_key_focus(); } catch { }
        }

        if (!animationsEnabled()) {
            box.opacity = 255;
            box.translation_y = 0;
            if (old) this._destroyBox(old);
            return;
        }

        if (reuse && old) {
            if (this._dying) { this._destroyBox(this._dying); this._dying = null; }
            this._dying = old;
            this._deactivateBox(old);
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

    _openWindowMenu(source, win, owner) {
        this._destroyWindowMenu();
        const cfg = this._getConfig();
        const menu = new PopupMenu.PopupMenu(source, 0.5, St.Side.BOTTOM);
        this._windowMenu = menu;
        try {
            menu.actor.add_style_class_name('aqua-menu');
            menu.addAction(_('Activate'), () => {
                try { win.activate(global.get_current_time()); } catch { }
                this.hide(true);
            });

            const workspace = global.workspace_manager.get_active_workspace();
            let onWorkspace = true;
            try { onWorkspace = win.located_on_workspace(workspace); } catch { }
            if (!onWorkspace) {
                menu.addAction(_('Move to Current Workspace'), () => {
                    try {
                        win.change_workspace(workspace);
                        win.activate(global.get_current_time());
                    } catch { }
                    this.hide(true);
                });
            }

            const monitors = Main.layoutManager.monitors ?? [];
            let currentMonitor = -1;
            try { currentMonitor = win.get_monitor(); } catch { }
            if (monitors.length > 1) {
                for (let index = 0; index < monitors.length; index++) {
                    if (index === currentMonitor) continue;
                    menu.addAction(format(_('Move to Monitor %d'), index + 1), () => {
                        try { win.move_to_monitor(index); } catch { }
                        this.hide(true);
                    });
                }
            }
            menu.addAction(_('Close Window'), () => {
                try { win.delete(global.get_current_time()); } catch { }
                this.hide(true);
            });

            const background = cfg.highContrast ? 'rgba(0,0,0,0.98)'
                : (cfg.menuBg || 'rgba(35,36,40,0.94)');
            const foreground = cfg.highContrast ? '#ffffff'
                : (cfg.menuFg || 'rgba(235,235,240,0.90)');
            const width = cfg.highContrast ? Math.max(2, cfg.menuBorderWidth ?? 1)
                : (cfg.menuBorderWidth ?? 1);
            const color = cfg.highContrast ? '#ffffff'
                : (cfg.menuBorderColor || 'rgba(255,255,255,0.12)');
            menu.box.set_style(
                `background-color: ${background}; border-radius: ${cfg.menuRadius ?? 12}px; ` +
                `border: ${width > 0 ? `${width}px solid ${color}` : 'none'};`);
            const fontSize = (10.5 * (cfg.interfaceTextScale ?? 1)).toFixed(2);
            for (const child of menu.box.get_children?.() ?? [])
                child.label?.set_style(`color: ${foreground}; font-size: ${fontSize}pt;`);

            this._windowMenuManager = new PopupMenu.PopupMenuManager(owner);
            this._windowMenuManager.addMenu(menu);
            Main.uiGroup.add_child(menu.actor);
            this._windowMenuStateId = menu.connect('open-state-changed', (_menu, open) => {
                if (open) this._cancelGrace();
                else if (this._box === owner) this.hide(false);
            });
            menu.actor.hide();
            menu.open();
        } catch (error) {
            this._destroyWindowMenu();
            throw error;
        }
    }

    _destroyWindowMenu() {
        if (this._windowMenu) {
            if (this._windowMenuStateId) {
                try { this._windowMenu.disconnect(this._windowMenuStateId); } catch { }
                this._windowMenuStateId = 0;
            }
            try { this._windowMenuManager?.removeMenu(this._windowMenu); } catch { }
            try { this._windowMenu.destroy(); } catch { }
        }
        this._windowMenu = null;
        this._windowMenuStateId = 0;
        try { this._windowMenuManager?.destroy?.(); } catch { }
        this._windowMenuManager = null;
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
            const mon = this._getMonitor?.();
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
        this._cancelGrace();
        this._destroyWindowMenu();
        if (this._dying) { this._destroyBox(this._dying); this._dying = null; }
        const box = this._box;
        this._box = null;
        if (!box) return;
        this._deactivateBox(box);
        this._dying = box;
        box.remove_all_transitions();
        if (!animationsEnabled()) {
            this._dying = null;
            this._destroyBox(box);
            try { this._onClose?.(); }
            catch (e) { logError(e, 'preview.onClose'); }
            return;
        }
        box.ease({
            opacity: 0, translation_y: 8, duration: 90,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (this._dying === box) this._dying = null;
                this._destroyBox(box);
            },
        });
        try { this._onClose?.(); }
        catch (e) { logError(e, 'preview.onClose'); }
    }

    _deactivateBox(box) {
        const pending = [box];
        while (pending.length) {
            const actor = pending.pop();
            actor.reactive = false;
            actor.can_focus = false;
            for (const child of actor.get_children?.() ?? [])
                pending.push(child);
        }
    }

    _destroyBox(box) {
        try { box.remove_all_transitions(); box.destroy(); } catch { }
    }

    _cancelOpen() {
        if (this._openId) { this._timers.remove(this._openId); this._openId = 0; }
        this._pendingItem = null;
    }

    _cancelGrace() {
        if (this._graceId) { this._timers.remove(this._graceId); this._graceId = 0; }
    }

    destroy() {
        this._timers.removeAll();
        this._openId = 0;
        this._graceId = 0;
        this._windowRefreshId = 0;
        this._pendingItem = null;
        this._destroyWindowMenu();
        if (this._dying) { this._destroyBox(this._dying); this._dying = null; }
        if (this._box) { this._destroyBox(this._box); this._box = null; }
        this._getConfig = this._getGeom = this._getHoverItem = this._getMonitor = this._onClose = null;
    }
}
