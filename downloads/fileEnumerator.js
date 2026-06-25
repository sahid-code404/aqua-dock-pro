// AquaDockPro — async Downloads folder enumeration.
//
// Purpose:   Read a folder's entries off the main loop (batched) and return them
//            newest-first, plus pick the best icon for a file (real thumbnail if
//            the thumbnailer made one, else the content-type icon). Enumeration
//            NEVER blocks the compositor — large/slow folders can't stall paint.
// Ownership: Stateless. The returned Promise resolves with Gio.FileInfo[].
// Cost:      O(entries), async, 64 per batch. One enumerator, closed when drained.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const ATTRS =
    'standard::name,standard::display-name,standard::icon,' +
    'standard::content-type,thumbnail::path,time::modified';

export function enumerateRecent(folder) {
    return new Promise(resolve => {
        const out = [];
        let en = null;
        const finish = () => {
            out.sort((a, b) => b.mtime - a.mtime);
            resolve(out.map(e => e.info));
        };
        const readBatch = () => {
            en.next_files_async(64, GLib.PRIORITY_DEFAULT, null, (e, res) => {
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
                    out.push({ info, mtime: info.get_modification_date_time()?.to_unix() ?? 0 });
                }
                readBatch();
            });
        };
        try {
            folder.enumerate_children_async(
                ATTRS, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null,
                (f, res) => {
                    try { en = f.enumerate_children_finish(res); }
                    catch { resolve([]); return; }
                    readBatch();
                });
        } catch { resolve([]); }
    });
}

export function iconForInfo(info) {
    try {
        const thumbPath = info.get_attribute_byte_string('thumbnail::path');
        if (thumbPath) return Gio.FileIcon.new(Gio.File.new_for_path(thumbPath));
    } catch { }
    return info.get_icon();
}
