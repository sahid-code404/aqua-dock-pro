// AquaDockPro — async Downloads folder enumeration.
//
// Purpose:   Read a folder's entries off the main loop (batched) and return them
//            newest-first, plus pick the best icon for a file (real thumbnail if
//            the thumbnailer made one, else the content-type icon). Enumeration
//            NEVER blocks the compositor — large/slow folders can't stall paint.
// Ownership: Stateless. The Promise resolves with {files, total}; only the
//            requested visible subset is retained while total counts overflow.
// Cost:      O(entries), async, 64 per batch, O(limit) retained memory.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const ATTRS =
    'standard::name,standard::display-name,standard::icon,' +
    'standard::content-type,thumbnail::path,time::modified';

export function enumerateRecent(folder, cancellable = null, sort = 'newest', limit = 11) {
    return new Promise(resolve => {
        const out = [];
        let total = 0;
        let en = null;
        limit = Math.max(1, Math.trunc(limit) || 11);
        const compare = sort === 'name'
            ? (a, b) => a.name.localeCompare(b.name)
            : sort === 'type'
                ? (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
                : (a, b) => b.mtime - a.mtime;
        const finish = () => {
            out.sort(compare);
            if (out.length > limit) out.length = limit;
            resolve({ files: out.map(entry => entry.info), total });
        };
        const readBatch = () => {
            en.next_files_async(64, GLib.PRIORITY_DEFAULT, cancellable, (e, res) => {
                let infos;
                try { infos = e.next_files_finish(res); }
                catch { try { en.close_async(GLib.PRIORITY_DEFAULT, null, null); } catch { } finish(); return; }
                if (!infos || infos.length === 0) {
                    try { en.close_async(GLib.PRIORITY_DEFAULT, null, null); } catch { }
                    finish();
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
                    catch { resolve({ files: [], total: 0 }); return; }
                    readBatch();
                });
        } catch { resolve({ files: [], total: 0 }); }
    });
}

export function iconForInfo(info) {
    try {
        const thumbPath = info.get_attribute_byte_string('thumbnail::path');
        if (thumbPath) return Gio.FileIcon.new(Gio.File.new_for_path(thumbPath));
    } catch { }
    return info.get_icon();
}
