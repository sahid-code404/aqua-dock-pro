import { reconcileMountedDeviceEntries } from '../services/mountedDevices.js';

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

print('mountedDevices: ok');
