// AquaDockPro — pure dock geometry.
//
// Purpose:   Given the config snapshot, the current chip list and the target
//            monitor, compute every coordinate the dock needs — container box,
//            hidden offsets, pill rect, per-chip offsets, pick/magnify bands,
//            chrome-zone rects and the strut — WITHOUT touching a single actor.
//            Separating computation from mutation makes layout testable and
//            keeps "layout thrashing" impossible to introduce by accident.
// Ownership: Stateless. Reads its inputs, returns a plain result object. It does
//            write the derived `baseX`/`w`/`box` fields onto the caller's chip
//            records (data, not actors) since those ARE the layout output.
// Cost:      O(chips), run only on relayout (settings/monitor/chip changes).

import { clamp } from '../core/utils.js';
import { ICON_BOT, BG_PAD_X, SEP_W, SEP_PAD } from '../core/constants.js';
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
    const bw = cfg.borderWidth ?? 1;
    const bc = cfg.borderColor ?? 'rgba(255,255,255,0.16)';
    const border = bw > 0 ? `${bw}px solid ${bc}` : 'none';
    const fill = applyAlpha(cfg.pillColor ?? 'rgba(28,28,32,0.78)', clamp(cfg.bgOpacity, 0.1, 1.0));
    return `border-radius: ${cfg.dockRadius}px; border: ${border}; background-color: ${fill};`;
}

// Shrink the dock proportionally if its natural length overflows the monitor.
// Returns a (possibly mutated) clone — never mutates the input snapshot.
function applyAutoShrink(base, chips, monitor) {
    const c = Object.assign({}, base);
    const pad = Math.round(BG_PAD_X * c.scale);
    const sepW = SEP_W + SEP_PAD * 2;
    let nIcons = 0, nSeps = 0;
    for (const chip of chips) (chip.item ? nIcons++ : nSeps++);
    if (nIcons === 0) return c;

    const natural = pad * 2 + nIcons * c.cellW + nSeps * sepW;
    const avail = (c.vertical ? monitor.height : monitor.width) - 2 * c.edgeMargin - 8;
    if (natural <= avail) return c;

    const fixed = pad * 2 + nSeps * sepW + nIcons * (c.cellPad * 2);
    const iconsPart = nIcons * c.iconSize;
    let f = (avail - fixed) / Math.max(1, iconsPart);
    f = clamp(f, 0.45, 1.0);
    if (f >= 0.999) return c;

    const iconSize = Math.max(16, Math.round(c.iconSize * f));
    const renderSize = Math.round(iconSize * c.zoomMax);
    const dockH = Math.max(28, Math.round(c.dockH * f));
    const hoverLift = Math.round(c.hoverLift * f);
    const cellPad = Math.max(2, Math.round(c.cellPad * f));
    const iconTopAtRest = dockH - ICON_BOT - iconSize;
    c.iconSize = iconSize;
    c.renderSize = renderSize;
    c.cellPad = cellPad;
    c.cellW = iconSize + cellPad * 2;
    c.dockH = dockH;
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
    const sepW = SEP_W + SEP_PAD * 2;
    const thick = cfg.dockH;

    // Main-axis span and per-chip offsets.
    let span = pad * 2;
    for (const chip of chips) {
        chip.w = chip.item ? cfg.cellW : sepW;
        span += chip.w;
    }
    const mainLen = Math.max(span, cfg.cellW);
    const width = vert ? thick : mainLen;
    const height = vert ? mainLen : thick;

    // Floating position (all three sides share the same edge margin).
    let x, y;
    if (side === 'left') {
        x = monitor.x + cfg.edgeMargin;
        y = Math.round(monitor.y + (monitor.height - height) / 2);
    } else if (side === 'right') {
        x = monitor.x + monitor.width - width - cfg.edgeMargin;
        y = Math.round(monitor.y + (monitor.height - height) / 2);
    } else {
        x = Math.round(monitor.x + (monitor.width - width) / 2);
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
        if (chip.item) {
            chip.w = cfg.cellW;
            chip.itemPos = vert ? { x: 0, y: cursor } : { x: cursor, y: 0 };
            const c = cursor + chip.w / 2;
            if (firstItemCenter === undefined) firstItemCenter = c;
            lastItemCenter = c;
        } else if (!vert) {
            chip.box = { x: cursor + SEP_PAD, y: sepOff, w: SEP_W, h: sepThick };
        } else {
            chip.box = { x: sepOff, y: cursor + SEP_PAD, w: sepThick, h: SEP_W };
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

    let strut = null;
    if (!cfg.autoHideActive && !monitorFullscreen) {
        const reserve = Math.max(1, em + thick + em);
        if (side === 'left') strut = { x: monitor.x, y: monitor.y, w: reserve, h: monitor.height };
        else if (side === 'right') strut = { x: monitor.x + monitor.width - reserve, y: monitor.y, w: reserve, h: monitor.height };
        else strut = { x: monitor.x, y: monitor.y + monitor.height - reserve, w: monitor.width, h: reserve };
    }

    const geom = {
        side, vert, width, height, x, y, hiddenX, hiddenY,
        mainLen, thick, pad,
        bg, bgBaseX, bgBaseW,
        pick, band,
        firstItemCenter, lastItemCenter,
        edgeZone, strip, strut,
        magZone: {
            headroom: cfg.renderSize + cfg.hoverLift,
            scaleDiv: 1 / Math.max(0.001, cfg.zoomMax - 1),
            side, dockH: thick,
        },
    };
    return { cfg, geom };
}
