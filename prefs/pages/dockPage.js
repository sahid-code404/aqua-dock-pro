// AquaDockPro preferences — Dock page (look & layout of the dock itself).

import { page, group, spinRow, switchRow, comboRow, colorRow, iconChooserRow }
    from '../widgets/rows.js';

export function buildDockPage(window, s) {
    const p = page('Dock', 'view-grid-symbolic');
    window.add(p);

    // ── Layout ──
    const layout = group('Layout', 'Where the dock sits and how big it is.');
    layout.add(comboRow(window, s, 'dock-position', 'Position',
        'Screen edge the floating dock appears on',
        ['Bottom', 'Left side', 'Right side'], ['bottom', 'left', 'right']));
    layout.add(spinRow(s, 'dock-scale', 'Overall scale',
        'Scales icons, padding and pill together', 0.5, 2.0, 0.05, 2));
    layout.add(spinRow(s, 'icon-size', 'Icon size',
        'Resting icon size in pixels', 24, 128, 2, 0));
    layout.add(spinRow(s, 'edge-margin', 'Edge gap',
        'Space between the dock and the screen edge (pixels)', 0, 14, 1, 0));
    p.add(layout);

    // ── Pill ──
    const pill = group('Pill', 'The rounded background panel behind the icons.');
    const autoThick = switchRow(s, 'pill-thickness-auto', 'Auto thickness',
        'Scale the pill height automatically with icon size');
    pill.add(autoThick);
    const thick = spinRow(s, 'pill-thickness', 'Pill thickness',
        'Manual pill height in pixels', 36, 120, 1, 0);
    thick.set_sensitive(!s.get_boolean('pill-thickness-auto'));
    window._settingsSignalIds.push(s.connect('changed::pill-thickness-auto',
        () => thick.set_sensitive(!s.get_boolean('pill-thickness-auto'))));
    pill.add(thick);
    pill.add(spinRow(s, 'dock-radius', 'Corner radius',
        'Rounded corner radius in pixels', 0, 40, 1, 0));
    pill.add(spinRow(s, 'background-opacity', 'Background opacity',
        'How see-through the pill is', 0.10, 1.0, 0.05, 2));
    p.add(pill);

    // ── Pill colours & border ──
    const pillStyle = group('Colours & border', 'Fill and outline of the dock pill.');
    pillStyle.add(colorRow(window, s, 'pill-color', 'Pill colour',
        'Background colour of the dock pill'));
    pillStyle.add(colorRow(window, s, 'border-color', 'Border colour',
        'Outline colour of the dock and its pills'));
    pillStyle.add(spinRow(s, 'border-width', 'Border width',
        'Outline thickness in pixels; 0 hides it', 0, 6, 1, 0));
    p.add(pillStyle);

    // ── Items ──
    const items = group('Items on the dock', 'Choose which built-in icons appear.');
    items.add(switchRow(s, 'show-apps-button', 'Applications button',
        'Show the app-grid launcher'));
    items.add(iconChooserRow(window, s, 'apps-button-icon', 'Applications icon'));
    items.add(switchRow(s, 'show-downloads', 'Downloads stack',
        'Show the Downloads folder with arrival bounce'));
    items.add(switchRow(s, 'show-trash', 'Trash',
        'Show the trash with full/empty state'));
    p.add(items);
}
