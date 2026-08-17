// Preferences editor for user-defined dock locations and layout markers.

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { _, format } from '../../core/i18n.js';
import { parseCustomItems, serializeCustomItems } from '../../services/customItems.js';
import { beginDialog, endDialog } from '../dialogLifecycle.js';

const TYPE_LABELS = {
    folder: _('Folder stack'),
    file: _('File'),
    url: _('Web link'),
    separator: _('Separator'),
    spacer: _('Spacer'),
};

function iconFor(type) {
    switch (type) {
        case 'folder': return 'folder-symbolic';
        case 'file': return 'text-x-generic-symbolic';
        case 'url': return 'web-browser-symbolic';
        case 'separator': return 'view-more-symbolic';
        default: return 'pan-end-symbolic';
    }
}

function button(icon, tooltip, action) {
    const widget = new Gtk.Button({
        icon_name: icon,
        tooltip_text: tooltip,
        valign: Gtk.Align.CENTER,
    });
    widget.add_css_class('flat');
    widget.connect('clicked', action);
    return widget;
}

export function buildCustomItemsEditor(window, settings, group) {
    let rows = [];
    let rebuilding = false;

    const load = () => parseCustomItems(settings.get_strv('custom-dock-items'));
    const save = items => settings.set_strv('custom-dock-items', serializeCustomItems(items));
    const add = item => save([...load(), { id: GLib.uuid_string_random(), ...item }]);

    const locationControls = new Adw.ActionRow({
        title: _('Add dock locations'),
        subtitle: _('Folders open as stacks; files and links open in their default application'),
    });
    locationControls.add_suffix(button('folder-new-symbolic', _('Add folder'), () => {
        const dialog = new Gtk.FileDialog({ title: _('Add a folder stack'), modal: true });
        const cancellable = beginDialog(window);
        dialog.select_folder(window, cancellable, (source, result) => {
            endDialog(window, cancellable);
            try {
                const file = source.select_folder_finish(result);
                if (file) add({ type: 'folder', uri: file.get_uri(), name: file.get_basename() ?? '' });
            } catch { }
        });
    }));
    locationControls.add_suffix(button('document-open-symbolic', _('Add file'), () => {
        const dialog = new Gtk.FileDialog({ title: _('Add a file'), modal: true });
        const cancellable = beginDialog(window);
        dialog.open(window, cancellable, (source, result) => {
            endDialog(window, cancellable);
            try {
                const file = source.open_finish(result);
                if (file) add({ type: 'file', uri: file.get_uri(), name: file.get_basename() ?? '' });
            } catch { }
        });
    }));
    locationControls.add_suffix(button('web-browser-symbolic', _('Add web link'), () => {
        const dialog = new Adw.AlertDialog({
            heading: _('Add a web link'),
            body: format(_('Enter a complete address such as %s'), 'https://example.com'),
        });
        const entry = new Gtk.Entry({
            placeholder_text: 'https://example.com',
            activates_default: true,
        });
        dialog.set_extra_child(entry);
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('add', _('Add'));
        dialog.set_response_appearance('add', Adw.ResponseAppearance.SUGGESTED);
        dialog.set_default_response('add');
        dialog.set_close_response('cancel');
        dialog.connect('response', (_dialog, response) => {
            if (response !== 'add') return;
            const uri = entry.text.trim();
            const scheme = GLib.uri_parse_scheme(uri);
            if (scheme === 'http' || scheme === 'https')
                add({ type: 'url', uri, name: uri });
        });
        dialog.present(window);
    }));
    group.add(locationControls);

    const layoutControls = new Adw.ActionRow({
        title: _('Add layout item'),
        subtitle: _('Separators draw a line; spacers add a small empty gap'),
    });
    layoutControls.add_suffix(button('view-more-symbolic', _('Add separator'),
        () => add({ type: 'separator' })));
    layoutControls.add_suffix(button('pan-end-symbolic', _('Add spacer'),
        () => add({ type: 'spacer' })));
    group.add(layoutControls);

    const rebuild = () => {
        if (rebuilding) return;
        rebuilding = true;
        try {
            for (const row of rows) group.remove(row);
            rows = [];
            const items = load();
            for (let index = 0; index < items.length; index++) {
                const item = items[index];
                const row = new Adw.ActionRow({
                    title: item.name || TYPE_LABELS[item.type] || _('Dock item'),
                    subtitle: item.uri || TYPE_LABELS[item.type] || '',
                });
                row.add_prefix(new Gtk.Image({ icon_name: iconFor(item.type) }));
                const up = button('go-up-symbolic', _('Move up'), () => {
                    if (index === 0) return;
                    const current = load();
                    [current[index - 1], current[index]] = [current[index], current[index - 1]];
                    save(current);
                });
                up.sensitive = index > 0;
                row.add_suffix(up);
                const down = button('go-down-symbolic', _('Move down'), () => {
                    const current = load();
                    if (index >= current.length - 1) return;
                    [current[index], current[index + 1]] = [current[index + 1], current[index]];
                    save(current);
                });
                down.sensitive = index < items.length - 1;
                row.add_suffix(down);
                row.add_suffix(button('user-trash-symbolic', _('Remove'), () => {
                    const current = load();
                    current.splice(index, 1);
                    save(current);
                }));
                rows.push(row);
                group.add(row);
            }
        } finally {
            rebuilding = false;
        }
    };
    rebuild();
    const changedId = settings.connect('changed::custom-dock-items', rebuild);
    window._cleanupCallbacks.push(() => {
        try { settings.disconnect(changedId); } catch { }
        rows = [];
    });
}
