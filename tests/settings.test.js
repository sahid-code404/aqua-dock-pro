import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { SettingsManager } from '../core/settingsManager.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const schemaDir = GLib.getenv('AQUA_SCHEMA_DIR');
if (!schemaDir) throw new Error('AQUA_SCHEMA_DIR is required');

const source = Gio.SettingsSchemaSource.new_from_directory(
    schemaDir, Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup('org.gnome.shell.extensions.aqua-dock-pro', false);
assert(schema !== null, 'compiled settings schema was not found');

const settings = new Gio.Settings({ settings_schema: schema });
const bus = { emit() {} };
const manager = new SettingsManager(settings, bus);
const cfg = manager.config;

assert(cfg.iconSize === 60 && cfg.zoomMax === 2.6, 'existing visual defaults changed');
assert(cfg.alignment === 'center' && cfg.leftClickAction === 'smart',
    'backward-compatible behavior defaults changed');
assert(cfg.previewWindowMode === 'hidden' && !cfg.previewCloseButtons,
    'preview defaults changed');
assert(!cfg.showCustomFolder && !cfg.isolateMonitors,
    'new optional features must be off by default');

for (const key of schema.list_keys())
    assert(settings.get_user_value(key) === null, `construction wrote setting ${key}`);

manager.destroy();
print(`settings: ok (${schema.list_keys().length} keys)`);
