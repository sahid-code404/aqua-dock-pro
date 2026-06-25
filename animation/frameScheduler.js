// AquaDockPro — compositor-aligned frame driver.
//
// Purpose:   Wrap a single Clutter.Timeline bound to an actor's frame clock so
//            callers get a clean start()/stop() loop that ticks once per monitor
//            refresh (60/120/144/VRR) and self-stops the instant there's no work.
//            A long, non-repeating timeline avoids any restart hitch; we stop it
//            explicitly when the per-frame callback reports "settled".
// Ownership: OWNS the Clutter.Timeline and its one `new-frame` connection.
//            destroy() stops it, disconnects, and detaches the actor binding so
//            a stopped timeline can't pin a soon-to-be-destroyed actor.
// Cleanup:   destroy() — idempotent.
// Cost:      Zero cost when stopped (no idle wakeups). One signal while running.

import Clutter from 'gi://Clutter';

import { logError } from '../core/utils.js';

// Long enough to never naturally complete during a session; we drive by delta
// and stop on settle, so the absolute duration is irrelevant beyond "huge".
const TIMELINE_DURATION_MS = 3600 * 1000;

export class FrameScheduler {
    // onFrame(dtMs) → truthy to keep running, falsy to stop.
    constructor(actor, onFrame) {
        this._actor = actor;
        this._onFrame = onFrame;
        this._timeline = null;
        this._frameId = 0;
    }

    start() {
        if (!this._actor || !this._onFrame) return;
        if (this._timeline) {
            if (!this._timeline.is_playing()) this._timeline.start();
            return;
        }
        this._timeline = new Clutter.Timeline({
            actor: this._actor,
            duration: TIMELINE_DURATION_MS,
        });
        this._frameId = this._timeline.connect('new-frame', () => {
            // Frame-clock delta in ms; clamp pathological gaps (resume/stall).
            let dt = this._timeline.get_delta();
            dt = Math.min(64, dt || 16);
            let keep = false;
            try { keep = this._onFrame(dt); }
            catch (e) { logError(e, 'FrameScheduler.onFrame'); keep = false; }
            if (!keep) this._timeline.stop();
        });
        this._timeline.start();
    }

    stop() {
        if (this._timeline) {
            try { this._timeline.stop(); } catch { /* already gone */ }
        }
    }

    isRunning() {
        return !!this._timeline && this._timeline.is_playing();
    }

    destroy() {
        if (this._timeline) {
            try { this._timeline.stop(); } catch { }
            if (this._frameId) {
                try { this._timeline.disconnect(this._frameId); } catch { }
                this._frameId = 0;
            }
            try { this._timeline.set_actor(null); } catch { }
            this._timeline = null;
        }
        this._actor = null;
        this._onFrame = null;
    }
}
