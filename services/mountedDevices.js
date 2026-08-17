// Mounted device discovery and dock entry representation via VolumeMonitor.

import Gio from 'gi://Gio';

import { TimeoutGroup } from '../core/utils.js';

const DEVICE_SCHEMES = new Set(['afc', 'gphoto2', 'mtp']);
const VIRTUAL_SCHEMES = new Set([
    'burn',
    'computer',
    'network',
    'recent',
    'search',
    'starred',
    'trash',
]);

function safely(read, fallback = null) {
    try {
        const value = read();
        return value ?? fallback;
    } catch {
        return fallback;
    }
}

function nonEmpty(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function mountLocation(mount) {
    return safely(() => mount.get_default_location()) ?? safely(() => mount.get_root());
}

function rootUri(mount) {
    return nonEmpty(safely(() => mount.get_root()?.get_uri()));
}

function driveForMount(mount) {
    return safely(() => mount?.get_drive()) ??
        safely(() => mount?.get_volume()?.get_drive());
}

function canEject(mount) {
    const volume = safely(() => mount?.get_volume());
    const drive = driveForMount(mount);
    return safely(() => mount?.can_eject(), false) ||
        safely(() => volume?.can_eject(), false) ||
        safely(() => drive?.can_eject(), false);
}

function logActionError(action, error) {
    console.error(`AquaDockPro: [${action}] ${error?.message ?? error}`);
}

const busyMounts = new WeakSet();
const activeOperations = new Set();
const monitorStores = new Map();

function operationCancelled(cancellable, error) {
    if (cancellable?.is_cancelled()) return true;
    try { return error?.matches?.(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED) === true; }
    catch { return false; }
}

function runAsync(target, method, finish, buildArgs, action, onDone) {
    if (!target || typeof target[method] !== 'function') return null;
    const cancellable = new Gio.Cancellable();
    activeOperations.add(cancellable);
    try {
        target[method](...buildArgs(cancellable), (source, result) => {
            let error = null;
            try { (source ?? target)[finish]?.(result); }
            catch (e) {
                error = e;
                if (!operationCancelled(cancellable, e)) logActionError(action, e);
            }
            activeOperations.delete(cancellable);
            onDone?.(error, operationCancelled(cancellable, error));
        });
        return cancellable;
    } catch (error) {
        activeOperations.delete(cancellable);
        logActionError(action, error);
        return null;
    }
}

function mountAction(mount, candidates, action, onDone) {
    if (!mount || busyMounts.has(mount)) return null;
    const settled = (error, cancelled) => {
        busyMounts.delete(mount);
        if (!cancelled) onDone?.(error);
    };
    for (const [target, method, finish, args] of candidates) {
        const cancellable = runAsync(target, method, finish, args, action, settled);
        if (cancellable) {
            busyMounts.add(mount);
            return cancellable;
        }
    }
    return null;
}

export function cancelMountedDeviceOperations() {
    for (const cancellable of activeOperations) {
        try { cancellable.cancel(); } catch { }
    }
    activeOperations.clear();
}

export function ejectMountedDevice(mount, onDone = null) {
    const volume = safely(() => mount?.get_volume());
    const drive = driveForMount(mount);
    const candidates = [];
    const targets = [mount, volume, drive];
    for (const target of targets) {
        if (!safely(() => target?.can_eject(), false)) continue;
        candidates.push(
            [target, 'eject_with_operation', 'eject_with_operation_finish',
                cancellable => [Gio.MountUnmountFlags.NONE, null, cancellable]],
            [target, 'eject', 'eject_finish',
                cancellable => [Gio.MountUnmountFlags.NONE, cancellable]],
        );
    }
    return mountAction(mount, candidates, 'eject mounted device', onDone);
}

export function unmountMountedDevice(mount, onDone = null) {
    if (!safely(() => mount?.can_unmount(), false)) return null;
    return mountAction(mount, [
        [mount, 'unmount_with_operation', 'unmount_with_operation_finish',
            cancellable => [Gio.MountUnmountFlags.NONE, null, cancellable]],
        [mount, 'unmount', 'unmount_finish',
            cancellable => [Gio.MountUnmountFlags.NONE, cancellable]],
    ], 'unmount mounted device', onDone);
}

export function mountedDeviceId(mount) {
    const mountUuid = nonEmpty(safely(() => mount.get_uuid()));
    if (mountUuid) return `mount:${mountUuid}`;

    const volume = safely(() => mount.get_volume());
    const volumeUuid = nonEmpty(safely(() => volume?.get_uuid())) ??
        nonEmpty(safely(() => volume?.get_identifier(Gio.VOLUME_IDENTIFIER_KIND_UUID)));
    if (volumeUuid) return `volume:${volumeUuid}`;

    const nfsId = nonEmpty(safely(() =>
        volume?.get_identifier(Gio.VOLUME_IDENTIFIER_KIND_NFS_MOUNT)));
    if (nfsId) return `nfs:${nfsId}`;

    const unixDevice = nonEmpty(safely(() =>
        volume?.get_identifier(Gio.VOLUME_IDENTIFIER_KIND_UNIX_DEVICE)));
    if (unixDevice) return `device:${unixDevice}`;

    const activationUri = nonEmpty(safely(() => volume?.get_activation_root()?.get_uri()));
    if (activationUri) return `activation:${activationUri}`;

    const uri = rootUri(mount) ?? nonEmpty(safely(() => mountLocation(mount)?.get_uri()));
    return uri ? `uri:${uri}` : null;
}

export function mountedDeviceGroup(mount) {
    const drive = driveForMount(mount);
    const root = safely(() => mount.get_root()) ?? mountLocation(mount);
    const scheme = safely(() => root?.get_uri_scheme(), '')?.toLowerCase() ?? '';

    const removable = safely(() => drive?.is_removable(), false) ||
        safely(() => drive?.is_media_removable(), false) ||
        canEject(mount) ||
        DEVICE_SCHEMES.has(scheme);

    if (removable) return 'removable';
    if (scheme && scheme !== 'file') return 'network';
    return 'fixed';
}

export function mountedDeviceEntry(mount) {
    if (!mount || safely(() => mount.is_shadowed(), true)) return null;

    const location = mountLocation(mount);
    const uri = nonEmpty(safely(() => location?.get_uri()));
    const scheme = safely(() => location?.get_uri_scheme(), '')?.toLowerCase() ?? '';
    const deviceId = mountedDeviceId(mount);
    if (!uri || !deviceId || !scheme || VIRTUAL_SCHEMES.has(scheme)) return null;

    const volume = safely(() => mount.get_volume());
    const name = nonEmpty(safely(() => mount.get_name())) ??
        nonEmpty(safely(() => volume?.get_name())) ?? 'Mounted device';
    const gicon = safely(() => mount.get_icon()) ??
        safely(() => volume?.get_icon()) ?? Gio.ThemedIcon.new('drive-removable-media');

    return {
        key: `mount:${deviceId}`,
        kind: 'mount',
        deviceId,
        name,
        gicon,
        uri,
        group: mountedDeviceGroup(mount),
        mount,
        sortKey: nonEmpty(safely(() => mount.get_sort_key())) ?? '',
        canEject: canEject(mount),
        canUnmount: safely(() => mount.can_unmount(), false),
    };
}

function groupEnabled(group, config) {
    if (!config) return true;
    if (config.showMountedDevices === false) return false;

    switch (group) {
        case 'removable': return config.showRemovableDevices !== false;
        case 'network': return config.showNetworkDevices !== false;
        case 'fixed': return config.showFixedDevices === true;
        default: return false;
    }
}

function compareEntries(a, b) {
    const aKey = `${a.sortKey}\u0000${a.name.toLowerCase()}\u0000${a.deviceId}\u0000${a.uri}`;
    const bKey = `${b.sortKey}\u0000${b.name.toLowerCase()}\u0000${b.deviceId}\u0000${b.uri}`;
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

function normalizeMountedDeviceEntries(mounts) {
    const entries = [];
    for (const mount of mounts ?? []) {
        const entry = mountedDeviceEntry(mount);
        if (entry) entries.push(entry);
    }
    entries.sort(compareEntries);
    return entries;
}

export function filterMountedDeviceEntries(normalized, config = null) {
    const hidden = config?.hiddenMountedDevices;
    const hiddenIds = hidden instanceof Set
        ? hidden
        : new Set(Array.isArray(hidden) ? hidden : []);
    const entries = [];

    for (const raw of normalized ?? []) {
        if (!groupEnabled(raw.group, config) || hiddenIds.has(raw.deviceId)) continue;
        entries.push({ ...raw });
    }

    const totals = new Map();
    for (const entry of entries)
        totals.set(entry.deviceId, (totals.get(entry.deviceId) ?? 0) + 1);
    const seen = new Map();
    for (const entry of entries) {
        if (totals.get(entry.deviceId) === 1) continue;
        const index = seen.get(entry.deviceId) ?? 0;
        seen.set(entry.deviceId, index + 1);
        entry.key = `mount:${entry.deviceId}:${entry.uri}:${index}`;
    }

    return entries;
}

export function buildMountedDeviceEntries(mounts, config = null) {
    return filterMountedDeviceEntries(normalizeMountedDeviceEntries(mounts), config);
}

export function listMountedDevices(monitor, config = null) {
    const mounts = safely(() => monitor?.get_mounts(), []);
    return buildMountedDeviceEntries(mounts, config);
}

function iconFingerprint(gicon) {
    return nonEmpty(safely(() => gicon?.to_string())) ?? '';
}

function entriesFingerprint(entries) {
    return entries.map(entry => [
        entry.key,
        entry.name,
        entry.uri,
        entry.group,
        iconFingerprint(entry.gicon),
        entry.canEject ? 'e' : '',
        entry.canUnmount ? 'u' : '',
    ].join('\u0001')).join('\u0002');
}

export function reconcileMountedDeviceEntries(previous, next) {
    const previousByKey = new Map(previous.map(entry => [entry.key, entry]));
    return next.map(entry => {
        const retained = previousByKey.get(entry.key);
        if (!retained) return entry;
        Object.assign(retained, entry);
        return retained;
    });
}

class MountedDeviceStore {
    constructor(monitor) {
        this._monitor = monitor;
        this._callbacks = new Set();
        this._signalIds = [];
        this._timers = new TimeoutGroup();
        this._refreshId = 0;
        this._entries = this._readEntries();
    }

    get empty() { return this._callbacks.size === 0; }
    get entries() { return this._entries; }

    subscribe(callback) {
        this._callbacks.add(callback);
        if (this._callbacks.size === 1) {
            this._connect();
            this._refresh();
        }

        let live = true;
        return () => {
            if (!live) return;
            live = false;
            this._callbacks.delete(callback);
            if (this._callbacks.size === 0) this._disconnect();
        };
    }

    _connect() {
        const changed = () => this._queueRefresh();
        for (const signal of [
            'mount-added',
            'mount-removed',
            'mount-changed',
            'volume-changed',
            'drive-changed',
        ]) {
            const id = safely(() => this._monitor.connect(signal, changed), 0);
            if (id) this._signalIds.push(id);
        }
    }

    _queueRefresh() {
        if (this._refreshId) return;
        this._refreshId = this._timers.addIdle(() => {
            this._refreshId = 0;
            this._refresh();
            return false;
        });
    }

    _readEntries() {
        const mounts = safely(() => this._monitor?.get_mounts(), []);
        return normalizeMountedDeviceEntries(mounts);
    }

    _refresh() {
        if (!this._monitor) return;
        this._entries = this._readEntries();
        for (const callback of [...this._callbacks])
            callback(this._entries);
    }

    _disconnect() {
        this._timers.removeAll();
        this._refreshId = 0;
        for (const id of this._signalIds)
            safely(() => this._monitor.disconnect(id));
        this._signalIds = [];
    }

    destroy() {
        this._disconnect();
        this._callbacks.clear();
        this._entries = [];
        this._monitor = null;
    }
}

function acquireMountedDeviceStore(monitor) {
    let store = monitorStores.get(monitor);
    if (!store) {
        store = new MountedDeviceStore(monitor);
        monitorStores.set(monitor, store);
    }
    return store;
}

function releaseMountedDeviceStore(monitor, store) {
    if (!store.empty || monitorStores.get(monitor) !== store) return;
    store.destroy();
    monitorStores.delete(monitor);
}

export class MountedDevices {
    constructor(getConfig, monitor = null) {
        this._getConfig = getConfig;
        this._monitor = monitor ?? Gio.VolumeMonitor.get();
        this._store = this._monitor ? acquireMountedDeviceStore(this._monitor) : null;
        this._entries = filterMountedDeviceEntries(
            this._store?.entries ?? [], this._getConfig?.());
        this._fingerprint = entriesFingerprint(this._entries);
        this._onChanged = null;
        this._unsubscribe = null;
    }

    get entries() {
        return this._entries;
    }

    start(onChanged) {
        this._onChanged = onChanged;
        if (this._unsubscribe || !this._store) return;

        this._unsubscribe = this._store.subscribe(entries => this._refresh(entries));
        this._refresh(this._store.entries);
    }

    _refresh(normalized) {
        const entries = filterMountedDeviceEntries(normalized, this._getConfig?.());
        const fingerprint = entriesFingerprint(entries);
        this._entries = reconcileMountedDeviceEntries(this._entries, entries);
        if (fingerprint === this._fingerprint) return;

        this._fingerprint = fingerprint;
        try {
            this._onChanged?.();
        } catch (error) {
            console.error(`AquaDockPro: [mounted devices changed] ${error}`);
        }
    }

    destroy() {
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }
        if (this._store && this._monitor) {
            releaseMountedDeviceStore(this._monitor, this._store);
            this._store = null;
        }

        this._entries = [];
        this._fingerprint = '';
        this._onChanged = null;
        this._getConfig = null;
        this._monitor = null;
    }
}
