// Fullscreen-window policy shared by autohide and its regression tests.

function isFullscreen(win) {
    try {
        if (typeof win?.is_fullscreen === 'function')
            return Boolean(win.is_fullscreen());
        return Boolean(win?.fullscreen);
    } catch {
        /* intentionally ignored: window fullscreen state query failed on destroyed window */
        return false;
    }
}

/**
 * Evaluates whether a specific window requires the dock to remain hidden.
 * Verified to be non-minimized, fullscreen, on the specified monitor index and active workspace.
 *
 * @param {Meta.Window|null} win - Mutter window instance to evaluate.
 * @param {number} monitorIndex - Target monitor index where the dock resides.
 * @param {Meta.Workspace|null} [workspace=null] - Optional workspace to verify window containment.
 * @returns {boolean} True if the window is active, fullscreen, and covers the specified monitor.
 */
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
        /* intentionally ignored: window monitor or workspace query failed on destroyed window */
        return false;
    }

    return isFullscreen(win);
}

/**
 * Checks whether any window in a collection requires the dock to remain hidden on a monitor.
 *
 * @param {Meta.Window[]|null} windows - Array of candidate Meta.Window instances.
 * @param {number} monitorIndex - Target monitor index.
 * @param {Meta.Workspace|null} [workspace=null] - Optional workspace filter.
 * @returns {boolean} True if at least one window keeps the dock hidden.
 */
export function hasFullscreenWindow(windows, monitorIndex, workspace = null) {
    if (!windows) return false;
    for (const win of windows) {
        if (windowKeepsDockHidden(win, monitorIndex, workspace)) return true;
    }
    return false;
}
