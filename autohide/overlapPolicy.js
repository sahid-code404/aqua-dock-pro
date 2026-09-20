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
    handledType = false,
    locatedOnWorkspace = null,
} = {}) {
    if (minimized || !handledType) return false;

    // Active-workspace membership is stable across compositor map/unmap effects.
    // Do not use is_hidden(): Mutter may toggle that during animations. Do not
    // require get_monitor() either: the frame rectangle below is the definitive
    // test and correctly handles spanning windows and transient monitor changes.
    if (locatedOnWorkspace !== null)
        return locatedOnWorkspace === true;
    return true;
}


export function shouldHoldShownForMagnification(hidden, engineAnimating) {
    return hidden !== true && engineAnimating === true;
}
