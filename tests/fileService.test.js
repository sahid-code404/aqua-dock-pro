import {
    trashDir,
    getCachedThemedIcon,
    getCachedFileIcon,
    getCachedIconForExtension,
    clearIconCaches,
} from '../services/fileService.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// Existing trashDir assertion
assert(trashDir().get_uri() === 'trash:///',
    'Trash state and Empty Trash must use the desktop GIO Trash backend');

// ── GIcon caching tests ───────────────────────────────────────────────────────
const t1 = getCachedThemedIcon('folder-download');
const t2 = getCachedThemedIcon('folder-download');
assert(t1 === t2, 'getCachedThemedIcon must return identical wrapper instance');

const tf1 = getCachedThemedIcon('folder', true);
const tf2 = getCachedThemedIcon('folder', true);
assert(tf1 === tf2, 'getCachedThemedIcon with fallbacks must return identical wrapper');
assert(t1 !== tf1, 'Fallback and non-fallback icons must have distinct keys');

const f1 = getCachedFileIcon('/tmp/test-thumbnail.png');
const f2 = getCachedFileIcon('/tmp/test-thumbnail.png');
assert(f1 === f2, 'getCachedFileIcon must return identical wrapper instance');

const extIcon1 = getCachedIconForExtension('pdf');
const extIcon2 = getCachedIconForExtension('report.pdf');
assert(extIcon1 === extIcon2, 'getCachedIconForExtension must return identical wrapper instance');

clearIconCaches();
const t3 = getCachedThemedIcon('folder-download');
assert(t1 !== t3, 'clearIconCaches must clear cached wrappers');

print('fileService: ok');
