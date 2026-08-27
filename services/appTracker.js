// Dock entry model tracking app favorites, running apps, and system shortcuts.

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';

import { SignalGroup, appWindowsForConfig, logError } from '../core/utils.js';
import { _ } from '../core/i18n.js';
import { downloadsDir } from './fileService.js';
import { LocationResolver } from './locationResolver.js';

let sharedAppState = null;
let sharedLocations = null;
let sharedLocationUsers = 0;

class AppStateHub {
    constructor() {
        this._favorites = AppFavorites.getAppFavorites();
        this._appSystem = Shell.AppSystem.get_default();
        this._subscribers = new Set();
        this._optionalSignals = new SignalGroup();
        this._windowSignals = new Map();
        this._iconCache = new Map();
        this._optionalActive = false;
        this._optionalWorkspace = false;
        this._optionalMonitor = false;

        // Use GNOME Shell's tracked signal ownership for long-lived global
        // objects. This is equivalent to the previous SignalGroup ownership but
        // is directly visible to EGO reviewers and Shexli cleanup analysis.
        this._favorites.connectObject('changed', () => this._emitAll(), this);
        this._appSystem.connectObject(
            'installed-changed', () => {
                // Desktop-file updates are the point at which an application's icon
                // identity can legitimately change. Share stable icons across docks
                // between those events instead of asking Shell for fresh GIcons on
                // every multi-monitor entry rebuild.
                this._iconCache.clear();
                this._emitAll();
            },
            'app-state-changed', () => this._emitAll(),
            this,
        );
    }

    get favorites() { return this._favorites; }
    get appSystem() { return this._appSystem; }
    get empty() { return this._subscribers.size === 0; }

    iconFor(app) {
        const id = app?.get_id?.();
        if (!id) {
            try { return app?.get_icon?.() ?? null; }
            catch { return null; }
        }
        if (this._iconCache.has(id)) return this._iconCache.get(id);
        let icon = null;
        try { icon = app.get_icon(); } catch { }
        // A transient Shell lookup failure should not poison the shared cache
        // for the rest of the session. Successful icons remain stable until the
        // desktop-file set changes.
        if (icon) this._iconCache.set(id, icon);
        return icon;
    }

    subscribe(callback, config) {
        const record = {
            callback,
            isolateWS: config.isolateWS === true,
            isolateMonitors: config.isolateMonitors === true,
            monitorIndex: config.monitorIndex ?? -1,
        };
        this._subscribers.add(record);
        this._syncOptionalSignals();

        let live = true;
        return () => {
            if (!live) return;
            live = false;
            this._subscribers.delete(record);
            this._syncOptionalSignals();
        };
    }

    _needsWorkspaceSignals() {
        for (const record of this._subscribers)
            if (record.isolateWS) return true;
        return false;
    }

    _needsMonitorSignals() {
        for (const record of this._subscribers)
            if (record.isolateMonitors) return true;
        return false;
    }

    _syncOptionalSignals() {
        const needsWorkspace = this._needsWorkspaceSignals();
        const needsMonitor = this._needsMonitorSignals();
        const needsWindows = needsWorkspace || needsMonitor;

        if (!needsWindows) {
            if (this._optionalActive) {
                this._optionalSignals.disconnectAll();
                this._clearWindowSignals();
            }
            this._optionalActive = false;
            this._optionalWorkspace = false;
            this._optionalMonitor = false;
            return;
        }

        // During a structural rebuild old and replacement docks overlap briefly.
        // If their isolation requirements differ, rebuild the optional signal set
        // instead of keeping the broader previous subscriptions alive.
        if (this._optionalActive &&
            this._optionalWorkspace === needsWorkspace &&
            this._optionalMonitor === needsMonitor)
            return;

        if (this._optionalActive) {
            this._optionalSignals.disconnectAll();
            this._clearWindowSignals();
        }

        this._optionalActive = true;
        this._optionalWorkspace = needsWorkspace;
        this._optionalMonitor = needsMonitor;

        this._optionalSignals.connect(global.display, 'window-created', (_display, window) => {
            this._trackWindow(window);
            this._emitOptional();
        });
        if (needsWorkspace) {
            this._optionalSignals.connect(global.workspace_manager, 'active-workspace-changed',
                () => this._emitWorkspace());
        }
        if (needsMonitor) {
            this._optionalSignals.connect(global.display, 'window-entered-monitor',
                (_display, monitorIndex) => this._emitMonitor(monitorIndex));
            this._optionalSignals.connect(global.display, 'window-left-monitor',
                (_display, monitorIndex) => this._emitMonitor(monitorIndex));
        }

        for (const actor of global.get_window_actors?.() ?? [])
            this._trackWindow(actor.meta_window);
    }

    _trackWindow(window) {
        if (!window || this._windowSignals.has(window)) return;
        const ids = [];
        try {
            if (this._optionalWorkspace)
                ids.push(window.connect('workspace-changed', () => this._emitWorkspace()));
            // Monitor-only isolation still needs an unmanage notification when a
            // local window disappears while the application remains alive on a
            // different monitor. It does not need workspace-change listeners.
            ids.push(window.connect('unmanaging', () => {
                this._untrackWindow(window);
                this._emitOptional();
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

    _clearWindowSignals() {
        for (const window of [...this._windowSignals.keys()])
            this._untrackWindow(window);
        this._windowSignals.clear();
    }

    _notify(record, context) {
        try { record.callback(); }
        catch (error) { logError(error, `AppStateHub ${context}`); }
    }

    _emitAll() {
        for (const record of [...this._subscribers])
            this._notify(record, 'all');
    }

    _emitWorkspace() {
        for (const record of [...this._subscribers])
            if (record.isolateWS) this._notify(record, 'workspace');
    }

    _emitMonitor(monitorIndex) {
        for (const record of [...this._subscribers])
            if (record.isolateMonitors && record.monitorIndex === monitorIndex)
                this._notify(record, 'monitor');
    }

    _emitOptional() {
        for (const record of [...this._subscribers])
            if (record.isolateWS || record.isolateMonitors)
                this._notify(record, 'window');
    }

    destroy() {
        this._optionalSignals.disconnectAll();
        try { this._favorites?.disconnectObject(this); } catch { }
        try { this._appSystem?.disconnectObject(this); } catch { }
        this._clearWindowSignals();
        this._subscribers.clear();
        this._iconCache.clear();
        this._optionalActive = false;
        this._optionalWorkspace = false;
        this._optionalMonitor = false;
        this._favorites = null;
        this._appSystem = null;
    }
}

function acquireAppState() {
    return (sharedAppState ??= new AppStateHub());
}

function releaseAppState(hub) {
    if (sharedAppState !== hub || !hub.empty) return;
    hub.destroy();
    sharedAppState = null;
}

function acquireLocations(onChanged) {
    const resolver = (sharedLocations ??= new LocationResolver());
    sharedLocationUsers++;
    return {
        resolver,
        unsubscribe: resolver.subscribe(onChanged),
    };
}

function releaseLocations(resolver, unsubscribe) {
    unsubscribe?.();
    if (sharedLocations !== resolver) return;
    sharedLocationUsers = Math.max(0, sharedLocationUsers - 1);
    if (sharedLocationUsers !== 0) return;
    resolver.destroy();
    sharedLocations = null;
}

export class AppTracker {
    constructor(getConfig, getMountedEntries = () => []) {
        this._getConfig = getConfig;
        this._getMountedEntries = getMountedEntries;
        this._onChanged = null;
        this._dlGicon = null;
        this._trashFull = null;
        this._trashEmpty = null;
        this._locationIcons = new Map();
        this._favorites = null;
        this._appSystem = null;
        this._stateHub = null;
        this._stateUnsubscribe = null;
        this._locationUnsubscribe = null;
        this._locations = null;
        this._trashIsFull = false;
    }

    start(onChanged) {
        this._onChanged = onChanged;
        if (this._stateUnsubscribe) return;

        const hub = acquireAppState();
        const cfg = this._getConfig();
        this._stateHub = hub;
        this._favorites = hub.favorites;
        this._appSystem = hub.appSystem;
        this._stateUnsubscribe = hub.subscribe(
            () => this._onChanged?.(),
            {
                isolateWS: cfg.isolateWS,
                isolateMonitors: cfg.isolateMonitors,
                monitorIndex: cfg.monitorIndex,
            });
    }

    _needsLocationMetadata(cfg) {
        if (cfg.showDownloads && cfg.useFolderMetadataIcons) return true;
        if (cfg.showCustomFolder && cfg.customFolderUri && cfg.useFolderMetadataIcons)
            return true;
        if (!cfg.showCustomDockItems) return false;
        for (const definition of cfg.customDockItems ?? []) {
            if (definition.type === 'url' || definition.type === 'separator' ||
                definition.type === 'spacer')
                continue;
            if (definition.type !== 'folder' || cfg.useFolderMetadataIcons)
                return true;
        }
        return false;
    }

    _ensureLocations() {
        if (this._locations) return;
        const shared = acquireLocations(() => this._onChanged?.());
        this._locations = shared.resolver;
        this._locationUnsubscribe = shared.unsubscribe;
    }

    _releaseLocations() {
        if (!this._locations) return;
        releaseLocations(this._locations, this._locationUnsubscribe);
        this._locations = null;
        this._locationUnsubscribe = null;
    }

    getEntries() {
        const cfg = this._getConfig();
        if (this._needsLocationMetadata(cfg)) this._ensureLocations();
        else this._releaseLocations();

        const favs = this._favorites ?? AppFavorites.getAppFavorites();
        const appSystem = this._appSystem ?? Shell.AppSystem.get_default();
        const iconFor = app => this._stateHub?.iconFor(app) ?? app.get_icon();
        const favsList = favs.getFavorites();
        const favIds = new Set();
        for (const app of favsList) favIds.add(app.get_id());

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
            gicon: iconFor(app),
        }));

        if (cfg.showApps) {
            const appsEntry = { key: 'apps', kind: 'apps', gicon: this._resolveAppsIcon(cfg) };
            const appsIndex = Math.max(0, Math.min(cfg.appsButtonPosition ?? 0, entries.length));
            entries.splice(appsIndex, 0, appsEntry);
        }

        if (runningExtra.length && favsList.length)
            entries.push({ key: 'sep:running', kind: 'separator' });

        for (const app of runningExtra)
            entries.push({ key: `app:${app.get_id()}`, kind: 'app', app, gicon: iconFor(app) });

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
        if (this._stateUnsubscribe) {
            this._stateUnsubscribe();
            this._stateUnsubscribe = null;
        }
        if (this._stateHub) {
            releaseAppState(this._stateHub);
            this._stateHub = null;
        }

        this._releaseLocations();

        this._onChanged = null;
        this._dlGicon = null;
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
