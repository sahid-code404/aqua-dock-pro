// Async folder enumeration for stack popups.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { getCachedFileIcon } from '../services/fileService.js';

const ATTRS =
    'standard::name,standard::display-name,standard::icon,' +
    'standard::content-type,thumbnail::path,time::modified';

/**
 * Asynchronously enumerates recent files within a folder with sorting and item limits.
 *
 * @param {Gio.File} folder - GIO directory to enumerate.
 * @param {Gio.Cancellable|null} [cancellable=null] - Optional cancellable token.
 * @param {'newest'|'name'|'type'} [sort='newest'] - Sorting criterion.
 * @param {number} [limit=11] - Maximum number of files to return.
 * @returns {Promise<{ files: Gio.FileInfo[], total: number, error: Error|null }>} Enumerated file infos and total count.
 */
export function enumerateRecent(folder, cancellable = null, sort = 'newest', limit = 11) {
    return new Promise(resolve => {
        const out = [];
        let total = 0;
        let en = null;
        let done = false;
        limit = Math.max(1, Math.trunc(limit) || 11);
        const compare = sort === 'name'
            ? (a, b) => a.name.localeCompare(b.name)
            : sort === 'type'
                ? (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
                : (a, b) => b.mtime - a.mtime;
        const finish = (error = null) => {
            if (done) return;
            done = true;
            out.sort(compare);
            if (out.length > limit) out.length = limit;
            resolve({ files: out.map(entry => entry.info), total, error });
        };
        const closeAndFinish = error => {
            try { en?.close_async(GLib.PRIORITY_DEFAULT, null, null); } catch { /* intentionally ignored: file enumerator stream may already be closed */ }
            finish(error);
        };
        const readBatch = () => {
            en.next_files_async(64, GLib.PRIORITY_DEFAULT, cancellable, (e, res) => {
                let infos;
                try { infos = e.next_files_finish(res); }
                catch (error) { closeAndFinish(error); return; }
                if (!infos || infos.length === 0) {
                    closeAndFinish(null);
                    return;
                }
                for (const info of infos) {
                    if (info.get_name().startsWith('.')) continue;
                    total++;
                    out.push({
                        info,
                        name: info.get_display_name() ?? info.get_name(),
                        type: info.get_content_type() ?? '',
                        mtime: info.get_modification_date_time()?.to_unix() ?? 0,
                    });
                }
                // Bound retained FileInfo objects even for very large folders.
                out.sort(compare);
                if (out.length > limit) out.length = limit;
                readBatch();
            });
        };
        try {
            folder.enumerate_children_async(
                ATTRS, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable,
                (f, res) => {
                    try { en = f.enumerate_children_finish(res); }
                    catch (error) { finish(error); return; }
                    readBatch();
                });
        } catch (error) { finish(error); }
    });
}

/**
 * Resolves an appropriate Gio.Icon for an enumerated file, preferring cached thumbnail paths.
 *
 * @param {Gio.FileInfo} info - GIO file info object.
 * @returns {Gio.Icon} Cached thumbnail file icon or standard themed file icon.
 */
export function iconForInfo(info) {
    try {
        const thumbPath = info.get_attribute_byte_string('thumbnail::path');
        if (thumbPath) return getCachedFileIcon(thumbPath);
    } catch { /* intentionally ignored: thumbnail attribute lookup fallback to standard file icon */ }
    return info.get_icon();
}
