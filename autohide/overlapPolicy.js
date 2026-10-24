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
