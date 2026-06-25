// AquaDockPro preferences — Behavior page (auto-hide, clicking, scrolling).

import { page, group, spinRow, switchRow, comboRow } from '../widgets/rows.js';

export function buildBehaviorPage(window, s) {
    const p = page('Behavior', 'preferences-system-symbolic');
    window.add(p);

    // ── Auto-hide ──
    const hide = group('Auto-hide', 'When the dock hides and how it reveals.');
    hide.add(comboRow(window, s, 'auto-hide-mode', 'Mode',
        'Never hide, intellihide (only when covered), or always hide',
        ['Never hide', 'Intellihide', 'Always hide'], ['never', 'dodge', 'always']));
    hide.add(spinRow(s, 'hide-delay', 'Hide delay',
        'Wait before hiding after the pointer leaves (milliseconds)', 0, 2000, 50, 0));
    hide.add(spinRow(s, 'reveal-pressure', 'Reveal delay',
        'Wait at the screen edge before revealing (milliseconds); 0 is instant',
        0, 1000, 25, 0));
    p.add(hide);

    // ── Pressure reveal ──
    const pressure = group('Edge pressure', 'Require a deliberate push to reveal.');
    pressure.add(switchRow(s, 'pressure-sense', 'Pressure-sense reveal',
        'The pointer must linger and press against the edge before the dock appears'));
    pressure.add(spinRow(s, 'pressure-sense-sensitivity', 'Sensitivity',
        'Higher needs less dwell to reveal', 0.0, 1.0, 0.05, 2));
    p.add(pressure);

    // ── Clicking & scrolling ──
    const click = group('Clicking', 'What clicks do.');
    click.add(switchRow(s, 'click-to-minimize', 'Click to minimize',
        'Clicking the focused app icon minimizes its window'));
    click.add(switchRow(s, 'drag-to-open', 'Drag to open',
        'Drag an icon outside the dock to launch or activate the app'));
    click.add(switchRow(s, 'isolate-workspaces', 'Only this workspace',
        'Show running apps from the current workspace only'));
    p.add(click);
}
