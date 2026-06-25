// AquaDockPro — pressure-sense reveal.
//
// Purpose:   Implement the "dwell at the screen edge to reveal" gesture. Because
//            motion events stop firing when the pointer is stationary at the
//            edge (which IS the gesture), it polls the pointer on a short timer
//            and accumulates dwell frames while the pointer stays pressed to the
//            edge with little lateral drift. Higher sensitivity → fewer frames.
// Ownership: OWNS one GLib poll source. begin() starts it, cancel()/destroy()
//            removes it — no dangling timer.
// Cost:      Active only while armed and the dock is hidden; one get_pointer()
//            per 30ms tick. Self-stops the moment it reveals.

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { TimeoutGroup } from '../core/utils.js';

const POLL_MS = 30;
const EDGE_PX = 4;                 // how close to the edge counts as "pressed"
const LATERAL_AREA = 40 * 40;      // max squared lateral drift to keep dwelling

export class PressureBarrier {
    // getConfig: () => config. isHidden: () => bool. onReveal: () => void.
    constructor(getConfig, isHidden, onReveal) {
        this._getConfig = getConfig;
        this._isHidden = isHidden;
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

    destroy() { this.cancel(); this._timers.removeAll(); this._onReveal = null; }

    _sample() {
        const cfg = this._getConfig();
        if (!cfg.pressureSense || !this._isHidden()) return;
        const mon = Main.layoutManager.primaryMonitor;
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
