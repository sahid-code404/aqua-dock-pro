// AquaDockPro — dock chrome: the actors and their stage registration.
//
// Purpose:   Own the low-level actor tree — the reactive container (the pill's
//            hit area), the background pill it parents, the dynamic magnification
//            zone that catches clicks on icons magnified ABOVE the pill, and the
//            strut that reserves space for maximized windows — plus their
//            registration with Main.layoutManager. It holds NO behaviour: the
//            controller connects signals and the engine drives the pill; this
//            file is purely "make the actors exist and place them".
// Ownership: OWNS container, bg, magZone, strut. destroy() unregisters chrome
//            and destroys every actor exactly once.
// Cleanup:   destroy() — idempotent.
// Cost:      A handful of actors; geometry setters are called only on relayout
//            (magZone resize is per-frame but a single set_size/set_position).

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { clamp } from '../core/utils.js';

export class DockChrome {
    constructor() {
        this._container = new St.Widget({
            reactive: true,
            track_hover: true,
            layout_manager: new Clutter.FixedLayout(),
        });
        this._container.set_clip_to_allocation(false);

        this._bg = new St.Widget({ style_class: 'aqua-bg' });
        this._container.add_child(this._bg);

        // Dynamic invisible zone covering magnified icon overflow above the
        // pill. Zero-sized at rest, so clicks pass through to the desktop.
        this._magZone = new St.Widget({ reactive: true, opacity: 0 });
        Main.layoutManager.addChrome(this._magZone, { affectsStruts: false, trackFullscreen: false });

        // Thin reactive strip at the very screen edge — the autohide reveal
        // trigger (pointer hits the edge while the dock is hidden).
        this._strip = new St.Widget({ reactive: true, opacity: 0 });
        Main.layoutManager.addChrome(this._strip, { affectsStruts: false, trackFullscreen: false });

        // Invisible reactive zone filling the edge-margin gap between the pill
        // and the screen edge, so hovering the gap keeps the dock revealed.
        this._edgeZone = new St.Widget({ reactive: true, opacity: 0 });
        Main.layoutManager.addChrome(this._edgeZone, { affectsStruts: false, trackFullscreen: false });

        // Strut reserves screen space so maximized windows clear the dock.
        this._strut = new St.Widget({ reactive: false, opacity: 0 });
        Main.layoutManager.addChrome(this._strut, { affectsStruts: true, trackFullscreen: true });

        Main.layoutManager.addChrome(this._container, { affectsStruts: false, trackFullscreen: false });

        this._bgStyleCache = null;

        // Grab GNOME's built-in dash and make it invisible so it doesn't
        // show alongside AquaDockPro.  We keep it occupying its overview
        // slot (opacity 0, non-reactive, height clamped) so workspace
        // previews stay at their default GNOME position.
        this._dash = null;
        this._dashWasVisible = true;
        this._dashOpacity = 255;
        this._dashReactive = true;
    }

    get container() { return this._container; }
    get bg() { return this._bg; }
    get magZone() { return this._magZone; }
    get strip() { return this._strip; }
    get edgeZone() { return this._edgeZone; }
    get strut() { return this._strut; }

    raiseAboveOverview() {
        const parent = this._container?.get_parent();
        if (parent) parent.set_child_above_sibling(this._container, null);
    }

    applyContainer(geom, hidden) {
        this._container.set_position(hidden ? geom.hiddenX : geom.x, hidden ? geom.hiddenY : geom.y);
        this._container.set_size(geom.width, geom.height);
    }

    // Seed the pill rect; the engine takes over per-frame via setPill().
    applyPill(geom) {
        this._bg.set_position(geom.bg.x, geom.bg.y);
        this._bg.set_size(geom.bg.w, geom.bg.h);
        this._bg.opacity = 255;
    }

    applyPillStyle(style) {
        if (style !== this._bgStyleCache) {
            this._bg.set_style(style);
            this._bgStyleCache = style;
        }
    }

    applyStrut(strut) {
        if (!strut) { this._strut.set_size(0, 0); return; }
        this._strut.set_position(strut.x, strut.y);
        this._strut.set_size(strut.w, strut.h);
    }

    applyStrip(strip) {
        this._strip.set_position(strip.x, strip.y);
        this._strip.set_size(strip.w, strip.h);
    }

    applyEdgeZone(edgeZone) {
        this._edgeZone.set_position(edgeZone.x, edgeZone.y);
        this._edgeZone.set_size(edgeZone.w, edgeZone.h);
    }

    hideEdgeZone() {
        this._edgeZone.set_size(0, 0);
    }

    applyMagZoneConst() {
        this._magZone.set_size(0, 0);
    }

    // ── Dash management ─────────────────────────────────────────────────────
    // Hide the GNOME dash but reserve its space so the overview layout stays
    // at the default position (workspace previews don't shift down).
    hideDash(cfg) {
        const dash = Main.overview?.dash ?? null;
        if (!dash) return;
        this._dash = dash;
        this._dashWasVisible = dash.visible;
        this._dashHeight = dash.height;
        this._dashOpacity = dash.opacity;
        this._dashReactive = dash.reactive;
        this._enforceDash(cfg);
        // Monitor for GNOME resetting dash properties (overview DnD does this).
        this._dashNotifyIds = [
            dash.connect('notify::opacity', () => this._enforceDash(cfg)),
            dash.connect('notify::reactive', () => this._enforceDash(cfg)),
        ];
    }

    _enforceDash(cfg) {
        const dash = this._dash;
        if (!dash) return;
        try {
            dash.opacity = 0;
            dash.reactive = false;
            dash.add_style_class_name('aqua-dash-hidden');
            const gap = clamp((cfg?.dockH ?? 48) + (cfg?.edgeMargin ?? 0) + 42, 90, 170);
            dash.set_height(gap);
        } catch { }
    }

    // Re-assert the dash override (GNOME sometimes resets properties during
    // overview transitions).
    enforceDashGap(cfg) {
        this._enforceDash(cfg);
    }

    // Restore the dash to its original state when the extension is disabled.
    restoreDash() {
        if (!this._dash) return;
        // Disconnect monitors.
        if (this._dashNotifyIds) {
            for (const id of this._dashNotifyIds) {
                try { this._dash.disconnect(id); } catch { }
            }
            this._dashNotifyIds = null;
        }
        try {
            this._dash.remove_style_class_name('aqua-dash-hidden');
            this._dash.set_height(-1);
            this._dash.opacity = this._dashOpacity ?? 255;
            this._dash.reactive = this._dashReactive ?? true;
            if (this._dashWasVisible) this._dash.show();
        } catch { }
        this._dash = null;
    }

    destroy() {
        this.restoreDash();
        for (const key of ['_magZone', '_strip', '_edgeZone', '_strut', '_container']) {
            const actor = this[key];
            if (!actor) continue;
            try { Main.layoutManager.removeChrome(actor); } catch { }
            try { actor.destroy(); } catch { }
            this[key] = null;
        }
        this._bg = null;
    }
}
