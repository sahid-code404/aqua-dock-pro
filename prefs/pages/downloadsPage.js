// Preferences page for Downloads stack appearance and sorting.

import { page, group, spinRow, switchRow, comboRow, colorRow, folderChooserRow }
    from '../widgets/rows.js';
import { _ } from '../../core/i18n.js';
import { buildCustomItemsEditor } from '../widgets/customItems.js';

export function buildDownloadsPage(window, s) {
    const p = page(_('Downloads'), 'folder-download-symbolic');
    window.add(p);

    // ── Stack ──
    const stack = group(_('Downloads stack'), _('How the folder opens from the dock.'));
    stack.add(comboRow(window, s, 'downloads-view', _('View'),
        _('Layout used when the stack opens'),
        [_('Fan'), _('Grid'), _('List')], ['fan', 'grid', 'list']));
    stack.add(spinRow(s, 'downloads-max-files', _('Files shown'),
        _('Maximum number of recent files in the stack'), 3, 11, 1, 0));
    stack.add(comboRow(window, s, 'downloads-sort', _('Sort files'),
        _('Order used by Downloads and the custom folder stack'),
        [_('Newest first'), _('Name'), _('File type')], ['newest', 'name', 'type']));
    stack.add(spinRow(s, 'downloads-border-radius', _('Panel corner radius'),
        _('Stack panel corner radius (pixels)'), 0, 40, 1, 0));
    p.add(stack);

    const custom = group(_('Custom folder stack'),
        _('Add one lightweight folder stack beside Downloads.'));
    custom.add(switchRow(s, 'show-custom-folder', _('Show custom folder'),
        _('Display the selected folder as another stack')));
    custom.add(folderChooserRow(window, s, 'custom-folder-uri', _('Folder'),
        _('The folder whose recent files appear in the stack')));
    custom.add(switchRow(s, 'use-folder-metadata-icons', _('Use folder’s own icon'),
        _('Prefer custom and standard folder artwork; disable for theme fallback icons')));
    p.add(custom);

    const dockItems = group(_('Dock locations and shortcuts'),
        _('Add and arrange folders, files, links, separators, and spacers.'));
    dockItems.add(switchRow(s, 'show-custom-dock-items', _('Show custom dock items'),
        _('Display the configured items in the dock’s locations section')));
    buildCustomItemsEditor(window, s, dockItems);
    p.add(dockItems);

    const panelStyle = group(_('Panel colours and border'), _('The stack panel styling.'));
    panelStyle.add(colorRow(window, s, 'downloads-pill-color', _('Panel background'),
        _('Stack panel background')));
    panelStyle.add(colorRow(window, s, 'downloads-border-color', _('Panel border'),
        _('Stack panel border colour')));
    panelStyle.add(spinRow(s, 'downloads-border-width', _('Panel border width'),
        _('Pixels; 0 hides it'), 0, 6, 1, 0));
    p.add(panelStyle);

    // ── File cards ──
    const cards = group(_('File cards'), _('The individual file tiles.'));
    cards.add(spinRow(s, 'downloads-item-radius', _('Card corner radius'),
        _('File card corner radius (pixels)'), 0, 28, 1, 0));
    p.add(cards);

    const cardStyle = group(_('Card colours and border'), _('The file-card styling.'));
    cardStyle.add(colorRow(window, s, 'downloads-item-color', _('Card background'),
        _('File card background')));
    cardStyle.add(colorRow(window, s, 'downloads-item-font-color', _('Card text'),
        _('File name colour')));
    cardStyle.add(colorRow(window, s, 'downloads-item-thumb-color', _('Thumbnail background'),
        _('Thumbnail backing colour')));
    cardStyle.add(colorRow(window, s, 'downloads-item-border-color', _('Card border'),
        _('File card border colour')));
    cardStyle.add(spinRow(s, 'downloads-item-border-width', _('Card border width'),
        _('Pixels; 0 hides it'), 0, 6, 1, 0));
    p.add(cardStyle);
}
