// Asynchronous metadata/icon lookup for files and folder stacks.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const ATTRIBUTES = [
    Gio.FILE_ATTRIBUTE_STANDARD_DISPLAY_NAME,
    Gio.FILE_ATTRIBUTE_STANDARD_ICON,
    'metadata::custom-icon',
    'metadata::custom-icon-name',
].join(',');

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
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._cache = new Map();
        this._pending = new Map();
        this._failed = new Set();
        this._generation = 1;
    }

    resolve(uri, fallbackName, fallbackIcon) {
        const cached = this._cache.get(uri);
        if (cached) return cached;
        this._query(uri, fallbackName, fallbackIcon);
        return { name: fallbackName, gicon: fallbackIcon };
    }

    _query(uri, fallbackName, fallbackIcon) {
        if (!uri || this._pending.has(uri) || this._failed.has(uri)) return;
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
                    catch { this._failed.add(uri); return; }
                    const next = {
                        name: info.get_display_name?.() || fallbackName,
                        gicon: customIcon(info) || info.get_icon?.() || fallbackIcon,
                    };
                    this._cache.set(uri, next);
                    this._onChanged?.();
                });
        } catch {
            this._pending.delete(uri);
            this._failed.add(uri);
        }
    }

    destroy() {
        this._generation++;
        for (const cancellable of this._pending.values()) cancellable.cancel();
        this._pending.clear();
        this._cache.clear();
        this._failed.clear();
        this._onChanged = null;
    }
}
