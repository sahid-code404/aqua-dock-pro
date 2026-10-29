// Downloads stack tile styling.

import Clutter from 'gi://Clutter';
import { clamp } from '../core/utils.js';

export function applyTileStyle(cfg, labelPill, label, thumb, thumbRadius, hover, padding, isBlurActive = null, isAction = null, pillH = 0) {
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
        : (hover ? 'rgba(255, 255, 255, 0.18)' : (cfg.dlItemThumbColor ?? 'rgba(46,46,54,0.70)'));

    const targetH = pillH > 0 ? pillH : (labelPill && typeof labelPill.get_height === 'function' ? (labelPill.get_height() || 0) : (labelPill?.height || 0));
    const heightStyle = targetH > 0 ? ` min-height: ${targetH}px; height: ${targetH}px;` : '';

    labelPill.set_style(
        `background-color: ${pillBg}; border: ${border}; border-radius: ${radius}px; padding: ${padding};${heightStyle}`);
    label.set_style(`color: ${fontColor}; font-size: ${(10.5 * (cfg.interfaceTextScale ?? 1)).toFixed(2)}pt;`);

    thumb.set_style(
        `border-radius: ${thumbRadius}px; background-color: ${thumbBg}; ` +
        (bw > 0 ? `border: ${bw}px solid ${bc};` : 'border: none;'));
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
            `border-radius: ${radius}px; padding: 0 16px !important; margin: 0 !important; spacing: 0 !important; box-shadow: none !important; ${heightStyle}`
        );
        if (typeof item?.set_x_align === 'function') {
            try { item.set_x_align(Clutter?.ActorAlign?.FILL ?? 0); } catch { }
        }
        if (typeof item?.set_y_align === 'function') {
            try { item.set_y_align(Clutter?.ActorAlign?.FILL ?? 0); } catch { }
        }
        if (typeof item?.set_x_expand === 'function') {
            try { item.set_x_expand(true); } catch { }
        }
        if (typeof item?.set_y_expand === 'function') {
            try { item.set_y_expand(true); } catch { }
        }
        item?.label?.set_style(
            `color: ${fontColor}; font-size: ${fontSize}pt; font-weight: 500; text-align: center; margin: 0 !important; padding: 0 !important;`
        );
        if (typeof item?.label?.set_x_align === 'function') {
            try { item.label.set_x_align(Clutter?.ActorAlign?.CENTER ?? 2); } catch { }
        }
        if (typeof item?.label?.set_y_align === 'function') {
            try { item.label.set_y_align(Clutter?.ActorAlign?.CENTER ?? 2); } catch { }
        }
        if (typeof item?.label?.set_x_expand === 'function') {
            try { item.label.set_x_expand(true); } catch { }
        }
        if (typeof item?.label?.set_y_expand === 'function') {
            try { item.label.set_y_expand(true); } catch { }
        }
        const ct = item?.label?.clutter_text;
        if (ct) {
            try {
                ct.set_line_wrap(false);
                ct.set_ellipsize(0);
                if (typeof ct.set_x_align === 'function') ct.set_x_align(Clutter?.ActorAlign?.CENTER ?? 2);
                if (typeof ct.set_y_align === 'function') ct.set_y_align(Clutter?.ActorAlign?.CENTER ?? 2);
            } catch { }
        }
    }
}
