// Preferences page for auto-hide, click action, and scroll behavior.

import { page, group, spinRow, switchRow, comboRow, shortcutRow, toggleExpander }
    from '../widgets/rows.js';
import { _ } from '../../core/i18n.js';

export function buildBehaviorPage(window, s) {
    const p = page(_('Behavior'), 'preferences-system-symbolic');
    window.add(p);

    const hide = group(_('Auto-hide'), _('When the dock hides and how it reveals.'));
    hide.add(comboRow(window, s, 'auto-hide-mode', _('Mode'),
        _('Never hide, intellihide (only when covered), or always hide'),
        [_('Never hide'), _('Intellihide'), _('Always hide')], ['never', 'dodge', 'always']));
    hide.add(spinRow(s, 'hide-delay', _('Hide delay'),
        _('Wait before hiding after the pointer leaves (milliseconds)'), 0, 2000, 50, 0));
    hide.add(spinRow(s, 'reveal-pressure', _('Reveal delay'),
        _('Wait at the screen edge before revealing (milliseconds); 0 is instant'),
        0, 1000, 25, 0));
    hide.add(switchRow(s, 'show-autohide-handle', _('Hidden dock rim'),
        _("Leave the dock pill's screen-facing border visible while hidden")));
    p.add(hide);

    const pressure = group(_('Edge pressure'), _('Require a deliberate push to reveal.'));
    const pressureToggle = toggleExpander(s, 'pressure-sense', _('Pressure-sense reveal'),
        _('The pointer must linger and press against the edge before the dock appears'),
        'input-mouse-symbolic');
    pressureToggle.add_row(spinRow(s, 'pressure-sense-sensitivity', _('Sensitivity'),
        _('Higher needs less dwell to reveal'), 0.0, 1.0, 0.05, 2));
    pressure.add(pressureToggle);
    p.add(pressure);

    const click = group(_('Clicking'), _('What clicks do.'));
    click.add(comboRow(window, s, 'left-click-action', _('Primary click'),
        _('Smart behavior, minimize, cycle, preview, or no action'),
        [_('Smart'), _('Minimize'), _('Cycle windows'), _('Show previews'), _('Do nothing')],
        ['smart', 'minimize', 'cycle', 'preview', 'nothing']));
    click.add(comboRow(window, s, 'middle-click-action', _('Middle click'),
        _('Open a new window, use smart behavior, or do nothing'),
        [_('New window'), _('Smart'), _('Do nothing')], ['new-window', 'smart', 'nothing']));
    click.add(comboRow(window, s, 'scroll-action', _('Scroll'),
        _('Minimize/restore, cycle windows, or leave scrolling unused'),
        [_('Minimize and restore'), _('Cycle windows'), _('Do nothing')],
        ['minimize-restore', 'cycle', 'nothing']));
    click.add(switchRow(s, 'click-to-minimize', _('Click to minimize'),
        _('Clicking the focused app icon minimizes its window')));
    click.add(switchRow(s, 'drag-to-open', _('Drag to open'),
        _('Drag a pinned app outside the dock to launch or activate it, even when the layout is locked')));
    click.add(switchRow(s, 'isolate-workspaces', _('Only this workspace'),
        _('Show running apps from the current workspace only')));
    click.add(shortcutRow(window, s, 'focus-dock-shortcut', _('Focus dock shortcut'),
        _('GNOME accelerator syntax, for example <Super>d; leave empty to disable')));
    p.add(click);
}
