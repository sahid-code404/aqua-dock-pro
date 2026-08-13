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
        this._last = null;
    }

    begin() {
        this._dwell = 0;
        this._last = null;
        if (this._pollId) return;
        this._pollId = this._timers.add(POLL_MS, () => {
            if (!this._canReveal()) {
                this._pollId = 0;
                this._dwell = 0;
                this._last = null;
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
        this._last = null;
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
        let edgeHit = false;
        if (side === 'left' || side === 'right') {
            // Vertical dock: lateral drift is on Y axis.
            const ddy = this._last ? (p[1] - this._last[1]) : 0;
            const dy = ddy * ddy;
            edgeHit = side === 'left'
                ? dy < LATERAL_AREA && p[0] < mon.x + EDGE_PX
                : dy < LATERAL_AREA && p[0] > mon.x + mon.width - EDGE_PX;
        } else {
            // Bottom dock: lateral drift is on X axis.
            const ddx = this._last ? (p[0] - this._last[0]) : 0;
            const dx = ddx * ddx;
            edgeHit = dx < LATERAL_AREA && p[1] >= mon.y + mon.height - EDGE_PX;
        }

        this._last = p;
        this._dwell = edgeHit ? this._dwell + 1 : 0;

        // sensitivity 0 → 80 frames, 1 → 20 frames.
        const need = 80 - 60 * (cfg.pressureSenseSensitivity ?? 0.5);
        if (this._dwell >= need) {
            this._dwell = 0;
            this.cancel();
            this._onReveal?.();
        }
    }
}
