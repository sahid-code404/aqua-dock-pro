// Downloads directory watcher, arrival animation, and stack opener.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { TimeoutGroup, animationsEnabled, logError } from '../core/utils.js';
import { _ } from '../core/i18n.js';
import { downloadsDir } from '../services/fileService.js';
import { DownloadsStack } from './downloadsStack.js';

const COOLDOWN_US = 1200 * 1000;
const DEBOUNCE_MS = 80;
const WATCH_RETRY_MS = 5000;
const FLY_DISTANCE = 220;

let sharedWatcher = null;

class DownloadsWatcher {
    constructor() {
        this._callbacks = new Set();
        this._timers = new TimeoutGroup();
        this._monitor = null;
        this._monitorId = 0;
        this._retryId = 0;
    }

    get empty() { return this._callbacks.size === 0; }

    subscribe(callback) {
        this._callbacks.add(callback);
        if (!this._monitor && !this._retryId) this._start();

        let live = true;
        return () => {
            if (!live) return;
            live = false;
            this._callbacks.delete(callback);
            if (this._callbacks.size === 0) this._stop();
        };
    }

    _start() {
        if (this._monitor || this._callbacks.size === 0) return;
        if (this._retryId) {
            this._timers.remove(this._retryId);
            this._retryId = 0;
        }

        let monitor = null;
        try {
            monitor = downloadsDir().monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitorId = monitor.connect('changed', (_m, file, _other, event) => {
                if (event !== Gio.FileMonitorEvent.CREATED &&
                    event !== Gio.FileMonitorEvent.MOVED_IN)
                    return;

                const name = file?.get_basename?.() ?? '';
                if (name.startsWith('.') || name.endsWith('.part') ||
                    name.endsWith('.crdownload') || name.endsWith('.tmp'))
                    return;

                for (const callback of [...this._callbacks]) {
                    try { callback(file); }
                    catch (error) { logError(error, 'downloads subscriber'); }
                }
            });
            this._monitor = monitor;
        } catch (error) {
            if (monitor) monitor.cancel();
            logError(error, 'downloads monitor');
            this._scheduleRetry();
        }
    }

    _scheduleRetry() {
        if (this._retryId || this._callbacks.size === 0) return;
        this._retryId = this._timers.addOnce(WATCH_RETRY_MS, () => {
            this._retryId = 0;
            this._start();
        });
    }

    _stop() {
        if (this._retryId) {
            this._timers.remove(this._retryId);
            this._retryId = 0;
        }
        if (this._monitor) {
            if (this._monitorId) {
                this._monitor.disconnect(this._monitorId);
                this._monitorId = 0;
            }
            this._monitor.cancel();
            this._monitor = null;
        }
        this._timers.removeAll();
    }

    destroy() {
        this._stop();
        this._callbacks.clear();
    }
}

function subscribeDownloads(callback) {
    const watcher = (sharedWatcher ??= new DownloadsWatcher());
    const unsubscribe = watcher.subscribe(callback);
    let live = true;
    return () => {
        if (!live) return;
        live = false;
        unsubscribe();
        if (sharedWatcher === watcher && watcher.empty) {
            watcher.destroy();
            sharedWatcher = null;
        }
    };
}

export class DownloadManager {
    constructor(host) {
        this._host = host;
        this._timers = new TimeoutGroup();
        this._stack = new DownloadsStack(host.getMonitor);
        this._watchUnsubscribe = null;
        this._debounceId = 0;
        this._lastArrivalAt = 0;
        this._flyer = null;
        this._iconQuery = null;
        this._gen = 0;
    }

    get stackOpen() { return this._stack?.isOpen ?? false; }

    enable() {
        if (!this._stack && this._host)
            this._stack = new DownloadsStack(this._host.getMonitor);
        if (!this._host.getConfig().showDownloads || this._watchUnsubscribe) return;
        this._watchUnsubscribe = subscribeDownloads(file => this._scheduleArrival(file));
    }

    openStack(item) {
        this.openFolderStack(item, downloadsDir(), _('Downloads'), item.gicon);
    }

    openFolderStack(item, folder, title = _('Folder'), gicon = null) {
        if (!this._stack && this._host)
            this._stack = new DownloadsStack(this._host.getMonitor);
        if (!this._stack) return;
        const cfg = this._host.getConfig();
        try { item.bounce(Math.round(cfg.bounceHeight * 0.6), { decay: cfg.bounceDecay }); }
        catch { }
        this._stack.show(item, folder, cfg, () => this._host.onStackClosed?.(), { title, gicon });
    }

    closeStack() {
        this._stack?.hide();
    }

    settleAnimations() {
        this._gen++;
        this._iconQuery?.cancel();
        this._iconQuery = null;
        if (this._flyer) {
            try {
                this._flyer.remove_all_transitions();
                this._flyer.destroy();
            } catch { }
            this._flyer = null;
        }
        this._stack?.settleAnimations();
    }

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
        if (!item || !animationsEnabled()) return;
        const cfg = this._host.getConfig();
        const gen = ++this._gen;
        const live = () => (this._gen === gen ? this._host.getDownloadsItem() : null);

        const bounceOnly = target => {
            try {
                target.bounce(cfg.bounceHeight,
                    { state: 'attention', decay: cfg.bounceDecay });
            } catch { }
            this._host.kickEngine?.();
        };

        if (this._host.isHidden?.()) {
            bounceOnly(item);
            return;
        }

        let pos = null;
        try { pos = item.get_transformed_position(); } catch { }
        if (!pos) {
            bounceOnly(item);
            return;
        }

        const size = Math.max(28, Math.round(cfg.iconSize * 0.7));
        const fallback = Gio.ThemedIcon.new('text-x-generic');

        const spawn = gicon => {
            const target = live();
            if (!target || !animationsEnabled()) return;

            let tx, ty;
            try { [tx, ty] = target.get_transformed_position(); }
            catch {
                bounceOnly(target);
                return;
            }

            const ix = Math.round(tx + (target.width - size) / 2);
            const iy = Math.round(ty + (target.height - size) / 2);
            const flyer = new St.Icon({
                gicon: gicon ?? fallback,
                icon_size: size,
                style_class: 'aqua-dl-flyer',
            });
            Main.uiGroup.add_child(flyer);
            this._flyer = flyer;
            flyer.set_position(ix, iy - FLY_DISTANCE);
            flyer.set_scale(1.6, 1.6);
            flyer.opacity = 0;
            flyer.ease({
                opacity: 255,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            flyer.ease({
                x: ix,
                y: iy,
                scale_x: 0.35,
                scale_y: 0.35,
                duration: 460,
                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                onComplete: () => {
                    flyer.ease({
                        opacity: 0,
                        duration: 90,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            if (this._flyer === flyer) this._flyer = null;
                            try { flyer.destroy(); } catch { }
                        },
                    });

                    const folder = live();
                    if (!folder || !animationsEnabled()) return;
                    try {
                        folder.pulseScale(1.18, () => {
                            const current = live();
                            if (current && animationsEnabled()) bounceOnly(current);
                        });
                    } catch { }
                },
            });
        };

        this._iconQuery?.cancel();
        const iconQuery = new Gio.Cancellable();
        this._iconQuery = iconQuery;
        try {
            file.query_info_async(
                'standard::icon',
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                iconQuery,
                (source, result) => {
                    if (this._iconQuery === iconQuery) this._iconQuery = null;
                    if (iconQuery.is_cancelled() || !live()) return;

                    let gicon = null;
                    try { gicon = source.query_info_finish(result)?.get_icon?.(); }
                    catch { }
                    spawn(gicon);
                });
        } catch {
            if (this._iconQuery === iconQuery) this._iconQuery = null;
            spawn(fallback);
        }
    }

    disable() {
        this._gen++;
        this._iconQuery?.cancel();
        this._iconQuery = null;

        if (this._watchUnsubscribe) {
            this._watchUnsubscribe();
            this._watchUnsubscribe = null;
        }
        if (this._debounceId) {
            this._timers.remove(this._debounceId);
            this._debounceId = 0;
        }

        this._timers.removeAll();
        if (this._flyer) {
            try {
                this._flyer.remove_all_transitions();
                this._flyer.destroy();
            } catch { }
            this._flyer = null;
        }
        this._stack?.destroy();
        this._stack = null;
    }

    destroy() {
        this.disable();
        this._host = null;
    }
}
