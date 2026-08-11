// AquaDockPro GNOME Shell compatibility boundary.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { warnOnce } from '../core/utils.js';

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

export function messageTraySources() {
    try { return messageTray()?.getSources?.() ?? []; }
    catch {
        warnOnce('message-tray-sources', 'Notification source enumeration failed; badges are disabled.');
        return [];
    }
}

export function dragSourceApp(source) {
    return source?.app ?? source?._delegate?.app ?? null;
}

export function setDropDelegate(actor, delegate) {
    actor._delegate = delegate;
}

export function notifyUser(title, detail = '', error = false) {
    try {
        if (error) Main.notifyError(title, detail);
        else Main.notify(title, detail);
    } catch {
        warnOnce('notify-user', 'Shell notifications are unavailable.');
    }
}
