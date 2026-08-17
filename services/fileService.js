// Filesystem utilities for Downloads and Trash operations.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { logError } from '../core/utils.js';

// Promisify the async Gio calls used below (idempotent at module load).
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.File.prototype, 'delete_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');

export function downloadsDir() {
    const path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ??
        GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']);
    return Gio.File.new_for_path(path);
}

export function downloadsUri() {
    return downloadsDir().get_uri();
}

// Use GIO's virtual Trash backend instead of assuming every trashed item lives
// in $XDG_DATA_HOME/Trash. The same URI is what the dock opens, so state and
// Empty Trash now cover mounted-volume trash backends as well when GIO exposes
// them through the desktop Trash implementation.
export function trashDir() {
    return Gio.File.new_for_uri('trash:///');
}

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
        try { await en.close_async(GLib.PRIORITY_DEFAULT, null); } catch { }
    }
}

// Empty the same virtual Trash collection shown by the desktop. The returned
// cancellable lets the owning controller stop outstanding I/O during teardown.
export function emptyTrash(onDone = null) {
    const cancellable = new Gio.Cancellable();
    const result = { deleted: 0, failed: 0, cancelled: false };
    deleteChildren(trashDir(), cancellable, result).catch(e => {
        if (!cancellable.is_cancelled()) {
            result.failed++;
            logError(e, 'emptyTrash');
        }
    }).finally(() => {
        result.cancelled = cancellable.is_cancelled();
        try { onDone?.(result); }
        catch (error) { logError(error, 'emptyTrash completion'); }
    });
    return cancellable;
}

async function deleteChildren(dir, cancellable, result) {
    let en;
    try {
        en = await dir.enumerate_children_async(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            GLib.PRIORITY_DEFAULT, cancellable);
    } catch (e) {
        if (!cancellable.is_cancelled() && !e.matches?.(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND))
            result.failed++;
        return;
    }
    for (;;) {
        let infos;
        try {
            infos = await en.next_files_async(32, GLib.PRIORITY_DEFAULT, cancellable);
        } catch (error) {
            if (!cancellable.is_cancelled()) {
                result.failed++;
                logError(error, 'emptyTrash enumerate');
            }
            break;
        }
        if (!infos.length) break;
        for (const info of infos) {
            if (cancellable.is_cancelled()) break;
            const child = dir.get_child(info.get_name());
            if (info.get_file_type() === Gio.FileType.DIRECTORY)
                await deleteChildren(child, cancellable, result);
            try {
                await child.delete_async(GLib.PRIORITY_DEFAULT, cancellable);
                result.deleted++;
            } catch {
                if (!cancellable.is_cancelled()) result.failed++;
            }
        }
        if (cancellable.is_cancelled()) break;
    }
    try { await en.close_async(GLib.PRIORITY_DEFAULT, null); } catch { }
}
