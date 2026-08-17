// Fullscreen-window policy shared by autohide and its regression tests.

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

export function hasFullscreenWindow(windows, monitorIndex, workspace = null) {
    if (!windows) return false;
    for (const win of windows) {
        if (windowKeepsDockHidden(win, monitorIndex, workspace)) return true;
    }
    return false;
}
