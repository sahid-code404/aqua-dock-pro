// AquaDockPro — context-menu lifecycle.
//
// Purpose:   Own the right-click popup: create it anchored to the icon, style it
//            from config, hold the icon magnified while it's open, and tear it
//            down cleanly on close (including the re-check of autohide, since the
//            menu's input grab swallows the dock's leave-event). Content comes
//            from menuActions; this file is pure lifecycle + the PopupMenuManager
//            that makes it behave like a native menu (click-away / Escape close).
// Ownership: OWNS the current PopupMenu, its open-state signal, the close idle,
//            and the shared PopupMenuManager. close()/destroy() release all.
// Cost:      One menu lives at a time. No per-frame cost.


import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { populateMenu } from './menuActions.js';
import { TimeoutGroup } from '../core/utils.js';

export class MenuManager {
    // host: { container, getConfig, getGeom, onOpen, onClose, holdItem(item),
    //         releaseHold(), onTrashEmptied }
    constructor(host) {
        this._host = host;
        this._timers = new TimeoutGroup();
        this._menu = null;
        this._manager = null;
        this._stateId = 0;
        this._closeIdle = 0;
    }

    get active() { return this._active === true; }

    openFor(item) {
        this._destroyMenu();

        const geom = this._host.getGeom();
        const side = geom?.vert
            ? (geom.side === 'left' ? St.Side.LEFT : St.Side.RIGHT)
            : St.Side.BOTTOM;
        const anchor = item._icon ?? item;

        this._menu = new PopupMenu.PopupMenu(anchor, 0.5, side);
        this._menu.actor.add_style_class_name('aqua-menu');
        if (!this._manager) this._manager = new PopupMenu.PopupMenuManager(this._host.container);
        this._manager.addMenu(this._menu);
        Main.uiGroup.add_child(this._menu.actor);
        this._style();
        this._menu.actor.hide();

        this._host.holdItem?.(item);

        this._stateId = this._menu.connect('open-state-changed', (m, open) => {
            this._active = open;
            if (open) {
                this._host.onOpen?.();
                return;
            }
            this._host.releaseHold?.();
            this._scheduleClose(m);
        });

        populateMenu(this._menu, item.entry, this._host.onTrashEmptied);
        this._menu.open();
    }

    _scheduleClose(m) {
        if (this._closeIdle) { this._timers.remove(this._closeIdle); this._closeIdle = 0; }
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

    _destroyMenu() {
        if (!this._menu) return;
        if (this._stateId) { try { this._menu.disconnect(this._stateId); } catch { } this._stateId = 0; }
        try { this._manager?.removeMenu(this._menu); } catch { }
        try { this._menu.destroy(); } catch { }
        this._menu = null;
        this._active = false;
    }

    _style() {
        const cfg = this._host.getConfig();
        const radius = cfg.menuRadius ?? 12;
        const bg = cfg.menuBg || 'rgba(35,36,40,0.94)';
        const fg = cfg.menuFg || 'rgba(235,235,240,0.90)';
        const bw = cfg.menuBorderWidth ?? 1;
        const bc = cfg.menuBorderColor || 'rgba(255,255,255,0.12)';
        const border = bw > 0 ? `${bw}px solid ${bc}` : 'none';

        const box = this._menu.box;
        if (box) box.set_style(`background-color: ${bg}; border-radius: ${radius}px; border: ${border};`);

        // Colour items added after this point (all of them — open() runs later).
        if (!this._menu._aquaStyleHooked) {
            this._menu._aquaStyleHooked = true;
            const orig = this._menu.addAction.bind(this._menu);
            this._menu.addAction = (label, cb, icon) => {
                const itm = orig(label, cb, icon);
                try { itm?.label?.set_style(`color: ${fg};`); } catch { }
                return itm;
            };
        }
    }

    destroy() {
        this._timers.removeAll();
        this._closeIdle = 0;
        this._destroyMenu();
        if (this._manager) { try { this._manager.destroy?.(); } catch { } this._manager = null; }
        this._host = null;
    }
}
