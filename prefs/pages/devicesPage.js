// Preferences page for mounted-device visibility.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { buildMountedDeviceEntries } from '../../services/mountedDevices.js';
import { _ } from '../../core/i18n.js';
import { page, group, switchRow, expanderRow } from '../widgets/rows.js';

const DEVICE_TYPES = Object.freeze({
    removable: 'Removable device',
    network: 'Network location',
    fixed: 'Fixed volume',
});

export function buildDevicesPage(window, s) {
    const p = page(_('Devices'), 'drive-removable-media-symbolic');
    window.add(p);

    const visibility = group(_('Mounted devices'),
        _('Choose which mounted storage appears beside Downloads.'));
    visibility.add(switchRow(s, 'show-mounted-devices', _('Show mounted devices'),
        _('Add mounted storage and network locations to the dock')));

    const types = expanderRow(_('Device types'),
        _('Control whole categories of mounted storage.'), 'drive-removable-media-symbolic');
    const typeRows = [
        switchRow(s, 'show-removable-devices', _('Removable devices'),
            _('Show USB storage, memory cards and optical media')),
        switchRow(s, 'show-network-devices', _('Network locations'),
            _('Show mounted servers and other remote locations')),
        switchRow(s, 'show-fixed-devices', _('Fixed volumes'),
            _('Show mounted internal and permanently attached volumes')),
    ];
    for (const row of typeRows) types.add_row(row);
    visibility.add(types);
    p.add(visibility);

    const syncTypeSensitivity = () => {
        const enabled = s.get_boolean('show-mounted-devices');
        types.sensitive = enabled;
        for (const row of typeRows) row.sensitive = enabled;
    };
    syncTypeSensitivity();
    window._settingsSignalIds.push(
        s.connect('changed::show-mounted-devices', syncTypeSensitivity));

    const current = group(_('Currently mounted'),
        _('Turn off an individual device to keep it hidden when it reconnects.'));
    p.add(current);

    const monitor = Gio.VolumeMonitor.get();
    const rows = new Map();
    const monitorSignalIds = [];
    let syncing = false;
    let refreshId = 0;
    let disposed = false;

    const hiddenDevices = () => new Set(s.get_strv('hidden-mounted-devices'));

    const syncSelections = () => {
        const hidden = hiddenDevices();
        syncing = true;
        try {
            for (const record of rows.values()) {
                if (record.toggle)
                    record.toggle.active = !hidden.has(record.deviceId);
            }
        } finally {
            syncing = false;
        }
    };

    const setDeviceVisible = (deviceId, visible) => {
        const hidden = hiddenDevices();
        const alreadyVisible = !hidden.has(deviceId);
        if (visible === alreadyVisible) return;

        if (visible) hidden.delete(deviceId);
        else hidden.add(deviceId);
        s.set_strv('hidden-mounted-devices', [...hidden].sort());
    };

    const clearRows = () => {
        for (const { row } of rows.values()) current.remove(row);
        rows.clear();
    };

    const addEmptyRow = () => {
        const row = new Adw.ActionRow({
            title: _('No devices are mounted'),
            subtitle: _('Mounted storage will appear here automatically.'),
            sensitive: false,
        });
        current.add(row);
        rows.set('empty', { row, toggle: null, deviceId: null });
    };

    const addDeviceRow = (entry, hidden) => {
        const row = new Adw.ActionRow({
            title: entry.name,
            subtitle: `${_(DEVICE_TYPES[entry.group] ?? 'Mounted device')} · ${entry.uri}`,
            subtitle_lines: 2,
        });
        row.add_prefix(new Gtk.Image({
            gicon: entry.gicon,
            pixel_size: 24,
            valign: Gtk.Align.CENTER,
        }));

        const toggle = new Gtk.Switch({
            active: !hidden.has(entry.deviceId),
            valign: Gtk.Align.CENTER,
        });
        toggle.connect('notify::active', () => {
            if (!syncing) setDeviceVisible(entry.deviceId, toggle.active);
        });
        row.add_suffix(toggle);
        current.add(row);
        rows.set(entry.key, { row, toggle, deviceId: entry.deviceId });
    };

    const rebuildRows = () => {
        if (disposed) return;
        clearRows();

        let entries = [];
        try {
            entries = buildMountedDeviceEntries(monitor.get_mounts());
        } catch (e) {
            console.error(`AquaDockPro: unable to list mounted devices: ${e}`);
        }

        if (entries.length === 0) {
            addEmptyRow();
            return;
        }

        syncing = true;
        try {
            const hidden = hiddenDevices();
            for (const entry of entries) addDeviceRow(entry, hidden);
        } finally {
            syncing = false;
        }
    };

    const queueRebuild = () => {
        if (disposed || refreshId) return;
        refreshId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            refreshId = 0;
            rebuildRows();
            return GLib.SOURCE_REMOVE;
        });
    };

    for (const signal of [
        'mount-added', 'mount-removed', 'mount-changed',
        'volume-added', 'volume-removed', 'volume-changed',
        'drive-connected', 'drive-disconnected', 'drive-changed',
    ]) {
        try { monitorSignalIds.push(monitor.connect(signal, queueRebuild)); }
        catch { /* unavailable on an unusual volume-monitor backend */ }
    }

    window._settingsSignalIds.push(
        s.connect('changed::hidden-mounted-devices', syncSelections));
    window._cleanupCallbacks ??= [];
    window._cleanupCallbacks.push(() => {
        disposed = true;
        if (refreshId) {
            GLib.source_remove(refreshId);
            refreshId = 0;
        }
        for (const id of monitorSignalIds) {
            try { monitor.disconnect(id); } catch { }
        }
        monitorSignalIds.length = 0;
        clearRows();
    });

    rebuildRows();
}
