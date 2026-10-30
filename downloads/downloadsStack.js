// Controller for the Downloads stack popup views (fan, grid, list).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { clamp, logError } from '../core/utils.js';
import { _ } from '../core/i18n.js';
import { enumerateRecent, prewarmFolderListing } from './fileEnumerator.js';
import { FanView } from './fanView.js';
import { PanelView } from './panelView.js';
import { ActorPool, stopSubtreeTransitions } from './actorPool.js';

export class DownloadsStack {
    constructor(getMonitor, getContainer = null) {
        if (typeof getMonitor === 'object' && getMonitor !== null && !(getMonitor instanceof Function)) {
            this._getMonitor = getMonitor.getMonitor;
            this._getContainer = getMonitor.getContainer ?? null;
        } else {
            this._getMonitor = getMonitor;
            this._getContainer = getContainer;
        }
        this._blocker = null;
        this._view = null;
        this._dying = null;
        this._dyingView = null;
        this._opening = false;
        this._showGen = 0;
        this._onClose = null;
        this._cancellable = null;
        this._anchor = null;
        this._currentFolderUri = null;
        this._pool = new ActorPool(16);
        this._prewarmId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._prewarmId = 0;
            try { this._pool?.prewarm(12); } catch { /* intentionally ignored: pool prewarm failed */ }
            return GLib.SOURCE_REMOVE;
        });
    }

    get isOpen() { return this._opening || !!(this._view || this._dying || (this._blocker && this._blocker.visible)); }
    get view() { return this._view; }
    get blurRegion() { return this._view?.blurRegion ?? null; }
    get anchor() { return this._anchor; }
    get currentFolderUri() { return this._currentFolderUri; }

    prewarm(folder, cfg) {
        if (!folder || !cfg) return;
        const max = clamp(cfg.downloadsMaxFiles ?? 11, 3, 11);
        prewarmFolderListing(folder, cfg.downloadsSort ?? 'newest', max);
    }

    _resolveDockContainer(anchor) {
        try {
            const fromHost = this._getContainer?.();
            if (fromHost) return fromHost;
        } catch { /* intentionally ignored: container lookup failed on disposing host */ }
        let cur = anchor;
        while (cur && cur !== Main.uiGroup) {
            const parent = cur.get_parent?.();
            if (parent === Main.uiGroup) return cur;
            cur = parent;
        }
        try {
            return Main.uiGroup?.find_child_by_name?.('aquaDockContainer') ?? null;
        } catch {
            return null;
        }
    }

    async show(anchor, folder, cfg, onClose, { title = _('Downloads'), gicon = null } = {}) {
        this._destroyNow();             // clear any lingering popup synchronously
        this._onClose = onClose;
        this._anchor = anchor;
        try { this._currentFolderUri = folder?.get_uri?.() ?? null; } catch { this._currentFolderUri = null; }
        const gen = ++this._showGen;
        this._opening = true;
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;

        const max = clamp(cfg.downloadsMaxFiles ?? 11, 3, 11);
        let listing;
        try {
            listing = await enumerateRecent(
                folder, cancellable, cfg.downloadsSort, max);
        }
        catch (e) {
            logError(e, 'enumerateRecent');
            if (gen === this._showGen) this.hide();
            else if (this._anchor !== anchor) {
                try { anchor.setStackOpenState?.(false, false); } catch { /* intentionally ignored */ }
            }
            return;
        }
        if (gen !== this._showGen) {
            if (this._anchor !== anchor) {
                try { anchor.setStackOpenState?.(false, false); } catch { /* intentionally ignored */ }
            }
            return;        // superseded or destroyed
        }
        if (listing.error) {
            this._cancellable = null;
            if (!cancellable.is_cancelled())
                logError(listing.error, 'enumerateRecent');
            if (gen === this._showGen) this.hide();
            else if (this._anchor !== anchor) {
                try { anchor.setStackOpenState?.(false, false); } catch { /* intentionally ignored */ }
            }
            return;
        }
        this._cancellable = null;

        const mon = this._getMonitor?.();
        if (!mon) {
            this.hide();
            try { anchor.setStackOpenState?.(false, false); } catch { /* intentionally ignored */ }
            return;
        }
        const origin = this._origin(anchor, mon, cfg);
        const dockContainer = this._resolveDockContainer(anchor);

        let blocker = this._blocker;
        if (!blocker || blocker.is_destroyed?.()) {
            blocker = new St.Widget({ reactive: true, opacity: 0 });
            blocker.connect('button-press-event', () => { this.hide(); return Clutter.EVENT_STOP; });
            this._blocker = blocker;
        }
        blocker.set_position(mon.x, mon.y);
        blocker.set_size(mon.width, mon.height);
        blocker.visible = true;
        blocker.opacity = 0;
        const bParent = blocker.get_parent?.();
        if (bParent !== Main.uiGroup) {
            if (bParent) {
                try { bParent.remove_child(blocker); } catch { /* intentionally ignored: blocker unparenting failed */ }
            }
            if (dockContainer && typeof Main.uiGroup?.insert_child_below === 'function') {
                Main.uiGroup.insert_child_below(blocker, dockContainer);
            } else if (Main.uiGroup?.add_child) {
                Main.uiGroup.add_child(blocker);
            }
        }
        this._opening = false;

        const files = listing.files;
        const totalFiles = listing.total;
        const opts = {
            folder,
            files,
            totalFiles,
            cfg,
            mon,
            origin,
            title,
            gicon,
            dockContainer,
            pool: this._pool,
            close: () => this.hide(),
        };
        let view;
        if (cfg.downloadsView === 'fan') {
            view = new FanView({ ...opts, overflow: Math.max(0, totalFiles - max) });
        } else {
            view = new PanelView(opts);
        }

        let actor;
        this._view = view;
        try {
            actor = view.build();
            actor.connect('key-press-event', (_a, ev) => view.handleKey(ev));
            actor.grab_key_focus();
        }
        catch (e) {
            logError(e, 'downloads view.build');
            this._destroyNow();
            const close = this._onClose;
            this._onClose = null;
            if (close) { try { close(); } catch (error) { logError(error, 'downloads onClose'); } }
            return;
        }
    }

    hide() {
        this._showGen++;                 // invalidate any pending show
        this._cancellable?.cancel();
        this._cancellable = null;
        this._opening = false;
        const view = this._view;
        const onClose = this._onClose;
        this._view = null;
        this._onClose = null;

        if (this._blocker && !this._blocker.is_destroyed?.()) {
            this._blocker.visible = false;
        }
        if (onClose) { try { onClose(); } catch (e) { logError(e, 'downloads onClose'); } }
        if (!view) {
            this._anchor = null;
            this._currentFolderUri = null;
            return;
        }

        // Kill a previous still-dying actor so we never stack two fades.
        if (this._dying) {
            try { this._dyingView?.settleAnimations?.(); } catch { /* intentionally ignored: view animation settlement failed during stack closing */ }
            this._dyingView?.releaseRows?.();
            this._destroyActor(this._dying);
            this._dying = null;
            this._dyingView = null;
        }
        this._dying = view.actor;
        this._dyingView = view;
        const dyingAnchor = this._anchor;
        view.animateClose(() => {
            if (this._dying === view.actor) {
                this._dying = null;
                this._dyingView = null;
                if (this._anchor === dyingAnchor) {
                    this._anchor = null;
                    this._currentFolderUri = null;
                }
            }
            this._destroyActor(view.actor);
        });
    }

    settleAnimations() {
        try { this._view?.settleAnimations?.(); } catch { /* intentionally ignored: view animation settlement failed during stack closing */ }
        if (this._dying) {
            try { this._dyingView?.settleAnimations?.(); } catch { /* intentionally ignored: view animation settlement failed during stack closing */ }
            this._dyingView?.releaseRows?.();
            this._destroyActor(this._dying);
            this._dying = null;
            this._dyingView = null;
        }
    }

    _destroyNow() {
        this._opening = false;
        this._anchor = null;
        this._currentFolderUri = null;
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._view) {
            try { this._view.settleAnimations?.(); } catch { /* intentionally ignored: view animation settlement failed during synchronous destroy */ }
            this._view.releaseRows?.();
            this._destroyActor(this._view.actor);
            this._view = null;
        }
        if (this._dying) {
            try { this._dyingView?.settleAnimations?.(); } catch { /* intentionally ignored: view animation settlement failed during synchronous destroy */ }
            this._dyingView?.releaseRows?.();
            this._destroyActor(this._dying);
            this._dying = null;
            this._dyingView = null;
        }
        if (this._blocker && !this._blocker.is_destroyed?.()) {
            this._blocker.visible = false;
        }
    }

    _destroyActor(actor) {
        if (!actor || actor.is_destroyed?.()) return;
        try { stopSubtreeTransitions(actor); actor.destroy(); } catch { /* intentionally ignored: modal blocker or stack view actor may already be destroyed */ }
    }

    destroy() {
        if (this._prewarmId) {
            GLib.source_remove(this._prewarmId);
            this._prewarmId = 0;
        }
        this._showGen++;
        this._destroyNow();
        if (this._blocker) {
            try { this._blocker.destroy(); } catch { /* intentionally ignored: modal blocker actor may already be destroyed */ }
            this._blocker = null;
        }
        this._pool?.clear();
        this._pool = null;
        this._onClose = null;
        this._getMonitor = null;
        this._getContainer = null;
    }

    _origin(anchor, mon, cfg) {
        try {
            const [ax, ay] = anchor.get_transformed_position();
            const tx = anchor.translation_x || 0;
            const ty = anchor.translation_y || 0;
            const rx = ax - tx;
            const ry = ay - ty;
            const rest = anchor._restRect;

            // X: use the icon actor's transformed center for pixel-perfect
            // horizontal centering (avoids rounding drift from restRect math).
            let cx;
            const icon = anchor._icon;
            if (rest) {
                cx = rx + rest.x + rest.w / 2;
            } else if (icon) {
                const [ix] = icon.get_transformed_position();
                const [iw] = icon.get_transformed_size();
                cx = ix - tx + iw / 2;
            } else {
                cx = rx + anchor.width / 2;
            }

            // Y: use restRect (the icon's visual top at rest), NOT the icon
            // actor's transformed Y which is the allocation top before pivot
            // scaling and doesn't match the visual position.
            const cy = rest
                ? ry + rest.y + (cfg.vertical ? rest.h / 2 : 0)
                : ry + (cfg.vertical ? anchor.height / 2 : 0);

            return { x: cx, y: cy };
        } catch {
            return {
                x: (mon?.x ?? 0) + (mon?.width ?? 0) / 2,
                y: cfg.vertical
                    ? (mon?.y ?? 0) + (mon?.height ?? 0) / 2
                    : (mon?.y ?? 0) + (mon?.height ?? 0),
            };
        }
    }
}
