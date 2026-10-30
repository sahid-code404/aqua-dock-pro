// Live window preview thumbnail frame using Clutter.Clone.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

// Returns a frame St.Widget sized (frameW × frameH) containing the thumbnail.
/**
 * Constructs a live window preview thumbnail frame using Clutter.Clone.
 * Centers the window's visual frame geometry inside the thumbnail bounding box.
 *
 * @param {Meta.Window} win - Mutter window instance to clone.
 * @param {number} frameW - Frame container width in pixels.
 * @param {number} frameH - Frame container height in pixels.
 * @param {Gio.Icon} fallbackGicon - Fallback icon if live window actor is unavailable.
 * @returns {St.Widget} Thumbnail widget containing the Clutter.Clone or fallback icon.
 */
export function buildWindowFrame(win, frameW, frameH, fallbackGicon) {
    const frame = new St.Widget({
        style_class: 'aqua-preview-thumb',
        layout_manager: new Clutter.FixedLayout(),
        clip_to_allocation: true,
    });
    frame.set_size(frameW, frameH);

    let actor = null;
    try { actor = win.get_compositor_private?.(); } catch { /* intentionally ignored: window actor geometry query failed for closing window */ }
    let rect = null;
    try { rect = win.get_frame_rect(); } catch { /* intentionally ignored: window actor geometry query failed for closing window */ }

    if (actor && rect && rect.width > 0 && rect.height > 0) {
        const clone = new Clutter.Clone({ source: actor, reactive: false });
        const scale = Math.min(frameW / rect.width, frameH / rect.height);
        const sw = rect.width * scale;
        const sh = rect.height * scale;
        clone.set_size(rect.width, rect.height);
        clone.set_scale(scale, scale);
        // Compositor actor origin differs from the frame origin — offset so the
        // window's frame is centred, not its buffer/shadow.
        let ox = 0, oy = 0;
        try {
            const bx = win.get_buffer_rect?.();
            if (bx) { ox = (rect.x - bx.x) * scale; oy = (rect.y - bx.y) * scale; }
        } catch { /* intentionally ignored: window actor geometry query failed for closing window */ }
        clone.set_position(
            Math.round((frameW - sw) / 2 - ox),
            Math.round((frameH - sh) / 2 - oy));
        frame.add_child(clone);
        return frame;
    }

    const iconSize = Math.min(72, Math.round(frameW * 0.34));
    const icon = new St.Icon({
        gicon: fallbackGicon,
        icon_size: iconSize,
        style_class: 'aqua-preview-static-icon',
    });
    icon.set_position(
        Math.round((frameW - iconSize) / 2),
        Math.round((frameH - iconSize) / 2));
    frame.add_child(icon);
    return frame;
}
