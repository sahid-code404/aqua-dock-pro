// AquaDockPro — mounted-device discovery and dock entry model.
//
// Gio.VolumeMonitor already exposes the user-visible mounts a file manager
// would show. This service keeps a small cached view of that list and refreshes
// only when Gio reports a mount, volume, or drive change.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

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
    try { console.error(`AquaDockPro: [${action}] ${error?.message ?? error}`); }
    catch { }
}

function runAsync(target, method, finish, args, action) {
    if (!target || typeof target[method] !== 'function') return false;
    try {
        target[method](...args, (source, result) => {
            try { (source ?? target)[finish]?.(result); }
            catch (error) { logActionError(action, error); }
        });
        return true;
    } catch (error) {
        logActionError(action, error);
        return false;
    }
}

// Prefer the mount itself: Gio will unmount it cleanly before ejecting when
// necessary. Some backends expose eject only on the owning volume or drive.
export function ejectMountedDevice(mount) {
    const volume = safely(() => mount?.get_volume());
    const drive = driveForMount(mount);
    const targets = [mount, volume, drive];
    for (const target of targets) {
        if (!safely(() => target?.can_eject(), false)) continue;
        if (runAsync(target, 'eject_with_operation', 'eject_with_operation_finish',
            [Gio.MountUnmountFlags.NONE, null, null], 'eject mounted device'))
            return true;
        if (runAsync(target, 'eject', 'eject_finish',
            [Gio.MountUnmountFlags.NONE, null], 'eject mounted device'))
            return true;
    }
    return false;
}

export function unmountMountedDevice(mount) {
    if (!safely(() => mount?.can_unmount(), false)) return false;
    if (runAsync(mount, 'unmount_with_operation', 'unmount_with_operation_finish',
        [Gio.MountUnmountFlags.NONE, null, null], 'unmount mounted device'))
        return true;
    return runAsync(mount, 'unmount', 'unmount_finish',
        [Gio.MountUnmountFlags.NONE, null], 'unmount mounted device');
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

export function buildMountedDeviceEntries(mounts, config = null) {
    const hidden = config?.hiddenMountedDevices;
    const hiddenIds = hidden instanceof Set
        ? hidden
        : new Set(Array.isArray(hidden) ? hidden : []);
    const entries = [];

    for (const mount of mounts ?? []) {
        const entry = mountedDeviceEntry(mount);
        if (!entry || !groupEnabled(entry.group, config) || hiddenIds.has(entry.deviceId))
            continue;
        entries.push(entry);
    }

    entries.sort(compareEntries);

    // UUIDs are expected to be unique, but cloned filesystems do exist. Keep
    // every mount addressable without weakening the stable per-device ID.
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

export class MountedDevices {
    constructor(getConfig, monitor = null) {
        this._getConfig = getConfig;
        this._monitor = monitor ?? Gio.VolumeMonitor.get();
        this._entries = listMountedDevices(this._monitor, this._getConfig?.());
        this._fingerprint = entriesFingerprint(this._entries);
        this._signalIds = [];
        this._refreshId = 0;
        this._onChanged = null;
    }

    get entries() {
        return this._entries;
    }

    start(onChanged) {
        this._onChanged = onChanged;
        if (this._signalIds.length || !this._monitor) return;

        for (const signal of [
            'mount-added',
            'mount-removed',
            'mount-changed',
            'volume-changed',
            'drive-changed',
        ]) {
            const id = safely(() => this._monitor.connect(signal, () => this._queueRefresh()), 0);
            if (id) this._signalIds.push(id);
        }

        this._refresh();
    }

    _queueRefresh() {
        if (this._refreshId) return;
        this._refreshId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._refreshId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _refresh() {
        if (!this._monitor) return;

        const entries = listMountedDevices(this._monitor, this._getConfig?.());
        const fingerprint = entriesFingerprint(entries);
        this._entries = entries;
        if (fingerprint === this._fingerprint) return;

        this._fingerprint = fingerprint;
        try {
            this._onChanged?.();
        } catch (error) {
            console.error(`AquaDockPro: [mounted devices changed] ${error}`);
        }
    }

    destroy() {
        if (this._refreshId) {
            try {
                GLib.Source.remove(this._refreshId);
            } catch {
                // Source already completed.
            }
            this._refreshId = 0;
        }

        if (this._monitor) {
            for (const id of this._signalIds) {
                try {
                    this._monitor.disconnect(id);
                } catch {
                    // The backend may already have gone away.
                }
            }
        }

        this._signalIds = [];
        this._entries = [];
        this._fingerprint = '';
        this._onChanged = null;
        this._getConfig = null;
        this._monitor = null;
    }
}
