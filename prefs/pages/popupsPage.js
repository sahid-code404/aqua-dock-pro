// Preferences page for indicators, badges, tooltips, menus, and previews.

import Gio from 'gi://Gio';
import {
    page,
    group,
    spinRow,
    switchRow,
    comboRow,
    colorRow,
    expanderRow,
    toggleExpander,
} from '../widgets/rows.js';
import { _ } from '../../core/i18n.js';

/**
 * Constructs and adds the Popups and Indicators preferences page to the preferences window.
 * Configures running dot/pill indicator styles, notification badges, tooltips, and window previews.
 *
 * @param {Adw.PreferencesWindow} window - Target preferences window.
 * @param {Gio.Settings} s - Extension GSettings instance.
 * @returns {void}
 */
export function buildPopupsPage(window, s) {
    const p = page(_('Widgets'), 'starred-symbolic');
    window.add(p);

    const ind = group(_('Running indicators'), _('The mark under running apps.'));
    ind.add(comboRow(window, s, 'indicator-style', _('Style'), _('Shape of the indicator'),
        [_('Single dot'), _('Multiple dots'), _('Line'), _('Pill'), _('Glow'), _('Glow dots')],
        ['dot', 'dots', 'line', 'pill', 'glow', 'glow-dots']));
    ind.add(spinRow(s, 'indicator-size', _('Size'), _('Indicator size in pixels'), 3, 14, 1, 0));
    ind.add(switchRow(s, 'show-window-count', _('Show window count'),
        _('Multiple dots for multiple windows (dot styles)')));
    ind.add(colorRow(window, s, 'indicator-color', _('Colour'), _('Indicator colour')));
    p.add(ind);

    const badge = group(_('Notification badges'), _('Pending-notification counters.'));
    const badgeToggle = toggleExpander(s, 'show-badges', _('Show badges'),
        _('A counter badge for apps with notifications'), 'mail-unread-symbolic');
    badgeToggle.add_row(colorRow(window, s, 'badge-color', _('Badge colour'),
        _('Notification badge background colour')));
    badgeToggle.add_row(colorRow(window, s, 'badge-text-color', _('Text colour'),
        _('Notification badge text colour')));
    badge.add(badgeToggle);
    p.add(badge);

    const tip = group(_('Tooltip'), _('The app-name label on hover.'));
    const tipToggle = toggleExpander(s, 'show-tooltip', _('Show tooltip'),
        _('Show app and folder name labels on pointer hover; disable to hide all tooltips'),
        'dialog-information-symbolic');
    tipToggle.add_row(spinRow(s, 'tooltip-delay', _('Show delay'),
        _('Delay before it appears (milliseconds)'), 0, 2000, 25, 0));

    const tipMenuTheme = switchRow(s, 'tooltip-use-menu-theme', _('Match context menu theme'),
        _('Use the same colour theme, border, and frosted glass blur pipeline as the custom context menu'));
    tipToggle.add_row(tipMenuTheme);

    const tipBlur = switchRow(s, 'tooltip-blur-effect', _('BMS background blur'),
        _('Enable Blur My Shell background blur for tooltips; fallbacks to normal background when disabled'));
    tipToggle.add_row(tipBlur);

    const tipRadius = spinRow(s, 'tooltip-radius', _('Corner radius'),
        _('Tooltip corner radius (pixels)'), 0, 30, 1, 0);
    tipToggle.add_row(tipRadius);

    const tipStyle = expanderRow(_('Tooltip colours'), _('Custom tooltip fill, text and outline (when not matching context menu).'),
        'applications-graphics-symbolic');
    tipStyle.add_row(colorRow(window, s, 'tooltip-bg-color', _('Background'), _('Tooltip background')));
    tipStyle.add_row(colorRow(window, s, 'tooltip-text-color', _('Text'), _('Tooltip text colour')));
    tipStyle.add_row(colorRow(window, s, 'tooltip-border-color', _('Border'), _('Tooltip border colour')));
    tipStyle.add_row(spinRow(s, 'tooltip-border-width', _('Border width'),
        _('Pixels; 0 hides it'), 0, 6, 1, 0));
    tipToggle.add_row(tipStyle);

    const syncTipSensitivity = () => {
        const useMenuTheme = s.get_boolean('tooltip-use-menu-theme');
        tipRadius.set_sensitive(!useMenuTheme);
        tipStyle.set_sensitive(!useMenuTheme);
    };
    syncTipSensitivity();
    (window._settingsSignalIds ??= []).push(s.connect('changed::tooltip-use-menu-theme', syncTipSensitivity));
    tip.add(tipToggle);
    p.add(tip);

    const menu = group(_('Context menu'), _('The right-click menu.'));
    const customMenu = switchRow(s, 'menu-use-gnome-default', _('Custom context menu'),
        _('Use Aqua Dock Pro custom styled menu; disable for GNOME Shell default menu'),
        Gio.SettingsBindFlags.DEFAULT | Gio.SettingsBindFlags.INVERT_BOOLEAN);
    menu.add(customMenu);

    const menuRadius = spinRow(s, 'menu-radius', _('Corner radius'),
        _('Menu corner radius (pixels)'), 0, 30, 1, 0);
    menu.add(menuRadius);

    const menuStyle = expanderRow(_('Menu colours'), _('Menu fill, text and outline.'),
        'applications-graphics-symbolic');
    menuStyle.add_row(colorRow(window, s, 'menu-bg-color', _('Background'), _('Menu background')));
    menuStyle.add_row(colorRow(window, s, 'menu-text-color', _('Text'), _('Menu item text colour')));
    menuStyle.add_row(colorRow(window, s, 'menu-border-color', _('Border'), _('Menu border colour')));
    menuStyle.add_row(spinRow(s, 'menu-border-width', _('Border width'),
        _('Pixels; 0 hides it'), 0, 6, 1, 0));
    menu.add(menuStyle);

    const menuBlur = switchRow(s, 'menu-blur-effect', _('BMS background blur'),
        _('Enable Blur My Shell background blur for context menus; fallbacks to normal background when disabled'));
    menu.add(menuBlur);

    const syncMenuSensitivity = () => {
        const useGnomeDefault = s.get_boolean('menu-use-gnome-default');
        menuRadius.set_sensitive(!useGnomeDefault);
        menuStyle.set_sensitive(!useGnomeDefault);
        menuBlur.set_sensitive(!useGnomeDefault);
    };
    syncMenuSensitivity();
    (window._settingsSignalIds ??= []).push(s.connect('changed::menu-use-gnome-default', syncMenuSensitivity));
    p.add(menu);

    const prev = group(_('Window previews'), _('Live thumbnails of hidden windows.'));
    const previewToggle = toggleExpander(s, 'show-previews', _('Show previews'),
        _('Live thumbnail on hover for minimized / other-workspace windows'),
        'video-display-symbolic');
    previewToggle.add_row(spinRow(s, 'preview-delay', _('Show delay'),
        _('Delay before previews appear (milliseconds)'), 100, 3000, 50, 0));
    previewToggle.add_row(spinRow(s, 'preview-size', _('Thumbnail size'),
        _('Maximum thumbnail width (pixels)'), 80, 400, 10, 0));
    previewToggle.add_row(comboRow(window, s, 'preview-window-mode', _('Windows shown'),
        _('Show hidden windows only or all windows for the app'),
        [_('Hidden windows'), _('All windows')], ['hidden', 'all']));
    previewToggle.add_row(switchRow(s, 'preview-close-buttons', _('Close buttons'),
        _('Show a close button beside every window title')));
    previewToggle.add_row(comboRow(window, s, 'preview-overflow-mode', _('Many windows'),
        _('Keep the compact count or browse every window in pages'),
        [_('Compact count'), _('Paged previews')], ['summary', 'pages']));
    previewToggle.add_row(spinRow(s, 'preview-page-size', _('Windows per page'),
        _('Maximum previews on one page; the monitor width may reduce it'), 1, 8, 1, 0));
    previewToggle.add_row(switchRow(s, 'preview-keyboard-navigation', _('Keyboard preview navigation'),
        _('Move focus into previews opened from the keyboard')));
    previewToggle.add_row(switchRow(s, 'preview-window-actions', _('Window action menu'),
        _('Right-click a preview for activation, workspace, monitor, and close actions')));
    prev.add(previewToggle);
    p.add(prev);
}
