// Tracks native file-dialog operations so closing Preferences cancels callbacks
// that would otherwise retain the window/settings objects until completion.

import Gio from 'gi://Gio';

/**
 * Creates and registers a Gio.Cancellable for a modal dialog tied to the preferences window lifecycle.
 * Ensures closing the preferences window cancels pending dialog operations and releases references.
 *
 * @param {Adw.PreferencesWindow|null} window - The active preferences window instance.
 * @returns {Gio.Cancellable} A tracked cancellable token.
 */
export function beginDialog(window) {
    const cancellable = new Gio.Cancellable();
    window?._dialogCancellables?.add(cancellable);
    return cancellable;
}

/**
 * Removes a completed or cancelled cancellable token from the preferences window tracking set.
 *
 * @param {Adw.PreferencesWindow|null} window - The active preferences window instance.
 * @param {Gio.Cancellable} cancellable - The cancellable token to deregister.
 * @returns {void}
 */
export function endDialog(window, cancellable) {
    window?._dialogCancellables?.delete(cancellable);
}
