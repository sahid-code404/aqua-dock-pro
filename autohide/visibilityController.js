// AquaDockPro — the dock's show/hide slide.
//
// Purpose:   Own the single source of truth for "is the dock hidden?" and the
//            container slide between its shown and hidden positions. Nothing
//            else moves the container on the hide axis. Kept tiny and free of
//            policy — the AutohideManager decides WHEN to hide; this decides HOW.
// Ownership: Borrows the container actor; owns only the in-flight slide
//            transition, which it removes before starting a new one so eases
//            never stack.
// Cleanup:   reset() shows the dock; destroy() drops the reference.
// Cost:      One ease per state change (rare). Zero per-frame cost.

import Clutter from 'gi://Clutter';

const SLIDE_MS = 200;

export class VisibilityController {
    constructor(container) {
        this._container = container;
        this._hidden = false;
    }

    get hidden() { return this._hidden; }

    // Returns true if the state actually changed. onComplete fires after a
    // SHOW slide so the caller can restart magnification from the new position.
    setHidden(hidden, geom, animate, onComplete = null) {
        if (this._hidden === hidden) return false;
        this._hidden = hidden;
        const x = hidden ? geom.hiddenX : geom.x;
        const y = hidden ? geom.hiddenY : geom.y;
        if (x === undefined || y === undefined) return true;

        try {
            this._container.remove_transition('x');
            this._container.remove_transition('y');
        } catch { }

        if (animate) {
            this._container.ease({
                x, y, duration: SLIDE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => { if (!hidden) onComplete?.(); },
            });
        } else {
            this._container.set_position(x, y);
            if (!hidden) onComplete?.();
        }
        return true;
    }

    destroy() {
        this._container = null;
    }
}
