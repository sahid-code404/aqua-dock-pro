// Preferences page for extension about info and diagnostics.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { page, group } from '../widgets/rows.js';
import { copyDiagnostics, exportSettings, importSettings } from '../supportTools.js';
import { _ } from '../../core/i18n.js';

export function buildAboutPage(window, s, metadata, extraSettings = {}) {
    const p = page(_('About'), 'help-about-symbolic');
    window.add(p);

    const info = group(_('AquaDockPro'), metadata?.description ?? '');
    const versionRow = new Adw.ActionRow({
        title: _('Version'),
        subtitle: String(metadata?.version ?? '—'),
    });
    info.add(versionRow);

    if (metadata?.url) {
        const linkRow = new Adw.ActionRow({ title: _('Project page'), subtitle: metadata.url });
        const open = new Gtk.Button({ icon_name: 'adw-external-link-symbolic', valign: Gtk.Align.CENTER });
        open.add_css_class('flat');
        open.connect('clicked', () => {
            try { Gtk.show_uri(window, metadata.url, Gtk.get_current_event_time?.() ?? 0); }
            catch { try { Gio.AppInfo.launch_default_for_uri(metadata.url, null); } catch { } }
        });
        linkRow.add_suffix(open);
        linkRow.set_activatable_widget(open);
        info.add(linkRow);
    }
    p.add(info);

    const support = group(_('Backup and support'),
        _('Move settings safely or collect a privacy-safe support report.'));
    const backupRow = new Adw.ActionRow({ title: _('Settings backup') });
    const exportButton = new Gtk.Button({ label: _('Export'), valign: Gtk.Align.CENTER });
    exportButton.connect('clicked', () =>
        exportSettings(window, s, metadata, extraSettings));
    backupRow.add_suffix(exportButton);
    const importButton = new Gtk.Button({ label: _('Import'), valign: Gtk.Align.CENTER });
    importButton.connect('clicked', () =>
        importSettings(window, s, metadata, extraSettings));
    backupRow.add_suffix(importButton);
    support.add(backupRow);

    const diagnosticsRow = new Adw.ActionRow({
        title: _('Diagnostics'),
        subtitle: _('Copies versions and changed setting names, without private values'),
    });
    const diagnosticsButton = new Gtk.Button({ label: _('Copy'), valign: Gtk.Align.CENTER });
    diagnosticsButton.connect('clicked', () =>
        copyDiagnostics(window, s, metadata, extraSettings));
    diagnosticsRow.add_suffix(diagnosticsButton);
    support.add(diagnosticsRow);
    p.add(support);

    // ── Reset ──
    const reset = group(_('Reset'), _('Restore every setting to its default value.'));
    const resetRow = new Adw.ActionRow({
        title: _('Reset all settings'),
        subtitle: _('This cannot be undone'),
    });
    const resetBtn = new Gtk.Button({ label: _('Reset'), valign: Gtk.Align.CENTER });
    resetBtn.add_css_class('destructive-action');
    resetBtn.connect('clicked', () => {
        const dialog = new Adw.MessageDialog({
            transient_for: window, modal: true,
            heading: _('Reset all settings?'),
            body: _('Every AquaDockPro preference will return to its default.'),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('reset', _('Reset'));
        dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_d, resp) => {
            if (resp === 'reset') {
                const schemas = [s, ...Object.values(extraSettings)];
                for (const settings of schemas) {
                    for (const key of settings.settings_schema.list_keys()) {
                        if (settings === s && key === 'settings-version') continue;
                        try { settings.reset(key); } catch { }
                    }
                }
            }
            dialog.destroy();
        });
        dialog.present();
    });
    resetRow.add_suffix(resetBtn);
    reset.add(resetRow);
    p.add(reset);
}
