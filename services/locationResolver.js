// Asynchronous metadata/icon lookup for files and folder stacks.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { TimeoutGroup, logError } from '../core/utils.js';

const ATTRIBUTES = [
    Gio.FILE_ATTRIBUTE_STANDARD_DISPLAY_NAME,
    Gio.FILE_ATTRIBUTE_STANDARD_ICON,
    'metadata::custom-icon',
    'metadata::custom-icon-name',
].join(',');
const FAILURE_RETRY_US = 15 * GLib.USEC_PER_SEC;

function customIcon(info) {
    const value = info.get_attribute_string('metadata::custom-icon')?.trim();
    if (value) {
        try {
            const file = value.includes('://')
                ? Gio.File.new_for_uri(value)
                : Gio.File.new_for_path(value);
            return Gio.FileIcon.new(file);
        } catch { }
    }
    const iconName = info.get_attribute_string('metadata::custom-icon-name')?.trim();
    return iconName ? Gio.ThemedIcon.new(iconName) : null;
}

export class LocationResolver {
    constructor(onChanged = null) {
        this._listeners = new Set();
        if (onChanged) this._listeners.add(onChanged);
        this._cache = new Map();
        this._pending = new Map();
        this._failedAt = new Map();
        this._timers = new TimeoutGroup();
        this._notifyId = 0;
        this._generation = 1;
    }

    subscribe(onChanged) {
        if (typeof onChanged !== 'function') return () => {};
        this._listeners.add(onChanged);
        let live = true;
        return () => {
            if (!live) return;
            live = false;
            this._listeners.delete(onChanged);
        };
    }

    resolve(uri, fallbackName, fallbackIcon) {
        const cached = this._cache.get(uri);
        if (cached) return cached;
        this._query(uri, fallbackName, fallbackIcon);
        return { name: fallbackName, gicon: fallbackIcon };
    }

    _query(uri, fallbackName, fallbackIcon) {
        if (!uri || this._pending.has(uri)) return;

        const failedAt = this._failedAt.get(uri);
        if (failedAt !== undefined) {
            if (GLib.get_monotonic_time() - failedAt < FAILURE_RETRY_US) return;
            this._failedAt.delete(uri);
        }

        let file;
        try { file = Gio.File.new_for_uri(uri); }
        catch { return; }

        const cancellable = new Gio.Cancellable();
        const generation = this._generation;
        this._pending.set(uri, cancellable);
        try {
            file.query_info_async(
                ATTRIBUTES,
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (source, result) => {
                    if (this._pending.get(uri) === cancellable)
                        this._pending.delete(uri);
                    if (generation !== this._generation || cancellable.is_cancelled()) return;

                    let info;
                    try { info = source.query_info_finish(result); }
                    catch {
                        this._failedAt.set(uri, GLib.get_monotonic_time());
                        return;
                    }

                    this._failedAt.delete(uri);
                    const next = {
                        name: info.get_display_name() || fallbackName,
                        gicon: customIcon(info) || info.get_icon() || fallbackIcon,
                    };
                    this._cache.set(uri, next);
                    this._queueChanged();
                });
        } catch {
            this._pending.delete(uri);
            this._failedAt.set(uri, GLib.get_monotonic_time());
        }
    }

    _queueChanged() {
        if (this._notifyId) return;
        this._notifyId = this._timers.addIdle(() => {
            this._notifyId = 0;
            for (const listener of [...this._listeners]) {
                try { listener(); }
                catch (error) { logError(error, 'LocationResolver listener'); }
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this._generation++;
        for (const cancellable of this._pending.values()) cancellable.cancel();
        this._pending.clear();
        this._timers.removeAll();
        this._notifyId = 0;
        this._cache.clear();
        this._failedAt.clear();
        this._listeners.clear();
    }
}
