// AquaDockPro — typed publish/subscribe bus.
//
// Purpose:   Decouple producers from consumers so services, the dock, and the
//            interaction layers never hold direct references to each other. A
//            module emits an event; whoever cares subscribes. This is how we
//            avoid the god-object/circular-dependency traps of the reference.
// Ownership: Owns the handler registry only. Subscribers own their unsubscribe
//            handle (returned by on()) and must call it on teardown.
// Cleanup:   clear() drops every registry entry; the owning ExtensionManager
//            calls it last, after all subscribers have unsubscribed.
// Cost:      on/off are O(1). emit is O(handlers-for-event). No allocation on
//            emit beyond the JS rest-args array (events here are low-frequency:
//            settings/state/lifecycle, never per-frame).

import { logError } from './utils.js';

export class EventBus {
    constructor() {
        this._handlers = new Map(); // event -> Set<callback>
    }

    // Subscribe. Returns an idempotent unsubscribe function — the canonical
    // ownership handle for the subscription.
    on(event, callback) {
        let set = this._handlers.get(event);
        if (!set) {
            set = new Set();
            this._handlers.set(event, set);
        }
        set.add(callback);
        let live = true;
        return () => {
            if (!live) return;
            live = false;
            this.off(event, callback);
        };
    }

    off(event, callback) {
        const set = this._handlers.get(event);
        if (!set) return;
        set.delete(callback);
        if (set.size === 0) this._handlers.delete(event);
    }

    // Synchronous fan-out. A throwing handler is isolated and logged so one bad
    // subscriber can never break the emit chain for the others.
    emit(event, ...args) {
        const set = this._handlers.get(event);
        if (!set || set.size === 0) return;
        // Snapshot guards against handlers that subscribe/unsubscribe during
        // dispatch. Events are rare, so the small copy cost is acceptable for
        // the correctness guarantee.
        const snapshot = [...set];
        for (let i = 0; i < snapshot.length; i++) {
            try { snapshot[i](...args); }
            catch (e) { logError(e, `EventBus '${event}' handler`); }
        }
    }

    clear() {
        this._handlers.clear();
    }
}
