// Preferences page for indicators, badges, tooltips, menus, and previews.

import { page, group, spinRow, switchRow, comboRow, colorRow }
    from '../widgets/rows.js';
import { _ } from '../../core/i18n.js';

export function buildPopupsPage(window, s) {
    const p = page(_('Widgets'), 'starred-symbolic');
    window.add(p);

    // ── Running indicators ──
    const ind = group(_('Running indicators'), _('The mark under running apps.'));
    ind.add(comboRow(window, s, 'indicator-style', _('Style'), _('Shape of the indicator'),
        [_('Single dot'), _('Multiple dots'), _('Line'), _('Pill'), _('Glow'), _('Glow dots')],
        ['dot', 'dots', 'line', 'pill', 'glow', 'glow-dots']));
    ind.add(spinRow(s, 'indicator-size', _('Size'), _('Indicator size in pixels'), 3, 14, 1, 0));
    ind.add(switchRow(s, 'show-window-count', _('Show window count'),
        _('Multiple dots for multiple windows (dot styles)')));
    ind.add(colorRow(window, s, 'indicator-color', _('Colour'), _('Indicator colour')));
    p.add(ind);

    // ── Badges ──
    const badge = group(_('Notification badges'), _('Pending-notification counters.'));
    badge.add(switchRow(s, 'show-badges', _('Show badges'),
        _('A counter badge for apps with notifications')));
    badge.add(colorRow(window, s, 'badge-color', _('Badge colour'),
        _('Notification badge background colour')));
    badge.add(colorRow(window, s, 'badge-text-color', _('Text colour'),
        _('Notification badge text colour')));
    p.add(badge);

    // ── Tooltip ──
    const tip = group(_('Tooltip'), _('The app-name label on hover.'));
    tip.add(switchRow(s, 'show-tooltip', _('Show tooltip'), _('Show the app name on hover')));
    tip.add(spinRow(s, 'tooltip-delay', _('Show delay'),
        _('Delay before it appears (milliseconds)'), 0, 2000, 25, 0));
    tip.add(spinRow(s, 'tooltip-radius', _('Corner radius'),
        _('Tooltip corner radius (pixels)'), 0, 30, 1, 0));
    p.add(tip);

    const tipStyle = group(_('Tooltip colours'), _('Tooltip fill, text and outline.'));
    tipStyle.add(colorRow(window, s, 'tooltip-bg-color', _('Background'), _('Tooltip background')));
    tipStyle.add(colorRow(window, s, 'tooltip-text-color', _('Text'), _('Tooltip text colour')));
    tipStyle.add(colorRow(window, s, 'tooltip-border-color', _('Border'), _('Tooltip border colour')));
    tipStyle.add(spinRow(s, 'tooltip-border-width', _('Border width'),
        _('Pixels; 0 hides it'), 0, 6, 1, 0));
    p.add(tipStyle);

    // ── Context menu ──
    const menu = group(_('Context menu'), _('The right-click menu.'));
    menu.add(spinRow(s, 'menu-radius', _('Corner radius'),
        _('Menu corner radius (pixels)'), 0, 30, 1, 0));
    p.add(menu);

    const menuStyle = group(_('Menu colours'), _('Menu fill, text and outline.'));
    menuStyle.add(colorRow(window, s, 'menu-bg-color', _('Background'), _('Menu background')));
    menuStyle.add(colorRow(window, s, 'menu-text-color', _('Text'), _('Menu item text colour')));
    menuStyle.add(colorRow(window, s, 'menu-border-color', _('Border'), _('Menu border colour')));
    menuStyle.add(spinRow(s, 'menu-border-width', _('Border width'),
        _('Pixels; 0 hides it'), 0, 6, 1, 0));
    p.add(menuStyle);

    // ── Previews ──
    const prev = group(_('Window previews'), _('Live thumbnails of hidden windows.'));
    prev.add(switchRow(s, 'show-previews', _('Show previews'),
        _('Live thumbnail on hover for minimized / other-workspace windows')));
    prev.add(spinRow(s, 'preview-delay', _('Show delay'),
        _('Delay before previews appear (milliseconds)'), 100, 3000, 50, 0));
    prev.add(spinRow(s, 'preview-size', _('Thumbnail size'),
        _('Maximum thumbnail width (pixels)'), 80, 400, 10, 0));
    prev.add(comboRow(window, s, 'preview-window-mode', _('Windows shown'),
        _('Show hidden windows only or all windows for the app'),
        [_('Hidden windows'), _('All windows')], ['hidden', 'all']));
    prev.add(switchRow(s, 'preview-close-buttons', _('Close buttons'),
        _('Show a close button beside every window title')));
    p.add(prev);
}
