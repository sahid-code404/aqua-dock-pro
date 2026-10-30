// Downloads directory watcher, arrival animation, and stack opener.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { TimeoutGroup, animationsEnabled, logError } from '../core/utils.js';
import { _ } from '../core/i18n.js';
import { clearIconCaches, downloadsDir, getCachedThemedIcon } from '../services/fileService.js';
import { DownloadsStack } from './downloadsStack.js';
import { invalidateListingCache, prewarmStartupFolders } from './fileEnumerator.js';

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

/**
 * Destroy shared DownloadsWatcher singleton and clear directory monitor.
 * Invoked during extension disable or lifecycle reset.
 */
export function clearDownloadWatcherCache() {
    if (sharedWatcher) {
        try { sharedWatcher.destroy(); }
        catch { /* intentionally ignored: download flyer or watcher may already be destroyed */ }
        sharedWatcher = null;
    }
    clearIconCaches();
}

export class DownloadManager {
    constructor(host) {
        this._host = host;
        this._timers = new TimeoutGroup();
        this._stack = null;
        this._watchUnsubscribe = null;
        this._debounceId = 0;
        this._arrivalDrainId = 0;
        this._arrivalQueue = [];
        this._pendingArrivalUris = new Set();
        this._lastArrivalAt = 0;
        this._lastArrivalUri = null;
        this._flyers = new Set();
        this._iconQuery = null;
        this._gen = 0;
        this._activeItem = null;
        this._prewarmTimerId = 0;
    }

    get stackOpen() { return this._stack?.isOpen ?? false; }
    get activeItem() { return this._activeItem; }
    get anchor() { return this._stack?.anchor ?? this._activeItem; }

    enable() {
        if (!this._stack && this._host)
            this._stack = new DownloadsStack(this._host.getMonitor, () => this._host.getContainer?.());
        const cfg = this._host.getConfig();
        const customUris = [];
        if (cfg.customFolderUri) customUris.push(cfg.customFolderUri);
        if (Array.isArray(cfg.customDockItems)) {
            for (const item of cfg.customDockItems) {
                if (item?.type === 'folder' && item?.uri) customUris.push(item.uri);
            }
        }
        prewarmStartupFolders([downloadsDir(), ...customUris]);
        if (!cfg.showDownloads || this._watchUnsubscribe) return;
        this._watchUnsubscribe = subscribeDownloads(file => this._scheduleArrival(file));
    }

    prewarm(folder = null, cfg = null) {
        if (this._prewarmTimerId) {
            this._timers.remove(this._prewarmTimerId);
            this._prewarmTimerId = 0;
        }
        if (!this._stack && this._host)
            this._stack = new DownloadsStack(this._host.getMonitor, () => this._host.getContainer?.());
        const target = folder ?? downloadsDir();
        const conf = cfg ?? this._host?.getConfig();
        this._stack?.prewarm(target, conf);
    }

    cancelPrewarm() {
        if (this._prewarmTimerId) {
            this._timers.remove(this._prewarmTimerId);
            this._prewarmTimerId = 0;
        }
    }

    openStack(item) {
        this.openFolderStack(item, downloadsDir(), _('Downloads'), item.gicon);
    }

    openFolderStack(item, folder, title = _('Folder'), gicon = null) {
        if (!this._stack && this._host)
            this._stack = new DownloadsStack(this._host.getMonitor, () => this._host.getContainer?.());
        if (!this._stack) return;

        this._host?.hideTooltip?.();

        // Toggle stack if already open for this exact anchor or folder URI
        if (this._stack.isOpen) {
            const folderUri = folder?.get_uri?.() ?? null;
            const isSame = (this._stack.anchor === item) ||
                (this._activeItem === item) ||
                (folderUri && this._stack.currentFolderUri === folderUri);
            this.closeStack();
            if (isSame) return;
        }

        this._activeItem = item;
        const cfg = this._host.getConfig();
        item.setStackOpenState?.(true);
        this._host?.setMagnificationSuppressed?.(true);
        this._host?.setSuppressedItem?.(item);

        this._stack.show(item, folder, cfg, () => {
            if (this._activeItem === item) {
                try { item.setStackOpenState?.(false); } catch { /* intentionally ignored: stack item actor may already be destroyed or unparented */ }
                this._activeItem = null;
            }
            this._host?.setMagnificationSuppressed?.(false);
            this._host?.setSuppressedItem?.(null);
            this._host?.kickEngine?.();
            this._host?.onStackClosed?.();
        }, { title, gicon });
    }

    closeStack() {
        if (this._activeItem) {
            try { this._activeItem.setStackOpenState?.(false); } catch { /* intentionally ignored: stack item actor may already be destroyed or unparented */ }
            this._activeItem = null;
        }
        this._host?.setMagnificationSuppressed?.(false);
        this._host?.setSuppressedItem?.(null);
        this._host?.kickEngine?.();
        this._stack?.hide();
    }

    _destroyFlyer(flyer) {
        if (!flyer) return;
        this._flyers.delete(flyer);
        try {
            flyer.remove_all_transitions();
            flyer.destroy();
        } catch { /* intentionally ignored: download flyer or watcher may already be destroyed */ }
    }

    _destroyAllFlyers() {
        for (const flyer of this._flyers) {
            try {
                flyer.remove_all_transitions();
                flyer.destroy();
            } catch { /* intentionally ignored: download flyer or watcher may already be destroyed */ }
        }
        this._flyers.clear();
    }

    settleAnimations() {
        this._gen++;
        this._iconQuery?.cancel();
        this._iconQuery = null;
        if (this._prewarmTimerId) {
            this._timers.remove(this._prewarmTimerId);
            this._prewarmTimerId = 0;
        }
        this._arrivalQueue.length = 0;
        this._pendingArrivalUris.clear();
        if (this._arrivalDrainId) {
            this._timers.remove(this._arrivalDrainId);
            this._arrivalDrainId = 0;
        }
        this._destroyAllFlyers();
        this._stack?.settleAnimations();
    }

    _scheduleArrival(file) {
        if (!file) return;

        let uri = null;
        try { uri = file.get_uri(); } catch { /* intentionally ignored: file info or URI query failed on deleted file */ }
        if (!uri) return;

        if (this._pendingArrivalUris.has(uri)) return;
        if (this._lastArrivalUri === uri &&
            GLib.get_monotonic_time() - this._lastArrivalAt < COOLDOWN_US)
            return;

        this._pendingArrivalUris.add(uri);
        this._arrivalQueue.push({ file, uri });
        try { invalidateListingCache(file.get_parent()?.get_uri?.()); } catch { /* intentionally ignored: cache invalidation on invalid file parent */ }

        if (this._debounceId) this._timers.remove(this._debounceId);
        this._debounceId = this._timers.addOnce(DEBOUNCE_MS, () => {
            this._debounceId = 0;
            this._drainArrivalQueue();
        });
    }

    _drainArrivalQueue() {
        if (this._arrivalDrainId || !this._arrivalQueue.length) return;

        const now = GLib.get_monotonic_time();
        const wait = this._lastArrivalAt
            ? Math.max(0, COOLDOWN_US - (now - this._lastArrivalAt))
            : 0;
        if (wait > 0) {
            this._arrivalDrainId = this._timers.addOnce(
                Math.max(1, Math.ceil(wait / 1000)),
                () => {
                    this._arrivalDrainId = 0;
                    this._drainArrivalQueue();
                });
            return;
        }

        const next = this._arrivalQueue.shift();
        this._pendingArrivalUris.delete(next.uri);
        this._lastArrivalAt = now;
        this._lastArrivalUri = next.uri;
        this._playArrival(next.file);

        if (this._arrivalQueue.length) {
            this._arrivalDrainId = this._timers.addOnce(
                Math.ceil(COOLDOWN_US / 1000),
                () => {
                    this._arrivalDrainId = 0;
                    this._drainArrivalQueue();
                });
        }
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
            } catch { /* intentionally ignored: stack item bounce or pulse animation failed on disposing item */ }
            this._host.kickEngine?.();
        };

        if (this._host.isHidden?.()) {
            bounceOnly(item);
            return;
        }

        let pos = null;
        try { pos = item.get_transformed_position(); } catch { /* intentionally ignored: transformed position lookup failed on unparented item */ }
        if (!pos) {
            bounceOnly(item);
            return;
        }

        const size = Math.max(28, Math.round(cfg.iconSize * 0.7));
        const fallback = getCachedThemedIcon('text-x-generic');

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
            this._flyers.add(flyer);
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
                            this._destroyFlyer(flyer);
                        },
                    });

                    const folder = live();
                    if (!folder || !animationsEnabled()) return;
                    try {
                        folder.pulseScale(1.18, () => {
                            const current = live();
                            if (current && animationsEnabled()) bounceOnly(current);
                        });
                    } catch { /* intentionally ignored: stack item bounce or pulse animation failed on disposing item */ }
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
                    catch { /* intentionally ignored: file info or URI query failed on deleted file */ }
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
        if (this._prewarmTimerId) {
            this._timers.remove(this._prewarmTimerId);
            this._prewarmTimerId = 0;
        }
        if (this._debounceId) {
            this._timers.remove(this._debounceId);
            this._debounceId = 0;
        }
        if (this._arrivalDrainId) {
            this._timers.remove(this._arrivalDrainId);
            this._arrivalDrainId = 0;
        }

        this._arrivalQueue.length = 0;
        this._pendingArrivalUris.clear();
        this._timers.removeAll();
        this._destroyAllFlyers();
        this._stack?.destroy();
        this._stack = null;
        clearIconCaches();
    }

    destroy() {
        this.disable();
        this._host = null;
    }
}
