// Extension lifecycle orchestrator and dock controller manager.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { DOCK_NOOP_KEYS } from './constants.js';
import { EventBus } from './eventBus.js';
import { SettingsManager } from './settingsManager.js';
import { TimeoutGroup, clearRuntimeWarnings, log, logError, setReduceMotionOverride } from './utils.js';
import { DockController } from '../dock/dockController.js';
import { cancelMountedDeviceOperations } from '../services/mountedDevices.js';
import { clearNotificationCache } from '../services/notificationService.js';

const REBUILD_RETRY_DELAYS_MS = [250, 750, 1500];
const DASH_RETRY_DELAYS_MS = [250, 750, 1500];

export class ExtensionManager {
    constructor(extension) {
        this._extension = extension;
        this._bus = null;
        this._settings = null;
        this._docks = [];
        this._unsubSettings = null;
        this._monitorsChangedId = 0;
        this._keybindingAdded = false;
        this._timers = new TimeoutGroup();
        this._rebuildRetryId = 0;
        this._rebuildRetryCount = 0;
        this._rebuildRetryReason = '';
        this._dashRetryId = 0;
        this._dashRetryCount = 0;
    }

    enable() {
        try {
            this._bus = new EventBus();
            this._settings = new SettingsManager(this._extension.getSettings(), this._bus);
            setReduceMotionOverride(this._settings.config.reduceMotion);
            clearNotificationCache();

            this._unsubSettings = this._bus.on('settings-changed', payload =>
                this._onSettingsChanged(payload));

            this._buildDocks();
            this._registerKeybinding();
            this._monitorsChangedId = Main.layoutManager.connect(
                'monitors-changed', () => this._onMonitorsChanged());
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

        const indexes = [primaryIndex];
        for (let i = 0; i < monitors.length; i++) {
            if (i !== primaryIndex) indexes.push(i);
        }
        return indexes;
    }

    _createDocks(manageDash = true) {
        const indexes = this._monitorIndexes();
        const built = [];
        try {
            for (let i = 0; i < indexes.length; i++) {
                built.push(new DockController(this._settings, {
                    monitorIndex: indexes[i],
                    manageDash: manageDash && i === 0,
                }));
            }
        } catch (e) {
            for (let i = built.length - 1; i >= 0; i--) {
                try { built[i].destroy(); } catch { }
            }
            throw e;
        }
        return built;
    }

    _buildDocks() {
        // Build all controllers before taking ownership of the stock dash. This
        // makes initial startup use the same transactional dash hand-off as a
        // monitor/settings rebuild and lets a transient Shell failure be retried
        // without disabling the whole extension.
        this._docks = this._createDocks(false);
        this._enablePrimaryDash();
    }

    _destroyDocks() {
        for (let i = this._docks.length - 1; i >= 0; i--) {
            try { this._docks[i]?.destroy(); }
            catch (e) { logError(e, `destroy dock on monitor ${i}`); }
        }
        this._docks = [];
    }

    _registerKeybinding() {
        try {
            Main.wm.addKeybinding(
                'focus-dock-shortcut',
                this._settings.raw,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => this._focusDock(),
            );
            this._keybindingAdded = true;
        } catch (e) {
            logError(e, 'register focus shortcut');
        }
    }

    _focusDock() {
        const focusedDock = this._docks.find(dock => dock.keyboardFocusActive);
        if (focusedDock) {
            focusedDock.exitKeyboardFocus();
            return;
        }

        let monitorIndex = -1;
        try { monitorIndex = global.display.focus_window?.get_monitor?.() ?? -1; }
        catch { }
        if (monitorIndex < 0) {
            try {
                const [x, y] = global.get_pointer();
                monitorIndex = (Main.layoutManager.monitors ?? []).findIndex(mon =>
                    x >= mon.x && x < mon.x + mon.width &&
                    y >= mon.y && y < mon.y + mon.height);
            } catch { }
        }
        const dock = this._docks.find(item => item.monitorIndex === monitorIndex) ??
            this._docks[0];
        dock?.focusFirst();
    }

    _rebuildDocks() {
        this._cancelDashRetry();
        const previous = this._docks;
        // Build the complete replacement before touching the working docks.
        // Candidate docks deliberately do not own the stock dash yet; otherwise
        // they could capture the previous controller's already-hidden dash as
        // their restoration baseline.
        const next = this._createDocks(false);
        this._docks = next;

        for (let i = previous.length - 1; i >= 0; i--) {
            try { previous[i]?.destroy(); }
            catch (e) { logError(e, `destroy replaced dock on monitor ${i}`); }
        }
        this._enablePrimaryDash();
    }

    _cancelDashRetry() {
        if (this._dashRetryId) {
            this._timers.remove(this._dashRetryId);
            this._dashRetryId = 0;
        }
        this._dashRetryCount = 0;
    }

    _scheduleDashRetry() {
        if (this._dashRetryId ||
            this._dashRetryCount >= DASH_RETRY_DELAYS_MS.length ||
            !this._settings || !this._docks.length)
            return;
        const delay = DASH_RETRY_DELAYS_MS[this._dashRetryCount++];
        this._dashRetryId = this._timers.addOnce(delay, () => {
            this._dashRetryId = 0;
            this._enablePrimaryDash(false);
        });
    }

    _enablePrimaryDash(resetBudget = true) {
        if (resetBudget) this._cancelDashRetry();
        const dock = this._docks[0];
        if (!dock) {
            this._cancelDashRetry();
            return true;
        }
        try {
            dock.enableDashManagement();
            this._cancelDashRetry();
            return true;
        } catch (e) {
            logError(e, 'enable replacement dash management');
            this._scheduleDashRetry();
            return false;
        }
    }

    _cancelRebuildRetry() {
        if (this._rebuildRetryId) {
            this._timers.remove(this._rebuildRetryId);
            this._rebuildRetryId = 0;
        }
        this._rebuildRetryCount = 0;
        this._rebuildRetryReason = '';
    }

    _scheduleRebuildRetry(reason) {
        if (this._rebuildRetryId ||
            this._rebuildRetryCount >= REBUILD_RETRY_DELAYS_MS.length ||
            !this._settings)
            return;
        const delay = REBUILD_RETRY_DELAYS_MS[this._rebuildRetryCount++];
        this._rebuildRetryReason = reason;
        this._rebuildRetryId = this._timers.addOnce(delay, () => {
            this._rebuildRetryId = 0;
            this._attemptRebuild(this._rebuildRetryReason || reason, false);
        });
    }

    _attemptRebuild(reason, resetBudget = true) {
        if (resetBudget) this._cancelRebuildRetry();
        try {
            this._rebuildDocks();
            this._cancelRebuildRetry();
            return true;
        } catch (e) {
            // Candidate construction is transactional, so the previous dock set
            // remains usable. Retry transient Shell/monitor construction failures
            // with a short bounded backoff instead of leaving new structural
            // settings permanently waiting for an unrelated future change.
            logError(e, `${reason} → keeping previous docks`);
            this._scheduleRebuildRetry(reason);
            return false;
        }
    }

    _onMonitorsChanged() {
        this._attemptRebuild('monitors-changed');
    }

    _onSettingsChanged({ structural, keys }) {
        setReduceMotionOverride(this._settings.config.reduceMotion);

        // GSettings owns the keybinding and the migration key is internal.
        // Neither changes dock geometry or presentation, so avoid waking every
        // monitor for a full relayout when a batch contains only those keys.
        if (keys?.size && [...keys].every(key => DOCK_NOOP_KEYS.has(key)))
            return;

        if (structural || !this._docks.length) {
            this._attemptRebuild('structural settings change');
            return;
        }
        try {
            for (const dock of this._docks) dock.applySettings(keys);
        } catch (e) {
            logError(e, 'applySettings → rebuilding');
            this._attemptRebuild('applySettings fallback');
        }
    }

    disable() {
        this._cancelDashRetry();
        this._cancelRebuildRetry();
        this._timers.removeAll();

        if (this._keybindingAdded) {
            try { Main.wm.removeKeybinding('focus-dock-shortcut'); } catch { }
            this._keybindingAdded = false;
        }
        if (this._unsubSettings) { this._unsubSettings(); this._unsubSettings = null; }

        if (this._monitorsChangedId) {
            try { Main.layoutManager.disconnect(this._monitorsChangedId); } catch { }
            this._monitorsChangedId = 0;
        }

        this._destroyDocks();
        cancelMountedDeviceOperations();
        clearNotificationCache();

        this._settings?.destroy();
        this._settings = null;
        setReduceMotionOverride(false);

        this._bus?.clear();
        this._bus = null;
        clearRuntimeWarnings();
    }
}
