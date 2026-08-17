import {
    filterMountedDeviceEntries,
    reconcileMountedDeviceEntries,
} from '../services/mountedDevices.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const oldMount = { id: 'old' };
const newMount = { id: 'new' };
const retained = {
    key: 'mount:usb',
    name: 'USB Drive',
    uri: 'file:///run/media/usb',
    mount: oldMount,
};
const removed = { key: 'mount:removed', mount: { id: 'removed' } };
const added = { key: 'mount:added', mount: { id: 'added' } };

const result = reconcileMountedDeviceEntries([retained, removed], [
    {
        key: 'mount:usb',
        name: 'Renamed USB Drive',
        uri: 'file:///run/media/usb',
        mount: newMount,
    },
    added,
]);

assert(result.length === 2, 'reconciliation returned the wrong entry count');
assert(result[0] === retained, 'a stable key should preserve the entry object');
assert(result[0].mount === newMount, 'a retained entry should receive the current mount');
assert(result[0].name === 'Renamed USB Drive', 'a retained entry should receive current metadata');
assert(result[1] === added, 'a new key should keep its new entry object');
assert(!result.includes(removed), 'a removed key should not remain in the result');

const raw = [
    {
        key: 'mount:shared', deviceId: 'shared', uri: 'file:///media/a',
        name: 'A', sortKey: 'a', group: 'removable', mount: { id: 'a' },
    },
    {
        key: 'mount:shared', deviceId: 'shared', uri: 'file:///media/b',
        name: 'B', sortKey: 'b', group: 'removable', mount: { id: 'b' },
    },
    {
        key: 'mount:fixed', deviceId: 'fixed', uri: 'file:///mnt/fixed',
        name: 'Fixed', sortKey: 'c', group: 'fixed', mount: { id: 'fixed' },
    },
];
const filtered = filterMountedDeviceEntries(raw, {
    showMountedDevices: true,
    showRemovableDevices: true,
    showNetworkDevices: true,
    showFixedDevices: false,
    hiddenMountedDevices: [],
});
assert(filtered.length === 2, 'per-dock filtering returned the wrong visible entries');
assert(filtered[0] !== raw[0] && filtered[1] !== raw[1],
    'per-dock entries must not share mutable presentation objects');
assert(filtered[0].key === 'mount:shared:file:///media/a:0' &&
    filtered[1].key === 'mount:shared:file:///media/b:1',
    'duplicate mounted-device keys changed after shared normalization');

const hidden = filterMountedDeviceEntries(raw, {
    showMountedDevices: true,
    showRemovableDevices: true,
    showNetworkDevices: true,
    showFixedDevices: true,
    hiddenMountedDevices: ['shared'],
});
assert(hidden.length === 1 && hidden[0].deviceId === 'fixed',
    'hidden mounted-device filtering changed');

print('mountedDevices: ok');
