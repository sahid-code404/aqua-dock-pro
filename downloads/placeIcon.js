// A themed place icon resolved at a stable source size and scaled visually.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { stableArtworkSourceSize } from '../dock/iconResolution.js';

/**
 * Constructs an St.Widget actor displaying a themed place or folder icon scaled to visual dimensions.
 *
 * @param {Gio.Icon} gicon - GIcon source instance.
 * @param {number} visualSize - Target visual display size in pixels.
 * @param {number} [preferredSourceSize=0] - Preferred source texture size.
 * @param {string} [styleClass=''] - Optional CSS style class name to assign.
 * @returns {St.Widget} Composite widget containing the scaled St.Icon child.
 */
export function buildPlaceIcon(gicon, visualSize, preferredSourceSize = 0, styleClass = '') {
    const sourceSize = stableArtworkSourceSize(visualSize, preferredSourceSize);
    const actor = new St.Widget({
        layout_manager: new Clutter.FixedLayout(),
        x_expand: false,
        y_expand: false,
        reactive: false,
    });
    actor.set_size(visualSize, visualSize);
    const icon = new St.Icon({ gicon, icon_size: sourceSize, style_class: styleClass });
    icon.set_pivot_point(0, 0);
    const scale = visualSize / sourceSize;
    icon.set_scale(scale, scale);
    actor.add_child(icon);
    return actor;
}

