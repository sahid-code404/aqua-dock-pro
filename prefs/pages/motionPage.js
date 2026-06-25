// AquaDockPro preferences — Motion page (magnification, springs, bounce, genie).
//
// Continuous, "feel" values are fractional spinners (2 decimals) for fine
// control; pixel/millisecond values stay whole numbers.

import { page, group, spinRow, switchRow } from '../widgets/rows.js';

export function buildMotionPage(window, s) {
    const p = page('Motion', 'preferences-desktop-screensaver-symbolic');
    window.add(p);

    // ── Magnification ──
    const mag = group('Magnification', 'How icons zoom under the cursor.');
    mag.add(spinRow(s, 'magnification', 'Peak magnification',
        'How large the icon under the cursor grows', 1.0, 3.5, 0.05, 2));
    mag.add(spinRow(s, 'magnification-curve', 'Falloff sharpness',
        'Higher is a sharper peak; lower spreads the zoom wider', 0.5, 5.0, 0.05, 2));
    mag.add(spinRow(s, 'zoom-range', 'Spread radius',
        'How far from the cursor the zoom reaches (pixels)', 40, 500, 10, 0));
    mag.add(spinRow(s, 'hover-lift', 'Hover lift',
        'How far the icon rises on hover (pixels); 0 disables', 0, 24, 1, 0));
    p.add(mag);

    // ── Spring physics ──
    const spring = group('Spring physics', 'The feel of the magnification motion.');
    spring.add(spinRow(s, 'animation-smoothness', 'Follow time',
        'Lower is snappier, higher is smoother (milliseconds)', 5, 300, 5, 0));
    spring.add(spinRow(s, 'spring-tension', 'Tension',
        'Stiffness of the spring', 0.1, 1.0, 0.05, 2));
    spring.add(spinRow(s, 'spring-damping', 'Damping',
        '1.00 settles with no overshoot; lower bounces a little', 0.2, 1.0, 0.05, 2));
    p.add(spring);

    // ── Bounce ──
    const bounce = group('Bounce', 'The hop on launch, attention and minimize.');
    bounce.add(spinRow(s, 'bounce-height', 'Bounce height',
        'Peak hop in pixels; 0 disables bounce', 0, 80, 1, 0));
    bounce.add(spinRow(s, 'bounce-decay', 'Bounce decay',
        'How much of the height each hop keeps; higher = more, gentler hops',
        0.30, 0.95, 0.05, 2));
    p.add(bounce);

    // ── Genie ──
    const genie = group('Genie minimize', 'Windows fly into their dock icon.');
    genie.add(switchRow(s, 'enable-genie-effect', 'Genie effect',
        'Minimize and restore animate into the dock icon'));
    genie.add(spinRow(s, 'genie-duration', 'Genie duration',
        'Length of the minimize animation (milliseconds)', 50, 1000, 10, 0));
    p.add(genie);
}
