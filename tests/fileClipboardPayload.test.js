import { FILE_LIST_MIME, fileListPayload } from '../downloads/fileClipboardPayload.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

assert(FILE_LIST_MIME === 'text/uri-list', 'unexpected file-list MIME type');
assert(fileListPayload(['file:///tmp/report.pdf']) === 'file:///tmp/report.pdf\r\n',
    'single-file URI list was not serialized correctly');
assert(fileListPayload(['file:///tmp/a', 'file:///tmp/b']) ===
    'file:///tmp/a\r\nfile:///tmp/b\r\n', 'multi-file URI list was not serialized correctly');
assert(fileListPayload(['file:///tmp/a\ninvalid', '', null]) === null,
    'unsafe or empty URI entries were not rejected');
assert(fileListPayload([]) === null, 'empty URI list should not produce clipboard content');

print('fileClipboardPayload: ok');
