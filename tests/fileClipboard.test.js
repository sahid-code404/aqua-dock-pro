import {
    FILE_LIST_MIME,
    fileListPayload,
} from '../downloads/fileClipboard.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

assert(FILE_LIST_MIME === 'text/uri-list',
    'file clipboard must use the standard desktop file-list MIME type');
assert(fileListPayload([
    'file:///tmp/one.txt',
    'file:///tmp/two%20words.txt',
]) === 'file:///tmp/one.txt\r\nfile:///tmp/two%20words.txt\r\n',
'file clipboard payload is not a valid URI list');
assert(fileListPayload([]) === null,
    'an empty selection should not replace the clipboard');
assert(fileListPayload(['file:///tmp/safe', 'file:///tmp/bad\nfile:///tmp/other']) ===
    'file:///tmp/safe\r\n', 'newline-bearing URIs must be rejected');

print('fileClipboard: ok');
