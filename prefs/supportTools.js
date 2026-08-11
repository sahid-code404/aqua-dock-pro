// AquaDockPro preference backup and diagnostics helpers.

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { _, format, ngettext } from '../core/i18n.js';

function showMessage(window, heading, body) {
    const dialog = new Adw.MessageDialog({ transient_for: window, modal: true, heading, body });
    dialog.add_response('ok', _('OK'));
    dialog.connect('response', () => dialog.destroy());
    dialog.present();
}

function settingsDocument(settings, metadata) {
    const values = {};
    for (const key of settings.settings_schema.list_keys()) {
        if (key === 'settings-version') continue;
        const value = settings.get_value(key);
        values[key] = {
            type: value.get_type_string(),
            value: value.print(true),
        };
    }
    return {
        format: 1,
        uuid: metadata.uuid,
        extensionVersion: metadata.version,
        values,
    };
}

export function exportSettings(window, settings, metadata) {
    const dialog = new Gtk.FileDialog({
        title: _('Export AquaDockPro settings'),
        initial_name: `aqua-dock-pro-v${metadata.version}-settings.json`,
    });
    dialog.save(window, null, (source, result) => {
        try {
            const file = source.save_finish(result);
            const path = file?.get_path();
            if (!path) throw new Error(_('Please choose a local file.'));
            const text = `${JSON.stringify(settingsDocument(settings, metadata), null, 2)}\n`;
            GLib.file_set_contents(path, text);
            showMessage(window, _('Settings exported'), path);
        } catch (e) {
            if (!String(e).includes('Dismissed')) showMessage(window, _('Export failed'), e.message);
        }
    });
}

export function importSettings(window, settings, metadata) {
    const dialog = new Gtk.FileDialog({ title: _('Import AquaDockPro settings') });
    dialog.open(window, null, (source, result) => {
        try {
            const file = source.open_finish(result);
            const path = file?.get_path();
            if (!path) throw new Error(_('Please choose a local file.'));
            const [ok, bytes] = GLib.file_get_contents(path);
            if (!ok) throw new Error(_('The selected file could not be read.'));
            const doc = JSON.parse(new TextDecoder().decode(bytes));
            if (doc.format !== 1 || doc.uuid !== metadata.uuid || !doc.values)
                throw new Error(_('This is not an AquaDockPro settings backup.'));

            const parsed = [];
            for (const [key, record] of Object.entries(doc.values)) {
                if (key === 'settings-version') continue;
                if (!settings.settings_schema.has_key(key)) continue;
                const expected = settings.get_value(key).get_type_string();
                if (record.type !== expected)
                    throw new Error(format(_('Setting “%s” has the wrong type.'), key));
                parsed.push([key, GLib.Variant.parse(
                    new GLib.VariantType(expected), record.value, null, null)]);
            }
            settings.delay();
            try {
                for (const [key, value] of parsed) settings.set_value(key, value);
                settings.apply();
            } catch (e) {
                settings.revert();
                throw e;
            }
            showMessage(window, _('Settings imported'),
                format(ngettext('%d setting was restored.', '%d settings were restored.',
                    parsed.length), parsed.length));
        } catch (e) {
            if (!String(e).includes('Dismissed')) showMessage(window, _('Import failed'), e.message);
        }
    });
}

export function copyDiagnostics(window, settings, metadata) {
    const changed = [];
    for (const key of settings.settings_schema.list_keys()) {
        if (settings.get_user_value(key) !== null) changed.push(key);
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
