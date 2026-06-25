// AquaDockPro preferences — Widgets page.
//
// Running indicators, notification badges, tooltips, the context menu and live
// window previews. Every option is visible — colour/border styling sits in its
// own clearly-titled group right below the feature it belongs to.

import { page, group, spinRow, switchRow, comboRow, colorRow }
    from '../widgets/rows.js';

export function buildPopupsPage(window, s) {
    const p = page('Widgets', 'starred-symbolic');
    window.add(p);

    // ── Running indicators ──
    const ind = group('Running indicators', 'The mark under running apps.');
    ind.add(comboRow(window, s, 'indicator-style', 'Style', 'Shape of the indicator',
        ['Single dot', 'Multiple dots', 'Line', 'Pill', 'Glow', 'Glow dots'],
        ['dot', 'dots', 'line', 'pill', 'glow', 'glow-dots']));
    ind.add(spinRow(s, 'indicator-size', 'Size', 'Indicator size in pixels', 3, 14, 1, 0));
    ind.add(switchRow(s, 'show-window-count', 'Show window count',
        'Multiple dots for multiple windows (dot styles)'));
    ind.add(colorRow(window, s, 'indicator-color', 'Colour', 'Indicator colour'));
    p.add(ind);

    // ── Badges ──
    const badge = group('Notification badges', 'Pending-notification counters.');
    badge.add(switchRow(s, 'show-badges', 'Show badges',
        'A counter badge for apps with notifications'));
    badge.add(colorRow(window, s, 'badge-color', 'Badge colour', 'Notification badge background colour'));
    badge.add(colorRow(window, s, 'badge-text-color', 'Text colour', 'Notification badge text colour'));
    p.add(badge);

    // ── Tooltip ──
    const tip = group('Tooltip', 'The app-name label on hover.');
    tip.add(switchRow(s, 'show-tooltip', 'Show tooltip', 'Show the app name on hover'));
    tip.add(spinRow(s, 'tooltip-delay', 'Show delay', 'Delay before it appears (milliseconds)', 0, 2000, 25, 0));
    tip.add(spinRow(s, 'tooltip-radius', 'Corner radius', 'Tooltip corner radius (pixels)', 0, 30, 1, 0));
    p.add(tip);

    const tipStyle = group('Tooltip colours', 'Tooltip fill, text and outline.');
    tipStyle.add(colorRow(window, s, 'tooltip-bg-color', 'Background', 'Tooltip background'));
    tipStyle.add(colorRow(window, s, 'tooltip-text-color', 'Text', 'Tooltip text colour'));
    tipStyle.add(colorRow(window, s, 'tooltip-border-color', 'Border', 'Tooltip border colour'));
    tipStyle.add(spinRow(s, 'tooltip-border-width', 'Border width', 'Pixels; 0 hides it', 0, 6, 1, 0));
    p.add(tipStyle);

    // ── Context menu ──
    const menu = group('Context menu', 'The right-click menu.');
    menu.add(spinRow(s, 'menu-radius', 'Corner radius', 'Menu corner radius (pixels)', 0, 30, 1, 0));
    p.add(menu);

    const menuStyle = group('Menu colours', 'Menu fill, text and outline.');
    menuStyle.add(colorRow(window, s, 'menu-bg-color', 'Background', 'Menu background'));
    menuStyle.add(colorRow(window, s, 'menu-text-color', 'Text', 'Menu item text colour'));
    menuStyle.add(colorRow(window, s, 'menu-border-color', 'Border', 'Menu border colour'));
    menuStyle.add(spinRow(s, 'menu-border-width', 'Border width', 'Pixels; 0 hides it', 0, 6, 1, 0));
    p.add(menuStyle);

    // ── Previews ──
    const prev = group('Window previews', 'Live thumbnails of hidden windows.');
    prev.add(switchRow(s, 'show-previews', 'Show previews',
        'Live thumbnail on hover for minimized / other-workspace windows'));
    prev.add(spinRow(s, 'preview-delay', 'Show delay', 'Delay before previews appear (milliseconds)', 100, 3000, 50, 0));
    prev.add(spinRow(s, 'preview-size', 'Thumbnail size', 'Maximum thumbnail width (pixels)', 80, 400, 10, 0));
    p.add(prev);
}
