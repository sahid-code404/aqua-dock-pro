// Context menu shared by the fan, grid and list folder-stack views.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { _ } from '../core/i18n.js';
import { clamp, logError } from '../core/utils.js';
import { copyFileToClipboard } from './fileClipboard.js';
import { applyStackMenuPillStyle } from './tileStyle.js';
import {
    isBmsPopupBlurActive,
    isBmsDockBlurActive,
    isBmsMenuBlurActive,
    registerBmsTarget,
    unregisterBmsTarget,
} from '../dock/dockBlur.js';

export class FileItemMenu {
    constructor(mon, cfg) {
        this._mon = mon;
        this._cfg = cfg;
        this._owner = null;
        this._ownerDestroyId = 0;
        this._manager = null;
        this._menu = null;
        this._blurRegistered = false;
        this._itemSignals = [];
    }

    bind(owner) {
        this._owner = owner;
        this._ownerDestroyId = owner.connect('destroy', () => {
            this._ownerDestroyId = 0;
            this._owner = null;
            this.destroy();
        });
    }

    attach(actor, file, activate, anchor = actor) {
        actor._openFileMenu = () => this.openFor(anchor, file);
        actor.set_button_mask((St.ButtonMask.PRIMARY ?? St.ButtonMask.ONE) | (St.ButtonMask.SECONDARY ?? St.ButtonMask.THREE));
        actor.connect('clicked', (_actor, button) => {
            if (button === Clutter.BUTTON_SECONDARY) actor._openFileMenu();
            else if (button === Clutter.BUTTON_PRIMARY) activate?.();
        });
    }

    openFor(actor, file) {
        if (!this._owner) return;
        this._destroyMenu();

        const menu = new PopupMenu.PopupMenu(actor, 0.5, this._sideFor(actor));
        this._menu = menu;
        try {
            menu.actor.name = 'aquaMenu';
            menu.actor.add_style_class_name('aqua-menu');
            menu.actor.add_style_class_name('aqua-file-item-menu');
            const copyItem = menu.addAction(_('Copy'), () => {
                try { copyFileToClipboard(file); }
                catch (error) { logError(error, 'copy folder stack item'); }
            });

            if (!this._manager)
                this._manager = new PopupMenu.PopupMenuManager(this._owner);
            this._manager.addMenu(menu);
            Main.uiGroup.add_child(menu.actor);
            this._styleMenu(menu, [copyItem]);
            this._setupBlur(menu);
            menu.actor.hide();
            menu.open();
        } catch (error) {
            this._destroyMenu();
            throw error;
        }
    }

    _sideFor(actor) {
        // On a vertical dock the stack is mirrored into the screen. Open the
        // menu beyond the filename rather than back across its thumbnail.
        if (this._cfg.position === 'left') return St.Side.LEFT;
        if (this._cfg.position === 'right') return St.Side.RIGHT;
        try {
            const [x] = actor.get_transformed_position();
            const [width] = actor.get_transformed_size();
            const monitorMiddle = this._mon.x + this._mon.width / 2;
            return x + width / 2 > monitorMiddle ? St.Side.RIGHT : St.Side.LEFT;
        } catch {
            return St.Side.RIGHT;
        }
    }

    _styleMenu(menu, actionItems) {
        menu.actor.set_style('min-width: 0; max-width: 220px; -boxpointer-gap: 6px; box-shadow: none;');
        menu.box.x_expand = false;

        const blurActive = isBmsMenuBlurActive(this._cfg);

        const updateHover = () => {
            const isHovered = (actionItems ?? []).some(
                item => item?.hover || item?.active || Boolean(item?.has_key_focus?.())
            );
            applyStackMenuPillStyle(this._cfg, menu.box, actionItems, isHovered, blurActive);
        };

        applyStackMenuPillStyle(this._cfg, menu.box, actionItems, false, blurActive);

        for (const item of actionItems ?? []) {
            if (!item || typeof item.connect !== 'function') continue;
            this._itemSignals.push(
                { actor: item, id: item.connect('notify::hover', updateHover) },
                { actor: item, id: item.connect('notify::active', updateHover) },
                { actor: item, id: item.connect('key-focus-in', updateHover) },
                { actor: item, id: item.connect('key-focus-out', updateHover) }
            );
        }
    }

    _setupBlur(menu) {
        const radius = this._cfg.dlItemRadius ?? clamp(this._cfg.dockRadius ?? 16, 6, 28);
        const blurActive = isBmsMenuBlurActive(this._cfg);
        if (!blurActive) return;

        if (isBmsPopupBlurActive()) return;

        if (isBmsDockBlurActive() && menu?.actor) {
            menu.actor._isAquaDock = true;
            menu.actor.name = 'aquaMenu';
            menu.actor._dockBlurEnabled = true;
            menu.actor._dockBg = menu.box ?? menu.actor;
            menu.actor._dockContent = menu.actor;
            menu.actor._dockContentParent = Main.uiGroup;
            menu.actor._dockRadius = radius;
            menu.actor.get_dock_radius = () => radius;
            if (menu.box) {
                menu.box._dockRadius = radius;
                menu.box.get_dock_radius = () => radius;
            }
            registerBmsTarget(menu.actor, () => radius);
            this._blurRegistered = true;
        }
    }

    _destroyMenu() {
        if (!this._menu) return;
        for (const { actor, id } of this._itemSignals) {
            try { actor?.disconnect(id); } catch { }
        }
        this._itemSignals = [];
        if (this._blurRegistered) {
            unregisterBmsTarget(this._menu.actor);
            this._blurRegistered = false;
        }
        try { this._manager?.removeMenu(this._menu); } catch { }
        try { this._menu.destroy(); } catch { }
        this._menu = null;
    }

    destroy() {
        this._destroyMenu();
        if (this._owner && this._ownerDestroyId) {
            try { this._owner.disconnect(this._ownerDestroyId); } catch { }
        }
        this._ownerDestroyId = 0;
        this._owner = null;
        try { this._manager?.destroy?.(); } catch { }
        this._manager = null;
        this._mon = null;
        this._cfg = null;
    }
}
