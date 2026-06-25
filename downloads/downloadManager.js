// AquaDockPro — Downloads watcher, arrival animation, and stack opener.
//
// Purpose:   Watch ~/Downloads and, when a new file lands, play the arrival
//            sequence on the Downloads icon (a thumbnail flies in → the folder
//            pulses → an attention bounce). Also opens the stack popup on click.
//
//   CRASH-PROOF BY CONSTRUCTION (the old extension froze the whole dock here):
//   • Arrival storms are coalesced — an 80ms debounce + a 1.2s hard cooldown, so
//     bulk landings (unzip, torrent chunks) play AT MOST one animation, never a
//     flood of flyers/bounces that starves the frame clock.
//   • Every async hop (the icon query, each ease onComplete) is GENERATION-
//     GUARDED and re-fetches the LIVE Downloads item: if the dock was rebuilt or
//     disabled in the gap, the callback bails instead of poking a freed actor.
//   • The in-flight flyer is tracked and killed on teardown; the pulse/bounce
//     run through DockItem's crash-safe pulse/Bounce paths (record-only setScale,
//     self-stopping frame clock). A throw can never wedge the compositor.
// Ownership: OWNS the file monitor + its signal, the debounce timer, the flyer,
//            and the DownloadsStack. destroy() releases every one and bumps the
//            generation so pending async callbacks no-op.
// Cost:      Idle except when a file arrives. One coalesced animation per burst.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { TimeoutGroup, logError } from '../core/utils.js';
import { downloadsDir } from '../services/fileService.js';
import { DownloadsStack } from './downloadsStack.js';

const COOLDOWN_US = 1200 * 1000;   // min gap between arrival animations
const DEBOUNCE_MS = 80;            // silence before an arrival burst fires once
const FLY_DISTANCE = 220;

export class DownloadManager {
    // host: { getConfig, getDownloadsItem, isHidden, kickEngine, onStackClosed }
    constructor(host) {
        this._host = host;
        this._timers = new TimeoutGroup();
        this._stack = new DownloadsStack();
        this._monitor = null;
        this._monitorId = 0;
        this._debounceId = 0;
        this._lastArrivalAt = 0;
        this._flyer = null;
        this._gen = 0;     // bumped on every arrival AND on teardown
    }

    get stackOpen() { return this._stack.isOpen; }

    enable() {
        if (!this._host.getConfig().showDownloads) return;
        if (this._monitor) return;
        try {
            this._monitor = downloadsDir().monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitorId = this._monitor.connect('changed', (_m, file, _o, evt) => {
                if (evt !== Gio.FileMonitorEvent.CREATED && evt !== Gio.FileMonitorEvent.MOVED_IN) return;
                const name = file?.get_basename?.() ?? '';
                if (name.startsWith('.') || name.endsWith('.part') ||
                    name.endsWith('.crdownload') || name.endsWith('.tmp')) return;
                this._scheduleArrival(file);
            });
        } catch (e) { logError(e, 'downloads monitor'); }
    }

    openStack(item) {
        const cfg = this._host.getConfig();
        // Bounce the folder as it opens, like a real stack.
        try { item.bounce(Math.round(cfg.bounceHeight * 0.6), { decay: cfg.bounceDecay }); } catch { }
        this._stack.show(item, downloadsDir(), cfg, () => this._host.onStackClosed?.());
    }

    // ── Arrival ───────────────────────────────────────────────────────────────
    _scheduleArrival(file) {
        const now = GLib.get_monotonic_time();
        if (this._lastArrivalAt && now - this._lastArrivalAt < COOLDOWN_US) return;
        if (this._debounceId) this._timers.remove(this._debounceId);
        this._debounceId = this._timers.addOnce(DEBOUNCE_MS, () => {
            this._debounceId = 0;
            this._lastArrivalAt = GLib.get_monotonic_time();
            this._playArrival(file);
        });
    }

    _playArrival(file) {
        const item = this._host.getDownloadsItem();
        if (!item) return;
        const cfg = this._host.getConfig();
        const gen = ++this._gen;
        const live = () => (this._gen === gen ? this._host.getDownloadsItem() : null);

        const bounceOnly = it => {
            try { it.bounce(cfg.bounceHeight, { state: 'attention', decay: cfg.bounceDecay }); } catch { }
            this._host.kickEngine?.();
        };

        // Hidden dock → just bounce (a flyer would draw off-screen artifacts).
        if (this._host.isHidden?.()) { bounceOnly(item); return; }
        let pos = null;
        try { pos = item.get_transformed_position(); } catch { }
        if (!pos) { bounceOnly(item); return; }

        const size = Math.max(28, Math.round(cfg.iconSize * 0.7));
        const fallback = Gio.ThemedIcon.new('text-x-generic');

        const spawn = gicon => {
            const it = live();
            if (!it) return;
            let tx, ty;
            try { [tx, ty] = it.get_transformed_position(); }
            catch { bounceOnly(it); return; }
            const ix = Math.round(tx + (it.width - size) / 2);
            const iy = Math.round(ty + (it.height - size) / 2);

            const flyer = new St.Icon({ gicon: gicon ?? fallback, icon_size: size, style_class: 'aqua-dl-flyer' });
            Main.uiGroup.add_child(flyer);
            this._flyer = flyer;
            flyer.set_position(ix, iy - FLY_DISTANCE);
            flyer.set_scale(1.6, 1.6);
            flyer.opacity = 0;
            flyer.ease({ opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            flyer.ease({
                x: ix, y: iy, scale_x: 0.35, scale_y: 0.35, duration: 460,
                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                onComplete: () => {
                    flyer.ease({
                        opacity: 0, duration: 90, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => { if (this._flyer === flyer) this._flyer = null; try { flyer.destroy(); } catch { } },
                    });
                    const folder = live();
                    if (!folder) return;
                    try {
                        folder.pulseScale(1.18, () => {
                            const b = live();
                            if (b) bounceOnly(b);
                        });
                    } catch { }
                },
            });
        };

        // Async icon query — never blocks the compositor; guarded against staleness.
        try {
            file.query_info_async('standard::icon', Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT, null, (f, res) => {
                    if (!live()) return;
                    let gicon = null;
                    try { gicon = f.query_info_finish(res)?.get_icon?.(); } catch { }
                    spawn(gicon);
                });
        } catch { spawn(fallback); }
    }

    // ── Teardown ────────────────────────────────────────────────────────────
    disable() {
        this._gen++;     // invalidate any in-flight async callbacks
        if (this._debounceId) { this._timers.remove(this._debounceId); this._debounceId = 0; }
        this._timers.removeAll();
        if (this._flyer) { try { this._flyer.remove_all_transitions(); this._flyer.destroy(); } catch { } this._flyer = null; }
        if (this._monitor) {
            if (this._monitorId) { try { this._monitor.disconnect(this._monitorId); } catch { } this._monitorId = 0; }
            try { this._monitor.cancel(); } catch { }
            this._monitor = null;
        }
        this._stack.destroy();
    }

    destroy() {
        this.disable();
        this._host = null;
    }
}
