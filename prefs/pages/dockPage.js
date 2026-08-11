// AquaDockPro preferences — Dock page (look & layout of the dock itself).

import { page, group, spinRow, switchRow, comboRow, colorRow, iconChooserRow }
    from '../widgets/rows.js';
import { _ } from '../../core/i18n.js';

export function buildDockPage(window, s) {
    const p = page(_('Dock'), 'view-grid-symbolic');
    window.add(p);

    // ── Layout ──
    const layout = group(_('Layout'), _('Where the dock sits and how big it is.'));
    layout.add(comboRow(window, s, 'dock-position', _('Position'),
        _('Screen edge the floating dock appears on'),
        [_('Bottom'), _('Left side'), _('Right side')], ['bottom', 'left', 'right']));
    layout.add(comboRow(window, s, 'dock-alignment', _('Alignment'),
        _('Place the dock at the start, center, or end of its screen edge'),
        [_('Start'), _('Center'), _('End')], ['start', 'center', 'end']));
    layout.add(switchRow(s, 'multi-monitor', _('Show on all monitors'),
        _('Display a dock on every connected monitor')));
    layout.add(switchRow(s, 'isolate-monitors', _('Isolate windows by monitor'),
        _('Each dock shows and controls running windows on its own monitor')));
    layout.add(spinRow(s, 'dock-scale', _('Overall scale'),
        _('Scales icons, padding and pill together'), 0.5, 2.0, 0.05, 2));
    layout.add(spinRow(s, 'icon-size', _('Icon size'),
        _('Resting icon size in pixels'), 24, 128, 2, 0));
    layout.add(spinRow(s, 'edge-margin', _('Edge gap'),
        _('Space between the dock and the screen edge (pixels)'), 0, 14, 1, 0));
    p.add(layout);

    // ── Pill ──
    const pill = group(_('Pill'), _('The rounded background panel behind the icons.'));
    const autoThick = switchRow(s, 'pill-thickness-auto', _('Auto thickness'),
        _('Scale the pill height automatically with icon size'));
    pill.add(autoThick);
    const thick = spinRow(s, 'pill-thickness', _('Pill thickness'),
        _('Manual pill height in pixels'), 36, 120, 1, 0);
    thick.set_sensitive(!s.get_boolean('pill-thickness-auto'));
    window._settingsSignalIds.push(s.connect('changed::pill-thickness-auto',
        () => thick.set_sensitive(!s.get_boolean('pill-thickness-auto'))));
    pill.add(thick);
    pill.add(spinRow(s, 'dock-radius', _('Corner radius'),
        _('Rounded corner radius in pixels'), 0, 40, 1, 0));
    pill.add(spinRow(s, 'background-opacity', _('Background opacity'),
        _('How see-through the pill is'), 0.10, 1.0, 0.05, 2));
    p.add(pill);

    // ── Pill colours & border ──
    const pillStyle = group(_('Colours and border'), _('Fill and outline of the dock pill.'));
    pillStyle.add(colorRow(window, s, 'pill-color', _('Pill colour'),
        _('Background colour of the dock pill')));
    pillStyle.add(colorRow(window, s, 'border-color', _('Border colour'),
        _('Outline colour of the dock and its pills')));
    pillStyle.add(spinRow(s, 'border-width', _('Border width'),
        _('Outline thickness in pixels; 0 hides it'), 0, 6, 1, 0));
    p.add(pillStyle);

    // ── Items ──
    const items = group(_('Items on the dock'), _('Choose which built-in icons appear.'));
    items.add(switchRow(s, 'lock-layout', _('Lock current layout'),
        _('Prevent pinned apps and the Applications button from being reordered, added, or removed through the dock')));
    items.add(switchRow(s, 'show-apps-button', _('Applications button'),
        _('Show the app-grid launcher')));
    items.add(iconChooserRow(window, s, 'apps-button-icon', _('Applications icon')));
    items.add(switchRow(s, 'show-downloads', _('Downloads stack'),
        _('Show the Downloads folder with arrival bounce')));
    items.add(switchRow(s, 'show-trash', _('Trash'),
        _('Show the trash with full/empty state')));
    p.add(items);
}
