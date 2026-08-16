// Downloads stack tile styling.

import { clamp } from '../core/utils.js';

export function applyTileStyle(cfg, labelPill, label, thumb, thumbRadius, hover, padding) {
    const bgAlpha = clamp(cfg.bgOpacity, 0.12, 0.82).toFixed(2);
    const radius = cfg.dlItemRadius ?? clamp(cfg.dockRadius ?? 16, 6, 28);
    const bw = cfg.highContrast ? Math.max(2, cfg.dlItemBorderWidth ?? 1)
        : (cfg.dlItemBorderWidth ?? cfg.borderWidth ?? 1);
    const bc = cfg.highContrast ? '#ffffff'
        : (cfg.dlItemBorderColor ?? cfg.borderColor ?? 'rgba(255,255,255,0.16)');
    const itemColor = cfg.highContrast ? 'rgba(0,0,0,0.96)'
        : (cfg.dlItemColor ?? `rgba(28,28,32,${bgAlpha})`);
    const pillBg = hover ? 'rgba(255,255,255,0.16)' : itemColor;
    const border = bw > 0 ? `${bw}px solid ${bc}` : 'none';
    const fontColor = cfg.highContrast ? '#ffffff' : (cfg.dlItemFontColor ?? '#f2f2f5');
    const thumbBg = cfg.highContrast ? '#000000'
        : (cfg.dlItemThumbColor ?? 'rgba(46,46,54,0.70)');

    labelPill.set_style(
        `background-color: ${pillBg}; border: ${border}; border-radius: ${radius}px; padding: ${padding};`);
    label.set_style(`color: ${fontColor}; font-size: ${(10.5 * (cfg.interfaceTextScale ?? 1)).toFixed(2)}pt;`);
    thumb.set_style(
        `border-radius: ${thumbRadius}px; background-color: ${thumbBg}; ` +
        (bw > 0 ? `border: ${bw}px solid ${bc};` : 'border: none;'));
}
