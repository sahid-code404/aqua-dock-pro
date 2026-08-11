// AquaDockPro — lifecycle orchestrator.
//
// Purpose:   The composition root. Constructs the foundation (EventBus →
//            SettingsManager → StateManager) in dependency order, owns one
//            dock per configured monitor, and tears everything down in
//            strict reverse order on disable(). Keeping all wiring here is what
//            keeps extension.js trivial and every other module dependency-
//            explicit (each receives exactly what it needs, nothing global).
// Ownership: OWNS bus, settings, state and the dock controllers. Each is created
//            here and destroyed here — one owner per resource.
// Cleanup:   disable() destroys in reverse construction order and nulls refs so
//            a re-enable starts from a clean slate (enable→disable→enable safe).
// Cost:      Construction is a handful of allocations; no work on hot paths.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { EventBus } from './eventBus.js';
import { SettingsManager } from './settingsManager.js';
import { StateManager } from './stateManager.js';
import { log, logError } from './utils.js';
import { DockController } from '../dock/dockController.js';

export class ExtensionManager {
    constructor(extension) {
        this._extension = extension;
        this._bus = null;
        this._settings = null;
        this._state = null;
        this._docks = [];
        this._unsubSettings = null;
        this._monitorsChangedId = 0;
    }

    enable() {
        try {
            // Construction order = dependency order. Bus first (no deps), then
            // settings (needs bus to announce changes), then state (needs bus).
            this._bus = new EventBus();
            this._settings = new SettingsManager(this._extension.getSettings(), this._bus);
            this._state = new StateManager(this._bus);

            // A structural settings change rebuilds the dock; anything else is a
            // cheap in-place refresh so dragging a slider never tears it down.
            this._unsubSettings = this._bus.on('settings-changed', payload =>
                this._onSettingsChanged(payload));

            this._buildDocks();
            this._monitorsChangedId = Main.layoutManager.connect(
                'monitors-changed', () => this._onMonitorsChanged());
            this._state.set('enabled', true);
            log('enabled');
        } catch (e) {
            logError(e, 'ExtensionManager.enable');
            this.disable();
            throw e;
        }
    }

    _monitorIndexes() {
        const monitors = Main.layoutManager.monitors ?? [];
        if (!monitors.length) return [];

        const primary = Main.layoutManager.primaryIndex;
        const primaryIndex = primary >= 0 && primary < monitors.length ? primary : 0;
        if (!this._settings.config.multiMonitor) return [primaryIndex];

        // Build the primary controller first so it is the sole owner of the
        // global GNOME overview dash. The remaining controllers are independent.
        const indexes = [primaryIndex];
        for (let i = 0; i < monitors.length; i++) {
            if (i !== primaryIndex) indexes.push(i);
        }
        return indexes;
    }

    _buildDocks() {
        const indexes = this._monitorIndexes();
        for (let i = 0; i < indexes.length; i++) {
            const monitorIndex = indexes[i];
            this._docks.push(new DockController(this._settings, this._bus, this._state, {
                monitorIndex,
                manageDash: i === 0,
            }));
        }
    }

    _destroyDocks() {
        for (let i = this._docks.length - 1; i >= 0; i--) {
            try { this._docks[i]?.destroy(); }
            catch (e) { logError(e, `destroy dock on monitor ${i}`); }
        }
        this._docks = [];
    }

    _rebuildDocks() {
        this._destroyDocks();
        this._buildDocks();
    }

    _onMonitorsChanged() {
        try { this._rebuildDocks(); }
        catch (e) {
            logError(e, 'monitors-changed → rebuilding');
            this._destroyDocks();
        }
    }

    _onSettingsChanged({ structural }) {
        if (structural || !this._docks.length) {
            this._rebuildDocks();
            return;
        }
        try {
            for (const dock of this._docks) dock.applySettings();
        } catch (e) {
            // Fall back to a full rebuild rather than leave one dock half-applied.
            logError(e, 'applySettings → rebuilding');
            this._rebuildDocks();
        }
    }

    disable() {
        this._state?.set('enabled', false);

        if (this._unsubSettings) { this._unsubSettings(); this._unsubSettings = null; }

        if (this._monitorsChangedId) {
            try { Main.layoutManager.disconnect(this._monitorsChangedId); } catch { }
            this._monitorsChangedId = 0;
        }

        this._destroyDocks();

        this._state?.destroy();
        this._state = null;

        this._settings?.destroy();
        this._settings = null;

        this._bus?.clear();
        this._bus = null;
    }
}
