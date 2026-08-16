// Controls dock container slide animations between shown and hidden states.

import Clutter from 'gi://Clutter';

import { animationsEnabled } from '../core/utils.js';

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

        if (animate && animationsEnabled()) {
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
        try {
            this._container?.remove_transition('x');
            this._container?.remove_transition('y');
        } catch { }
        this._container = null;
    }
}
