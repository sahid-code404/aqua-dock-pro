// AquaDockPro preference backup and diagnostics helpers.

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { _, format, ngettext } from '../core/i18n.js';
import { beginDialog, endDialog } from './dialogLifecycle.js';

function showMessage(window, heading, body) {
    const dialog = new Adw.MessageDialog({ transient_for: window, modal: true, heading, body });
    dialog.add_response('ok', _('OK'));
    dialog.connect('response', () => dialog.destroy());
    dialog.present();
}

function settingsValues(settings, skipSettingsVersion = false) {
    const values = {};
    for (const key of settings.settings_schema.list_keys()) {
        if (skipSettingsVersion && key === 'settings-version') continue;
        const value = settings.get_value(key);
        values[key] = {
            type: value.get_type_string(),
            value: value.print(true),
        };
    }
    return values;
}

function settingsDocument(settings, metadata, extraSettings = {}) {
    const auxiliary = {};
    for (const [name, extra] of Object.entries(extraSettings))
        auxiliary[name] = settingsValues(extra);

    // Keep format 1 so older AquaDockPro builds can still import the primary
    // settings from a newer backup; they simply ignore the auxiliary field.
    return {
        format: 1,
        uuid: metadata.uuid,
        extensionVersion: metadata.version,
        values: settingsValues(settings, true),
        auxiliary,
    };
}

export function exportSettings(window, settings, metadata, extraSettings = {}) {
    const dialog = new Gtk.FileDialog({
        title: _('Export AquaDockPro settings'),
        initial_name: `aqua-dock-pro-v${metadata.version}-settings.json`,
    });
    const cancellable = beginDialog(window);
    dialog.save(window, cancellable, (source, result) => {
        endDialog(window, cancellable);
        try {
            const file = source.save_finish(result);
            const path = file?.get_path();
            if (!path) throw new Error(_('Please choose a local file.'));
            const text = `${JSON.stringify(
                settingsDocument(settings, metadata, extraSettings), null, 2)}\n`;
            GLib.file_set_contents(path, text);
            showMessage(window, _('Settings exported'), path);
        } catch (e) {
            if (!cancellable.is_cancelled() && !String(e).includes('Dismissed'))
                showMessage(window, _('Export failed'), e.message);
        }
    });
}

function parseSettingsRecords(settings, records, skipSettingsVersion = false) {
    const parsed = [];
    if (!records || typeof records !== 'object') return parsed;
    for (const [key, record] of Object.entries(records)) {
        if (skipSettingsVersion && key === 'settings-version') continue;
        if (!settings.settings_schema.has_key(key)) continue;
        const expected = settings.get_value(key).get_type_string();
        if (record?.type !== expected)
            throw new Error(format(_('Setting “%s” has the wrong type.'), key));
        parsed.push({
            settings,
            key,
            value: GLib.Variant.parse(
                new GLib.VariantType(expected), record.value, null, null),
        });
    }
    return parsed;
}

export function importSettings(window, settings, metadata, extraSettings = {}) {
    const dialog = new Gtk.FileDialog({ title: _('Import AquaDockPro settings') });
    const cancellable = beginDialog(window);
    dialog.open(window, cancellable, (source, result) => {
        endDialog(window, cancellable);
        try {
            const file = source.open_finish(result);
            const path = file?.get_path();
            if (!path) throw new Error(_('Please choose a local file.'));
            const [ok, bytes] = GLib.file_get_contents(path);
            if (!ok) throw new Error(_('The selected file could not be read.'));
            const doc = JSON.parse(new TextDecoder().decode(bytes));
            if (doc.format !== 1 || doc.uuid !== metadata.uuid || !doc.values)
                throw new Error(_('This is not an AquaDockPro settings backup.'));

            const parsed = parseSettingsRecords(settings, doc.values, true);
            for (const [name, extra] of Object.entries(extraSettings)) {
                parsed.push(...parseSettingsRecords(
                    extra,
                    doc.auxiliary?.[name],
                    false,
                ));
            }

            // Parse and validate the whole document before changing anything.
            // Gio.Settings.delay() is sticky for the lifetime of the object,
            // which would leave the rest of the preferences window delayed.
            const previous = parsed.map(record => ({
                ...record,
                previous: record.settings.get_user_value(record.key),
            }));
            try {
                for (const record of parsed) {
                    if (!record.settings.set_value(record.key, record.value))
                        throw new Error(format(
                            _('Setting “%s” could not be restored.'), record.key));
                }
            } catch (e) {
                for (const record of previous.reverse()) {
                    if (record.previous === null) record.settings.reset(record.key);
                    else record.settings.set_value(record.key, record.previous);
                }
                throw e;
            }
            showMessage(window, _('Settings imported'),
                format(ngettext('%d setting was restored.', '%d settings were restored.',
                    parsed.length), parsed.length));
        } catch (e) {
            if (!cancellable.is_cancelled() && !String(e).includes('Dismissed'))
                showMessage(window, _('Import failed'), e.message);
        }
    });
}

export function copyDiagnostics(window, settings, metadata, extraSettings = {}) {
    const changed = [];
    for (const key of settings.settings_schema.list_keys()) {
        if (settings.get_user_value(key) !== null) changed.push(key);
    }
    for (const [name, extra] of Object.entries(extraSettings)) {
        for (const key of extra.settings_schema.list_keys()) {
            if (extra.get_user_value(key) !== null) changed.push(`${name}.${key}`);
        }
    }
    const report = [
        `AquaDockPro ${metadata.version}`,
        `GNOME Shell: ${GLib.getenv('GNOME_SHELL_VERSION') ?? 'unknown'}`,
        `Session: ${GLib.getenv('XDG_SESSION_TYPE') ?? 'unknown'}`,
        `OS: ${GLib.get_os_info('NAME') ?? 'unknown'} ${GLib.get_os_info('VERSION_ID') ?? ''}`.trim(),
        `Changed settings (${changed.length}): ${changed.join(', ') || 'none'}`,
    ].join('\n');
    window.get_clipboard().set_text(report);
    showMessage(window, _('Diagnostics copied'),
        _('The report is ready to paste into a support request.'));
}
