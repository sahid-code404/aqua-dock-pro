// Preferences page for Downloads stack appearance and sorting.

import {
    page,
    group,
    spinRow,
    switchRow,
    comboRow,
    colorRow,
    folderChooserRow,
    expanderRow,
    toggleExpander,
} from '../widgets/rows.js';
import { _ } from '../../core/i18n.js';
import { buildCustomItemsEditor } from '../widgets/customItems.js';

/**
 * Constructs and adds the Downloads stack preferences page to the preferences window.
 * Configures stack views (fan, grid, list), sorting criteria, and custom folder stacks.
 *
 * @param {Adw.PreferencesWindow} window - Target preferences window.
 * @param {Gio.Settings} s - Extension GSettings instance.
 * @returns {void}
 */
export function buildDownloadsPage(window, s) {
    const p = page(_('Downloads'), 'folder-download-symbolic');
    window.add(p);

    const stack = group(_('Downloads stack'), _('How the folder opens from the dock.'));
    const dlToggle = switchRow(s, 'show-downloads', _('Downloads folder stack'),
        _('Show the Downloads folder stack on the dock'));
    stack.add(dlToggle);
    const viewRow = comboRow(window, s, 'downloads-view', _('View'),
        _('Layout used when the stack opens'),
        [_('Fan'), _('Grid'), _('List')], ['fan', 'grid', 'list']);
    stack.add(viewRow);
    const filesRow = spinRow(s, 'downloads-max-files', _('Files shown'),
        _('Maximum number of recent files in the stack'), 3, 11, 1, 0);
    stack.add(filesRow);
    const sortRow = comboRow(window, s, 'downloads-sort', _('Sort files'),
        _('Order used by Downloads and the custom folder stack'),
        [_('Newest first'), _('Name'), _('File type')], ['newest', 'name', 'type']);
    stack.add(sortRow);

    const panelStyle = expanderRow(_('Panel colours and border'),
        _('The stack panel styling.'), 'applications-graphics-symbolic');
    panelStyle.add_row(spinRow(s, 'downloads-border-radius', _('Panel corner radius'),
        _('Stack panel corner radius (pixels)'), 0, 40, 1, 0));
    const panelColor = colorRow(window, s, 'downloads-pill-color', _('Panel background'),
        _('Stack panel background when blur is disabled'));
    panelStyle.add_row(panelColor);
    panelStyle.add_row(colorRow(window, s, 'downloads-border-color', _('Panel border'),
        _('Stack panel border colour')));
    panelStyle.add_row(spinRow(s, 'downloads-border-width', _('Panel border width'),
        _('Pixels; 0 hides it'), 0, 6, 1, 0));
    stack.add(panelStyle);
    p.add(stack);

    const cards = group(_('File cards'), _('The individual file tiles.'));
    cards.add(spinRow(s, 'downloads-item-radius', _('Card corner radius'),
        _('File card corner radius (pixels)'), 0, 28, 1, 0));

    const cardStyle = expanderRow(_('Card colours and border'),
        _('The file-card styling.'), 'applications-graphics-symbolic');
    const cardColor = colorRow(window, s, 'downloads-item-color', _('Card background'),
        _('File card background when blur is disabled'));
    cardStyle.add_row(cardColor);
    cardStyle.add_row(colorRow(window, s, 'downloads-item-font-color', _('Card text'),
        _('File name colour')));
    cardStyle.add_row(colorRow(window, s, 'downloads-item-thumb-color', _('Thumbnail background'),
        _('Thumbnail backing colour')));
    cardStyle.add_row(colorRow(window, s, 'downloads-item-border-color', _('Card border'),
        _('File card border colour')));
    cardStyle.add_row(spinRow(s, 'downloads-item-border-width', _('Card border width'),
        _('Pixels; 0 hides it'), 0, 6, 1, 0));
    cards.add(cardStyle);
    p.add(cards);

    const custom = group(_('Custom folder stack'),
        _('Add one lightweight folder stack beside Downloads.'));
    const customToggle = toggleExpander(s, 'show-custom-folder', _('Show custom folder'),
        _('Display the selected folder as another stack'), 'folder-symbolic');
    customToggle.add_row(folderChooserRow(window, s, 'custom-folder-uri', _('Folder'),
        _('The folder whose recent files appear in the stack')));
    customToggle.add_row(switchRow(s, 'use-folder-metadata-icons', _('Use folder’s own icon'),
        _('Prefer custom and standard folder artwork; disable for theme fallback icons')));
    custom.add(customToggle);
    p.add(custom);

    const dockItems = group(_('Dock locations and shortcuts'),
        _('Add and arrange folders, files, links, separators, and spacers.'));
    dockItems.add(switchRow(s, 'show-custom-dock-items', _('Show custom dock items'),
        _('Display the configured items in the dock’s locations section')));
    buildCustomItemsEditor(window, s, dockItems);
    p.add(dockItems);

    const syncDownloadsSensitivity = () => {
        const enabled = s.get_boolean('show-downloads');
        viewRow.set_sensitive(enabled);
        filesRow.set_sensitive(enabled);
        panelStyle.set_sensitive(enabled);
    };
    syncDownloadsSensitivity();
    (window._settingsSignalIds ??= []).push(s.connect('changed::show-downloads', syncDownloadsSensitivity));

    const syncBlurSensitivity = () => {
        const blurOn = s.get_boolean('blur-effect');
        panelColor.set_sensitive(!blurOn);
        cardColor.set_sensitive(!blurOn);
    };
    syncBlurSensitivity();
    (window._settingsSignalIds ??= []).push(s.connect('changed::blur-effect', syncBlurSensitivity));
}
