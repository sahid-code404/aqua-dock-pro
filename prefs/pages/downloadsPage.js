// AquaDockPro preferences — Downloads page (stack + file-card styling).

import { page, group, spinRow, comboRow, colorRow } from '../widgets/rows.js';

export function buildDownloadsPage(window, s) {
    const p = page('Downloads', 'folder-download-symbolic');
    window.add(p);

    // ── Stack ──
    const stack = group('Downloads stack', 'How the folder opens from the dock.');
    stack.add(comboRow(window, s, 'downloads-view', 'View',
        'Layout used when the stack opens',
        ['Fan', 'Grid', 'List'], ['fan', 'grid', 'list']));
    stack.add(spinRow(s, 'downloads-max-files', 'Files shown',
        'Maximum number of recent files in the stack', 3, 11, 1, 0));
    stack.add(spinRow(s, 'downloads-border-radius', 'Panel corner radius',
        'Stack panel corner radius (pixels)', 0, 40, 1, 0));
    p.add(stack);

    const panelStyle = group('Panel colours & border', 'The stack panel styling.');
    panelStyle.add(colorRow(window, s, 'downloads-pill-color', 'Panel background', 'Stack panel background'));
    panelStyle.add(colorRow(window, s, 'downloads-border-color', 'Panel border', 'Stack panel border colour'));
    panelStyle.add(spinRow(s, 'downloads-border-width', 'Panel border width', 'Pixels; 0 hides it', 0, 6, 1, 0));
    p.add(panelStyle);

    // ── File cards ──
    const cards = group('File cards', 'The individual file tiles.');
    cards.add(spinRow(s, 'downloads-item-radius', 'Card corner radius', 'File card corner radius (pixels)', 0, 28, 1, 0));
    p.add(cards);

    const cardStyle = group('Card colours & border', 'The file-card styling.');
    cardStyle.add(colorRow(window, s, 'downloads-item-color', 'Card background', 'File card background'));
    cardStyle.add(colorRow(window, s, 'downloads-item-font-color', 'Card text', 'File name colour'));
    cardStyle.add(colorRow(window, s, 'downloads-item-thumb-color', 'Thumbnail background', 'Thumbnail backing colour'));
    cardStyle.add(colorRow(window, s, 'downloads-item-border-color', 'Card border', 'File card border colour'));
    cardStyle.add(spinRow(s, 'downloads-item-border-width', 'Card border width', 'Pixels; 0 hides it', 0, 6, 1, 0));
    p.add(cardStyle);
}
