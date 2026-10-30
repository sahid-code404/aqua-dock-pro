// Pure dock geometry and layout calculator.

import { clamp } from '../core/utils.js';
import { ICON_BOT, BG_PAD_X, DOT_SIZE, SEP_W, SEP_PAD } from '../core/constants.js';
import { magnificationParams } from '../animation/springSolver.js';

// Caches for memoizing applyAlpha and pillStyle
const ALPHA_CACHE = new Map();
const MAX_ALPHA_CACHE = 128;

const PILL_STYLE_CACHE = new Map();
const MAX_PILL_STYLE_CACHE = 64;

/**
 * Clear layout style and color memoization caches.
 * Called on extension disable or configuration reset.
 */
export function clearDockLayoutCache() {
    ALPHA_CACHE.clear();
    PILL_STYLE_CACHE.clear();
}

/**
 * Parses an rgb/rgba or hex color string and multiplies its alpha channel by factor.
 * Memoized with an LRU cache (up to 128 entries) to eliminate regex evaluation on hover.
 *
 * @param {string} colorStr - Color string in hex (#RGB, #RRGGBB, #RRGGBBAA) or rgb()/rgba() syntax.
 * @param {number} factor - Alpha multiplier factor in [0, 1].
 * @returns {string} Formatted rgba(r, g, b, a) CSS string, or original string if parsing fails.
 */
export function applyAlpha(colorStr, factor) {
    if (!colorStr) return colorStr;
    const factorNum = Number(factor);
    const key = `${colorStr}:${Number.isFinite(factorNum) ? factorNum.toFixed(4) : factor}`;
    const cached = ALPHA_CACHE.get(key);
    if (cached !== undefined) {
        ALPHA_CACHE.delete(key);
        ALPHA_CACHE.set(key, cached);
        return cached;
    }

    let result = colorStr;
    const m = colorStr.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (m) {
        const a = (m[4] !== undefined ? parseFloat(m[4]) : 1) * factor;
        result = `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a.toFixed(3)})`;
    } else {
        const hex = colorStr.match(/^#?([0-9a-f]{3,8})$/i);
        if (hex) {
            const h = hex[1];
            let r, g, b, a = 1;
            if (h.length === 3) {
                r = parseInt(h[0] + h[0], 16);
                g = parseInt(h[1] + h[1], 16);
                b = parseInt(h[2] + h[2], 16);
            } else if (h.length === 4) {
                r = parseInt(h[0] + h[0], 16);
                g = parseInt(h[1] + h[1], 16);
                b = parseInt(h[2] + h[2], 16);
                a = parseInt(h[3] + h[3], 16) / 255;
            } else if (h.length === 6) {
                r = parseInt(h.slice(0, 2), 16);
                g = parseInt(h.slice(2, 4), 16);
                b = parseInt(h.slice(4, 6), 16);
            } else if (h.length === 8) {
                r = parseInt(h.slice(0, 2), 16);
                g = parseInt(h.slice(2, 4), 16);
                b = parseInt(h.slice(4, 6), 16);
                a = parseInt(h.slice(6, 8), 16) / 255;
            }
            if (r !== undefined) {
                result = `rgba(${r}, ${g}, ${b}, ${(a * factor).toFixed(3)})`;
            }
        }
    }

    if (ALPHA_CACHE.size >= MAX_ALPHA_CACHE) {
        const oldest = ALPHA_CACHE.keys().next().value;
        ALPHA_CACHE.delete(oldest);
    }
    ALPHA_CACHE.set(key, result);
    return result;
}

/**
 * Constructs an inline CSS style string for the dock pill background and border.
 * Memoized with an LRU cache (up to 64 entries) to avoid template string concatenation during motion.
 *
 * @param {object} cfg - Layout configuration snapshot.
 * @param {boolean} [isTransparent=false] - If true, forces transparent background for Blur My Shell.
 * @returns {string} Inline CSS style string for the dock pill.
 */
export function pillStyle(cfg, isTransparent = false) {
    const radius = cfg.dockRadius ?? 16;
    const bw = cfg.highContrast ? Math.max(2, cfg.borderWidth ?? 1) : (cfg.borderWidth ?? 1);
    const bc = cfg.highContrast ? '#ffffff' : (cfg.borderColor ?? 'rgba(255,255,255,0.16)');
    const hc = Boolean(cfg.highContrast);
    const pillColor = cfg.pillColor ?? 'rgba(28,28,32,0.78)';
    const bgOpacity = clamp(cfg.bgOpacity ?? 0.78, 0.1, 1.0);
    const trans = Boolean(isTransparent);

    const key = `${radius}:${bw}:${bc}:${hc}:${pillColor}:${bgOpacity.toFixed(3)}:${trans}`;
    const cached = PILL_STYLE_CACHE.get(key);
    if (cached !== undefined) {
        PILL_STYLE_CACHE.delete(key);
        PILL_STYLE_CACHE.set(key, cached);
        return cached;
    }

    const border = bw > 0 ? `${bw}px solid ${bc}` : 'none';
    const fill = hc ? 'rgba(0,0,0,0.96)'
        : (trans ? 'transparent' : applyAlpha(pillColor, bgOpacity));
    const result = `border-radius: ${radius}px; border: ${border}; background-color: ${fill};`;

    if (PILL_STYLE_CACHE.size >= MAX_PILL_STYLE_CACHE) {
        const oldest = PILL_STYLE_CACHE.keys().next().value;
        PILL_STYLE_CACHE.delete(oldest);
    }
    PILL_STYLE_CACHE.set(key, result);
    return result;
}

/**
 * Calculates the required pixel overflow headroom outside the resting dock bounds
 * to prevent magnified icons from being clipped by stage boundaries.
 *
 * @param {number} magZone - Base magnification zone thickness in pixels.
 * @param {number} scale - Peak magnification scale factor.
 * @returns {number} Required overflow headroom in pixels.
 */
export function magnifiedOverflow(magZone, scale) {
    const growth = Math.max(0, scale - 1) * magZone.growthPerScale;
    const overflow = Math.ceil(growth - magZone.restInset);
    if (overflow <= 0) return 0;
    return overflow + (magZone.hoverReach ?? 0);
}

/**
 * Computes pixel geometry, spacing, and glow padding for running window indicator marks.
 * Scales dynamically when dock auto-shrink-to-fit compression is active.
 *
 * @param {object} cfg - Layout configuration snapshot.
 * @param {number} [count=1] - Number of open windows for the application.
 * @returns {{ responsive: boolean, scale: number, width: number, height: number, spacing: number, gap: number, glowPads: number[], outerPad: number, indicW: number, indicH: number, paintW: number, paintH: number }} Computed indicator metrics.
 */
export function indicatorMetrics(cfg, count = 1) {
    const style = cfg.indicatorStyle ?? 'dot';
    const vertical = !!cfg.vertical;
    const configuredSize = cfg.indicatorSize ?? DOT_SIZE;
    const itemCount = Math.max(1, Math.round(count));
    const multi = style === 'dots' || style === 'glow-dots';
    const glowing = style === 'glow' || style === 'glow-dots';

    const baseShape = () => {
        const ratio = configuredSize / DOT_SIZE;
        let width = configuredSize;
        let height = configuredSize;
        if (style === 'line')
            [width, height] = [Math.round(24 * ratio), Math.max(2, Math.round(3 * ratio))];
        else if (style === 'pill')
            [width, height] = [Math.round(18 * ratio), Math.max(2, Math.round(4 * ratio))];
        else if (style === 'glow')
            [width, height] = [Math.round(28 * ratio), Math.max(3, Math.round(6 * ratio))];
        if (vertical && !multi) [width, height] = [height, width];
        return { width, height };
    };

    const base = baseShape();
    const baseShortEdge = Math.min(base.width, base.height);
    const baseOuterPad = style === 'glow-dots'
        ? Math.min(6, Math.max(3, Math.round(baseShortEdge * 0.55)))
        : (style === 'glow'
            ? Math.min(7, Math.max(4, Math.round(baseShortEdge * 0.65)))
            : 0);
    const baseGlowPads = glowing
        ? [baseOuterPad,
            Math.max(2, Math.round(baseOuterPad * 0.6)),
            Math.max(1, Math.round(baseOuterPad * 0.3))]
        : [];

    const build = (scale, responsive) => {
        const width = responsive ? Math.max(1, Math.round(base.width * scale)) : base.width;
        const height = responsive ? Math.max(1, Math.round(base.height * scale)) : base.height;
        const spacing = multi ? (responsive ? Math.max(0, Math.round(4 * scale)) : 4) : 0;
        const gap = responsive ? Math.max(0, Math.round(4 * scale)) : 4;
        const glowPads = responsive
            ? baseGlowPads.map(padding => Math.max(0, Math.round(padding * scale)))
            : baseGlowPads;
        const outerPad = glowPads.length ? Math.max(...glowPads) : 0;
        const run = itemCount * (vertical ? height : width) +
            Math.max(0, itemCount - 1) * spacing;
        const indicW = vertical ? width : run;
        const indicH = vertical ? run : height;
        return {
            responsive,
            scale,
            width,
            height,
            spacing,
            gap,
            glowPads,
            outerPad,
            indicW,
            indicH,
            paintW: indicW + outerPad * 2,
            paintH: indicH + outerPad * 2,
        };
    };

    const legacy = build(1, false);
    const restGap = Math.max(0, Math.round((cfg.dockH - cfg.iconSize) / 2));
    const fits = metrics => {
        const crossSize = vertical ? metrics.indicW : metrics.indicH;
        const mainPaint = vertical ? metrics.paintH : metrics.paintW;
        const crossPaint = vertical ? metrics.paintW : metrics.paintH;
        return mainPaint <= cfg.cellW && crossPaint <= cfg.dockH &&
            metrics.gap >= metrics.outerPad &&
            metrics.gap + crossSize + metrics.outerPad <= restGap;
    };

    // Preserve the original indicator pixel-for-pixel in every normal manual
    // or fitting layout. Invalid manual thickness/icon combinations are also
    // contained, because painting outside the pill is never useful.
    if (cfg.shrunk !== true && fits(legacy)) return legacy;

    // Rounding can make a nominally proportional indicator one pixel too
    // large. Walk down in one-percent steps and use the first pixel-aligned
    // shape whose complete paint bounds (including glow) fit both the cell and
    // the breathing room between the resting icon and the pill edge.
    const requested = clamp(cfg.shrunk === true ? (cfg.autoShrinkFactor ?? 1) : 1, 0.01, 1);

    let smallest = build(0.01, true);
    for (let percent = Math.max(1, Math.floor(requested * 100)); percent >= 1; percent--) {
        const metrics = build(percent / 100, true);
        smallest = metrics;
        if (fits(metrics)) return metrics;
    }
    // Invalid manual thickness/icon combinations may leave no outside gap at
    // all. The placement helper still clamps this smallest legible core inside
    // the pill, preferring containment over painting beyond the screen edge.
    return smallest;
}

/**
 * Computes stage coordinates for an application running indicator relative to its resting icon rect.
 * Ensures indicators stay centered along the dock edge and within pill padding.
 *
 * @param {object} cfg - Layout configuration snapshot.
 * @param {object} metrics - Indicator geometry metrics from {@link indicatorMetrics}.
 * @param {{ x: number, y: number, w: number, h: number }|null} restRect - Resting icon bounds.
 * @param {number} [containerHeadroom=0] - Additional container headroom offset.
 * @returns {{ x: number, y: number }} Clamped stage coordinates for the indicator.
 */
export function indicatorPosition(cfg, metrics, restRect, containerHeadroom = 0) {
    const iw = metrics.indicW;
    const ih = metrics.indicH;
    const restGap = Math.round((cfg.dockH - cfg.iconSize) / 2);
    const cx = restRect ? restRect.x + restRect.w / 2 : cfg.cellW / 2;
    const cy = restRect ? restRect.y + restRect.h / 2 : cfg.cellW / 2;
    let x;
    let y;

    if (!cfg.vertical) {
        const iconBottom = containerHeadroom + cfg.dockH - restGap;
        x = Math.round(cx - iw / 2);
        y = Math.round(iconBottom + metrics.gap);
    } else if (cfg.position !== 'right') {
        x = Math.max(2, restGap - metrics.gap - iw);
        y = Math.round(cy - ih / 2);
    } else {
        const iconRight = containerHeadroom + cfg.dockH - restGap;
        x = Math.round(iconRight + metrics.gap);
        y = Math.round(cy - ih / 2);
    }

    if (!metrics.responsive) return { x, y };

    const pad = metrics.outerPad;
    const bounded = (value, low, high) =>
        Math.round(clamp(value, low, Math.max(low, high)));
    if (!cfg.vertical) {
        x = bounded(x, pad, cfg.cellW - iw - pad);
        y = bounded(y, containerHeadroom + pad,
            containerHeadroom + cfg.dockH - ih - pad);
    } else {
        const crossStart = cfg.position === 'right' ? containerHeadroom : 0;
        x = bounded(x, crossStart + pad, crossStart + cfg.dockH - iw - pad);
        y = bounded(y, pad, cfg.cellW - ih - pad);
    }
    return { x, y };
}

// Shrink the dock proportionally if its natural length overflows the monitor.
// Returns a (possibly mutated) clone — never mutates the input snapshot.
function applyAutoShrink(base, chips, monitor) {
    const c = Object.assign({}, base);
    if (c.autoShrink === false) return c;

    const pad = Math.round(BG_PAD_X * c.scale);
    const sepW = SEP_W + SEP_PAD * 2;
    const spacerW = Math.max(4, Math.round(12 * c.scale));
    let nIcons = 0, fixedStructures = 0;
    for (const chip of chips) {
        if (chip.item) nIcons++;
        else fixedStructures += chip.entry?.kind === 'spacer' ? spacerW : sepW;
    }

    const natural = pad * 2 + nIcons * c.cellW + fixedStructures;
    const topInset = monitor.topInset ?? 0;
    const bottomInset = monitor.bottomInset ?? 0;
    const availSpan = c.vertical
        ? Math.max(1, monitor.height - topInset - bottomInset)
        : monitor.width;
    const avail = Math.max(1, availSpan - 2 * c.edgeMargin - 8);
    if (natural <= avail) return c;

    // Normally separators/spacers keep their historical pixel sizes. Only when
    // those fixed structures themselves would consume the space needed for
    // legible icon cells do we proportionally compress them as a last-resort
    // screen-fit measure. This also covers structure-only custom layouts.
    if (fixedStructures > 0) {
        const iconReserve = nIcons > 0 ? nIcons * 16 : 0;
        const structureBudget = Math.max(0, avail - pad * 2 - iconReserve);
        if (fixedStructures > structureBudget)
            c.structureScale = clamp(structureBudget / fixedStructures, 0, 1);
    }

    if (nIcons === 0) {
        c.shrunk = true;
        c.autoShrinkFactor = 1;
        return c;
    }

    const effectiveStructures = fixedStructures * (c.structureScale ?? 1);
    const baseSpacing = c.iconSpacing ?? c.cellPad * 2;
    const fixed = pad * 2 + effectiveStructures;
    const naturalCells = nIcons * (c.iconSize + baseSpacing);
    const f = clamp((avail - fixed) / Math.max(1, naturalCells), 0.01, 1.0);
    if (f >= 0.999 && c.structureScale === undefined) return c;

    const baseIconSize = c.iconSize;
    const baseDockH = c.dockH;
    // Keep icons legible whenever there is room, then relax that floor only
    // for pathological icon counts. This final cell budget guarantees that
    // screen-fit mode cannot leave normal icon-heavy docks beyond their span.
    const cellBudget = Math.max(1, Math.floor((avail - fixed) / nIcons));
    let iconSize = Math.max(16, Math.floor(c.iconSize * f));
    let iconSpacing = Math.min(
        baseSpacing, Math.max(0, Math.floor(baseSpacing * f)));
    if (iconSize + iconSpacing > cellBudget)
        iconSpacing = Math.max(0, cellBudget - iconSize);
    if (iconSize > cellBudget) {
        iconSize = cellBudget;
        iconSpacing = 0;
    }
    const renderSize = Math.round(iconSize * c.zoomMax);
    const dockH = Math.max(28, Math.round(c.dockH * f));
    const hoverLift = Math.round(c.hoverLift * f);
    const cellPad = iconSpacing / 2;
    const iconTopAtRest = dockH - ICON_BOT - iconSize;
    c.iconSize = iconSize;
    c.renderSize = renderSize;
    c.cellPad = cellPad;
    c.cellW = iconSize + iconSpacing;
    c.iconSpacing = iconSpacing;
    c.dockH = dockH;
    // Radius and indicators are visual parts of the dock, so keep them in the
    // same proportions as its final pixel-aligned thickness. The raw settings
    // snapshot remains untouched and the no-shrink path is exactly unchanged.
    const thicknessRatio = dockH / Math.max(1, baseDockH);
    c.dockRadius = Math.max(0, Math.round((c.dockRadius ?? 0) * thicknessRatio));
    c.autoShrinkFactor = Math.min(
        iconSize / Math.max(1, baseIconSize), thicknessRatio, 1);
    c.hoverLift = hoverLift;
    c.headroom = Math.max(0, renderSize - iconSize + hoverLift - iconTopAtRest) + 10;
    c.hitH = c.headroom + dockH;
    c.shrunk = true;
    return c;
}

/**
 * Master dock layout engine. Calculates actor geometry, chip positions, floating coordinates,
 * and auto-shrink compression factors for the dock on a given physical monitor.
 *
 * @param {object} base - Base configuration object from SettingsManager.
 * @param {Array<object>} chips - Array of dock item chips representing applications and widgets.
 * @param {object} monitor - Monitor geometry rect { x, y, width, height }.
 * @param {boolean} [monitorFullscreen=false] - Whether a fullscreen window is active on the monitor.
 * @returns {{ cfg: object, geom: object }} Layout configuration and actor geometry specifications.
 */
export function computeLayout(base, chips, monitor, monitorFullscreen = false) {
    const cfg = applyAutoShrink(base, chips, monitor);
    cfg.mag = magnificationParams(cfg);

    const vert = cfg.vertical;
    const side = cfg.position;
    const pad = Math.round(BG_PAD_X * cfg.scale);
    const structureScale = cfg.structureScale ?? 1;
    const sepPad = structureScale < 1
        ? Math.max(0, Math.floor(SEP_PAD * structureScale)) : SEP_PAD;
    const sepLine = structureScale < 1
        ? Math.max(1, Math.round(SEP_W * structureScale)) : SEP_W;
    const sepW = sepLine + sepPad * 2;
    const baseSpacerW = Math.max(4, Math.round(12 * cfg.scale));
    const spacerW = structureScale < 1
        ? Math.max(1, Math.floor(baseSpacerW * structureScale)) : baseSpacerW;
    const thick = cfg.dockH;

    // Main-axis span and per-chip offsets.
    let span = pad * 2;
    for (const chip of chips) {
        chip.w = chip.item ? cfg.cellW
            : (chip.entry?.kind === 'spacer' ? spacerW : sepW);
        span += chip.w;
    }
    const mainLen = Math.max(span, cfg.cellW);
    const width = vert ? thick : mainLen;
    const height = vert ? mainLen : thick;

    // Floating position (all three sides share the same edge margin). Alignment
    // changes only the main-axis origin; center remains the compatible default.
    const alignPad = Math.max(12, Math.round(16 * cfg.scale));
    const topInset = monitor.topInset ?? 0;
    const bottomInset = monitor.bottomInset ?? 0;
    const availSpan = vert
        ? Math.max(0, monitor.height - topInset - bottomInset)
        : monitor.width;

    const mainOrigin = (available, length) => {
        const room = Math.max(0, available - length);
        if (cfg.alignment === 'start') return Math.min(alignPad, room);
        if (cfg.alignment === 'end') return Math.max(0, room - alignPad);
        return (available - length) / 2;
    };
    let x, y;
    if (side === 'left') {
        x = monitor.x + cfg.edgeMargin;
        y = Math.round(monitor.y + topInset + mainOrigin(availSpan, height));
    } else if (side === 'right') {
        x = monitor.x + monitor.width - width - cfg.edgeMargin;
        y = Math.round(monitor.y + topInset + mainOrigin(availSpan, height));
    } else {
        x = Math.round(monitor.x + mainOrigin(monitor.width, width));
        y = Math.round(monitor.y + monitor.height - height - cfg.edgeMargin);
    }
    if (vert) y = Math.max(monitor.y + topInset, y);
    let hiddenX = x, hiddenY = y;
    if (side === 'left') hiddenX = monitor.x - width - 4;
    else if (side === 'right') hiddenX = monitor.x + monitor.width + 4;
    else hiddenY = monitor.y + monitor.height + 4;

    // Pick band (cross-axis range that counts as "on a chip") + magnify band.
    const pickGrace = 14;
    const graceIn = cfg.renderSize + cfg.hoverLift;
    const pick = { low: -pickGrace, high: thick + pickGrace };
    const band = side === 'left'
        ? { low: -pickGrace, high: thick + graceIn }
        : { low: -graceIn, high: thick + pickGrace };

    // Pill base rect (local to container; headroom is always 0).
    const bg = vert ? { x: 0, y: 0, w: thick, h: mainLen } : { x: 0, y: 0, w: mainLen, h: thick };
    const bgBaseX = vert ? bg.y : bg.x;   // == 0
    const bgBaseW = mainLen;

    // Chip offsets + per-chip actor boxes.
    const sepThick = Math.round(thick * 0.56);
    const sepOff = Math.round(thick * 0.22);
    let cursor = pad;
    let firstItemCenter, lastItemCenter;
    for (const chip of chips) {
        chip.baseX = cursor;
        chip.center = cursor + chip.w / 2;
        if (chip.item) {
            chip.w = cfg.cellW;
            chip.itemPos = vert ? { x: 0, y: cursor } : { x: cursor, y: 0 };
            chip.center = cursor + chip.w / 2;
            if (firstItemCenter === undefined) firstItemCenter = chip.center;
            lastItemCenter = chip.center;
        } else if (chip.entry?.kind === 'spacer') {
            chip.box = vert
                ? { x: 0, y: cursor, w: thick, h: chip.w }
                : { x: cursor, y: 0, w: chip.w, h: thick };
        } else if (!vert) {
            chip.box = { x: cursor + sepPad, y: sepOff, w: sepLine, h: sepThick };
        } else {
            chip.box = { x: sepOff, y: cursor + sepPad, w: sepThick, h: sepLine };
        }
        cursor += chip.w;
    }

    // Chrome zones (absolute/stage coords).
    const em = cfg.edgeMargin;
    let edgeZone;
    if (em <= 0) edgeZone = { x: monitor.x, y: monitor.y, w: 0, h: 0 };
    else if (side === 'left') edgeZone = { x: monitor.x, y, w: em, h: height };
    else if (side === 'right') edgeZone = { x: x + width, y, w: em, h: height };
    else edgeZone = { x, y: y + height, w: width, h: em };

    let strip;
    if (side === 'left') strip = { x: monitor.x, y: monitor.y + topInset, w: 2, h: availSpan };
    else if (side === 'right') strip = { x: monitor.x + monitor.width - 2, y: monitor.y + topInset, w: 2, h: availSpan };
    else strip = { x: monitor.x, y: monitor.y + monitor.height - 2, w: monitor.width, h: 2 };

    // The hidden marker is a clipped copy of the pill, not a separately sized
    // capsule. Only the screen-facing border is exposed, so its length, corner
    // shape and alignment always follow the live dock geometry. Keeping the
    // full actor rect plus a local clip also prevents it bleeding onto an
    // adjacent monitor when that edge is shared.
    const peek = Math.min(thick, Math.max(1, Math.round(cfg.borderWidth ?? 1)));
    const mainStart = vert ? y : x;
    const mainEnd = mainStart + (vert ? height : width);
    const monitorStart = vert ? (monitor.y + topInset) : monitor.x;
    const monitorEnd = vert ? (monitor.y + monitor.height - bottomInset) : (monitor.x + monitor.width);
    const visibleStart = Math.max(mainStart, monitorStart);
    const visibleEnd = Math.max(visibleStart, Math.min(mainEnd, monitorEnd));
    const visibleLength = visibleEnd - visibleStart;
    const localStart = visibleStart - mainStart;
    let autohideHandle;
    if (side === 'left') {
        autohideHandle = {
            x: monitor.x - width + peek,
            y,
            w: width,
            h: height,
            clip: { x: width - peek, y: localStart, w: peek, h: visibleLength },
        };
    } else if (side === 'right') {
        const edge = monitor.x + monitor.width;
        autohideHandle = {
            x: edge - peek,
            y,
            w: width,
            h: height,
            clip: { x: 0, y: localStart, w: peek, h: visibleLength },
        };
    } else {
        const edge = monitor.y + monitor.height;
        autohideHandle = {
            x,
            y: edge - peek,
            w: width,
            h: height,
            clip: { x: localStart, y: 0, w: visibleLength, h: peek },
        };
    }

    let strut = null;
    if (!cfg.autoHideActive && !monitorFullscreen) {
        const reserve = Math.max(1, em + thick + em);
        if (side === 'left') strut = { x: monitor.x, y: monitor.y + topInset, w: reserve, h: availSpan };
        else if (side === 'right') strut = { x: monitor.x + monitor.width - reserve, y: monitor.y + topInset, w: reserve, h: availSpan };
        else strut = { x: monitor.x, y: monitor.y + monitor.height - reserve, w: monitor.width, h: reserve };
    }

    // DockItem uses the same rounded centring gap. The extra reach gives the
    // live hover area a small cushion beyond the icon edge while staying inside
    // the tooltip gap.
    const restGap = Math.round((thick - cfg.iconSize) / 2);
    const restInset = Math.max(0, thick - restGap - cfg.iconSize);
    const growthPerScale = cfg.iconSize + cfg.hoverLift * cfg.liftDenom;
    const hoverReach = 8;
    // The overflow zone must not change along the row while the pill animates:
    // resizing a reactive actor under the pointer produces synthetic leave and
    // enter events. Reserve only the transformed icon's peak side overhang.
    const mainPad = Math.ceil(Math.max(0, cfg.renderSize - cfg.iconSize) / 2);

    const geom = {
        side, vert, width, height, x, y, hiddenX, hiddenY,
        mainLen, thick, pad,
        bg, bgBaseX, bgBaseW,
        pick, band,
        firstItemCenter, lastItemCenter,
        edgeZone, strip, strut, autohideHandle,
        magZone: {
            restInset,
            growthPerScale,
            hoverReach,
            mainPad,
            side, dockH: thick,
        },
    };
    return { cfg, geom };
}

/**
 * Compute the on-stage transformed bounding box and center of a DockItem icon
 * analytically without traversing the Clutter scene graph transform matrix hierarchy.
 *
 * @param {object} item - DockItem actor instance
 * @param {object} geom - Dock geometry from computeLayout
 * @param {object|null} [scratch=null] - Optional reusable object { ix, iy, iw, ih, cx, cy }
 * @returns {object|null} Transformed geometry { ix, iy, iw, ih, cx, cy } or null if unavailable
 */
export function getAnalyticalIconGeometry(item, geom, scratch = null) {
    if (!item || !geom) return null;
    const rest = item._restRect;
    if (!rest) return null;

    const chip = item._chip;
    const transProp = geom.vert ? 'translation_y' : 'translation_x';
    const spread = (chip && Number.isFinite(chip.spreadOffset))
        ? chip.spreadOffset
        : (item[transProp] ?? 0);
    const baseX = chip?.baseX ?? (geom.vert ? (item.y ?? 0) : (item.x ?? 0));
    const lift = item._iconLift ?? 0;
    const scale = item.scaleCurrent ?? 1;

    const iw = rest.w * scale;
    const ih = rest.h * scale;

    const vert = Boolean(geom.vert);
    const side = geom.side || (vert ? 'left' : 'bottom');

    let ix, iy, cx, cy;
    if (!vert) {
        // Bottom dock: pivot is (0.5, 1.0)
        cx = geom.x + baseX + spread + rest.x + rest.w * 0.5;
        ix = cx - iw * 0.5;
        iy = geom.y + rest.y + rest.h + lift - ih;
        cy = iy + ih * 0.5;
    } else if (side === 'left') {
        // Left dock: pivot is (0.0, 0.5)
        ix = geom.x + rest.x + lift;
        cx = ix + iw * 0.5;
        cy = geom.y + baseX + spread + rest.y + rest.h * 0.5;
        iy = cy - ih * 0.5;
    } else {
        // Right dock: pivot is (1.0, 0.5)
        ix = geom.x + rest.x + rest.w + lift - iw;
        cx = ix + iw * 0.5;
        cy = geom.y + baseX + spread + rest.y + rest.h * 0.5;
        iy = cy - ih * 0.5;
    }

    if (scratch) {
        scratch.ix = ix;
        scratch.iy = iy;
        scratch.iw = iw;
        scratch.ih = ih;
        scratch.cx = cx;
        scratch.cy = cy;
        return scratch;
    }
    return { ix, iy, iw, ih, cx, cy };
}
