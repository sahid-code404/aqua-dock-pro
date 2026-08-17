// Pressure-sense edge reveal gesture handler.
// Polls pointer dwell at the screen edge to trigger dock reveal.

import GLib from 'gi://GLib';

import { TimeoutGroup } from '../core/utils.js';

const POLL_MS = 30;
const EDGE_PX = 4;                 // how close to the edge counts as "pressed"
const LATERAL_AREA = 40 * 40;      // max squared lateral drift to keep dwelling

export class PressureBarrier {
    // getConfig: () => config; getMonitor: () => monitor geometry.
    // isHidden/canReveal: () => bool. onReveal: () => void.
    constructor(getConfig, getMonitor, isHidden, canReveal, onReveal) {
        this._getConfig = getConfig;
        this._getMonitor = getMonitor;
        this._isHidden = isHidden;
        this._canReveal = canReveal;
        this._onReveal = onReveal;
        this._timers = new TimeoutGroup();
        this._pollId = 0;
        this._dwell = 0;
        this._anchorLateral = null;
    }

    begin() {
        this._dwell = 0;
        this._anchorLateral = null;
        if (this._pollId) return;
        this._pollId = this._timers.add(POLL_MS, () => {
            if (!this._canReveal()) {
                this._pollId = 0;
                this._dwell = 0;
                this._anchorLateral = null;
                return GLib.SOURCE_REMOVE;
            }
            this._sample();
            if (!this._isHidden() || !this._getConfig().pressureSense) {
                this._pollId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    cancel() {
        if (this._pollId) { this._timers.remove(this._pollId); this._pollId = 0; }
        this._dwell = 0;
        this._anchorLateral = null;
    }

    destroy() {
        this.cancel();
        this._timers.removeAll();
        this._getConfig = null;
        this._getMonitor = null;
        this._isHidden = null;
        this._canReveal = null;
        this._onReveal = null;
    }

    _sample() {
        const cfg = this._getConfig();
        if (!cfg.pressureSense || !this._isHidden()) return;
        const mon = this._getMonitor?.();
        if (!mon) return;
        let p;
        try { p = global.get_pointer(); } catch { return; }

        const side = cfg.position;
        const monR = mon.x + mon.width;
        const monB = mon.y + mon.height;
        let onEdge = false;
        let lateral = 0;
        if (side === 'left' || side === 'right') {
            lateral = p[1];
            const withinY = p[1] >= mon.y && p[1] < monB;
            onEdge = side === 'left'
                ? withinY && p[0] >= mon.x && p[0] < mon.x + EDGE_PX
                : withinY && p[0] >= monR - EDGE_PX && p[0] < monR;
        } else {
            lateral = p[0];
            const withinX = p[0] >= mon.x && p[0] < monR;
            onEdge = withinX && p[1] >= monB - EDGE_PX && p[1] < monB;
        }

        if (!onEdge) {
            this._anchorLateral = null;
            this._dwell = 0;
            return;
        }

        if (this._anchorLateral === null) this._anchorLateral = lateral;
        const delta = lateral - this._anchorLateral;
        if (delta * delta >= LATERAL_AREA) {
            // Pressure is a dwell gesture, not a slow edge swipe. Reset the
            // dwell origin once the pointer drifts too far along the edge.
            this._anchorLateral = lateral;
            this._dwell = 0;
            return;
        }

        this._dwell++;

        // sensitivity 0 → 80 frames, 1 → 20 frames.
        const need = 80 - 60 * (cfg.pressureSenseSensitivity ?? 0.5);
        if (this._dwell >= need) {
            this._dwell = 0;
            this.cancel();
            this._onReveal?.();
        }
    }
}
