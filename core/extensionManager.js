// AquaDockPro — lifecycle orchestrator.
//
// Purpose:   The composition root. Constructs the foundation (EventBus →
//            SettingsManager → StateManager) in dependency order, will own the
//            services and the dock in later phases, and tears everything down in
//            strict reverse order on disable(). Keeping all wiring here is what
//            keeps extension.js trivial and every other module dependency-
//            explicit (each receives exactly what it needs, nothing global).
// Ownership: OWNS bus, settings, state (and, later, services + dock). Each is
//            created here and destroyed here — one owner per resource.
// Cleanup:   disable() destroys in reverse construction order and nulls refs so
//            a re-enable starts from a clean slate (enable→disable→enable safe).
// Cost:      Construction is a handful of allocations; no work on hot paths.

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
        this._dock = null;
        this._unsubSettings = null;
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

            this._buildDock();
            this._state.set('enabled', true);
            log('enabled');
        } catch (e) {
            logError(e, 'ExtensionManager.enable');
            this.disable();
            throw e;
        }
    }

    _buildDock() {
        this._dock = new DockController(this._settings, this._bus, this._state);
    }

    _onSettingsChanged({ structural }) {
        if (structural || !this._dock) {
            this._dock?.destroy();
            this._buildDock();
            return;
        }
        try {
            this._dock.applySettings();
        } catch (e) {
            // Fall back to a full rebuild rather than a half-applied dock.
            logError(e, 'applySettings → rebuilding');
            this._dock.destroy();
            this._buildDock();
        }
    }

    disable() {
        this._state?.set('enabled', false);

        if (this._unsubSettings) { this._unsubSettings(); this._unsubSettings = null; }

        this._dock?.destroy();
        this._dock = null;

        this._state?.destroy();
        this._state = null;

        this._settings?.destroy();
        this._settings = null;

        this._bus?.clear();
        this._bus = null;
    }
}
