// Context menu lifecycle and item action orchestration.


import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { populateMenu } from './menuActions.js';
import { appWindowsForConfig, TimeoutGroup } from '../core/utils.js';
import { _, format, ngettext } from '../core/i18n.js';
import { emptyTrash } from '../services/fileService.js';
import { notifyUser } from '../compat/shell.js';

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
    }

    get active() { return this._active === true; }
    get heldItem() { return this._heldItem; }

    openFor(item) {
        this._destroyMenu();

        const geom = this._host.getGeom();
        const side = geom?.vert
            ? (geom.side === 'left' ? St.Side.LEFT : St.Side.RIGHT)
            : St.Side.BOTTOM;
        const anchor = item._icon ?? item;

        this._menu = new PopupMenu.PopupMenu(anchor, 0.5, side);
        try {
            this._menu.actor.add_style_class_name('aqua-menu');
            if (!this._manager)
                this._manager = new PopupMenu.PopupMenuManager(this._host.container);
            this._manager.addMenu(this._menu);
            Main.uiGroup.add_child(this._menu.actor);
            this._style();
            this._menu.actor.hide();

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

    _scheduleClose(m) {
        this._cancelCloseIdle();
        this._closeIdle = this._timers.addIdle(() => {
            this._closeIdle = 0;
            if (this._menu === m) this._destroyMenu();
            this._host.onClose?.();
            return false;
        });
    }

    close() {
        try { this._menu?.close(); } catch { }
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
        if (this._stateId) { try { this._menu.disconnect(this._stateId); } catch { } this._stateId = 0; }
        try { this._manager?.removeMenu(this._menu); } catch { }
        try { this._menu.destroy(); } catch { }
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
        try { this._trashDialog.close(); } catch { }
        this._trashDialog = null;
    }

    _style() {
        const cfg = this._host.getConfig();
        const radius = cfg.menuRadius ?? 12;
        const bg = cfg.highContrast ? 'rgba(0,0,0,0.98)'
            : (cfg.menuBg || 'rgba(35,36,40,0.94)');
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

    _styleItems() {
        const color = this._menuTextColor;
        if (!color) return;
        for (const item of this._menu?.box?.get_children?.() ?? []) {
            try { item.label?.set_style(`color: ${color}; font-size: ${this._menuTextSize}pt;`); } catch { }
        }
    }

    destroy() {
        this._destroyTrashDialog();
        this._trashOperation?.cancel();
        this._trashOperation = null;
        this._timers.removeAll();
        this._closeIdle = 0;
        this._destroyMenu();
        if (this._manager) { try { this._manager.destroy?.(); } catch { } this._manager = null; }
        this._host = null;
        this._menuTextColor = null;
        this._menuTextSize = null;
    }
}
