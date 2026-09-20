// Pure helpers for dodge/intellihide overlap decisions.

export function chooseStableWindowInventory(
    displayWindows, workspaceWindows, actorWindows) {
    if (Array.isArray(displayWindows)) return displayWindows;
    if (Array.isArray(workspaceWindows)) return workspaceWindows;
    return Array.isArray(actorWindows) ? actorWindows : [];
}

export function frameOverlapsDock(frame, dock, tolerance = 4) {
    if (!frame || !dock) return false;
    return frame.x + tolerance < dock.x + dock.width &&
        frame.x + frame.width - tolerance > dock.x &&
        frame.y + tolerance < dock.y + dock.height &&
        frame.y + frame.height - tolerance > dock.y;
}


export function windowVisibleForDodge({
    minimized = false,
    monitorMatches = false,
    handledType = false,
    showingOnWorkspace = null,
    locatedOnWorkspace = null,
    onAllWorkspaces = false,
} = {}) {
    if (minimized || !monitorMatches || !handledType) return false;

    // Mutter's showing_on_its_workspace() is the strongest signal: it already
    // understands sticky windows and the "workspaces only on primary display"
    // model. If available, prefer it over manual active-workspace membership.
    if (showingOnWorkspace !== null)
        return showingOnWorkspace === true;

    // Compatibility fallback for Shell/Mutter variants where the visibility
    // helper is unavailable.
    if (onAllWorkspaces) return true;
    if (locatedOnWorkspace !== null)
        return locatedOnWorkspace === true;
    return true;
}
