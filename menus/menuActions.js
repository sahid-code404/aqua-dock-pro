// AquaDockPro — context-menu content.
//
// Purpose:   Populate a PopupMenu with the right actions for a dock entry
//            (Applications / Trash / app). Pure builder: it adds items and wires
//            their callbacks; it knows nothing about positioning, styling, or
//            the menu's lifecycle (that's the MenuManager's job).
// Ownership: Stateless. Adds children to the menu it's given.
// Cost:      O(desktop-actions + windows). Runs once per menu open.

import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { appWindows, launchUri } from '../core/utils.js';
import { emptyTrash, downloadsUri } from '../services/fileService.js';

export function populateMenu(menu, entry, onTrashEmptied = null) {
    switch (entry.kind) {
        case 'apps':
            menu.addAction('Open Applications', () => Main.overview.showApps());
            break;
        case 'downloads':
            menu.addAction('Open Downloads', () => launchUri(downloadsUri()));
            break;
        case 'trash':
            menu.addAction('Open Trash', () => launchUri('trash:///'));
            menu.addAction('Empty Trash', () => emptyTrash(onTrashEmptied));
            break;
        case 'app':
            if (entry.app) populateAppMenu(menu, entry.app);
            break;
    }
}

function populateAppMenu(menu, app) {
    const appInfo = app.app_info;
    const actions = appInfo?.list_actions?.() ?? [];
    const canNew = app.can_open_new_window();

    if (canNew) menu.addAction('New Window', () => app.open_new_window(-1));

    for (const action of actions) {
        const label = appInfo.get_action_name(action) ?? '';
        const norm = label.trim().toLowerCase();
        // Skip a desktop "new window" action when we already added our own.
        if (canNew && (action === 'new-window' || norm === 'new window' || norm === 'open new window'))
            continue;
        menu.addAction(label, () =>
            appInfo.launch_action(action, global.create_app_launch_context(0, -1)));
    }

    const favs = AppFavorites.getAppFavorites();
    const id = app.get_id();
    menu.addAction(
        favs.isFavorite(id) ? 'Unpin from Dock' : 'Pin to Dock',
        () => favs.isFavorite(id) ? favs.removeFavorite(id) : favs.addFavorite(id));

    const wins = appWindows(app);
    if (wins.length) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (const win of wins) {
            const title = win.get_title() || app.get_name() || 'Window';
            const label = title.length > 30 ? title.slice(0, 29).trimEnd() + '…' : title;
            const itm = menu.addAction(label, () => win.activate(global.get_current_time()));
            try { itm.label?.clutter_text?.set_ellipsize?.(3); } catch { }
        }
    }

    if (app.get_state() === Shell.AppState.RUNNING) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Quit', () => app.request_quit());
    }
}
