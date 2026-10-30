import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { enumerateRecent, invalidateListingCache } from '../downloads/fileEnumerator.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const path = GLib.dir_make_tmp('aqua-dock-enumerator-XXXXXX');
const folder = Gio.File.new_for_path(path);
try {
    for (let i = 39; i >= 0; i--)
        GLib.file_set_contents(GLib.build_filenamev([path, `file-${String(i).padStart(2, '0')}.txt`]), 'x');

    const listing = await enumerateRecent(folder, null, 'name', 5);
    assert(!listing.error, 'successful enumeration unexpectedly reported an error');
    assert(listing.total === 40, 'enumerator overflow count is wrong');
    assert(listing.files.length === 5, 'enumerator retained more than its limit');
    assert(listing.files[0].get_name() === 'file-00.txt' &&
        listing.files[4].get_name() === 'file-04.txt', 'name sort is wrong');

    // Test caching
    const cachedListing = await enumerateRecent(folder, null, 'name', 5);
    assert(cachedListing === listing, 'consecutive enumeration did not use cache');

    // Test cache invalidation
    invalidateListingCache(folder.get_uri());
    const uncachedListing = await enumerateRecent(folder, null, 'name', 5);
    assert(uncachedListing !== listing, 'listing was not refreshed after cache invalidation');
    assert(uncachedListing.files.length === 5, 'refreshed listing has wrong count');

    const newestListing = await enumerateRecent(folder, null, 'newest', 3);
    assert(newestListing.files.length === 3, 'newest sort returned wrong count');

    const missing = await enumerateRecent(
        Gio.File.new_for_path(`${path}-missing`), null, 'name', 5);
    assert(missing.error, 'missing folder enumeration was reported as empty success');
} finally {
    const enumerator = folder.enumerate_children(
        'standard::name', Gio.FileQueryInfoFlags.NONE, null);
    for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null))
        folder.get_child(info.get_name()).delete(null);
    enumerator.close(null);
    folder.delete(null);
}

print('fileEnumerator: ok');
