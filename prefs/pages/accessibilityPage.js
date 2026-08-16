// Accessibility preferences shared by every dock surface.

import { page, group, spinRow, switchRow } from '../widgets/rows.js';
import { _ } from '../../core/i18n.js';

export function buildAccessibilityPage(window, settings) {
    const p = page(_('Accessibility'), 'preferences-desktop-accessibility-symbolic');
    window.add(p);

    const motion = group(_('Motion'), _('GNOME’s system animation setting is always respected.'));
    motion.add(switchRow(settings, 'reduce-motion', _('Reduce dock motion'),
        _('Disable magnification transitions, bounce, fades, and movement animations')));
    p.add(motion);

    const vision = group(_('Visibility'), _('Optional stronger presentation for dock interfaces.'));
    vision.add(switchRow(settings, 'high-contrast', _('High contrast'),
        _('Use opaque backgrounds, brighter outlines, and stronger focus indicators')));
    vision.add(spinRow(settings, 'interface-text-scale', _('Interface text scale'),
        _('Scale menu, tooltip, preview, and folder-stack text'), 1.0, 1.6, 0.05, 2));
    p.add(vision);

    const screenReader = group(_('Screen reader'), _('Information exposed to assistive technology.'));
    screenReader.add(switchRow(settings, 'announce-item-status', _('Announce application status'),
        _('Include open-window and notification counts in dock item names')));
    p.add(screenReader);
}

