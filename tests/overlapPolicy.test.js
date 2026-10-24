import {
    chooseStableWindowInventory,
    frameOverlapsDock,
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

print('overlapPolicy: ok');
