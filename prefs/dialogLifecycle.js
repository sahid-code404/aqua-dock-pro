// Tracks native file-dialog operations so closing Preferences cancels callbacks
// that would otherwise retain the window/settings objects until completion.

import Gio from 'gi://Gio';

export function beginDialog(window) {
    const cancellable = new Gio.Cancellable();
    window?._dialogCancellables?.add(cancellable);
    return cancellable;
}

export function endDialog(window, cancellable) {
    window?._dialogCancellables?.delete(cancellable);
}
