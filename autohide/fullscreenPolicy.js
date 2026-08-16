// Stable fullscreen policy. Mutter's monitor flag and workspace window list can
// briefly disagree during restacking, so any still-live fullscreen window on
// the active workspace remains authoritative.

function isFullscreen(win) {
    try {
        if (typeof win?.is_fullscreen === 'function')
            return Boolean(win.is_fullscreen());
        return Boolean(win?.fullscreen);
    } catch {
        return false;
    }
}

export function windowKeepsDockHidden(win, monitorIndex, workspace = null) {
    if (!win || win.minimized || monitorIndex < 0) return false;

    try {
        if (typeof win.get_monitor !== 'function' ||
            win.get_monitor() !== monitorIndex)
            return false;
        if (workspace && typeof win.located_on_workspace === 'function' &&
            !win.located_on_workspace(workspace))
            return false;
    } catch {
        return false;
    }

    return isFullscreen(win);
}

function listHasFullscreenWindow(windows, monitorIndex, workspace) {
    if (!windows) return false;
    for (const win of windows) {
        if (windowKeepsDockHidden(win, monitorIndex, workspace)) return true;
    }
    return false;
}

export function hasFullscreenWindow(windows, monitorIndex, workspace = null) {
    if (listHasFullscreenWindow(windows, monitorIndex, workspace)) return true;

    // workspace.list_windows() can transiently omit the underlying fullscreen
    // Meta.Window while Mutter removes a covering window. Window actors usually
    // remain stable across that restack, so consult them as a second independent
    // source instead of allowing one incomplete snapshot to reveal the dock.
    try {
        if (typeof global !== 'undefined' &&
            typeof global.get_window_actors === 'function') {
            for (const actor of global.get_window_actors()) {
                if (windowKeepsDockHidden(actor?.meta_window, monitorIndex, workspace))
                    return true;
            }
        }
    } catch {
        // The caller's snapshot remains authoritative if Shell is tearing down.
    }

    return false;
}
