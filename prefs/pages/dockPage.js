// Preferences page for dock position, alignment, and styling.

import {
    page,
    group,
    spinRow,
    switchRow,
    comboRow,
    colorRow,
    iconChooserRow,
    expanderRow,
    toggleExpander,
} from '../widgets/rows.js';
import { _ } from '../../core/i18n.js';

/**
 * Constructs and adds the Dock layout and appearance preferences page to the preferences window.
 * Configures position, alignment, icon size, pill thickness, and corner radius.
 *
 * @param {Adw.PreferencesWindow} window - Target preferences window.
 * @param {Gio.Settings} s - Extension GSettings instance.
 * @returns {void}
 */
export function buildDockPage(window, s) {
    const p = page(_('Dock'), 'view-grid-symbolic');
    window.add(p);

    const placement = group(_('Dock placement'), _('Where the dock sits on screen and multi-monitor options.'));
    placement.add(comboRow(window, s, 'dock-position', _('Position'),
        _('Screen edge the floating dock appears on'),
        [_('Bottom'), _('Left side'), _('Right side')], ['bottom', 'left', 'right']));
    placement.add(comboRow(window, s, 'dock-alignment', _('Alignment'),
        _('Place the dock at the start, center, or end of its screen edge'),
        [_('Start'), _('Center'), _('End')], ['start', 'center', 'end']));
    placement.add(spinRow(s, 'edge-margin', _('Edge gap'),
        _('Space between the dock and the screen edge (pixels)'), 0, 14, 1, 0));

    const monitors = toggleExpander(s, 'multi-monitor', _('Show on all monitors'),
        _('Display a dock on every connected monitor'), 'video-display-symbolic');
    monitors.add_row(switchRow(s, 'isolate-monitors', _('Isolate windows by monitor'),
        _('Each dock shows and controls running windows on its own monitor')));
    placement.add(monitors);
    p.add(placement);

    const geometry = group(_('Icon geometry'), _('Icon size, overall scale, and spacing.'));
    geometry.add(spinRow(s, 'icon-size', _('Icon size'),
        _('Resting icon size in pixels'), 26, 128, 2, 0));
    geometry.add(spinRow(s, 'dock-scale', _('Overall scale'),
        _('Scales icons, padding and pill together'), 0.5, 2.0, 0.05, 2));
    geometry.add(spinRow(s, 'icon-spacing', _('Icon spacing'),
        _('Gap between neighbouring dock icons in pixels'), 0, 48, 1, 0));
    geometry.add(switchRow(s, 'auto-shrink-to-fit', _('Shrink dock to fit'),
        _('Automatically reduce the dock when its configured size would not fit its monitor')));
    p.add(geometry);

    const pill = group(_('Pill appearance & blur'), _('Pill thickness, frosted glass blur, and colors.'));
    const blurRow = switchRow(s, 'blur-effect', _('Frosted glass blur (Blur My Shell)'),
        _('Frosted glass background blur matching dock pill via Blur My Shell pipeline; fallback to solid transparency when disabled'));
    pill.add(blurRow);

    const autoThick = switchRow(s, 'pill-thickness-auto', _('Auto thickness'),
        _('Scale the pill height automatically with icon size'));
    pill.add(autoThick);
    const thick = spinRow(s, 'pill-thickness', _('Pill thickness'),
        _('Manual pill height in pixels'), 36, 120, 1, 0);
    thick.set_sensitive(!s.get_boolean('pill-thickness-auto'));
    window._settingsSignalIds.push(s.connect('changed::pill-thickness-auto',
        () => thick.set_sensitive(!s.get_boolean('pill-thickness-auto'))));
    pill.add(thick);
    const bgOpacity = spinRow(s, 'background-opacity', _('Background opacity'),
        _('How see-through the pill is when blur is disabled'), 0.10, 1.0, 0.05, 2);
    pill.add(bgOpacity);

    const pillStyle = expanderRow(_('Colours and border'),
        _('Fill and outline of the dock pill.'), 'applications-graphics-symbolic');
    pillStyle.add_row(spinRow(s, 'dock-radius', _('Corner radius'),
        _('Rounded corner radius in pixels'), 0, 40, 1, 0));
    const pillColor = colorRow(window, s, 'pill-color', _('Pill colour'),
        _('Background colour of the dock pill when blur is disabled'));
    pillStyle.add_row(pillColor);
    pillStyle.add_row(colorRow(window, s, 'border-color', _('Border colour'),
        _('Outline colour of the dock and its pills')));
    pillStyle.add_row(spinRow(s, 'border-width', _('Border width'),
        _('Outline thickness in pixels; 0 hides it'), 0, 6, 1, 0));
    pill.add(pillStyle);

    const syncBlurSensitivity = () => {
        const blurOn = s.get_boolean('blur-effect');
        bgOpacity.set_sensitive(!blurOn);
        pillColor.set_sensitive(!blurOn);
    };
    syncBlurSensitivity();
    window._settingsSignalIds.push(s.connect('changed::blur-effect', syncBlurSensitivity));
    p.add(pill);

    const items = group(_('Dock items'), _('Choose which built-in icons appear.'));
    items.add(switchRow(s, 'lock-layout', _('Lock current layout'),
        _('Prevent pinned apps and the Applications button from being reordered, added, or removed through the dock')));

    const apps = toggleExpander(s, 'show-apps-button', _('Applications button'),
        _('Show the app-grid launcher'), 'view-app-grid-symbolic');
    apps.add_row(iconChooserRow(window, s, 'apps-button-icon', _('Applications icon')));
    items.add(apps);

    items.add(switchRow(s, 'show-downloads', _('Downloads stack'),
        _('Show the Downloads folder with arrival bounce')));
    items.add(switchRow(s, 'show-trash', _('Trash'),
        _('Show the trash with full/empty state')));
    p.add(items);
}
