// Pure dock geometry and layout calculator.

import { clamp } from '../core/utils.js';
import { ICON_BOT, BG_PAD_X, DOT_SIZE, SEP_W, SEP_PAD } from '../core/constants.js';
import { magnificationParams } from '../animation/springSolver.js';

// Parse rgb/rgba and multiply alpha by `factor`; pass through anything else.
export function applyAlpha(colorStr, factor) {
    const m = colorStr.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (!m) return colorStr;
    const a = (m[4] !== undefined ? parseFloat(m[4]) : 1) * factor;
    return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a.toFixed(3)})`;
}

// The cached CSS for the background pill.
export function pillStyle(cfg) {
    const bw = cfg.highContrast ? Math.max(2, cfg.borderWidth ?? 1) : (cfg.borderWidth ?? 1);
    const bc = cfg.highContrast ? '#ffffff' : (cfg.borderColor ?? 'rgba(255,255,255,0.16)');
    const border = bw > 0 ? `${bw}px solid ${bc}` : 'none';
    const fill = cfg.highContrast ? 'rgba(0,0,0,0.96)'
        : applyAlpha(cfg.pillColor ?? 'rgba(28,28,32,0.78)', clamp(cfg.bgOpacity, 0.1, 1.0));
    return `border-radius: ${cfg.dockRadius}px; border: ${border}; background-color: ${fill};`;
}

// Pixels by which a transformed icon extends beyond the dock pill. The icon is
// anchored at the screen-facing edge, so only its scale growth and hover lift
// move outward; `restInset` is the breathing room already inside the pill.
export function magnifiedOverflow(magZone, scale) {
    const growth = Math.max(0, scale - 1) * magZone.growthPerScale;
    const overflow = Math.ceil(growth - magZone.restInset);
    if (overflow <= 0) return 0;
    return overflow + (magZone.hoverReach ?? 0);
}

// Running-indicator geometry is shared with DockItem but kept pure so the
// auto-shrink path can be regression-tested without starting GNOME Shell. A
// dock that is not screen-fit shrunk deliberately returns the historical
// sizes, gaps and glow layers byte-for-byte.
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

// Position an indicator core. Halo bounds are represented by outerPad. The
// legacy branch intentionally mirrors DockItem's old coordinates; containment
// clamps apply only while screen-fit shrinking is active.
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
    const avail = Math.max(1,
        (c.vertical ? monitor.height : monitor.width) - 2 * c.edgeMargin - 8);
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

// Main entry. Returns { cfg, geom }. The geom holds every rect the controller
// applies to actors; chip records are annotated with baseX/w/box/itemPos.
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
    const mainOrigin = (available, length) => {
        const room = Math.max(0, available - length);
        if (cfg.alignment === 'start') return Math.min(alignPad, room);
        if (cfg.alignment === 'end') return Math.max(0, room - alignPad);
        return (available - length) / 2;
    };
    let x, y;
    if (side === 'left') {
        x = monitor.x + cfg.edgeMargin;
        y = Math.round(monitor.y + mainOrigin(monitor.height, height));
    } else if (side === 'right') {
        x = monitor.x + monitor.width - width - cfg.edgeMargin;
        y = Math.round(monitor.y + mainOrigin(monitor.height, height));
    } else {
        x = Math.round(monitor.x + mainOrigin(monitor.width, width));
        y = Math.round(monitor.y + monitor.height - height - cfg.edgeMargin);
    }
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
    if (side === 'left') strip = { x: monitor.x, y: monitor.y, w: 2, h: monitor.height };
    else if (side === 'right') strip = { x: monitor.x + monitor.width - 2, y: monitor.y, w: 2, h: monitor.height };
    else strip = { x: monitor.x, y: monitor.y + monitor.height - 2, w: monitor.width, h: 2 };

    // The hidden marker is a clipped copy of the pill, not a separately sized
    // capsule. Only the screen-facing border is exposed, so its length, corner
    // shape and alignment always follow the live dock geometry. Keeping the
    // full actor rect plus a local clip also prevents it bleeding onto an
    // adjacent monitor when that edge is shared.
    const peek = Math.min(thick, Math.max(1, Math.round(cfg.borderWidth ?? 1)));
    const mainStart = vert ? y : x;
    const mainEnd = mainStart + (vert ? height : width);
    const monitorStart = vert ? monitor.y : monitor.x;
    const monitorEnd = monitorStart + (vert ? monitor.height : monitor.width);
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
        if (side === 'left') strut = { x: monitor.x, y: monitor.y, w: reserve, h: monitor.height };
        else if (side === 'right') strut = { x: monitor.x + monitor.width - reserve, y: monitor.y, w: reserve, h: monitor.height };
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
