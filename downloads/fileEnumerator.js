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
const LISTING_CACHE_TTL_US = 3600 * 1000 * 1000; // 1h sliding window with SWR background refresh
const LISTING_CACHE_STALE_US = 8 * 1000 * 1000; // 8s SWR threshold for background revalidation
const listingCache = new Map();
const inFlightRevalidations = new Set();
const inFlightEnumerations = new Map();
const activeIdleSources = new Set();
let invalidationEpoch = 0;

function scheduleIdle(priority, callback) {
    if (typeof GLib === 'undefined' || !GLib.idle_add) return 0;
    let id = 0;
    id = GLib.idle_add(priority, () => {
        activeIdleSources.delete(id);
        return callback();
    });
    if (id) activeIdleSources.add(id);
    return id;
}

function getCachedListing(key, folderUri = null, sort = null, limit = 0) {
    const now = GLib.get_monotonic_time();
    const entry = listingCache.get(key);
    if (entry) {
        if ((now - entry.lastAccess) > LISTING_CACHE_TTL_US) {
            listingCache.delete(key);
        } else {
            entry.lastAccess = now;
            listingCache.delete(key);
            listingCache.set(key, entry);
            return entry;
        }
    }
    if (folderUri && sort && limit > 0) {
        const prefix = `${folderUri}:${sort}:`;
        for (const [k, candidate] of listingCache) {
            if (!k.startsWith(prefix)) continue;
            if ((now - candidate.lastAccess) > LISTING_CACHE_TTL_US) {
                listingCache.delete(k);
                continue;
            }
            if ((candidate.limit ?? 0) >= limit && candidate.result && !candidate.result.error) {
                const sliced = {
                    files: candidate.result.files.slice(0, limit),
                    total: candidate.result.total,
                    error: null,
                };
                putCachedListing(key, sliced, limit, candidate.timestamp);
                return listingCache.get(key);
            }
        }
    }
    return null;
}

function putCachedListing(key, result, limit = 11, timestamp = null) {
    if (!listingCache.has(key) && listingCache.size >= LISTING_CACHE_CAPACITY) {
        const oldestKey = listingCache.keys().next().value;
        if (oldestKey !== undefined) listingCache.delete(oldestKey);
    }
    const now = GLib.get_monotonic_time();
    listingCache.delete(key);
    listingCache.set(key, {
        timestamp: timestamp ?? now,
        lastAccess: now,
        limit,
        result,
    });
}

export function invalidateListingCache(folderUri = null) {
    invalidationEpoch++;
    if (!folderUri) {
        listingCache.clear();
        inFlightRevalidations.clear();
        inFlightEnumerations.clear();
        for (const id of activeIdleSources) {
            try { GLib.source_remove(id); } catch {}
        }
        activeIdleSources.clear();
        return;
    }
    for (const [key] of listingCache) {
        if (key.startsWith(folderUri)) listingCache.delete(key);
    }
    for (const key of inFlightRevalidations) {
        if (key.startsWith(folderUri)) inFlightRevalidations.delete(key);
    }
    for (const [key] of inFlightEnumerations) {
        if (key.startsWith(folderUri)) inFlightEnumerations.delete(key);
    }
}

function _scheduleBackgroundRevalidate(folder, sort, limit, cacheKey) {
    if (inFlightRevalidations.has(cacheKey)) return;
    inFlightRevalidations.add(cacheKey);
    scheduleIdle(GLib.PRIORITY_LOW, () => {
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
    const startEpoch = invalidationEpoch;
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
            try { en?.close_async(GLib.PRIORITY_DEFAULT, null, null); } catch {}
            if (error) {
                resolve({ files: [], total, error });
                return;
            }
            const res = { files: finalFiles || [], total, error: null };
            if (cacheKey && invalidationEpoch === startEpoch) {
                putCachedListing(cacheKey, res, limit);
            }
            resolve(res);
            if (res.files.length > 0) {
                if (typeof GLib !== 'undefined' && GLib.idle_add) {
                    scheduleIdle(GLib.PRIORITY_LOW, () => {
                        warmTextureCache(res.files);
                        return GLib.SOURCE_REMOVE;
                    });
                } else {
                    warmTextureCache(res.files);
                }
            }
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
                try {
                    const childFile = folder.get_child(cand.name);
                    childFile.query_info_async(
                        ATTRS_HEAVY, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable,
                        (fl, qres) => {
                            let info = null;
                            try { info = fl.query_info_finish(qres); }
                            catch { info = cand.rawInfo; }
                            if (cancellable?.is_cancelled()) {
                                finish(new Error('Operation cancelled'));
                                return;
                            }
                            finalFiles[idx] = info;
                            pending--;
                            if (pending === 0) {
                                finish(null, finalFiles.filter(Boolean));
                            }
                        }
                    );
                } catch {
                    finalFiles[idx] = cand.rawInfo;
                    pending--;
                    if (pending === 0) {
                        finish(null, finalFiles.filter(Boolean));
                    }
                }
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
    if (cancellable?.is_cancelled()) {
        return Promise.resolve({ files: [], total: 0, error: new Error('Operation cancelled') });
    }
    limit = Math.max(1, Math.trunc(limit) || 11);
    const folderUri = folder?.get_uri?.() ?? '';
    const cacheKey = `${folderUri}:${sort}:${limit}`;

    const entry = getCachedListing(cacheKey, folderUri, sort, limit);
    if (entry) {
        const now = GLib.get_monotonic_time();
        if ((now - entry.timestamp) > LISTING_CACHE_STALE_US) {
            _scheduleBackgroundRevalidate(folder, sort, limit, cacheKey);
        }
        return Promise.resolve(entry.result);
    }

    const inFlight = inFlightEnumerations.get(cacheKey);
    if (inFlight) {
        if (!cancellable) return inFlight;
        return inFlight.then(res => {
            if (cancellable.is_cancelled()) {
                return { files: [], total: 0, error: new Error('Operation cancelled') };
            }
            return res;
        });
    }

    if (!cancellable && folderUri) {
        const promise = _doEnumerate(folder, null, sort, limit, cacheKey).finally(() => {
            if (inFlightEnumerations.get(cacheKey) === promise) {
                inFlightEnumerations.delete(cacheKey);
            }
        });
        inFlightEnumerations.set(cacheKey, promise);
        return promise;
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
    } catch {}
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
            } catch {}
        }
    } catch {}
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
    const entry = getCachedListing(cacheKey, folderUri, sort, limit);
    if (entry) {
        if (entry.result?.files?.length) warmTextureCache(entry.result.files);
        return;
    }
    enumerateRecent(folder, null, sort, limit).then(res => {
        if (res?.files?.length) warmTextureCache(res.files);
    }).catch(() => {});
}

/**
 * Asynchronously prewarms folder listings during idle system startup.
 *
 * @param {Array<Gio.File|string>} [foldersOrUris=[]] - Folders or URIs to prewarm.
 * @param {'newest'|'name'|'type'} [sort='newest'] - Sorting criterion.
 * @param {number} [limit=11] - Maximum number of files to prewarm.
 */
export function prewarmStartupFolders(foldersOrUris = [], sort = 'newest', limit = 11) {
    scheduleIdle(GLib.PRIORITY_LOW, () => {
        try {
            for (const item of foldersOrUris) {
                if (!item) continue;
                try {
                    const folder = (typeof item === 'string') ? Gio.File.new_for_uri(item) : item;
                    prewarmFolderListing(folder, sort, Math.max(limit, 11));
                } catch {}
            }
        } catch {}
        return GLib.SOURCE_REMOVE;
    });
}
