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
        if (this._container) this._container.reactive = !hidden;
        if (x === undefined || y === undefined) return true;

        try {
            this._container.remove_transition('x');
            this._container.remove_transition('y');
            this._container.remove_transition('opacity');
        } catch { /* intentionally ignored: dock container actor may already be destroyed or unparented */ }

        const targetOpacity = hidden ? 0 : 255;
        if (animate && animationsEnabled()) {
            this._container.ease({
                x, y,
                opacity: targetOpacity,
                duration: SLIDE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (this._container) this._container.opacity = targetOpacity;
                    if (!hidden) onComplete?.();
                },
            });
        } else {
            this._container.set_position(x, y);
            this._container.opacity = targetOpacity;
            if (!hidden) onComplete?.();
        }
        return true;
    }

    settle(geom) {
        if (!this._container || !geom) return;
        const x = this._hidden ? geom.hiddenX : geom.x;
        const y = this._hidden ? geom.hiddenY : geom.y;
        try {
            this._container.remove_transition('x');
            this._container.remove_transition('y');
            this._container.remove_transition('opacity');
            this._container.reactive = !this._hidden;
            this._container.opacity = this._hidden ? 0 : 255;
            if (x !== undefined && y !== undefined)
                this._container.set_position(x, y);
        } catch { /* intentionally ignored: dock container actor may already be destroyed or unparented */ }
    }

    destroy() {
        try {
            this._container?.remove_transition('x');
            this._container?.remove_transition('y');
            this._container?.remove_transition('opacity');
        } catch { /* intentionally ignored: dock container actor may already be destroyed or unparented */ }
        this._container = null;
    }
}
