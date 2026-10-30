// Async folder enumeration for stack popups.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { getCachedFileIcon } from '../services/fileService.js';

const ATTRS_HEAVY =
    'standard::name,standard::display-name,standard::icon,' +
    'standard::content-type,thumbnail::path,time::modified';

const ATTRS_SCAN_NEWEST = 'standard::name,time::modified';
const ATTRS_SCAN_NAME = 'standard::name,standard::display-name';
const ATTRS_SCAN_TYPE = 'standard::name,standard::content-type,time::modified';

const LISTING_CACHE_CAPACITY = 16;
const LISTING_CACHE_TTL_US = 60 * 1000 * 1000; // 60s sliding window for active consecutive toggles
const LISTING_CACHE_STALE_US = 8 * 1000 * 1000; // 8s SWR threshold for background revalidation
const listingCache = new Map();
const inFlightRevalidations = new Set();

function getCachedListing(key) {
    const entry = listingCache.get(key);
    if (!entry) return null;
    const now = GLib.get_monotonic_time();
    if ((now - entry.lastAccess) > LISTING_CACHE_TTL_US) {
        listingCache.delete(key);
        return null;
    }
    entry.lastAccess = now;
    listingCache.delete(key);
    listingCache.set(key, entry);
    return entry;
}

function putCachedListing(key, result) {
    if (listingCache.size >= LISTING_CACHE_CAPACITY) {
        const oldestKey = listingCache.keys().next().value;
        if (oldestKey !== undefined) listingCache.delete(oldestKey);
    }
    const now = GLib.get_monotonic_time();
    listingCache.set(key, {
        timestamp: now,
        lastAccess: now,
        result,
    });
}

export function invalidateListingCache(folderUri = null) {
    if (!folderUri) {
        listingCache.clear();
        inFlightRevalidations.clear();
        return;
    }
    for (const [key] of listingCache) {
        if (key.startsWith(folderUri)) listingCache.delete(key);
    }
    for (const key of inFlightRevalidations) {
        if (key.startsWith(folderUri)) inFlightRevalidations.delete(key);
    }
}

function _scheduleBackgroundRevalidate(folder, sort, limit, cacheKey) {
    if (inFlightRevalidations.has(cacheKey)) return;
    inFlightRevalidations.add(cacheKey);
    GLib.idle_add(GLib.PRIORITY_LOW, () => {
        if (!inFlightRevalidations.has(cacheKey)) return GLib.SOURCE_REMOVE;
        _doEnumerate(folder, null, sort, limit, cacheKey)
            .then(fresh => {
                inFlightRevalidations.delete(cacheKey);
                if (!fresh.error && fresh.files?.length > 0) {
                    warmTextureCache(fresh.files);
                }
            })
            .catch(() => {
                inFlightRevalidations.delete(cacheKey);
            });
        return GLib.SOURCE_REMOVE;
    });
}

function _doEnumerate(folder, cancellable, sort, limit, cacheKey = null) {
    return new Promise(resolve => {
        let scanAttrs = ATTRS_SCAN_NEWEST;
        if (sort === 'name') scanAttrs = ATTRS_SCAN_NAME;
        else if (sort === 'type') scanAttrs = ATTRS_SCAN_TYPE;

        const compare = sort === 'name'
            ? (a, b) => a.displayName.localeCompare(b.displayName)
            : sort === 'type'
                ? (a, b) => a.type.localeCompare(b.type) || a.displayName.localeCompare(b.displayName)
                : (a, b) => b.mtime - a.mtime;

        let total = 0;
        let en = null;
        let done = false;
        const candidates = [];

        const finish = (error = null, finalFiles = null) => {
            if (done) return;
            done = true;
            try { en?.close_async(GLib.PRIORITY_DEFAULT, null, null); } catch { /* intentionally ignored: file enumerator stream may already be closed */ }
            if (error) {
                resolve({ files: [], total, error });
                return;
            }
            const res = { files: finalFiles || [], total, error: null };
            if (cacheKey && res.files.length > 0) putCachedListing(cacheKey, res);
            resolve(res);
        };

        const fetchPhase2 = () => {
            candidates.sort(compare);
            if (candidates.length > limit) candidates.length = limit;
            if (candidates.length === 0) {
                finish(null, []);
                return;
            }

            let pending = candidates.length;
            const finalFiles = new Array(candidates.length);
            candidates.forEach((cand, idx) => {
                const childFile = folder.get_child(cand.name);
                childFile.query_info_async(
                    ATTRS_HEAVY, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable,
                    (fl, qres) => {
                        if (cancellable?.is_cancelled()) {
                            finish(new Error('Operation cancelled'));
                            return;
                        }
                        try { finalFiles[idx] = fl.query_info_finish(qres); }
                        catch { finalFiles[idx] = cand.rawInfo; }
                        pending--;
                        if (pending === 0) {
                            finish(null, finalFiles.filter(Boolean));
                        }
                    }
                );
            });
        };

        const readBatch = () => {
            en.next_files_async(256, GLib.PRIORITY_DEFAULT, cancellable, (e, res) => {
                let infos;
                try { infos = e.next_files_finish(res); }
                catch (error) { finish(error); return; }
                if (!infos || infos.length === 0) {
                    fetchPhase2();
                    return;
                }
                for (const info of infos) {
                    const name = info.get_name();
                    if (name.startsWith('.')) continue;
                    total++;
                    const displayName = (sort === 'name') ? (info.get_display_name() ?? name) : name;
                    candidates.push({
                        name,
                        displayName,
                        type: sort === 'type' ? (info.get_content_type() ?? '') : '',
                        mtime: sort !== 'name' ? (info.get_modification_date_time()?.to_unix() ?? 0) : 0,
                        rawInfo: info,
                    });
                }
                candidates.sort(compare);
                if (candidates.length > limit) candidates.length = limit;
                readBatch();
            });
        };

        try {
            folder.enumerate_children_async(
                scanAttrs, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable,
                (f, res) => {
                    try { en = f.enumerate_children_finish(res); }
                    catch (error) { finish(error); return; }
                    readBatch();
                }
            );
        } catch (error) { finish(error); }
    });
}

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
    limit = Math.max(1, Math.trunc(limit) || 11);
    const folderUri = folder?.get_uri?.() ?? '';
    const cacheKey = `${folderUri}:${sort}:${limit}`;

    if (!cancellable?.is_cancelled()) {
        const entry = getCachedListing(cacheKey);
        if (entry) {
            const now = GLib.get_monotonic_time();
            if ((now - entry.timestamp) > LISTING_CACHE_STALE_US) {
                _scheduleBackgroundRevalidate(folder, sort, limit, cacheKey);
            }
            return Promise.resolve(entry.result);
        }
    }

    return _doEnumerate(folder, cancellable, sort, limit, cacheKey);
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

function warmTextureCache(files) {
    if (typeof global === 'undefined' || !global.stage) return;
    try {
        const cache = St.TextureCache?.get_default?.();
        if (!cache?.load_gicon) return;
        for (const info of files) {
            try {
                const gicon = iconForInfo(info);
                if (gicon) cache.load_gicon(null, gicon, 48, 1, 1);
            } catch { /* intentionally ignored: individual texture pre-warm failure */ }
        }
    } catch { /* intentionally ignored: texture cache unavailable */ }
}

/**
 * Asynchronously prewarms folder listing and GPU texture cache on hover.
 *
 * @param {Gio.File} folder - GIO directory to prewarm.
 * @param {'newest'|'name'|'type'} [sort='newest'] - Sorting criterion.
 * @param {number} [limit=11] - Maximum number of files to prewarm.
 */
export function prewarmFolderListing(folder, sort = 'newest', limit = 11) {
    if (!folder) return;
    limit = Math.max(1, Math.trunc(limit) || 11);
    const folderUri = folder?.get_uri?.() ?? '';
    if (!folderUri) return;
    const cacheKey = `${folderUri}:${sort}:${limit}`;
    const entry = getCachedListing(cacheKey);
    if (entry) {
        if (entry.result?.files?.length) warmTextureCache(entry.result.files);
        return;
    }
    enumerateRecent(folder, null, sort, limit).then(res => {
        if (res?.files?.length) warmTextureCache(res.files);
    }).catch(() => {});
}
