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
// Empty Trash cover mounted-volume trash backends as well when GIO exposes
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

// Use the same native GIO operation exposed by `gio trash --empty` instead of
// recursively deleting children of trash:///. The latter can fail on some
// Trash backends even though the native GIO operation succeeds.
// The returned cancellable lets the owning controller stop the in-flight wait
// and terminate the helper process during teardown.
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
            try { process.force_exit(); } catch { }
        });

        process.wait_check_async(cancellable, (_process, asyncResult) => {
            if (cancelId) {
                try { cancellable.disconnect(cancelId); } catch { }
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
            try { cancellable.disconnect(cancelId); } catch { }
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
