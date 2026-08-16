import { normalizeCustomItem, parseCustomItems, serializeCustomItems }
    from '../services/customItems.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const items = [
    { id: 'folder-1', type: 'folder', uri: 'file:///tmp/Folder', name: 'Folder' },
    { id: 'file-1', type: 'file', uri: 'file:///tmp/report.pdf', name: 'Report' },
    { id: 'url-1', type: 'url', uri: 'https://example.com', name: 'Example' },
    { id: 'separator-1', type: 'separator' },
    { id: 'spacer-1', type: 'spacer' },
];
const roundTrip = parseCustomItems(serializeCustomItems(items));
assert(JSON.stringify(roundTrip) === JSON.stringify(items), 'custom-item round trip failed');
assert(parseCustomItems(['not json', '{"type":"file"}']).length === 0,
    'invalid custom items were accepted');
assert(normalizeCustomItem({ id: 'x', type: 'file', uri: 'file:///x\ninvalid' }).uri ===
    'file:///x invalid', 'unsafe control characters were not removed');
assert(parseCustomItems([JSON.stringify(items[0]), JSON.stringify(items[0])]).length === 1,
    'duplicate custom-item IDs were not removed');

print('customItems: ok');
