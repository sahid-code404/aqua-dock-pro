import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { LocationResolver } from '../services/locationResolver.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const loop = new GLib.MainLoop(null, false);
const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_current_dir(), 'metadata.json']));
const fallbackIcon = Gio.ThemedIcon.new('text-x-generic');
let resolver;
let timedOut = false;
resolver = new LocationResolver(() => {
    const resolved = resolver.resolve(file.get_uri(), 'Fallback', fallbackIcon);
    assert(resolved.name === 'metadata.json', 'resolved location display name was not used');
    assert(resolved.gicon !== fallbackIcon, 'resolved standard icon was not used');
    resolver.destroy();
    loop.quit();
});
const first = resolver.resolve(file.get_uri(), 'Fallback', fallbackIcon);
assert(first.name === 'Fallback' && first.gicon === fallbackIcon,
    'location resolver did not return its immediate safe fallback');
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
    timedOut = true;
    resolver.destroy();
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();
assert(!timedOut, 'location metadata lookup timed out');

print('locationResolver: ok');
