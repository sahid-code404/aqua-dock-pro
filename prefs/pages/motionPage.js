// Preferences page for magnification, spring physics, and Genie effect.

import { page, group, spinRow, switchRow } from '../widgets/rows.js';
import { _ } from '../../core/i18n.js';

export function buildMotionPage(window, s) {
    const p = page(_('Motion'), 'preferences-desktop-screensaver-symbolic');
    window.add(p);

    // ── Magnification ──
    const mag = group(_('Magnification'), _('How icons zoom under the cursor.'));
    mag.add(spinRow(s, 'magnification', _('Peak magnification'),
        _('How large the icon under the cursor grows'), 1.0, 3.5, 0.05, 2));
    mag.add(spinRow(s, 'magnification-curve', _('Falloff sharpness'),
        _('Higher is a sharper peak; lower spreads the zoom wider'), 0.5, 5.0, 0.05, 2));
    mag.add(spinRow(s, 'zoom-range', _('Spread radius'),
        _('How far from the cursor the zoom reaches (pixels)'), 40, 500, 10, 0));
    mag.add(spinRow(s, 'hover-lift', _('Hover lift'),
        _('How far the icon rises on hover (pixels); 0 disables'), 0, 24, 1, 0));
    p.add(mag);

    // ── Spring physics ──
    const spring = group(_('Spring physics'), _('The feel of the magnification motion.'));
    spring.add(spinRow(s, 'animation-smoothness', _('Follow time'),
        _('Lower is snappier, higher is smoother (milliseconds)'), 5, 300, 5, 0));
    spring.add(spinRow(s, 'spring-tension', _('Tension'),
        _('Stiffness of the spring'), 0.1, 1.0, 0.05, 2));
    spring.add(spinRow(s, 'spring-damping', _('Damping'),
        _('1.00 settles with no overshoot; lower bounces a little'), 0.2, 1.0, 0.05, 2));
    p.add(spring);

    // ── Bounce ──
    const bounce = group(_('Bounce'), _('The hop on launch, attention and minimize.'));
    bounce.add(spinRow(s, 'bounce-height', _('Bounce height'),
        _('Peak hop in pixels; 0 disables bounce'), 0, 80, 1, 0));
    bounce.add(spinRow(s, 'bounce-decay', _('Bounce decay'),
        _('How much of the height each hop keeps; higher = more, gentler hops'),
        0.30, 0.95, 0.05, 2));
    p.add(bounce);

    // ── Genie ──
    const genie = group(_('Genie minimize'), _('Windows fly into their dock icon.'));
    genie.add(switchRow(s, 'enable-genie-effect', _('Genie effect'),
        _('Minimize and restore animate into the dock icon')));
    genie.add(spinRow(s, 'genie-duration', _('Genie duration'),
        _('Length of the minimize animation (milliseconds)'), 50, 1000, 10, 0));
    p.add(genie);
}
