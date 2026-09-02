// AquaDockPro GNOME Shell compatibility boundary.

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { warnOnce } from '../core/utils.js';

const SHELL_MAJOR = Number.parseInt(Config.PACKAGE_VERSION, 10) || 0;

export function shellMajorVersion() {
    return SHELL_MAJOR;
}

// GNOME Shell 51 changed PopupMenu.open()/close() from a PopupAnimation enum
// argument to an options object. Keep that ABI difference confined here so the
// same extension package remains correct on both GNOME Shell 50 and 51+.
export function openPopupMenu(menu, animate = true) {
    if (typeof menu?.open !== 'function') return;
    if (SHELL_MAJOR >= 51) {
        menu.open({ animate: animate !== false });
        return;
    }
    menu.open(animate === false
        ? BoxPointer.PopupAnimation.NONE
        : BoxPointer.PopupAnimation.FULL);
}

export function overviewDash() {
    const dash = Main.overview?.dash ?? null;
    if (!dash)
        warnOnce('overview-dash', 'The overview dash API is unavailable; the stock dash will remain visible.');
    return dash;
}

export function messageTray() {
    const tray = Main.messageTray ?? null;
    if (!tray)
        warnOnce('message-tray', 'Notification badges are unavailable on this Shell version.');
    return tray;
}

// Returns null when Shell cannot provide a trustworthy source snapshot. Callers
// that maintain cached state can then preserve the last known-good data instead
// of treating a transient enumeration failure as an empty notification tray.
export function messageTraySourcesSnapshot() {
    const tray = messageTray();
    if (!tray) return null;
    try {
        if (typeof tray.getSources !== 'function') {
            warnOnce('message-tray-sources', 'Notification source enumeration is unavailable; badge polling will use the last valid snapshot.');
            return null;
        }
        return tray.getSources() ?? [];
    } catch {
        warnOnce('message-tray-sources', 'Notification source enumeration failed; badge polling will use the last valid snapshot.');
        return null;
    }
}

export function messageTraySources() {
    return messageTraySourcesSnapshot() ?? [];
}

export function notificationSourceApp(source) {
    return source?.app ?? source?._app ?? null;
}

export function dragSourceApp(source) {
    return source?.app ?? source?._delegate?.app ?? null;
}

export function setDropDelegate(actor, delegate) {
    actor._delegate = delegate;
}

export function monitorInFullscreen(index) {
    try {
        if (typeof global.display?.get_monitor_in_fullscreen === 'function')
            return global.display.get_monitor_in_fullscreen(index);
        const monitor = Main.layoutManager.monitors?.[index];
        return Boolean(monitor?.inFullscreen ?? monitor?.in_fullscreen);
    } catch {
        warnOnce('monitor-fullscreen', 'Monitor fullscreen state is unavailable.');
        return false;
    }
}

export function notifyUser(title, detail = '', error = false) {
    try {
        if (error) Main.notifyError(title, detail);
        else Main.notify(title, detail);
    } catch {
        warnOnce('notify-user', 'Shell notifications are unavailable.');
    }
}
