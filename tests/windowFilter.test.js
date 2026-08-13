import { appWindowsForConfig } from '../core/utils.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const workspaceA = { id: 'a' };
const workspaceB = { id: 'b' };
const windows = [
    {
        id: 'a0',
        get_monitor: () => 0,
        located_on_workspace: workspace => workspace === workspaceA,
    },
    {
        id: 'a1',
        get_monitor: () => 1,
        located_on_workspace: workspace => workspace === workspaceA,
    },
    {
        id: 'b1',
        get_monitor: () => 1,
        located_on_workspace: workspace => workspace === workspaceB,
    },
];
const app = { get_windows: () => windows };

const unfiltered = appWindowsForConfig(app, {}, workspaceA);
assert(unfiltered === windows, 'disabled isolation must preserve the original window list');

const monitorOnly = appWindowsForConfig(app, {
    isolateMonitors: true,
    isolateWS: false,
    monitorIndex: 1,
}, workspaceA);
assert(monitorOnly.map(window => window.id).join(',') === 'a1,b1',
    'monitor isolation selected the wrong windows');

const workspaceOnly = appWindowsForConfig(app, {
    isolateMonitors: false,
    isolateWS: true,
    monitorIndex: 0,
}, workspaceA);
assert(workspaceOnly.map(window => window.id).join(',') === 'a0,a1',
    'workspace isolation selected the wrong windows');

const both = appWindowsForConfig(app, {
    isolateMonitors: true,
    isolateWS: true,
    monitorIndex: 1,
}, workspaceA);
assert(both.length === 1 && both[0].id === 'a1',
    'combined workspace and monitor isolation must use their intersection');

assert(appWindowsForConfig(null, {}, workspaceA).length === 0,
    'an unavailable app must return an empty list');

print('windowFilter: ok');
