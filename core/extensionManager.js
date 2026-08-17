// Extension lifecycle orchestrator and dock controller manager.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { DOCK_NOOP_KEYS } from './constants.js';
import { EventBus } from './eventBus.js';
import { SettingsManager } from './settingsManager.js';
import { clearRuntimeWarnings, log, logError, setReduceMotionOverride } from './utils.js';
import { DockController } from '../dock/dockController.js';
import { cancelMountedDeviceOperations } from '../services/mountedDevices.js';
import { clearNotificationCache } from '../services/notificationService.js';

export class ExtensionManager {
    constructor(extension) {
        this._extension = extension;
        this._bus = null;
        this._settings = null;
        this._docks = [];
        this._unsubSettings = null;
        this._monitorsChangedId = 0;
        this._keybindingAdded = false;
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

    _buildDocks() {
        const indexes = this._monitorIndexes();
        const built = [];
        try {
            for (let i = 0; i < indexes.length; i++) {
                built.push(new DockController(this._settings, {
                    monitorIndex: indexes[i],
                    manageDash: i === 0,
                }));
            }
        } catch (e) {
            for (let i = built.length - 1; i >= 0; i--) {
                try { built[i].destroy(); } catch { }
            }
            throw e;
        }
        this._docks = built;
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

    _onSettingsChanged({ structural, keys }) {
        setReduceMotionOverride(this._settings.config.reduceMotion);

        // GSettings owns the keybinding and the migration key is internal.
        // Neither changes dock geometry or presentation, so avoid waking every
        // monitor for a full relayout when a batch contains only those keys.
        if (keys?.size && [...keys].every(key => DOCK_NOOP_KEYS.has(key)))
            return;

        if (structural || !this._docks.length) {
            this._rebuildDocks();
            return;
        }
        try {
            for (const dock of this._docks) dock.applySettings(keys);
        } catch (e) {
            logError(e, 'applySettings → rebuilding');
            this._rebuildDocks();
        }
    }

    disable() {
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
