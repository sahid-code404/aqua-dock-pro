// Context menu lifecycle and item action orchestration.


import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { AppMenu } from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { populateMenu } from './menuActions.js';
import { appWindowsForConfig, TimeoutGroup } from '../core/utils.js';
import { _, format, ngettext } from '../core/i18n.js';
import { emptyTrash } from '../services/fileService.js';
import { notifyUser, openPopupMenu } from '../compat/shell.js';
import { applyAlpha, getAnalyticalIconGeometry } from '../dock/dockLayout.js';
import {
    isBmsPopupBlurActive,
    isBmsDockBlurActive,
    isBmsMenuBlurActive,
    registerBmsTarget,
    unregisterBmsTarget,
} from '../dock/dockBlur.js';

export class MenuManager {
    // host: { container, getConfig, getGeom, isLayoutLocked, onOpen, onClose,
    //         holdItem(item), releaseHold(), onTrashEmptied, onToggleLayoutLock }
    constructor(host) {
        this._host = host;
        this._timers = new TimeoutGroup();
        this._menu = null;
        this._manager = null;
        this._stateId = 0;
        this._closeIdle = 0;
        this._heldItem = null;
        this._trashDialog = null;
        this._trashOperation = null;
        this._blurRegistered = false;
    }

    get active() { return this._active === true; }
    get heldItem() { return this._heldItem; }

    openFor(item) {
        this._destroyMenu();

        const geom = this._host.getGeom();
        const side = geom?.vert
            ? (geom.side === 'left' ? St.Side.LEFT : St.Side.RIGHT)
            : (geom.side === 'top' ? St.Side.TOP : St.Side.BOTTOM);
        const anchor = item.menuAnchor ?? item._icon ?? item;

        if (this._useGnomeAppMenu(item)) {
            this._openGnomeAppMenu(item, anchor, side);
            return;
        }

        this._menu = new PopupMenu.PopupMenu(anchor, 0.5, side);
        try {
            this._menu.actor.name = 'aquaMenu';
            this._menu.actor.add_style_class_name('aqua-menu');
            this._attachMenu(item);
            this._style();
            this._setupBlur();
            this._setupAnchorAlignment(this._menu, item);
            this._menu.actor.hide();

            populateMenu(this._menu, item.entry, {
                onTrashEmptied: this._host.onTrashEmptied,
                onEmptyTrash: callback => this._confirmEmptyTrash(callback),
                isLayoutLocked: () => this._host.isLayoutLocked?.() ??
                    this._host.getConfig().layoutLocked,
                onToggleLayoutLock: this._host.onToggleLayoutLock,
                appWindowsFor: app => {
                    const cfg = this._host.getConfig();
                    return appWindowsForConfig(app, cfg);
                },
                isWindowIsolationActive: () => {
                    const cfg = this._host.getConfig();
                    return cfg.isolateWS || cfg.isolateMonitors;
                },
            });
            this._styleItems();
            this._menu.open();
        } catch (error) {
            this._destroyMenu();
            throw error;
        }
    }

    _useGnomeAppMenu(item) {
        return this._host.getConfig().menuUseGnomeDefault === true &&
            item?.entry?.kind === 'app' && !!item.entry.app;
    }

    _openGnomeAppMenu(item, anchor, side) {
        try {
            // Use GNOME Shell's exported native AppMenu on both Shell 50 and
            // 51. The compatibility boundary handles the open() ABI change;
            // only the arrow side follows the dock edge for vertical layouts.
            this._menu = new AppMenu(anchor, side, {
                favoritesSection: true,
                showSingleWindows: true,
            });
            this._menu.setApp(item.entry.app);
            this._attachMenu(item);
            openPopupMenu(this._menu);
        } catch (error) {
            this._destroyMenu();
            throw error;
        }
    }

    _attachMenu(item) {
        if (!this._manager)
            this._manager = new PopupMenu.PopupMenuManager(this._host.container);
        this._manager.addMenu(this._menu);
        Main.uiGroup.add_child(this._menu.actor);

        this._heldItem = item;
        this._host.holdItem?.(item);

        this._stateId = this._menu.connect('open-state-changed', (m, open) => {
            this._active = open;
            if (open) {
                this._host.onOpen?.();
                return;
            }
            this._releaseHeldItem();
            this._scheduleClose(m);
        });
    }

    _scheduleClose(m) {
        this._cancelCloseIdle();
        this._closeIdle = this._timers.addIdle(() => {
            this._closeIdle = 0;
            if (this._menu === m) this._destroyMenu();
            this._host.onClose?.();
            return GLib.SOURCE_REMOVE;
        });
    }

    close() {
        try { this._menu?.close(); } catch { /* intentionally ignored: context menu or trash confirmation dialog may already be closed */ }
    }

    closeNow() {
        const wasActive = this.active;
        this._destroyMenu();
        if (wasActive) this._host.onClose?.();
    }

    _destroyMenu() {
        this._cancelCloseIdle();
        this._releaseHeldItem();
        if (!this._menu) return;
        if (this._blurRegistered) {
            unregisterBmsTarget(this._menu.actor);
            this._blurRegistered = false;
        }
        if (this._stateId) { try { this._menu.disconnect(this._stateId); } catch { /* intentionally ignored: menu state signal handler may already be disconnected */ } this._stateId = 0; }
        try { this._manager?.removeMenu(this._menu); } catch { /* intentionally ignored: menu or menu manager may already be destroyed */ }
        try { this._menu.destroy(); } catch { /* intentionally ignored: menu or menu manager may already be destroyed */ }
        this._menu = null;
        this._active = false;
    }

    _cancelCloseIdle() {
        if (!this._closeIdle) return;
        this._timers.remove(this._closeIdle);
        this._closeIdle = 0;
    }

    _releaseHeldItem() {
        if (!this._heldItem) return;
        this._heldItem = null;
        this._host.releaseHold?.();
    }

    _confirmEmptyTrash(onDone) {
        this._destroyTrashDialog();
        const dialog = new ModalDialog.ModalDialog({ destroyOnClose: true });
        dialog.contentLayout.add_child(new Dialog.MessageDialogContent({
            title: _('Empty Trash?'),
            description: _('All items in Trash will be permanently deleted.'),
        }));
        dialog.setButtons([
            {
                label: _('Cancel'),
                action: () => { this._trashDialog = null; dialog.close(); },
                key: Clutter.KEY_Escape,
            },
            {
                label: _('Empty Trash'),
                default: true,
                action: () => {
                    this._trashDialog = null;
                    dialog.close();
                    this._trashOperation?.cancel();
                    const operation = emptyTrash(result => {
                        if (this._trashOperation === operation)
                            this._trashOperation = null;
                        if (result.cancelled) return;
                        onDone?.();
                        if (result.failed > 0)
                            notifyUser(_('Trash could not be fully emptied'), format(
                                ngettext('%d item could not be removed.', '%d items could not be removed.', result.failed),
                                result.failed), true);
                        else
                            notifyUser(_('Trash emptied'));
                    });
                    this._trashOperation = operation;
                },
            },
        ]);
        this._trashDialog = dialog;
        dialog.open();
    }

    _destroyTrashDialog() {
        if (!this._trashDialog) return;
        try { this._trashDialog.close(); } catch { /* intentionally ignored: context menu or trash confirmation dialog may already be closed */ }
        this._trashDialog = null;
    }

    _style() {
        const cfg = this._host.getConfig();
        const radius = cfg.menuRadius ?? 12;
        const blurActive = isBmsMenuBlurActive(cfg);
        const normalBg = cfg.highContrast ? 'rgba(0,0,0,0.98)'
            : (cfg.menuBg || 'rgba(35,36,40,0.94)');
        const bg = blurActive ? applyAlpha(normalBg, 0.45) : normalBg;
        const fg = cfg.highContrast ? '#ffffff'
            : (cfg.menuFg || 'rgba(235,235,240,0.90)');
        const bw = cfg.highContrast ? Math.max(2, cfg.menuBorderWidth ?? 1)
            : (cfg.menuBorderWidth ?? 1);
        const bc = cfg.highContrast ? '#ffffff'
            : (cfg.menuBorderColor || 'rgba(255,255,255,0.12)');
        const border = bw > 0 ? `${bw}px solid ${bc}` : 'none';

        const box = this._menu.box;
        if (box)
            box.set_style(`background-color: ${bg}; border-radius: ${radius}px; border: ${border};`);

        this._menuTextColor = fg;
        this._menuTextSize = (10.5 * (cfg.interfaceTextScale ?? 1)).toFixed(2);
    }

    _setupBlur() {
        const cfg = this._host.getConfig();
        const radius = cfg.menuRadius ?? 12;
        const blurActive = isBmsMenuBlurActive(cfg);
        if (!blurActive) return;

        // If Blur My Shell popup blur is active, BMS natively creates the blur surface for popup-menu-content.
        if (isBmsPopupBlurActive()) return;

        // Fallback: if BMS dock blur is active, hook through AquaDockSurface
        if (isBmsDockBlurActive() && this._menu?.actor) {
            const menuActor = this._menu.actor;
            menuActor._isAquaDock = true;
            menuActor._blurType = 'popup';
            menuActor.name = 'aquaMenu';
            menuActor._dockBlurEnabled = true;
            menuActor._dockBg = menuActor;
            menuActor._dockContent = menuActor;
            menuActor._dockContentParent = Main.uiGroup;
            menuActor._dockRadius = radius;
            menuActor.get_dock_radius = () => radius;
            registerBmsTarget(menuActor, () => radius);
            this._blurRegistered = true;
        }
    }

    _setupAnchorAlignment(menu, item) {
        const boxPointer = menu._boxPointer ?? menu.actor;
        if (!boxPointer) return;

        const host = this._host;
        boxPointer._reposition = function(allocationBox) {
            const geom = host.getGeom?.();
            const geo = getAnalyticalIconGeometry(item, geom);
            let ix, iy, iw, ih, cx, cy;
            if (geo) {
                ix = geo.ix; iy = geo.iy; iw = geo.iw; ih = geo.ih;
                cx = geo.cx; cy = geo.cy;
            } else {
                const icon = item?._icon ?? item;
                let pos = [0, 0], size = [48, 48];
                try {
                    pos = typeof icon?.get_transformed_position === 'function'
                        ? icon.get_transformed_position() : [icon?.x ?? 0, icon?.y ?? 0];
                    size = typeof icon?.get_transformed_size === 'function'
                        ? icon.get_transformed_size() : [icon?.width ?? 48, icon?.height ?? 48];
                } catch {
                    /* fallback */
                }
                ix = pos[0]; iy = pos[1];
                iw = size[0]; ih = size[1];
                cx = ix + iw * 0.5;
                cy = iy + ih * 0.5;
            }

            const [, , natWidth, natHeight] = this.get_preferred_size();
            const gap = 8;

            let resX = 0;
            let resY = 0;

            const arrowSide = this._arrowSide;
            switch (arrowSide) {
            case St.Side.BOTTOM:
                resX = cx - natWidth * 0.5;
                resY = iy - natHeight - gap;
                break;
            case St.Side.TOP:
                resX = cx - natWidth * 0.5;
                resY = iy + ih + gap;
                break;
            case St.Side.LEFT:
                resX = ix + iw + gap;
                resY = cy - natHeight * 0.5;
                break;
            case St.Side.RIGHT:
                resX = ix - natWidth - gap;
                resY = cy - natHeight * 0.5;
                break;
            default:
                resX = cx - natWidth * 0.5;
                resY = iy - natHeight - gap;
                break;
            }

            const monitorIndex = Main.layoutManager?.findIndexForActor?.(this) ??
                Main.layoutManager?.primaryIndex ?? 0;
            const workarea = Main.layoutManager?.getWorkAreaForMonitor?.(monitorIndex);
            if (workarea) {
                const pad = 8;
                resX = Math.max(workarea.x + pad, Math.min(resX, workarea.x + workarea.width - natWidth - pad));
                resY = Math.max(workarea.y + pad, Math.min(resY, workarea.y + workarea.height - natHeight - pad));
            }

            let parent = this.get_parent();
            let success = false;
            let x = resX;
            let y = resY;
            while (!success && parent) {
                try {
                    [success, x, y] = parent.transform_stage_point(resX, resY);
                } catch {
                    success = true;
                    x = resX;
                    y = resY;
                    break;
                }
                if (!success) parent = parent.get_parent();
            }

            allocationBox.set_origin(Math.round(x), Math.round(y));
            if (typeof this.setArrowOrigin === 'function') {
                const arrowOrigin = arrowSide === St.Side.LEFT || arrowSide === St.Side.RIGHT
                    ? Math.round(cy - resY)
                    : Math.round(cx - resX);
                this.setArrowOrigin(arrowOrigin);
            }
        };

        boxPointer._calculateArrowSide = function(arrowSide) {
            const geom = host.getGeom?.();
            const geo = getAnalyticalIconGeometry(item, geom);
            let iy = 0, ih = 48, ix = 0, iw = 48;
            if (geo) {
                ix = geo.ix; iy = geo.iy; iw = geo.iw; ih = geo.ih;
            } else {
                const icon = item?._icon ?? item;
                try {
                    const pos = icon?.get_transformed_position?.() ?? [0, 0];
                    const size = icon?.get_transformed_size?.() ?? [48, 48];
                    ix = pos[0]; iy = pos[1]; iw = size[0]; ih = size[1];
                } catch { /* ignore */ }
            }
            const monitorIndex = Main.layoutManager?.findIndexForActor?.(this) ?? 0;
            const workarea = Main.layoutManager?.getWorkAreaForMonitor?.(monitorIndex);
            const [, , natWidth, natHeight] = this.get_preferred_size();
            const gap = 8;
            if (arrowSide === St.Side.BOTTOM && workarea) {
                if (iy - natHeight - gap < workarea.y && (iy + ih + gap + natHeight <= workarea.y + workarea.height)) {
                    return St.Side.TOP;
                }
            } else if (arrowSide === St.Side.TOP && workarea) {
                if (iy + ih + gap + natHeight > workarea.y + workarea.height && (iy - natHeight - gap >= workarea.y)) {
                    return St.Side.BOTTOM;
                }
            } else if (arrowSide === St.Side.LEFT && workarea) {
                if (ix + iw + gap + natWidth > workarea.x + workarea.width && (ix - natWidth - gap >= workarea.x)) {
                    return St.Side.RIGHT;
                }
            } else if (arrowSide === St.Side.RIGHT && workarea) {
                if (ix - gap - natWidth < workarea.x && (ix + iw + gap + natWidth <= workarea.x + workarea.width)) {
                    return St.Side.LEFT;
                }
            }
            return arrowSide;
        };
    }

    _styleItems() {
        const color = this._menuTextColor;
        if (!color) return;
        for (const item of this._menu?.box?.get_children?.() ?? []) {
            try { item.label?.set_style(`color: ${color}; font-size: ${this._menuTextSize}pt;`); } catch { /* intentionally ignored: menu item label style update failed on disposed actor */ }
        }
    }

    destroy() {
        this._destroyTrashDialog();
        this._trashOperation?.cancel();
        this._trashOperation = null;
        this._timers.removeAll();
        this._closeIdle = 0;
        this._destroyMenu();
        if (this._manager) { try { this._manager.destroy?.(); } catch { /* intentionally ignored: menu or menu manager may already be destroyed */ } this._manager = null; }
        this._host = null;
        this._menuTextColor = null;
        this._menuTextSize = null;
    }
}
