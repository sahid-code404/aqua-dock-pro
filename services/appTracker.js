// AquaDockPro — the dock's entry model (what chips exist, in what order).
//
// Purpose:   Produce the ordered list of dock entries — the configurable
//            Applications button, pinned favourites, running-but-unpinned apps,
//            then Downloads, mounted devices and Trash — and fire a callback whenever
//            anything that affects that list changes (favourites, app install/
//            state, active workspace under isolate-workspaces). The dock turns
//            entries into chips; this service knows nothing about actors.
// Ownership: OWNS its shell-signal connections (one SignalGroup) and the cached
//            static GIcons. destroy() releases all of them.
// Cleanup:   destroy() disconnects every signal and drops the icon cache.
// Cost:      getEntries() is O(favourites + running). Called on app events, not
//            per frame. Static GIcons are built once (re-allocating would defeat
//            the icon-identity fast path in the chip diff).

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';

import { SignalGroup, appWindows } from '../core/utils.js';
import { _ } from '../core/i18n.js';
import { trashHasFiles } from './fileService.js';

export class AppTracker {
    // getConfig: () => current config snapshot (for the section/isolate flags).
    constructor(getConfig, getMountedEntries = () => []) {
        this._getConfig = getConfig;
        this._getMountedEntries = getMountedEntries;
        this._signals = new SignalGroup();
        this._onChanged = null;
        this._dlGicon = null;
        this._folderGicon = null;
        this._trashFull = null;
        this._trashEmpty = null;
        // Seed the trash state so the very first getEntries() shows the
        // correct full/empty icon without waiting for a monitor callback.
        this._trashIsFull = trashHasFiles();
    }

    start(onChanged) {
        this._onChanged = onChanged;
        const favs = AppFavorites.getAppFavorites();
        const sys = Shell.AppSystem.get_default();
        const fire = () => this._onChanged?.();
        this._signals.connect(favs, 'changed', fire);
        this._signals.connect(sys, 'installed-changed', fire);
        this._signals.connect(sys, 'app-state-changed', fire);
        this._signals.connect(global.workspace_manager, 'active-workspace-changed', fire);
    }

    getEntries() {
        const cfg = this._getConfig();
        const favsList = AppFavorites.getAppFavorites().getFavorites();
        const favIds = new Set();
        for (const a of favsList) favIds.add(a.get_id());
        const running = Shell.AppSystem.get_default().get_running();
        const ws = cfg.isolateWS ? global.workspace_manager.get_active_workspace() : null;

        const runningExtra = [];
        for (const app of running) {
            if (favIds.has(app.get_id())) continue;
            const windows = appWindows(app);
            if (ws && !windows.some(w => w.located_on_workspace(ws))) continue;
            if (cfg.isolateMonitors &&
                !windows.some(w => w.get_monitor?.() === cfg.monitorIndex)) continue;
            runningExtra.push(app);
        }

        const entries = favsList.map(app => ({
            key: `app:${app.get_id()}`,
            kind: 'app',
            app,
            gicon: app.get_icon(),
        }));
        if (cfg.showApps) {
            const appsEntry = { key: 'apps', kind: 'apps', gicon: this._resolveAppsIcon(cfg) };
            const appsIndex = Math.max(0, Math.min(cfg.appsButtonPosition ?? 0, entries.length));
            entries.splice(appsIndex, 0, appsEntry);
        }
        if (runningExtra.length && favsList.length)
            entries.push({ key: 'sep:running', kind: 'separator' });
        for (const app of runningExtra)
            entries.push({ key: `app:${app.get_id()}`, kind: 'app', app, gicon: app.get_icon() });
        const systemEntries = [];
        if (cfg.showDownloads)
            systemEntries.push({ key: 'downloads', kind: 'downloads', gicon: this._downloadsGicon() });
        if (cfg.showCustomFolder && cfg.customFolderUri) {
            try {
                const folder = Gio.File.new_for_uri(cfg.customFolderUri);
                const name = folder.get_basename() || _('Folder');
                systemEntries.push({
                    key: `folder:${cfg.customFolderUri}`,
                    kind: 'folder',
                    name,
                    uri: cfg.customFolderUri,
                    gicon: (this._folderGicon ??= Gio.ThemedIcon.new('folder')),
                });
            } catch { }
        }
        if (cfg.showMountedDevices)
            systemEntries.push(...(this._getMountedEntries?.() ?? []));
        if (cfg.showTrash)
            systemEntries.push({ key: 'trash', kind: 'trash', gicon: this.trashGicon(this._trashIsFull) });
        if (systemEntries.length && entries.length)
            entries.push({ key: 'sep:system', kind: 'separator' });
        entries.push(...systemEntries);
        return entries;
    }

    // Static gicons, built once — re-allocating defeats the icon-identity check
    // in the chip diff, and getEntries() runs on every app launch/quit.
    _downloadsGicon() {
        return (this._dlGicon ??= Gio.ThemedIcon.new('folder-download'));
    }

    trashGicon(full) {
        this._trashFull ??= Gio.ThemedIcon.new('user-trash-full');
        this._trashEmpty ??= Gio.ThemedIcon.new('user-trash');
        return full ? this._trashFull : this._trashEmpty;
    }

    // Called by TrashWatcher whenever the trash full/empty state changes so
    // subsequent getEntries() calls produce the correct icon.
    setTrashFull(full) {
        this._trashIsFull = full;
    }

    _resolveAppsIcon(cfg) {
        const raw = (cfg.appsIcon ?? '').trim();
        if (raw === this._appsIconKey && this._appsGicon) return this._appsGicon;
        this._appsIconKey = raw;
        if (!raw) this._appsGicon = Gio.ThemedIcon.new('view-app-grid-symbolic');
        else if (raw.includes('/')) this._appsGicon = Gio.FileIcon.new(Gio.File.new_for_path(raw));
        else this._appsGicon = Gio.ThemedIcon.new(raw);
        return this._appsGicon;
    }

    destroy() {
        this._signals.disconnectAll();
        this._onChanged = null;
        this._dlGicon = null;
        this._folderGicon = null;
        this._trashFull = null;
        this._trashEmpty = null;
        this._appsGicon = null;
        this._appsIconKey = null;
        this._getMountedEntries = null;
    }
}
