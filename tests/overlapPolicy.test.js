import {
    chooseStableWindowInventory,
    frameOverlapsDock,
    windowVisibleForDodge,
    shouldHoldShownForMagnification,
} from '../autohide/overlapPolicy.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const displayWindows = [{ id: 'display' }];
const workspaceWindows = [{ id: 'workspace' }];
const actorWindows = [{ id: 'actor' }];

assert(chooseStableWindowInventory(
    displayWindows, workspaceWindows, actorWindows) === displayWindows,
'display Meta.Window inventory must be preferred over workspace/actor snapshots');

const emptyDisplay = [];
assert(chooseStableWindowInventory(
    emptyDisplay, workspaceWindows, actorWindows) === emptyDisplay,
'an empty stable display inventory must not fall back to compositor actors');

assert(chooseStableWindowInventory(
    null, workspaceWindows, actorWindows) === workspaceWindows,
'workspace Meta.Window inventory should be the stable fallback');

assert(chooseStableWindowInventory(
    null, null, actorWindows) === actorWindows,
'actor inventory should be used only as the compatibility fallback');

const dock = { x: 0, y: 1000, width: 1920, height: 80 };
assert(frameOverlapsDock(
    { x: 0, y: 0, width: 1920, height: 1080 }, dock, 4),
'a full-height local window should overlap the dock');
assert(!frameOverlapsDock(
    { x: 0, y: 0, width: 1920, height: 1004 }, dock, 4),
'a window that only touches the tolerance boundary must not count as overlap');
assert(!frameOverlapsDock(null, dock, 4),
'missing window geometry must not invent an overlap');

assert(windowVisibleForDodge({
    minimized: false,
    handledType: true,
    locatedOnWorkspace: true,
}) === true,
'a normal window on the active workspace must remain eligible for dodge');

assert(windowVisibleForDodge({
    minimized: true,
    handledType: true,
    locatedOnWorkspace: true,
}) === false,
'a minimized window must not keep the dock hidden');

assert(windowVisibleForDodge({
    minimized: false,
    handledType: false,
    locatedOnWorkspace: true,
}) === false,
'unhandled window types must not drive intellihide');

assert(windowVisibleForDodge({
    minimized: false,
    handledType: true,
    locatedOnWorkspace: false,
}) === false,
'a window outside the active workspace must not drive intellihide');

assert(windowVisibleForDodge({
    minimized: false,
    handledType: true,
    locatedOnWorkspace: null,
}) === true,
'missing workspace API must preserve a valid candidate instead of inventing a clear dock');

const secondaryDock = { x: 1920, y: 1000, width: 1920, height: 80 };
assert(frameOverlapsDock(
    { x: 1800, y: 0, width: 500, height: 1080 }, secondaryDock, 4),
'a window spanning monitors must hide a dock wherever its real frame overlaps');

assert(shouldHoldShownForMagnification(false, true) === true,
    'a visible dock may delay hiding while magnification is settling');
assert(shouldHoldShownForMagnification(true, true) === false,
    'background animation work must never reveal an already-hidden dock');
assert(shouldHoldShownForMagnification(false, false) === false,
    'an idle visible dock must not invent a magnification hold');

print('overlapPolicy: ok');
