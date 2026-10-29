// Downloads stack tile styling.

import Clutter from 'gi://Clutter';
import { clamp } from '../core/utils.js';

export function applyTileStyle(cfg, labelPill, label, thumb, thumbRadius, hover, padding, isBlurActive = null, isAction = null) {
    const bgAlpha = clamp(cfg.bgOpacity ?? 0.8, 0.12, 0.82).toFixed(2);
    const radius = cfg.dlItemRadius ?? clamp(cfg.dockRadius ?? 16, 6, 28);
    const bw = cfg.highContrast ? Math.max(2, cfg.dlItemBorderWidth ?? 1)
        : (cfg.dlItemBorderWidth ?? cfg.borderWidth ?? 1);
    const bc = cfg.highContrast ? '#ffffff'
        : (cfg.dlItemBorderColor ?? cfg.borderColor ?? 'rgba(255,255,255,0.16)');
    const blurEnabled = isBlurActive !== null ? Boolean(isBlurActive) : Boolean(cfg.blurEffect);
    const itemColor = cfg.highContrast ? 'rgba(0,0,0,0.96)'
        : (blurEnabled ? 'transparent' : (cfg.downloadsItemColor ?? cfg.dlItemColor ?? `rgba(28,28,32,${bgAlpha})`));
    const pillBg = hover ? 'rgba(255,255,255,0.16)' : itemColor;
    const border = bw > 0 ? `${bw}px solid ${bc}` : 'none';
    const fontColor = cfg.highContrast ? '#ffffff' : (cfg.dlItemFontColor ?? '#f2f2f5');
    const thumbBg = cfg.highContrast ? '#000000'
        : (cfg.dlItemThumbColor ?? 'rgba(46,46,54,0.70)');

    labelPill.set_style(
        `background-color: ${pillBg}; border: ${border}; border-radius: ${radius}px; padding: ${padding};`);
    label.set_style(`color: ${fontColor}; font-size: ${(10.5 * (cfg.interfaceTextScale ?? 1)).toFixed(2)}pt;`);

    if (isAction === true) {
        const actionBg = hover ? 'rgba(255, 255, 255, 0.24)' : (cfg.dlItemThumbColor ?? 'rgba(46, 46, 54, 0.75)');
        thumb.set_style(
            `border-radius: 999px; background-color: ${actionBg}; ` +
            (bw > 0 ? `border: ${bw}px solid ${bc};` : 'border: 1px solid rgba(255,255,255,0.22);'));
    } else if (isAction === false) {
        thumb.set_style('background-color: transparent; border: none; box-shadow: none;');
    } else {
        thumb.set_style(
            `border-radius: ${thumbRadius}px; background-color: ${thumbBg}; ` +
            (bw > 0 ? `border: ${bw}px solid ${bc};` : 'border: none;'));
    }
}

export function applyStackMenuPillStyle(cfg, menuBox, actionItems, hover = false, isBlurActive = null, targetHeight = 0) {
    const bgAlpha = clamp(cfg.bgOpacity ?? 0.8, 0.12, 0.82).toFixed(2);
    const radius = cfg.dlItemRadius ?? clamp(cfg.dockRadius ?? 16, 6, 28);
    const bw = cfg.highContrast ? Math.max(2, cfg.dlItemBorderWidth ?? 1)
        : (cfg.dlItemBorderWidth ?? cfg.borderWidth ?? 1);
    const bc = cfg.highContrast ? '#ffffff'
        : (cfg.dlItemBorderColor ?? cfg.borderColor ?? 'rgba(255,255,255,0.16)');
    const blurEnabled = isBlurActive !== null ? Boolean(isBlurActive) : Boolean(cfg.blurEffect);
    const itemColor = cfg.highContrast ? 'rgba(0,0,0,0.96)'
        : (blurEnabled ? 'transparent' : (cfg.downloadsItemColor ?? cfg.dlItemColor ?? `rgba(28,28,32,${bgAlpha})`));
    const pillBg = hover ? 'rgba(255, 255, 255, 0.16)' : itemColor;
    const border = bw > 0 ? `${bw}px solid ${bc}` : 'none';
    const fontColor = cfg.highContrast ? '#ffffff' : (cfg.dlItemFontColor ?? '#f2f2f5');
    const fontSize = (10.5 * (cfg.interfaceTextScale ?? 1)).toFixed(2);
    const heightStyle = targetHeight > 0 ? `min-height: ${targetHeight}px; height: ${targetHeight}px;` : '';

    menuBox?.set_style(
        `background-color: ${pillBg} !important; border: ${border}; ` +
        `border-radius: ${radius}px; padding: 0; margin: 0; min-width: 0; max-width: 220px; box-shadow: none; ${heightStyle}`
    );

    for (const item of actionItems ?? []) {
        item?.set_style(
            `background-color: transparent !important; border: none !important; ` +
            `border-radius: ${radius}px; padding: 6px 14px !important; margin: 0 !important; box-shadow: none !important; ${heightStyle}`
        );
        if (targetHeight > 0 && typeof item?.set_y_align === 'function') {
            try { item.set_y_align(Clutter?.ActorAlign?.CENTER ?? 2); } catch { }
        }
        item?.label?.set_style(
            `color: ${fontColor}; font-size: ${fontSize}pt; font-weight: 500;`
        );
        if (typeof item?.label?.set_y_align === 'function') {
            try { item.label.set_y_align(Clutter?.ActorAlign?.CENTER ?? 2); } catch { }
        }
    }
}
