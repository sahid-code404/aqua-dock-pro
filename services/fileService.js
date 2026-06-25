// AquaDockPro — filesystem helpers for Downloads and Trash.
//
// Purpose:   Centralize the small set of file/dir operations the dock needs:
//            resolve the Downloads/Trash locations, test whether the trash has
//            files, and empty it asynchronously. Keeping these here keeps the
//            controller and menus free of Gio plumbing.
// Ownership: Stateless module functions. emptyTrash() runs entirely off the
//            main loop so a large trash never stalls the compositor.
// Cost:      Enumeration is async and batched (32 entries/call). Best-effort per
//            entry so one un-deletable file doesn't abort the sweep.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { logError } from '../core/utils.js';

// Promisify the async Gio calls used below (idempotent at module load).
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.File.prototype, 'delete_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');

export function downloadsDir() {
    const path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ??
        GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']);
    return Gio.File.new_for_path(path);
}

export function downloadsUri() {
    return downloadsDir().get_uri();
}

function trashFilesDir() {
    return Gio.File.new_for_path(
        GLib.build_filenamev([GLib.get_user_data_dir(), 'Trash', 'files']));
}

// The trash 'files' dir — exported for the directory monitor.
export function trashDir() {
    return trashFilesDir();
}

function trashInfoDir() {
    return Gio.File.new_for_path(
        GLib.build_filenamev([GLib.get_user_data_dir(), 'Trash', 'info']));
}

export function trashHasFiles() {
    try {
        const en = trashFilesDir().enumerate_children(
            'standard::name', Gio.FileQueryInfoFlags.NONE, null);
        const has = en.next_file(null) !== null;
        en.close(null);
        return has;
    } catch { return false; }
}

// Empty the trash off the main loop, then run onDone (e.g. refresh the icon).
export function emptyTrash(onDone = null) {
    Promise.all([
        deleteChildren(trashFilesDir()),
        deleteChildren(trashInfoDir()),
    ]).catch(e => logError(e, 'emptyTrash'))
        .finally(() => onDone?.());
}

async function deleteChildren(dir) {
    let en;
    try {
        en = await dir.enumerate_children_async(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            GLib.PRIORITY_DEFAULT, null);
    } catch { return; }
    for (;;) {
        let infos;
        try { infos = await en.next_files_async(32, GLib.PRIORITY_DEFAULT, null); }
        catch { break; }
        if (!infos.length) break;
        for (const info of infos) {
            const child = dir.get_child(info.get_name());
            if (info.get_file_type() === Gio.FileType.DIRECTORY)
                await deleteChildren(child);
            try { await child.delete_async(GLib.PRIORITY_DEFAULT, null); } catch { }
        }
    }
    try { en.close(null); } catch { }
}
