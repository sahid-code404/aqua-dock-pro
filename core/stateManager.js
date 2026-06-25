// AquaDockPro — shared runtime state, single source of truth.
//
// Purpose:   Hold the small set of cross-cutting runtime facts that more than
//            one subsystem needs (is the dock enabled, which app is focused,
//            which monitor hosts the dock, is the dock currently hidden). Any
//            mutation fans out through the EventBus so subscribers react without
//            polling and without holding references to the mutator.
// Ownership: Owns its plain state record and nothing else. Does not own the bus
//            (borrowed) and creates no GLib/GObject resources.
// Cleanup:   destroy() drops references. No signals/timeouts to release.
// Cost:      get/set are O(1). set() emits only on actual value change, so no
//            redundant churn. Two emits per change (generic + per-key) let
//            subscribers pick the granularity they need.

export class StateManager {
    constructor(bus) {
        this._bus = bus;
        this._state = {
            enabled: false,
            focusedApp: null,
            monitorIndex: -1,
            dockHidden: false,
        };
    }

    get(key) {
        return this._state[key];
    }

    // Set with change-gating: identical writes are dropped so we never emit a
    // no-op event (and never trigger downstream relayout/redraw for nothing).
    set(key, value) {
        if (this._state[key] === value) return false;
        this._state[key] = value;
        if (this._bus) {
            this._bus.emit('state-changed', key, value);
            this._bus.emit(`state-changed:${key}`, value);
        }
        return true;
    }

    destroy() {
        this._bus = null;
        this._state = null;
    }
}
