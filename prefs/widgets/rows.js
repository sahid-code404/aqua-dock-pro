// Reusable Adwaita preference rows bound to GSettings.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { _ } from '../../core/i18n.js';
import { beginDialog, endDialog } from '../dialogLifecycle.js';

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

export function shortcutRow(window, s, key, title, subtitle) {
    const row = new Adw.EntryRow({ title, show_apply_button: true });
    row.set_tooltip_text(subtitle);
    let syncing = false;

    const load = () => {
        const text = s.get_strv(key)[0] ?? '';
        if (row.text === text) return;
        syncing = true;
        try { row.text = text; }
        finally { syncing = false; }
    };
    load();
    row.connect('apply', () => {
        if (syncing) return;
        const text = row.text.trim();
        const [valid, keyval] = Gtk.accelerator_parse(text);
        if (text && (!valid || keyval === 0)) {
            load();
            return;
        }
        const next = text ? [text] : [];
        if (JSON.stringify(next) !== JSON.stringify(s.get_strv(key))) s.set_strv(key, next);
    });
    window._settingsSignalIds.push(s.connect(`changed::${key}`, load));
    return row;
}

export function comboRow(window, s, key, title, subtitle, labels, values) {
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(labels),
    });
    let syncingFromSettings = false;

    row.selected = Math.max(0, values.indexOf(s.get_string(key)));
    row.connect('notify::selected', () => {
        if (syncingFromSettings) return;

        const value = values[row.selected];
        if (value !== undefined && value !== s.get_string(key)) s.set_string(key, value);
    });
    window._settingsSignalIds.push(s.connect(`changed::${key}`, () => {
        const i = values.indexOf(s.get_string(key));
        const selected = i >= 0 ? i : 0;
        if (row.selected === selected) return;

        syncingFromSettings = true;
        try {
            row.selected = selected;
        } finally {
            syncingFromSettings = false;
        }
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
    let syncingFromSettings = false;

    const load = () => {
        const rgba = new Gdk.RGBA();
        if (!rgba.parse(s.get_string(key))) return;

        syncingFromSettings = true;
        try {
            button.set_rgba(rgba);
        } finally {
            syncingFromSettings = false;
        }
    };
    load();
    button.connect('notify::rgba', () => {
        if (syncingFromSettings) return;

        const value = button.get_rgba().to_string();
        if (value !== s.get_string(key)) s.set_string(key, value);
    });
    window._settingsSignalIds.push(s.connect(`changed::${key}`, load));
    row.add_suffix(button);
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
        tooltip_text: _('Choose an image (PNG, JPEG, SVG…)'),
    });
    browse.add_css_class('flat');
    browse.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({ title: _('Choose an application icon'), modal: true });
        const filter = new Gtk.FileFilter({ name: _('Images') });
        filter.add_pixbuf_formats();
        filter.add_mime_type('image/svg+xml');
        const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
        filters.append(filter);
        dialog.set_filters(filters);
        dialog.set_default_filter(filter);
        const cancellable = beginDialog(window);
        dialog.open(window, cancellable, (d, res) => {
            endDialog(window, cancellable);
            try {
                const file = d.open_finish(res);
                if (file) s.set_string(key, file.get_path());
            } catch { /* dismissed or cancelled */ }
        });
    });
    row.add_suffix(browse);

    const clear = new Gtk.Button({
        icon_name: 'edit-clear-symbolic', valign: Gtk.Align.CENTER,
        tooltip_text: _('Use the default icon'),
    });
    clear.add_css_class('flat');
    clear.connect('clicked', () => s.set_string(key, ''));
    row.add_suffix(clear);

    return row;
}

export function folderChooserRow(window, s, key, title, subtitle) {
    const row = new Adw.ActionRow({ title, subtitle });
    const label = new Gtk.Label({
        label: s.get_string(key) || _('No folder selected'),
        ellipsize: 3,
        max_width_chars: 28,
        valign: Gtk.Align.CENTER,
    });
    const refresh = () => { label.label = s.get_string(key) || _('No folder selected'); };
    window._settingsSignalIds.push(s.connect(`changed::${key}`, refresh));
    row.add_suffix(label);

    const choose = new Gtk.Button({ label: _('Choose'), valign: Gtk.Align.CENTER });
    choose.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({ title: _('Choose a folder stack'), modal: true });
        const cancellable = beginDialog(window);
        dialog.select_folder(window, cancellable, (source, result) => {
            endDialog(window, cancellable);
            try {
                const folder = source.select_folder_finish(result);
                if (folder) s.set_string(key, folder.get_uri());
            } catch { /* dismissed or cancelled */ }
        });
    });
    row.add_suffix(choose);
    return row;
}

function addExpanderIcon(row, iconName) {
    if (!iconName) return;
    const icon = new Gtk.Image({
        icon_name: iconName,
        pixel_size: 18,
        valign: Gtk.Align.CENTER,
    });
    icon.add_css_class('dim-label');
    row.add_prefix(icon);
}

// Adw.ExpanderRow keeps secondary/advanced settings one click away without
// turning a PreferencesPage into a long wall of controls.
export function expanderRow(title, subtitle, iconName = null, expanded = false) {
    const row = new Adw.ExpanderRow({ title, subtitle, expanded });
    addExpanderIcon(row, iconName);
    return row;
}

// A compact feature card: its built-in switch is bound directly to the feature
// setting, while child controls stay tucked away until the user opens the row.
export function toggleExpander(s, key, title, subtitle, iconName = null, expanded = false) {
    const enabled = s.get_boolean(key);
    const row = new Adw.ExpanderRow({
        title,
        subtitle,
        show_enable_switch: true,
        enable_expansion: enabled,
        expanded: enabled && expanded,
    });
    addExpanderIcon(row, iconName);
    s.bind(key, row, 'enable-expansion', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function group(title, description) {
    return new Adw.PreferencesGroup({ title, description });
}

export function page(title, iconName) {
    return new Adw.PreferencesPage({ title, icon_name: iconName });
}
