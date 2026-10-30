// Downloads stack tile styling.

import Clutter from 'gi://Clutter';
import { clamp } from '../core/utils.js';

// Module-level caches for precomputed normal and hover row styles.
export const NORMAL_ROW_STYLES = new Map();
export const HOVER_ROW_STYLES = new Map();

const MAX_ROW_STYLE_CACHE = 64;

/**
 * Clear all precomputed tile style caches.
 * Called on extension disable or configuration reset.
 */
export function clearTileStyleCache() {
    NORMAL_ROW_STYLES.clear();
    HOVER_ROW_STYLES.clear();
}

/**
 * Precompute or retrieve cached row style objects for normal and hover states.
 *
 * @param {object} cfg - Extension settings object
 * @param {number} thumbRadius - Thumbnail corner radius in pixels
 * @param {string} [padding='0 12px'] - CSS padding string
 * @param {boolean|null} [isBlurActive=null] - Whether blur is active on the stack
 * @param {number} [pillH=0] - Explicit pill height
 * @param {Clutter.Actor|null} [labelPill=null] - Pill actor to query height if pillH is 0
 * @returns {{ normal: object, hover: object }} Precomputed style objects assigned by reference
 */
export function getRowStyles(cfg, thumbRadius, padding = '0 12px', isBlurActive = null, pillH = 0, labelPill = null) {
    const bgAlpha = clamp(cfg.bgOpacity ?? 0.8, 0.12, 0.82).toFixed(2);
    const radius = cfg.dlItemRadius ?? clamp(cfg.dockRadius ?? 16, 6, 28);
    const bw = cfg.highContrast ? Math.max(2, cfg.dlItemBorderWidth ?? 1)
        : (cfg.dlItemBorderWidth ?? cfg.borderWidth ?? 1);
    const bc = cfg.highContrast ? '#ffffff'
        : (cfg.dlItemBorderColor ?? cfg.borderColor ?? 'rgba(255,255,255,0.16)');
    const blurEnabled = isBlurActive !== null ? Boolean(isBlurActive) : Boolean(cfg.blurEffect);
    const itemColor = cfg.highContrast ? 'rgba(0,0,0,0.96)'
        : (blurEnabled ? 'transparent' : (cfg.downloadsItemColor ?? cfg.dlItemColor ?? `rgba(28,28,32,${bgAlpha})`));
    const border = bw > 0 ? `${bw}px solid ${bc}` : 'none';
    const fontColor = cfg.highContrast ? '#ffffff' : (cfg.dlItemFontColor ?? '#f2f2f5');
    const fontSize = (10.5 * (cfg.interfaceTextScale ?? 1)).toFixed(2);
    const thumbBgNormal = cfg.highContrast ? '#000000'
        : (cfg.dlItemThumbColor ?? 'rgba(46,46,54,0.70)');
    const thumbBgHover = cfg.highContrast ? '#000000' : 'rgba(255, 255, 255, 0.18)';
    const thumbBorder = bw > 0 ? `border: ${bw}px solid ${bc};` : 'border: none;';

    const targetH = pillH > 0 ? pillH : (labelPill && typeof labelPill.get_height === 'function' ? (labelPill.get_height() || 0) : (labelPill?.height || 0));
    const heightStyle = targetH > 0 ? ` min-height: ${targetH}px; height: ${targetH}px;` : '';

    const key = `${radius}:${bw}:${bc}:${itemColor}:${fontColor}:${fontSize}:${thumbRadius}:${padding}:${targetH}:${thumbBgNormal}:${thumbBgHover}:${border}:${thumbBorder}`;

    let normal = NORMAL_ROW_STYLES.get(key);
    let hover = HOVER_ROW_STYLES.get(key);

    if (!normal || !hover) {
        const pillNormal = `background-color: ${itemColor}; border: ${border}; border-radius: ${radius}px; padding: ${padding};${heightStyle}`;
        const pillHover = `background-color: rgba(255,255,255,0.16); border: ${border}; border-radius: ${radius}px; padding: ${padding};${heightStyle}`;
        const labelStyle = `color: ${fontColor}; font-size: ${fontSize}pt;`;
        const thumbNormal = `border-radius: ${thumbRadius}px; background-color: ${thumbBgNormal}; ${thumbBorder}`;
        const thumbHover = `border-radius: ${thumbRadius}px; background-color: ${thumbBgHover}; ${thumbBorder}`;

        normal = Object.freeze({
            pill: pillNormal,
            pillStyle: pillNormal,
            label: labelStyle,
            labelStyle,
            thumb: thumbNormal,
            thumbStyle: thumbNormal,
        });

        hover = Object.freeze({
            pill: pillHover,
            pillStyle: pillHover,
            label: labelStyle,
            labelStyle,
            thumb: thumbHover,
            thumbStyle: thumbHover,
        });

        if (NORMAL_ROW_STYLES.size >= MAX_ROW_STYLE_CACHE) {
            const firstKey = NORMAL_ROW_STYLES.keys().next().value;
            NORMAL_ROW_STYLES.delete(firstKey);
            HOVER_ROW_STYLES.delete(firstKey);
        }

        NORMAL_ROW_STYLES.set(key, normal);
        HOVER_ROW_STYLES.set(key, hover);
    }

    return { normal, hover };
}

/**
 * Apply styling to row actors. Backward-compatible wrapper delegating to precomputed caches.
 *
 * @param {object} cfg - Extension settings object.
 * @param {Clutter.Actor|null} labelPill - Pill container actor.
 * @param {Clutter.Actor|null} label - Label actor.
 * @param {Clutter.Actor|null} thumb - Thumbnail container actor.
 * @param {number} thumbRadius - Thumbnail corner radius in pixels.
 * @param {boolean} hover - Whether hover state is active.
 * @param {string} [padding='0 12px'] - CSS padding string.
 * @param {boolean|null} [isBlurActive=null] - Explicit blur state override.
 * @param {boolean|null} [isAction=null] - Unused legacy parameter.
 * @param {number} [pillH=0] - Explicit pill height.
 * @returns {void}
 */
export function applyTileStyle(cfg, labelPill, label, thumb, thumbRadius, hover, padding, isBlurActive = null, isAction = null, pillH = 0) {
    const { normal, hover: hoverStyle } = getRowStyles(cfg, thumbRadius, padding, isBlurActive, pillH, labelPill);
    const s = hover ? hoverStyle : normal;

    if (labelPill) labelPill.set_style(s.pill);
    if (label) label.set_style(s.label);
    if (thumb) thumb.set_style(s.thumb);
}

/**
 * Applies styled dark translucent pill CSS and typography to Downloads stack context menu boxes and action items.
 *
 * @param {object} cfg - Layout configuration object.
 * @param {Clutter.Actor|null} menuBox - Container box actor for the menu.
 * @param {Clutter.Actor[]|null} actionItems - Array of child action item button actors.
 * @param {boolean} [hover=false] - Whether menu box is currently in hover state.
 * @param {boolean|null} [isBlurActive=null] - Explicit blur state override.
 * @param {number} [targetHeight=0] - Explicit target height constraint in pixels.
 * @returns {void}
 */
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
            try { item.set_x_align(Clutter?.ActorAlign?.FILL ?? 0); } catch { /* intentionally ignored: clutter text or alignment properties unsupported on disposing actor */ }
        }
        if (typeof item?.set_y_align === 'function') {
            try { item.set_y_align(Clutter?.ActorAlign?.FILL ?? 0); } catch { /* intentionally ignored: clutter text or alignment properties unsupported on disposing actor */ }
        }
        if (typeof item?.set_x_expand === 'function') {
            try { item.set_x_expand(true); } catch { /* intentionally ignored: clutter text or alignment properties unsupported on disposing actor */ }
        }
        if (typeof item?.set_y_expand === 'function') {
            try { item.set_y_expand(true); } catch { /* intentionally ignored: clutter text or alignment properties unsupported on disposing actor */ }
        }
        item?.label?.set_style(
            `color: ${fontColor}; font-size: ${fontSize}pt; font-weight: 500; text-align: center; margin: 0 !important; padding: 0 !important;`
        );
        if (typeof item?.label?.set_x_align === 'function') {
            try { item.label.set_x_align(Clutter?.ActorAlign?.CENTER ?? 2); } catch { /* intentionally ignored: clutter text or alignment properties unsupported on disposing actor */ }
        }
        if (typeof item?.label?.set_y_align === 'function') {
            try { item.label.set_y_align(Clutter?.ActorAlign?.CENTER ?? 2); } catch { /* intentionally ignored: clutter text or alignment properties unsupported on disposing actor */ }
        }
        if (typeof item?.label?.set_x_expand === 'function') {
            try { item.label.set_x_expand(true); } catch { /* intentionally ignored: clutter text or alignment properties unsupported on disposing actor */ }
        }
        if (typeof item?.label?.set_y_expand === 'function') {
            try { item.label.set_y_expand(true); } catch { /* intentionally ignored: clutter text or alignment properties unsupported on disposing actor */ }
        }
        const ct = item?.label?.clutter_text;
        if (ct) {
            try {
                ct.set_line_wrap(false);
                ct.set_ellipsize(0);
                if (typeof ct.set_x_align === 'function') ct.set_x_align(Clutter?.ActorAlign?.CENTER ?? 2);
                if (typeof ct.set_y_align === 'function') ct.set_y_align(Clutter?.ActorAlign?.CENTER ?? 2);
            } catch { /* intentionally ignored: clutter text or alignment properties unsupported on disposing actor */ }
        }
    }
}
