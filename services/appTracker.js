// Dock entry model tracking app favorites, running apps, and system shortcuts.

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';

import { SignalGroup, appWindowsForConfig } from '../core/utils.js';
import { _ } from '../core/i18n.js';
import { downloadsDir } from './fileService.js';
import { LocationResolver } from './locationResolver.js';

export class AppTracker {
    // getConfig: () => current config snapshot (for the section/isolate flags).
    constructor(getConfig, getMountedEntries = () => []) {
        this._getConfig = getConfig;
        this._getMountedEntries = getMountedEntries;
        this._signals = new SignalGroup();
        this._onChanged = null;
        this._dlGicon = null;
        this._trashFull = null;
        this._trashEmpty = null;
        this._windowSignals = new Map();
        this._locationIcons = new Map();
        this._favorites = null;
        this._appSystem = null;
        this._locations = new LocationResolver(() => this._onChanged?.());
        // TrashWatcher fills this asynchronously after the first actor sync.
        this._trashIsFull = false;
    }

    start(onChanged) {
        this._onChanged = onChanged;
        const favs = (this._favorites ??= AppFavorites.getAppFavorites());
        const sys = (this._appSystem ??= Shell.AppSystem.get_default());
        const fire = () => this._onChanged?.();
        this._signals.connect(favs, 'changed', fire);
        this._signals.connect(sys, 'installed-changed', fire);
        this._signals.connect(sys, 'app-state-changed', fire);

        const cfg = this._getConfig();
        if (cfg.isolateWS)
            this._signals.connect(global.workspace_manager, 'active-workspace-changed', fire);
        if (cfg.isolateWS || cfg.isolateMonitors) {
            this._signals.connect(global.display, 'window-created', (_display, window) => {
                this._trackWindow(window, fire);
                fire();
            });
            for (const actor of global.get_window_actors?.() ?? [])
                this._trackWindow(actor.meta_window, fire);
        }
        if (cfg.isolateMonitors) {
            const onMonitorChanged = (_display, monitorIndex) => {
                if (monitorIndex === this._getConfig()?.monitorIndex) fire();
            };
            this._signals.connect(global.display, 'window-entered-monitor', onMonitorChanged);
            this._signals.connect(global.display, 'window-left-monitor', onMonitorChanged);
        }
    }

    _trackWindow(window, onChanged) {
        if (!window || this._windowSignals.has(window)) return;
        const ids = [];
        try {
            if (this._getConfig()?.isolateWS)
                ids.push(window.connect('workspace-changed', onChanged));
            ids.push(window.connect('unmanaging', () => {
                this._untrackWindow(window);
                onChanged();
            }));
        } catch {
            for (const id of ids) {
                try { window.disconnect(id); } catch { }
            }
            return;
        }
        this._windowSignals.set(window, ids);
    }

    _untrackWindow(window) {
        const ids = this._windowSignals.get(window);
        if (!ids) return;
        this._windowSignals.delete(window);
        for (const id of ids) {
            try { window.disconnect(id); } catch { }
        }
    }

    getEntries() {
        const cfg = this._getConfig();
        const favs = (this._favorites ??= AppFavorites.getAppFavorites());
        const appSystem = (this._appSystem ??= Shell.AppSystem.get_default());
        const favsList = favs.getFavorites();
        const favIds = new Set();
        for (const a of favsList) favIds.add(a.get_id());
        const running = appSystem.get_running();
        let activeWorkspace;
        if (cfg.isolateWS) {
            try { activeWorkspace = global.workspace_manager.get_active_workspace(); }
            catch { }
        }
        const runningExtra = [];
        for (const app of running) {
            if (favIds.has(app.get_id())) continue;
            const windows = appWindowsForConfig(app, cfg, activeWorkspace);
            if ((cfg.isolateWS || cfg.isolateMonitors) && !windows.length) continue;
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
        if (cfg.showDownloads) {
            const fallback = { name: _('Downloads'), gicon: this._downloadsGicon() };
            const resolved = cfg.useFolderMetadataIcons
                ? this._locations.resolve(downloadsDir().get_uri(), fallback.name, fallback.gicon)
                : fallback;
            systemEntries.push({ key: 'downloads', kind: 'downloads', gicon: resolved.gicon });
        }
        if (cfg.showCustomFolder && cfg.customFolderUri) {
            try {
                const folder = Gio.File.new_for_uri(cfg.customFolderUri);
                const fallbackName = folder.get_basename() || _('Folder');
                const fallbackIcon = this._iconForLocation('folder');
                const resolved = cfg.useFolderMetadataIcons
                    ? this._locations.resolve(cfg.customFolderUri, fallbackName, fallbackIcon)
                    : { name: fallbackName, gicon: fallbackIcon };
                systemEntries.push({
                    key: `folder:${cfg.customFolderUri}`,
                    kind: 'folder',
                    name: resolved.name,
                    uri: cfg.customFolderUri,
                    gicon: resolved.gicon,
                });
            } catch { }
        }
        if (cfg.showCustomDockItems) {
            for (const definition of cfg.customDockItems ?? []) {
                if (definition.type === 'separator' || definition.type === 'spacer') {
                    systemEntries.push({
                        key: `custom:${definition.id}`,
                        kind: definition.type,
                    });
                    continue;
                }
                const fallbackName = definition.name || this._locationBasename(definition.uri);
                const fallbackIcon = this._iconForLocation(definition.type);
                const resolveMetadata = definition.type !== 'url' &&
                    (definition.type !== 'folder' || cfg.useFolderMetadataIcons);
                const resolved = !resolveMetadata
                    ? { name: fallbackName, gicon: fallbackIcon }
                    : this._locations.resolve(definition.uri, fallbackName, fallbackIcon);
                systemEntries.push({
                    key: `custom:${definition.id}`,
                    kind: definition.type === 'folder' ? 'folder' : 'location',
                    locationType: definition.type,
                    name: definition.name || resolved.name,
                    uri: definition.uri,
                    gicon: resolved.gicon,
                });
            }
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

    _iconForLocation(type) {
        if (this._locationIcons.has(type)) return this._locationIcons.get(type);
        const name = type === 'folder' ? 'folder'
            : (type === 'url' ? 'web-browser-symbolic' : 'text-x-generic');
        const icon = Gio.ThemedIcon.new(name);
        this._locationIcons.set(type, icon);
        return icon;
    }

    _locationBasename(uri) {
        try { return Gio.File.new_for_uri(uri).get_basename() || _('Location'); }
        catch { return _('Location'); }
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
        for (const window of this._windowSignals.keys()) this._untrackWindow(window);
        this._windowSignals.clear();
        this._onChanged = null;
        this._dlGicon = null;
        this._locations?.destroy();
        this._locations = null;
        this._locationIcons.clear();
        this._trashFull = null;
        this._trashEmpty = null;
        this._appsGicon = null;
        this._appsIconKey = null;
        this._favorites = null;
        this._appSystem = null;
        this._getConfig = null;
        this._getMountedEntries = null;
    }
}
