import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { buildAboutPage } from '../prefs/pages/aboutPage.js';
import { buildAccessibilityPage } from '../prefs/pages/accessibilityPage.js';
import { buildBehaviorPage } from '../prefs/pages/behaviorPage.js';
import { buildDevicesPage } from '../prefs/pages/devicesPage.js';
import { buildDockPage } from '../prefs/pages/dockPage.js';
import { buildDownloadsPage } from '../prefs/pages/downloadsPage.js';
import { buildMotionPage } from '../prefs/pages/motionPage.js';
import { buildPopupsPage } from '../prefs/pages/popupsPage.js';

const schemaDir = GLib.getenv('AQUA_SCHEMA_DIR');
if (!schemaDir) throw new Error('AQUA_SCHEMA_DIR is required');

Adw.init();
const source = Gio.SettingsSchemaSource.new_from_directory(
    schemaDir, Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup('org.gnome.shell.extensions.aqua-dock-pro', false);
const settings = new Gio.Settings({ settings_schema: schema });
const window = new Adw.PreferencesWindow();
window._settingsSignalIds = [];
window._cleanupCallbacks = [];

buildDockPage(window, settings);
buildMotionPage(window, settings);
buildBehaviorPage(window, settings);
buildPopupsPage(window, settings);
buildDownloadsPage(window, settings);
buildDevicesPage(window, settings);
buildAccessibilityPage(window, settings);
buildAboutPage(window, settings, {
    uuid: 'aqua-dock-pro@shaque',
    version: 221,
    description: 'AquaDockPro test',
});

function findRowByTitle(root, title) {
    if (!root) return null;
    if (root.title === title) return root;
    if (typeof root.get_first_child === 'function') {
        for (let c = root.get_first_child(); c; c = c.get_next_sibling()) {
            const found = findRowByTitle(c, title);
            if (found) return found;
        }
    }
    return null;
}

const bgOpacity = findRowByTitle(window, 'Background opacity');
const pillColor = findRowByTitle(window, 'Pill colour');
const panelBg = findRowByTitle(window, 'Panel background');
const cardBg = findRowByTitle(window, 'Card background');
if (!bgOpacity) throw new Error('Background opacity row was not found');
if (!pillColor) throw new Error('Pill colour row was not found');
if (!panelBg) throw new Error('Panel background row was not found');
if (!cardBg) throw new Error('Card background row was not found');

if (bgOpacity.get_sensitive() !== false)
    throw new Error('Background opacity should be insensitive when blur-effect is enabled');
if (pillColor.get_sensitive() !== false)
    throw new Error('Pill colour should be insensitive when blur-effect is enabled');
if (panelBg.get_sensitive() !== false)
    throw new Error('Panel background should be insensitive when blur-effect is enabled');
if (cardBg.get_sensitive() !== false)
    throw new Error('Card background should be insensitive when blur-effect is enabled');

settings.set_boolean('blur-effect', false);
if (bgOpacity.get_sensitive() !== true)
    throw new Error('Background opacity should be sensitive when blur-effect is disabled');
if (pillColor.get_sensitive() !== true)
    throw new Error('Pill colour should be sensitive when blur-effect is disabled');
if (panelBg.get_sensitive() !== true)
    throw new Error('Panel background should be sensitive when blur-effect is disabled');
if (cardBg.get_sensitive() !== true)
    throw new Error('Card background should be sensitive when blur-effect is disabled');

settings.set_boolean('blur-effect', true);
if (bgOpacity.get_sensitive() !== false)
    throw new Error('Background opacity should be insensitive when blur-effect is re-enabled');
if (pillColor.get_sensitive() !== false)
    throw new Error('Pill colour should be insensitive when blur-effect is re-enabled');
if (panelBg.get_sensitive() !== false)
    throw new Error('Panel background should be insensitive when blur-effect is re-enabled');
if (cardBg.get_sensitive() !== false)
    throw new Error('Card background should be insensitive when blur-effect is re-enabled');

settings.reset('blur-effect');

for (const cleanup of window._cleanupCallbacks) cleanup();
for (const id of window._settingsSignalIds) settings.disconnect(id);
window.destroy();

for (const key of schema.list_keys()) {
    if (settings.get_user_value(key) !== null)
        throw new Error(`preferences construction wrote setting ${key}`);
}

print('preferences: ok');
