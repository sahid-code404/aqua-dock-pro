// Typed publish/subscribe event bus.

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
