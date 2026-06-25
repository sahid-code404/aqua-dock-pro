// AquaDockPro preferences — About page (info + reset).

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { page, group } from '../widgets/rows.js';

export function buildAboutPage(window, s, metadata) {
    const p = page('About', 'help-about-symbolic');
    window.add(p);

    const info = group('AquaDockPro', metadata?.description ?? '');
    const versionRow = new Adw.ActionRow({
        title: 'Version',
        subtitle: String(metadata?.version ?? '—'),
    });
    info.add(versionRow);

    if (metadata?.url) {
        const linkRow = new Adw.ActionRow({ title: 'Project page', subtitle: metadata.url });
        const open = new Gtk.Button({ icon_name: 'adw-external-link-symbolic', valign: Gtk.Align.CENTER });
        open.add_css_class('flat');
        open.connect('clicked', () => {
            try { Gtk.show_uri(window, metadata.url, Gtk.get_current_event_time?.() ?? 0); }
            catch { try { Gio.AppInfo.launch_default_for_uri(metadata.url, null); } catch { } }
        });
        linkRow.add_suffix(open);
        linkRow.activatable_widget = open;
        info.add(linkRow);
    }
    p.add(info);

    // ── Reset ──
    const reset = group('Reset', 'Restore every setting to its default value.');
    const resetRow = new Adw.ActionRow({
        title: 'Reset all settings',
        subtitle: 'This cannot be undone',
    });
    const resetBtn = new Gtk.Button({ label: 'Reset', valign: Gtk.Align.CENTER });
    resetBtn.add_css_class('destructive-action');
    resetBtn.connect('clicked', () => {
        const dialog = new Adw.MessageDialog({
            transient_for: window, modal: true,
            heading: 'Reset all settings?',
            body: 'Every AquaDockPro preference will return to its default.',
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('reset', 'Reset');
        dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_d, resp) => {
            if (resp === 'reset') {
                for (const key of s.settings_schema.list_keys()) {
                    try { s.reset(key); } catch { }
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
