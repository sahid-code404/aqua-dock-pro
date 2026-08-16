import { previewPagePlan } from '../ui/preview/previewPaging.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const legacy = previewPagePlan({
    total: 7, targetWidth: 200, monitorWidth: 1920, mode: 'summary', requestedSize: 4,
});
assert(!legacy.paged && legacy.start === 0 && legacy.end === 4 && legacy.remaining === 3,
    'compact preview behavior changed');

const pages = previewPagePlan({
    total: 11, targetWidth: 200, monitorWidth: 900, mode: 'pages',
    requestedSize: 8, requestedPage: 2,
});
assert(pages.pageSize === 4 && pages.pageCount === 3 && pages.start === 8 && pages.end === 11,
    'preview pages do not fit or clamp correctly');

const narrow = previewPagePlan({
    total: 3, targetWidth: 400, monitorWidth: 500, mode: 'pages',
    requestedSize: 4, requestedPage: 99,
});
assert(narrow.pageSize === 1 && narrow.page === 2 && narrow.end === 3,
    'narrow-monitor preview page was not contained');

print('previewPaging: ok');
