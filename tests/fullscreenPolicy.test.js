import { hasFullscreenWindow, windowKeepsDockHidden } from '../autohide/fullscreenPolicy.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const workspace = {};
const fullscreen = {
    minimized: false,
    get_monitor: () => 1,
    located_on_workspace: candidate => candidate === workspace,
    is_fullscreen: () => true,
};
const coveringWindow = {
    minimized: false,
    get_monitor: () => 1,
    located_on_workspace: candidate => candidate === workspace,
    is_fullscreen: () => false,
};

assert(hasFullscreenWindow([fullscreen, coveringWindow], 1, workspace),
    'a covered fullscreen window must keep the dock hidden');
assert(hasFullscreenWindow([coveringWindow, fullscreen], 1, workspace),
    'window stacking order must not change fullscreen ownership');
assert(!windowKeepsDockHidden(fullscreen, 0, workspace),
    'fullscreen on another monitor must not hide this dock');
assert(!windowKeepsDockHidden({ ...fullscreen, minimized: true }, 1, workspace),
    'a minimized fullscreen window must not block the dock');
assert(!windowKeepsDockHidden(fullscreen, 1, {}),
    'fullscreen on another workspace must not block the dock');
assert(windowKeepsDockHidden({
    minimized: false,
    get_monitor: () => 1,
    located_on_workspace: () => true,
    fullscreen: true,
}, 1, workspace), 'the compatibility fullscreen property was ignored');
assert(!hasFullscreenWindow([null, { get_monitor: () => { throw new Error('gone'); } }],
    1, workspace), 'stale windows must be ignored safely');

print('fullscreenPolicy: ok');
