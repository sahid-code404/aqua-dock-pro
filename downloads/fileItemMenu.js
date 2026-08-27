// Context menu shared by the fan, grid and list folder-stack views.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { _ } from '../core/i18n.js';

export class FileItemMenu {
    constructor(mon, cfg) {
        this._mon = mon;
        this._cfg = cfg;
        this._owner = null;
        this._ownerDestroyId = 0;
        this._manager = null;
        this._menu = null;
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
        actor._openFileMenu = () => this.openFor(anchor, file, activate);
        actor.set_button_mask(St.ButtonMask.ONE | St.ButtonMask.THREE);
        actor.connect('clicked', (_actor, button) => {
            if (button === Clutter.BUTTON_SECONDARY) actor._openFileMenu();
            else if (button === Clutter.BUTTON_PRIMARY) activate?.();
        });
    }

    openFor(actor, _file, activate) {
        if (!this._owner) return;
        this._destroyMenu();

        const menu = new PopupMenu.PopupMenu(actor, 0.5, this._sideFor(actor));
        this._menu = menu;
        try {
            menu.actor.add_style_class_name('aqua-menu');
            menu.actor.add_style_class_name('aqua-file-item-menu');
            const openItem = menu.addAction(_('Open'), () => activate?.());

            if (!this._manager)
                this._manager = new PopupMenu.PopupMenuManager(this._owner);
            this._manager.addMenu(menu);
            Main.uiGroup.add_child(menu.actor);
            this._styleMenu(menu, openItem);
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

    _styleMenu(menu, actionItem) {
        const radius = this._cfg.menuRadius ?? 12;
        const background = this._cfg.highContrast ? 'rgba(0,0,0,0.98)'
            : (this._cfg.menuBg || 'rgba(35,36,40,0.94)');
        const foreground = this._cfg.highContrast ? '#ffffff'
            : (this._cfg.menuFg || 'rgba(235,235,240,0.90)');
        const borderWidth = this._cfg.highContrast ? Math.max(2, this._cfg.menuBorderWidth ?? 1)
            : (this._cfg.menuBorderWidth ?? 1);
        const borderColor = this._cfg.highContrast ? '#ffffff'
            : (this._cfg.menuBorderColor || 'rgba(255,255,255,0.12)');
        const border = borderWidth > 0
            ? `${borderWidth}px solid ${borderColor}` : 'none';

        // Shell's theme gives every popup menu a wide global minimum. This
        // menu contains one short action, so opt its content out explicitly;
        // natural label width still lets translations grow when necessary.
        menu.actor.set_style('min-width: 0; max-width: 220px; -boxpointer-gap: 4px;');
        menu.box.x_expand = false;
        menu.box?.set_style(
            `background-color: ${background}; border-radius: ${radius}px; ` +
            `border: ${border}; min-width: 0; max-width: 220px; padding: 4px 0;`);
        actionItem?.set_style('padding: 6px 10px; margin: 0 4px;');
        const fontSize = (10.5 * (this._cfg.interfaceTextScale ?? 1)).toFixed(2);
        for (const item of menu.box?.get_children?.() ?? [])
            item.label?.set_style(`color: ${foreground}; font-size: ${fontSize}pt;`);
    }

    _destroyMenu() {
        if (!this._menu) return;
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
