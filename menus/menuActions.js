// Populate PopupMenu context menu items for dock entries.

import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { appWindows, launchUri } from '../core/utils.js';
import { _, format } from '../core/i18n.js';
import { downloadsUri } from '../services/fileService.js';
import { ejectMountedDevice, unmountMountedDevice } from '../services/mountedDevices.js';
import { notifyUser } from '../compat/shell.js';

export function populateMenu(menu, entry, {
    onTrashEmptied = null,
    onEmptyTrash = null,
    isLayoutLocked = () => false,
    onToggleLayoutLock = null,
    appWindowsFor = appWindows,
    isWindowIsolationActive = () => false,
} = {}) {
    switch (entry.kind) {
        case 'apps':
            menu.addAction(_('Open Applications'), () => Main.overview.showApps());
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            addLayoutToggle(menu, isLayoutLocked, onToggleLayoutLock);
            break;
        case 'downloads':
            menu.addAction(_('Open Downloads'), () => launchUri(downloadsUri()));
            break;
        case 'folder':
            menu.addAction(format(_('Open %s'), entry.name ?? _('Folder')),
                () => launchUri(entry.uri));
            break;
        case 'mount':
            menu.addAction(format(_('Open %s'), entry.name ?? _('Mounted device')),
                () => launchUri(entry.uri));
            if (entry.canEject) {
                menu.addAction(format(_('Eject %s'), entry.name ?? _('Mounted device')), () => {
                    const name = entry.name ?? _('Mounted device');
                    const op = ejectMountedDevice(entry.mount, error => {
                        if (error) notifyUser(format(_('Could not eject %s'), name), error.message, true);
                        else notifyUser(format(_('%s ejected'), name));
                    });
                    if (!op) notifyUser(format(_('Could not start ejecting %s'), name),
                        _('Another device operation may already be running.'), true);
                });
            } else if (entry.canUnmount) {
                menu.addAction(format(_('Unmount %s'), entry.name ?? _('Mounted device')), () => {
                    const name = entry.name ?? _('Mounted device');
                    const op = unmountMountedDevice(entry.mount, error => {
                        if (error) notifyUser(format(_('Could not unmount %s'), name), error.message, true);
                        else notifyUser(format(_('%s unmounted'), name));
                    });
                    if (!op) notifyUser(format(_('Could not start unmounting %s'), name),
                        _('Another device operation may already be running.'), true);
                });
            }
            break;
        case 'trash':
            menu.addAction(_('Open Trash'), () => launchUri('trash:///'));
            menu.addAction(_('Empty Trash'), () => onEmptyTrash?.(onTrashEmptied));
            break;
        case 'app':
            if (entry.app)
                populateAppMenu(menu, entry.app, isLayoutLocked, onToggleLayoutLock,
                    appWindowsFor, isWindowIsolationActive);
            break;
    }
}

function addLayoutToggle(menu, isLayoutLocked, onToggleLayoutLock) {
    menu.addAction(
        isLayoutLocked() ? _('Unlock Layout') : _('Lock Layout'),
        () => onToggleLayoutLock?.());
}

function populateAppMenu(menu, app, isLayoutLocked, onToggleLayoutLock,
    appWindowsFor, isWindowIsolationActive) {
    const appInfo = app.app_info;
    const actions = appInfo?.list_actions?.() ?? [];
    const canNew = app.can_open_new_window();

    let actionCount = 0;
    if (canNew) {
        menu.addAction(_('New Window'), () => app.open_new_window(-1));
        actionCount++;
    }

    for (const action of actions) {
        const label = appInfo.get_action_name(action) ?? '';
        const norm = label.trim().toLowerCase();
        // Skip a desktop "new window" action when we already added our own.
        if (canNew && (action === 'new-window' || norm === 'new window' || norm === 'open new window'))
            continue;
        menu.addAction(label, () =>
            appInfo.launch_action(action, global.create_app_launch_context(0, -1)));
        actionCount++;
    }

    if (!isLayoutLocked()) {
        const favs = AppFavorites.getAppFavorites();
        const id = app.get_id();
        menu.addAction(
            favs.isFavorite(id) ? _('Unpin from Dock') : _('Pin to Dock'),
            () => {
                if (isLayoutLocked()) return;
                if (favs.isFavorite(id)) favs.removeFavorite(id);
                else favs.addFavorite(id);
            });
        actionCount++;
    }

    if (actionCount > 0)
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    addLayoutToggle(menu, isLayoutLocked, onToggleLayoutLock);

    const wins = appWindowsFor(app);
    if (wins.length) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (const win of wins) {
            const title = win.get_title() || app.get_name() || _('Window');
            const label = title.length > 30 ? title.slice(0, 29).trimEnd() + '…' : title;
            const itm = menu.addAction(label, () => win.activate(global.get_current_time()));
            try { itm.label?.clutter_text?.set_ellipsize?.(3); } catch { }
        }
    }

    if (wins.length && app.get_state() === Shell.AppState.RUNNING) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction(_('Quit'), () => {
            if (!isWindowIsolationActive()) {
                app.request_quit();
                return;
            }
            const time = global.get_current_time();
            for (const win of appWindowsFor(app)) {
                try { win.delete(time); } catch { }
            }
        });
    }
}
