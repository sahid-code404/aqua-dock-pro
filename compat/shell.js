// AquaDockPro GNOME Shell compatibility boundary.

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { warnOnce } from '../core/utils.js';

const SHELL_MAJOR = Number.parseInt(Config.PACKAGE_VERSION, 10) || 0;

/**
 * Retrieves the integer major version of the running GNOME Shell (e.g. 50, 51).
 *
 * @returns {number} Integer major version of GNOME Shell, or 0 if unresolvable.
 */
export function shellMajorVersion() {
    return SHELL_MAJOR;
}

// GNOME Shell 51 changed PopupMenu.open()/close() from a PopupAnimation enum
// argument to an options object. Keep that ABI difference confined here so the
// same extension package remains correct on both GNOME Shell 50 and 51+.
/**
 * Opens a popup menu with forward-compatible animation arguments across GNOME Shell 50 and 51+.
 * Adapts between BoxPointer.PopupAnimation enum (Shell 50) and options object (Shell 51+).
 *
 * @param {PopupMenu.PopupMenu} menu - The popup menu to open.
 * @param {boolean} [animate=true] - Whether to animate the menu presentation.
 * @returns {void}
 */
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

/**
 * Safely accesses the GNOME Shell overview dash actor.
 *
 * @returns {Clutter.Actor|null} The overview dash actor or null if unavailable.
 */
export function overviewDash() {
    const dash = Main.overview?.dash ?? null;
    if (!dash)
        warnOnce('overview-dash', 'The overview dash API is unavailable; the stock dash will remain visible.');
    return dash;
}

/**
 * Safely accesses the GNOME Shell message tray singleton.
 *
 * @returns {Main.messageTray|null} The message tray singleton or null.
 */
export function messageTray() {
    const tray = Main.messageTray ?? null;
    if (!tray)
        warnOnce('message-tray', 'Notification badges are unavailable on this Shell version.');
    return tray;
}

// Returns null when Shell cannot provide a trustworthy source snapshot. Callers
// that maintain cached state can then preserve the last known-good data instead
// of treating a transient enumeration failure as an empty notification tray.
/**
 * Takes a snapshot array of current notification sources from the message tray.
 * Returns null on transient failure so callers can retain last known-good state.
 *
 * @returns {Array<object>|null} Array of notification sources, or null if enumeration fails.
 */
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
        /* intentionally ignored: message tray source query failed */
        warnOnce('message-tray-sources', 'Notification source enumeration failed; badge polling will use the last valid snapshot.');
        return null;
    }
}

/**
 * Returns current notification sources from the message tray, falling back to an empty array.
 *
 * @returns {Array<object>} Array of notification sources.
 */
export function messageTraySources() {
    return messageTraySourcesSnapshot() ?? [];
}

/**
 * Extracts the associated Shell.App instance from a notification source.
 *
 * @param {object|null} source - Message tray notification source.
 * @returns {Shell.App|null} Associated application or null.
 */
export function notificationSourceApp(source) {
    return source?.app ?? source?._app ?? null;
}

/**
 * Resolves the application associated with a drag source delegate.
 *
 * @param {object|null} source - DND drag source object.
 * @returns {Shell.App|null} Associated application or null.
 */
export function dragSourceApp(source) {
    return source?.app ?? source?._delegate?.app ?? null;
}

/**
 * Assigns a drag-and-drop delegate to a Clutter actor for Shell DND dispatching.
 *
 * @param {Clutter.Actor} actor - Clutter actor receiving the delegate.
 * @param {object} delegate - Delegate object implementing handleDragOver / acceptDrop.
 * @returns {void}
 */
export function setDropDelegate(actor, delegate) {
    actor._delegate = delegate;
}

/**
 * Determines whether a physical monitor currently contains a fullscreen window.
 * Confines display server differences between Mutter versions.
 *
 * @param {number} index - Physical monitor index.
 * @returns {boolean} True if any window on the monitor is fullscreen.
 */
export function monitorInFullscreen(index) {
    try {
        if (typeof global.display?.get_monitor_in_fullscreen === 'function')
            return global.display.get_monitor_in_fullscreen(index);
        const monitor = Main.layoutManager.monitors?.[index];
        return Boolean(monitor?.inFullscreen ?? monitor?.in_fullscreen);
    } catch {
        /* intentionally ignored: monitor fullscreen query failed */
        warnOnce('monitor-fullscreen', 'Monitor fullscreen state is unavailable.');
        return false;
    }
}

/**
 * Displays a desktop notification banner via GNOME Shell's Main.notify API.
 *
 * @param {string} title - Main notification title.
 * @param {string} [detail=''] - Optional secondary notification body text.
 * @param {boolean} [error=false] - Whether to style and sound as an error notification.
 * @returns {void}
 */
export function notifyUser(title, detail = '', error = false) {
    try {
        if (error) Main.notifyError(title, detail);
        else Main.notify(title, detail);
    } catch {
        /* intentionally ignored: shell notification failed */
        warnOnce('notify-user', 'Shell notifications are unavailable.');
    }
}
