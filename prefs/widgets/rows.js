// AquaDockPro preferences — reusable Adwaita rows.
//
// Purpose:   One small, consistent vocabulary of bound rows (spin / switch /
//            combo / colour / entry / icon-chooser) so every page is built the
//            same way and stays two-way bound to GSettings. Continuous/abstract
//            values use fractional spinners (digits ≥ 2); pixels/ms use integer
//            steppers — the caller decides per row.
// Ownership: Rows bind directly to GSettings. Manual `changed::` connections
//            (combo/colour) are tracked on window._settingsSignalIds and dropped
//            on window close.
// Cost:      UI-thread only; built once when the prefs window opens.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

// Integer or fractional spinner. `digits` 0 → whole numbers (px/ms); ≥1 →
// fractional control for continuous values (factors, opacity, damping…).
export function spinRow(s, key, title, subtitle, lower, upper, step, digits = 0) {
    const row = new Adw.SpinRow({
        title, subtitle, digits,
        adjustment: new Gtk.Adjustment({
            lower, upper, step_increment: step, page_increment: step * 5,
        }),
    });
    s.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function switchRow(s, key, title, subtitle) {
    const row = new Adw.SwitchRow({ title, subtitle });
    s.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function comboRow(window, s, key, title, subtitle, labels, values) {
    const row = new Adw.ComboRow({ title, subtitle, model: Gtk.StringList.new(labels) });
    row.selected = Math.max(0, values.indexOf(s.get_string(key)));
    row.connect('notify::selected', () => s.set_string(key, values[row.selected]));
    window._settingsSignalIds.push(s.connect(`changed::${key}`, () => {
        const i = values.indexOf(s.get_string(key));
        row.selected = i >= 0 ? i : 0;
    }));
    return row;
}

// Colour picker whose alpha doubles as intensity; stored as a CSS colour string.
export function colorRow(window, s, key, title, subtitle) {
    const row = new Adw.ActionRow({ title, subtitle });
    const button = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({ with_alpha: true }),
        valign: Gtk.Align.CENTER,
    });
    const load = () => {
        const rgba = new Gdk.RGBA();
        if (rgba.parse(s.get_string(key))) button.set_rgba(rgba);
    };
    load();
    button.connect('notify::rgba', () => s.set_string(key, button.get_rgba().to_string()));
    window._settingsSignalIds.push(s.connect(`changed::${key}`, load));
    row.add_suffix(button);
    row.activatable_widget = button;
    return row;
}

// An icon picker: a live preview, an editable field (type a theme icon name),
// a "browse" button that opens a native image file chooser, and a clear button
// to fall back to the default. Stores a theme name or an absolute file path.
export function iconChooserRow(window, s, key, title) {
    const row = new Adw.EntryRow({ title });
    s.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);

    const preview = new Gtk.Image({ pixel_size: 28, valign: Gtk.Align.CENTER });
    const refresh = () => {
        const v = (s.get_string(key) ?? '').trim();
        try {
            if (!v) preview.set_from_icon_name('view-app-grid-symbolic');
            else if (v.includes('/')) preview.set_from_file(v);
            else preview.set_from_icon_name(v);
        } catch { preview.set_from_icon_name('image-missing-symbolic'); }
    };
    refresh();
    window._settingsSignalIds.push(s.connect(`changed::${key}`, refresh));
    row.add_prefix(preview);

    const browse = new Gtk.Button({
        icon_name: 'document-open-symbolic', valign: Gtk.Align.CENTER,
        tooltip_text: 'Choose an image (PNG, JPEG, SVG…)',
    });
    browse.add_css_class('flat');
    browse.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({ title: 'Choose an application icon', modal: true });
        const filter = new Gtk.FileFilter({ name: 'Images' });
        filter.add_pixbuf_formats();
        filter.add_mime_type('image/svg+xml');
        const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
        filters.append(filter);
        dialog.set_filters(filters);
        dialog.set_default_filter(filter);
        dialog.open(window, null, (d, res) => {
            try {
                const file = d.open_finish(res);
                if (file) s.set_string(key, file.get_path());
            } catch { /* dismissed */ }
        });
    });
    row.add_suffix(browse);

    const clear = new Gtk.Button({
        icon_name: 'edit-clear-symbolic', valign: Gtk.Align.CENTER,
        tooltip_text: 'Use the default icon',
    });
    clear.add_css_class('flat');
    clear.connect('clicked', () => s.set_string(key, ''));
    row.add_suffix(clear);

    return row;
}

export function group(title, description) {
    return new Adw.PreferencesGroup({ title, description });
}

export function page(title, iconName) {
    return new Adw.PreferencesPage({ title, icon_name: iconName });
}
