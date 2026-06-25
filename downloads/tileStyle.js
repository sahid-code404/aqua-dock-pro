// AquaDockPro — Downloads card styling.
//
// Purpose:   One place for the cfg→CSS mapping every Downloads tile uses (label
//            pill, label colour, thumbnail), so the fan and grid/list views look
//            identical and pick up the same user-configurable colours/borders.
// Ownership: Stateless. Mutates the style of the actors it's handed.
// Cost:      String build + 3 set_style calls; runs on build and on hover.

import { clamp } from '../core/utils.js';

export function applyTileStyle(cfg, labelPill, label, thumb, thumbRadius, hover, padding) {
    const bgAlpha = clamp(cfg.bgOpacity, 0.12, 0.82).toFixed(2);
    const radius = cfg.dlItemRadius ?? clamp(cfg.dockRadius ?? 16, 6, 28);
    const bw = cfg.dlItemBorderWidth ?? cfg.borderWidth ?? 1;
    const bc = cfg.dlItemBorderColor ?? cfg.borderColor ?? 'rgba(255,255,255,0.16)';
    const itemColor = cfg.dlItemColor ?? `rgba(28,28,32,${bgAlpha})`;
    const pillBg = hover ? 'rgba(255,255,255,0.16)' : itemColor;
    const border = bw > 0 ? `${bw}px solid ${bc}` : 'none';
    const fontColor = cfg.dlItemFontColor ?? '#f2f2f5';
    const thumbBg = cfg.dlItemThumbColor ?? 'rgba(46,46,54,0.70)';

    labelPill.set_style(
        `background-color: ${pillBg}; border: ${border}; border-radius: ${radius}px; padding: ${padding};`);
    label.set_style(`color: ${fontColor};`);
    thumb.set_style(
        `border-radius: ${thumbRadius}px; background-color: ${thumbBg}; ` +
        (bw > 0 ? `border: ${bw}px solid ${bc};` : 'border: none;'));
}
