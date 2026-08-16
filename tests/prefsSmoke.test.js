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

for (const cleanup of window._cleanupCallbacks) cleanup();
for (const id of window._settingsSignalIds) settings.disconnect(id);
window.destroy();

for (const key of schema.list_keys()) {
    if (settings.get_user_value(key) !== null)
        throw new Error(`preferences construction wrote setting ${key}`);
}

print('preferences: ok');
