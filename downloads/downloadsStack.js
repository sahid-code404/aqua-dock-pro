// AquaDockPro — the Downloads stack popup controller.
//
// Purpose:   Open the right view (fan / grid / list) over a full-screen click
//            blocker, drive its open/close animation, and tear everything down
//            cleanly. The async file read is generation-guarded so a stack that
//            was closed (or the extension disabled) before the read finished
//            never builds a ghost popup.
// Ownership: OWNS the blocker, the current view, and any "dying" (animating-out)
//            actor. hide() animates then destroys; destroy() is synchronous.
// Cost:      One popup at a time. Enumeration is async (never blocks paint).

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { clamp, logError } from '../core/utils.js';
import { enumerateRecent } from './fileEnumerator.js';
import { FanView } from './fanView.js';
import { PanelView } from './panelView.js';

export class DownloadsStack {
    constructor() {
        this._blocker = null;
        this._view = null;
        this._dying = null;
        this._showGen = 0;
        this._onClose = null;
        this._keyId = 0;
    }

    get isOpen() { return !!(this._blocker || this._view); }

    async show(anchor, folder, cfg, onClose) {
        this._destroyNow();             // clear any lingering popup synchronously
        this._onClose = onClose;
        const gen = ++this._showGen;

        let files;
        try { files = await enumerateRecent(folder); }
        catch (e) { logError(e, 'enumerateRecent'); return; }
        if (gen !== this._showGen) return;        // superseded or destroyed

        const mon = Main.layoutManager.primaryMonitor;
        if (!mon) return;
        const origin = this._origin(anchor);

        const blocker = new St.Widget({ reactive: true, opacity: 0 });
        blocker.set_position(mon.x, mon.y);
        blocker.set_size(mon.width, mon.height);
        blocker.connect('button-press-event', () => { this.hide(); return Clutter.EVENT_STOP; });
        Main.uiGroup.add_child(blocker);
        this._blocker = blocker;

        const max = clamp(cfg.downloadsMaxFiles ?? 11, 3, 11);
        const totalFiles = files.length;
        files = files.slice(0, max);
        const opts = { folder, cfg, mon, origin, close: () => this.hide() };
        let view;
        if (cfg.downloadsView === 'fan') {
            view = new FanView({ ...opts, files, overflow: Math.max(0, totalFiles - max) });
        } else {
            view = new PanelView({ ...opts, files });
        }

        let actor;
        try { actor = view.build(); }
        catch (e) { logError(e, 'downloads view.build'); this.hide(); return; }
        this._view = view;
        this._keyId = actor.connect('key-press-event', (_a, ev) => view.handleKey(ev));
        actor.grab_key_focus();
    }

    hide() {
        this._showGen++;                 // invalidate any pending show
        const view = this._view;
        const blocker = this._blocker;
        const onClose = this._onClose;
        this._view = null;
        this._blocker = null;
        this._onClose = null;
        this._keyId = 0;

        if (blocker) { try { blocker.destroy(); } catch { } }
        if (onClose) { try { onClose(); } catch (e) { logError(e, 'downloads onClose'); } }
        if (!view) return;

        // Kill a previous still-dying actor so we never stack two fades.
        if (this._dying) { this._destroyActor(this._dying); this._dying = null; }
        this._dying = view.actor;
        view.animateClose(() => {
            if (this._dying === view.actor) this._dying = null;
            this._destroyActor(view.actor);
        });
    }

    _destroyNow() {
        if (this._view) { this._destroyActor(this._view.actor); this._view = null; }
        if (this._dying) { this._destroyActor(this._dying); this._dying = null; }
        if (this._blocker) { try { this._blocker.destroy(); } catch { } this._blocker = null; }
    }

    _destroyActor(actor) {
        try { actor?.remove_all_transitions(); actor?.destroy(); } catch { }
    }

    destroy() {
        this._showGen++;
        this._destroyNow();
        this._onClose = null;
    }

    _origin(anchor) {
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
            if (icon) {
                const [ix] = icon.get_transformed_position();
                const [iw] = icon.get_transformed_size();
                cx = ix - tx + iw / 2;
            } else {
                cx = rest ? rx + rest.x + rest.w / 2 : rx + anchor.width / 2;
            }

            // Y: use restRect (the icon's visual top at rest), NOT the icon
            // actor's transformed Y which is the allocation top before pivot
            // scaling and doesn't match the visual position.
            const cy = rest ? ry + rest.y : ry;

            return { x: cx, y: cy };
        } catch {
            const mon = Main.layoutManager.primaryMonitor;
            return { x: (mon?.x ?? 0) + (mon?.width ?? 0) / 2, y: (mon?.y ?? 0) + (mon?.height ?? 0) };
        }
    }
}
