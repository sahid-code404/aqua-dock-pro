// Filesystem utilities for Downloads and Trash operations.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { logError } from '../core/utils.js';

// Promisify the async Gio calls used below (idempotent at module load).
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.File.prototype, 'delete_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');

/**
 * Resolves the user's standard XDG Downloads directory as a Gio.File instance.
 *
 * @returns {Gio.File} GIO file object for the downloads directory.
 */
export function downloadsDir() {
    const path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ??
        GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']);
    return Gio.File.new_for_path(path);
}

/**
 * Resolves the URI string corresponding to the user's standard XDG Downloads directory.
 *
 * @returns {string} File URI string (e.g. 'file:///home/user/Downloads').
 */
export function downloadsUri() {
    return downloadsDir().get_uri();
}

// Use GIO's virtual Trash backend instead of assuming every trashed item lives
// in $XDG_DATA_HOME/Trash. The same URI is what the dock opens, so state and
// Empty Trash cover mounted-volume trash backends as well when GIO exposes
// them through the desktop Trash implementation.
/**
 * Returns a Gio.File instance pointing to the desktop Trash backend ('trash:///').
 *
 * @returns {Gio.File} GIO file object representing the trash location.
 */
export function trashDir() {
    return Gio.File.new_for_uri('trash:///');
}

/**
 * Asynchronously determines whether the desktop Trash contains at least one item.
 *
 * @param {Gio.Cancellable|null} [cancellable=null] - Optional operation cancellable.
 * @returns {Promise<boolean>} True if trash contains at least one file or folder.
 */
export async function trashHasFiles(cancellable = null) {
    let en;
    try {
        en = await trashDir().enumerate_children_async(
            'standard::name', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT, cancellable);
    } catch (error) {
        if (error.matches?.(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND))
            return false;
        throw error;
    }
    try {
        const entries = await en.next_files_async(1, GLib.PRIORITY_DEFAULT, cancellable);
        return entries.length > 0;
    } finally {
        try { await en.close_async(GLib.PRIORITY_DEFAULT, null); } catch { /* intentionally ignored: enumerator stream may already be closed */ }
    }
}

// Use the same native GIO operation exposed by `gio trash --empty` instead of
// recursively deleting children of trash:///. The latter can fail on some
// Trash backends even though the native GIO operation succeeds.
// The returned cancellable lets the owning controller stop the in-flight wait
// and terminate the helper process during teardown.
/**
 * Asynchronously empties the desktop Trash using the native GIO helper process ('gio trash --empty').
 *
 * @param {Function|null} [onDone=null] - Optional callback receiving ({ deleted: number, failed: number, cancelled: boolean }).
 * @returns {Gio.Cancellable} Cancellable allowing caller to terminate the process during teardown.
 */
export function emptyTrash(onDone = null) {
    const cancellable = new Gio.Cancellable();
    const result = { deleted: 0, failed: 0, cancelled: false };
    const gioPath = GLib.find_program_in_path('gio');

    if (!gioPath) {
        result.failed = 1;
        logError(new Error('gio executable not found in PATH'), 'emptyTrash');
        try { onDone?.(result); }
        catch (error) { logError(error, 'emptyTrash completion'); }
        return cancellable;
    }

    let process;
    let cancelId = 0;
    try {
        process = Gio.Subprocess.new(
            [gioPath, 'trash', '--empty'],
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
        );

        cancelId = cancellable.connect(() => {
            try { process.force_exit(); } catch { /* intentionally ignored: subprocess may already have terminated */ }
        });

        process.wait_check_async(cancellable, (_process, asyncResult) => {
            if (cancelId) {
                try { cancellable.disconnect(cancelId); } catch { /* intentionally ignored: cancellable signal handler may already be disconnected */ }
                cancelId = 0;
            }

            result.cancelled = cancellable.is_cancelled();
            if (!result.cancelled) {
                try {
                    const ok = process.wait_check_finish(asyncResult);
                    result.failed = ok ? 0 : 1;
                    if (!ok)
                        logError(new Error('gio trash --empty failed'), 'emptyTrash');
                } catch (error) {
                    result.failed = 1;
                    logError(error, 'emptyTrash');
                }
            }

            try { onDone?.(result); }
            catch (error) { logError(error, 'emptyTrash completion'); }
        });
    } catch (error) {
        if (cancelId) {
            try { cancellable.disconnect(cancelId); } catch { /* intentionally ignored: cancellable signal handler may already be disconnected */ }
            cancelId = 0;
        }
        result.cancelled = cancellable.is_cancelled();
        if (!result.cancelled) {
            result.failed = 1;
            logError(error, 'emptyTrash');
        }
        try { onDone?.(result); }
        catch (completionError) { logError(completionError, 'emptyTrash completion'); }
    }

    return cancellable;
}

// ── GIcon Caching ─────────────────────────────────────────────────────────────
const MAX_ICON_CACHE_ENTRIES = 128;
const _fileIconCache = new Map();
const _themedIconCache = new Map();

/**
 * Get or create a cached Gio.ThemedIcon for the specified icon name.
 *
 * @param {string} name - Icon name (e.g., 'folder', 'folder-download', 'text-x-generic')
 * @param {boolean} [useFallbacks=false] - Whether to create with default fallbacks
 * @returns {Gio.ThemedIcon|null}
 */
export function getCachedThemedIcon(name, useFallbacks = false) {
    if (!name || typeof name !== 'string') return null;
    const key = useFallbacks ? `${name}:fb` : name;
    const cached = _themedIconCache.get(key);
    if (cached) {
        // Refresh LRU order
        _themedIconCache.delete(key);
        _themedIconCache.set(key, cached);
        return cached;
    }
    try {
        const icon = useFallbacks
            ? Gio.ThemedIcon.new_with_default_fallbacks(name)
            : Gio.ThemedIcon.new(name);
        if (_themedIconCache.size >= MAX_ICON_CACHE_ENTRIES) {
            const oldest = _themedIconCache.keys().next().value;
            _themedIconCache.delete(oldest);
        }
        _themedIconCache.set(key, icon);
        return icon;
    } catch {
        return null;
    }
}

/**
 * Get or create a cached Gio.FileIcon for the specified filesystem path.
 *
 * @param {string} path - Absolute filesystem path (e.g. thumbnail path)
 * @returns {Gio.FileIcon|null}
 */
export function getCachedFileIcon(path) {
    if (!path || typeof path !== 'string') return null;
    const cached = _fileIconCache.get(path);
    if (cached) {
        // Refresh LRU order
        _fileIconCache.delete(path);
        _fileIconCache.set(path, cached);
        return cached;
    }
    try {
        const file = Gio.File.new_for_path(path);
        const icon = Gio.FileIcon.new(file);
        if (_fileIconCache.size >= MAX_ICON_CACHE_ENTRIES) {
            const oldest = _fileIconCache.keys().next().value;
            _fileIconCache.delete(oldest);
        }
        _fileIconCache.set(path, icon);
        return icon;
    } catch {
        return null;
    }
}

/**
 * Get or create a cached Gio.ThemedIcon for a standard file extension or filename.
 *
 * @param {string} filenameOrExt - Filename or extension (e.g., 'report.pdf', 'png')
 * @returns {Gio.ThemedIcon|null}
 */
export function getCachedIconForExtension(filenameOrExt) {
    if (!filenameOrExt || typeof filenameOrExt !== 'string') return null;
    const ext = filenameOrExt.includes('.')
        ? filenameOrExt.slice(filenameOrExt.lastIndexOf('.') + 1)
        : filenameOrExt;
    const key = `ext:${ext.toLowerCase()}`;
    const cached = _themedIconCache.get(key);
    if (cached) {
        _themedIconCache.delete(key);
        _themedIconCache.set(key, cached);
        return cached;
    }
    try {
        const [contentType] = Gio.content_type_guess(`file.${ext}`, null);
        const icon = contentType ? Gio.content_type_get_icon(contentType) : null;
        if (icon) {
            if (_themedIconCache.size >= MAX_ICON_CACHE_ENTRIES) {
                const oldest = _themedIconCache.keys().next().value;
                _themedIconCache.delete(oldest);
            }
            _themedIconCache.set(key, icon);
            return icon;
        }
    } catch { /* intentionally ignored: content type guessing failed fallback to generic icon */ }
    return getCachedThemedIcon('text-x-generic');
}

/**
 * Clear the Gio.FileIcon cache.
 */
export function clearFileIconCache() {
    _fileIconCache.clear();
}

/**
 * Clear the Gio.ThemedIcon cache.
 */
export function clearThemedIconCache() {
    _themedIconCache.clear();
}

/**
 * Clear all cached GIcons. Invoked during extension disable or testing teardown.
 */
export function clearIconCaches() {
    _fileIconCache.clear();
    _themedIconCache.clear();
}
