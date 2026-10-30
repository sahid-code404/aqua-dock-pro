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

    attach(actor, file, activate, anchor = null) {
        actor._openFileMenu = () => {
            const targetAnchor = anchor ?? actor?._labelPill ?? actor;
            this.openFor(targetAnchor, file);
        };
        actor.set_button_mask((St.ButtonMask.PRIMARY ?? St.ButtonMask.ONE) | (St.ButtonMask.SECONDARY ?? St.ButtonMask.THREE));
        actor.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                actor._openFileMenu();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        actor.connect('clicked', (_actor, button) => {
            if (button === Clutter.BUTTON_SECONDARY) actor._openFileMenu();
            else if (button === Clutter.BUTTON_PRIMARY) activate?.();
        });
    }

    openFor(actor, file) {
        if (!this._owner) return;
        this._destroyMenu();

        const anchor = actor?._labelPill ?? actor;
        const side = this._sideFor(anchor);
        const menu = new PopupMenu.PopupMenu(anchor, 0.5, side);
        this._menu = menu;
        try {
            menu.actor.name = 'aquaMenu';
            menu.actor.add_style_class_name('aqua-menu');
            menu.actor.add_style_class_name('aqua-file-item-menu');
            const copyItem = menu.addAction(_('Copy'), () => {
                try { copyFileToClipboard(file); }
                catch (error) { logError(error, 'copy folder stack item'); }
            });

            if (copyItem._ornamentIcon) {
                try {
                    copyItem._ornamentIcon.destroy();
                    copyItem._ornamentIcon = null;
                } catch { /* intentionally ignored: context menu actor may already be destroyed */ }
            }

            copyItem.x_expand = true;
            copyItem.y_expand = true;
            if (typeof copyItem.set_x_align === 'function') copyItem.set_x_align(Clutter.ActorAlign.FILL);
            if (typeof copyItem.set_y_align === 'function') copyItem.set_y_align(Clutter.ActorAlign.FILL);

            if (copyItem.label) {
                copyItem.label.x_expand = true;
                copyItem.label.y_expand = true;
                if (typeof copyItem.label.set_x_align === 'function') copyItem.label.set_x_align(Clutter.ActorAlign.CENTER);
                if (typeof copyItem.label.set_y_align === 'function') copyItem.label.set_y_align(Clutter.ActorAlign.CENTER);
                const ct = copyItem.label.clutter_text;
                if (ct) {
                    ct.set_line_wrap(false);
                    ct.set_ellipsize(0);
                    if (typeof ct.set_x_align === 'function') ct.set_x_align(Clutter.ActorAlign.CENTER);
                    if (typeof ct.set_y_align === 'function') ct.set_y_align(Clutter.ActorAlign.CENTER);
                }
            }

            if (!this._manager)
                this._manager = new PopupMenu.PopupMenuManager(this._owner);
            this._manager.addMenu(menu);
            Main.uiGroup.add_child(menu.actor);
            menu.connect('open-state-changed', (_m, open) => {
                if (!open)
                    this._destroyMenu();
            });
            this._styleMenu(menu, [copyItem], anchor);
            this._setupBlur(menu);
            this._setupAnchorAlignment(menu, anchor);
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

    _styleMenu(menu, actionItems, anchor = null) {
        menu.actor.set_style(
            'min-width: 0; max-width: 220px; -boxpointer-gap: 8px; ' +
            '-arrow-rise: 0px; -arrow-base: 0px; -arrow-border-width: 0px; -arrow-border-radius: 0px; ' +
            'box-shadow: none; background-color: transparent !important; border: none !important;'
        );
        menu.box.x_expand = false;

        const targetHeight = anchor ? Math.max(28, Math.round(anchor.height || anchor.get_height?.() || 0)) : 0;
        const blurActive = isBmsMenuBlurActive(this._cfg);

        const updateHover = () => {
            const isHovered = (actionItems ?? []).some(
                item => item?.hover || item?.active || Boolean(item?.has_key_focus?.())
            );
            applyStackMenuPillStyle(this._cfg, menu.box, actionItems, isHovered, blurActive, targetHeight);
        };

        applyStackMenuPillStyle(this._cfg, menu.box, actionItems, false, blurActive, targetHeight);

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

    _setupAnchorAlignment(menu, anchor) {
        const boxPointer = menu._boxPointer ?? menu.actor;
        if (!boxPointer) return;

        boxPointer._reposition = function(allocationBox) {
            const sourceActor = this._sourceActor ?? anchor;
            if (!sourceActor) return;

            const monitorIndex = Main.layoutManager?.findIndexForActor?.(sourceActor) ?? 0;
            const workarea = Main.layoutManager?.getWorkAreaForMonitor?.(monitorIndex);

            let pillStageX = 0, pillStageY = 0;
            let pillW = 0, pillH = 0;
            try {
                [pillStageX, pillStageY] = sourceActor.get_transformed_position();
                [pillW, pillH] = sourceActor.get_transformed_size();
            } catch {
                const alloc = sourceActor.get_allocation_box();
                pillStageX = alloc.x1;
                pillStageY = alloc.y1;
                pillW = alloc.get_width();
                pillH = alloc.get_height();
            }

            const pillCenterX = pillStageX + pillW / 2;
            const pillCenterY = pillStageY + pillH / 2;

            const [, , natWidth, natHeight] = this.get_preferred_size();
            const gap = 8;

            let resX = 0;
            let resY = 0;

            switch (this._arrowSide) {
            case St.Side.RIGHT:
                resX = pillStageX - natWidth - gap;
                resY = pillCenterY - natHeight / 2;
                break;
            case St.Side.LEFT:
                resX = pillStageX + pillW + gap;
                resY = pillCenterY - natHeight / 2;
                break;
            case St.Side.TOP:
                resX = pillCenterX - natWidth / 2;
                resY = pillStageY + pillH + gap;
                break;
            case St.Side.BOTTOM:
                resX = pillCenterX - natWidth / 2;
                resY = pillStageY - natHeight - gap;
                break;
            default:
                resX = pillStageX - natWidth - gap;
                resY = pillCenterY - natHeight / 2;
                break;
            }

            if (workarea) {
                resX = clamp(resX, workarea.x + 8, workarea.x + workarea.width - natWidth - 8);
                resY = clamp(resY, workarea.y + 8, workarea.y + workarea.height - natHeight - 8);
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
                this.setArrowOrigin(Math.round(natHeight / 2));
            }
        };

        boxPointer._calculateArrowSide = function(arrowSide) {
            const sourceActor = this._sourceActor ?? anchor;
            if (!sourceActor) return arrowSide;
            let stageX = 0, pillW = 0;
            try {
                [stageX] = sourceActor.get_transformed_position();
                [pillW] = sourceActor.get_transformed_size();
            } catch {
                return arrowSide;
            }
            const [, , natWidth] = this.get_preferred_size();
            const gap = 8;
            const monitorIndex = Main.layoutManager?.findIndexForActor?.(sourceActor) ?? 0;
            const workarea = Main.layoutManager?.getWorkAreaForMonitor?.(monitorIndex);
            if (!workarea) return arrowSide;

            switch (arrowSide) {
            case St.Side.LEFT:
                if (stageX + pillW + gap + natWidth > workarea.x + workarea.width &&
                    stageX - natWidth - gap >= workarea.x)
                    return St.Side.RIGHT;
                break;
            case St.Side.RIGHT:
                if (stageX - natWidth - gap < workarea.x &&
                    stageX + pillW + gap + natWidth <= workarea.x + workarea.width)
                    return St.Side.LEFT;
                break;
            }
            return arrowSide;
        };
    }

    _setupBlur(menu) {
        const radius = this._cfg.dlItemRadius ?? clamp(this._cfg.dockRadius ?? 16, 6, 28);
        const blurActive = isBmsMenuBlurActive(this._cfg);
        if (!blurActive) return;

        if (isBmsPopupBlurActive()) return;

        if (isBmsDockBlurActive() && menu?.actor) {
            menu.actor._isAquaDock = true;
            menu.actor._blurType = 'popup';
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
            try { actor?.disconnect(id); } catch { /* intentionally ignored: menu signal handler may already be disconnected */ }
        }
        this._itemSignals = [];
        if (this._blurRegistered) {
            unregisterBmsTarget(this._menu.actor);
            this._blurRegistered = false;
        }
        try { this._manager?.removeMenu(this._menu); } catch { /* intentionally ignored: menu may already be removed from manager */ }
        try { this._menu.destroy(); } catch { /* intentionally ignored: context menu actor may already be destroyed */ }
        this._menu = null;
    }

    destroy() {
        this._destroyMenu();
        if (this._owner && this._ownerDestroyId) {
            try { this._owner.disconnect(this._ownerDestroyId); } catch { /* intentionally ignored: menu signal handler may already be disconnected */ }
        }
        this._ownerDestroyId = 0;
        this._owner = null;
        try { this._manager?.destroy?.(); } catch { /* intentionally ignored: context menu actor may already be destroyed */ }
        this._manager = null;
        this._mon = null;
        this._cfg = null;
    }
}
