// Reusable Adwaita preference rows bound to GSettings.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { _ } from '../../core/i18n.js';
import { beginDialog, endDialog } from '../dialogLifecycle.js';

// Integer or fractional spinner. `digits` 0 → whole numbers (px/ms); ≥1 →
// fractional control for continuous values (factors, opacity, damping…).
/**
 * Creates an Adw.SpinRow bound to a numeric GSettings key.
 *
 * @param {Gio.Settings} s - Extension GSettings instance.
 * @param {string} key - Schema key name.
 * @param {string} title - Primary row title.
 * @param {string} subtitle - Explanatory subtitle text.
 * @param {number} lower - Minimum allowable value.
 * @param {number} upper - Maximum allowable value.
 * @param {number} step - Step increment for adjustments.
 * @param {number} [digits=0] - Decimal places precision (0 for integer values).
 * @returns {Adw.SpinRow} Configured and bound spin row.
 */
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

/**
 * Creates an Adw.SwitchRow bound to a boolean GSettings key.
 *
 * @param {Gio.Settings} s - Extension GSettings instance.
 * @param {string} key - Schema key name.
 * @param {string} title - Primary row title.
 * @param {string} subtitle - Explanatory subtitle text.
 * @param {Gio.SettingsBindFlags} [bindFlags=Gio.SettingsBindFlags.DEFAULT] - Binding flags.
 * @returns {Adw.SwitchRow} Configured and bound switch row.
 */
export function switchRow(s, key, title, subtitle, bindFlags = Gio.SettingsBindFlags.DEFAULT) {
    const row = new Adw.SwitchRow({ title, subtitle });
    s.bind(key, row, 'active', bindFlags);
    return row;
}

/**
 * Creates an Adw.EntryRow for capturing and parsing keyboard accelerators bound to a string array GSettings key.
 *
 * @param {Adw.PreferencesWindow} window - Parent preferences window tracking signal connections.
 * @param {Gio.Settings} s - Extension GSettings instance.
 * @param {string} key - Schema key name storing accelerator strings.
 * @param {string} title - Primary row title.
 * @param {string} subtitle - Explanatory tooltip text.
 * @returns {Adw.EntryRow} Configured shortcut entry row.
 */
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

/**
 * Creates an Adw.ComboRow dropdown bound to a string GSettings key.
 *
 * @param {Adw.PreferencesWindow} window - Parent preferences window tracking signal connections.
 * @param {Gio.Settings} s - Extension GSettings instance.
 * @param {string} key - Schema key name.
 * @param {string} title - Primary row title.
 * @param {string} subtitle - Explanatory subtitle text.
 * @param {string[]} labels - User-visible display labels.
 * @param {string[]} values - Stored schema string values.
 * @returns {Adw.ComboRow} Configured combo dropdown row.
 */
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
/**
 * Creates an Adw.ActionRow hosting a Gtk.ColorDialogButton with alpha support, bound to a CSS color string key.
 *
 * @param {Adw.PreferencesWindow} window - Parent preferences window tracking signal connections.
 * @param {Gio.Settings} s - Extension GSettings instance.
 * @param {string} key - Schema key name storing CSS color string.
 * @param {string} title - Primary row title.
 * @param {string} subtitle - Explanatory subtitle text.
 * @returns {Adw.ActionRow} Configured color picker row.
 */
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
    row.activatable_widget = button;
    return row;
}

// An icon picker: a live preview, an editable field (type a theme icon name),
// a "browse" button that opens a native image file chooser, and a clear button
// to fall back to the default. Stores a theme name or an absolute file path.
/**
 * Creates an Adw.EntryRow with icon preview, theme lookup, and file browsing for custom icon selection.
 *
 * @param {Adw.PreferencesWindow} window - Parent preferences window.
 * @param {Gio.Settings} s - Extension GSettings instance.
 * @param {string} key - Schema key name storing icon name or image file path.
 * @param {string} title - Primary row title.
 * @returns {Adw.EntryRow} Configured icon chooser row.
 */
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
        } catch { /* intentionally ignored: icon file or name invalid fallback to missing icon symbolic */ preview.set_from_icon_name('image-missing-symbolic'); }
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
            } catch { /* intentionally ignored: file or folder dialog dismissed or cancelled */ }
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

/**
 * Creates an Adw.ActionRow with a native folder chooser dialog for custom folder stack selection.
 *
 * @param {Adw.PreferencesWindow} window - Parent preferences window.
 * @param {Gio.Settings} s - Extension GSettings instance.
 * @param {string} key - Schema key name storing folder URI string.
 * @param {string} title - Primary row title.
 * @param {string} subtitle - Explanatory subtitle text.
 * @returns {Adw.ActionRow} Configured folder chooser row.
 */
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
            } catch { /* intentionally ignored: file or folder dialog dismissed or cancelled */ }
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
/**
 * Creates an expandable Adw.ExpanderRow for nesting secondary preference controls.
 *
 * @param {string} title - Primary row title.
 * @param {string} subtitle - Explanatory subtitle text.
 * @param {string|null} [iconName=null] - Optional symbolic icon name.
 * @param {boolean} [expanded=false] - Initial expansion state.
 * @returns {Adw.ExpanderRow} Configured expander row.
 */
export function expanderRow(title, subtitle, iconName = null, expanded = false) {
    const row = new Adw.ExpanderRow({ title, subtitle, expanded });
    addExpanderIcon(row, iconName);
    return row;
}

// A compact feature card: its built-in switch is bound directly to the feature
// setting, while child controls stay tucked away until the user opens the row.
/**
 * Creates an Adw.ExpanderRow featuring an integrated enable switch directly bound to a boolean setting.
 *
 * @param {Gio.Settings} s - Extension GSettings instance.
 * @param {string} key - Boolean schema key controlling feature enablement.
 * @param {string} title - Primary row title.
 * @param {string} subtitle - Explanatory subtitle text.
 * @param {string|null} [iconName=null] - Optional symbolic icon name.
 * @param {boolean} [expanded=false] - Initial expansion state.
 * @returns {Adw.ExpanderRow} Configured toggle expander row.
 */
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

/**
 * Creates a standard Adw.PreferencesGroup container with title and optional description.
 *
 * @param {string} title - Group heading title.
 * @param {string} description - Group subtitle description.
 * @returns {Adw.PreferencesGroup} New preferences group instance.
 */
export function group(title, description) {
    const escapedTitle = title ? GLib.markup_escape_text(title, -1) : title;
    const escapedDesc = description ? GLib.markup_escape_text(description, -1) : description;
    return new Adw.PreferencesGroup({ title: escapedTitle, description: escapedDesc });
}

/**
 * Creates a standard Adw.PreferencesPage with title and symbolic icon.
 *
 * @param {string} title - Page title for sidebar navigation.
 * @param {string} iconName - Symbolic icon name for sidebar navigation.
 * @returns {Adw.PreferencesPage} New preferences page instance.
 */
export function page(title, iconName) {
    return new Adw.PreferencesPage({ title, icon_name: iconName });
}
