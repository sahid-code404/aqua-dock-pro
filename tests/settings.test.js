import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { SettingsManager } from '../core/settingsManager.js';
import {
    AUTOHIDE_KEYS,
    DOCK_NOOP_KEYS,
    GEOMETRY_KEYS,
    ITEM_REFRESH_KEYS,
    PASSIVE_CONFIG_KEYS,
    SETTING_CONFIG_PROPERTIES,
    STRUCTURAL_KEYS,
    STYLE_KEYS,
    TOOLTIP_KEYS,
    hasKnownDirectSettingImpact,
} from '../core/constants.js';
import { animationsEnabled, setReduceMotionOverride } from '../core/utils.js';

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

assert(cfg.iconSize === 60 && cfg.zoomMax === 2.6 && cfg.iconSpacing === 12,
    'existing visual defaults changed');
assert(cfg.autoShrink, 'screen-fit shrinking must remain enabled by default');
assert(cfg.showAutohideHandle, 'the hidden dock handle must be enabled by default');
assert(cfg.alignment === 'center' && cfg.leftClickAction === 'smart',
    'backward-compatible behavior defaults changed');
assert(cfg.previewWindowMode === 'hidden' && !cfg.previewCloseButtons,
    'preview defaults changed');
assert(cfg.previewOverflowMode === 'summary' && cfg.previewPageSize === 4 &&
    cfg.previewKeyboardNavigation && !cfg.previewWindowActions,
    'accessible preview defaults changed');
assert(!cfg.showCustomFolder && !cfg.isolateMonitors,
    'new optional features must be off by default');
assert(!cfg.showCustomDockItems && cfg.customDockItems.length === 0,
    'custom dock locations must be off by default');
assert(cfg.useFolderMetadataIcons,
    'folder metadata icons should be used by default');
assert(!cfg.reduceMotion && !cfg.highContrast && cfg.interfaceTextScale === 1 &&
    cfg.announceItemStatus, 'accessibility defaults changed');
assert(GEOMETRY_KEYS.has('auto-hide-mode') &&
    !hasKnownDirectSettingImpact('auto-hide-mode'),
    'auto-hide mode must relayout so reserved strut geometry stays in sync');
assert(DOCK_NOOP_KEYS.has('focus-dock-shortcut') &&
    DOCK_NOOP_KEYS.has('settings-version'),
    'non-visual settings must not trigger dock-wide relayout work');

const impactGroups = [
    DOCK_NOOP_KEYS,
    STRUCTURAL_KEYS,
    GEOMETRY_KEYS,
    STYLE_KEYS,
    AUTOHIDE_KEYS,
    TOOLTIP_KEYS,
    ITEM_REFRESH_KEYS,
    PASSIVE_CONFIG_KEYS,
];
for (const key of schema.list_keys()) {
    const groups = impactGroups.filter(group => group.has(key));
    assert(groups.length === 1,
        `setting ${key} must belong to exactly one impact group (found ${groups.length})`);
    if (hasKnownDirectSettingImpact(key))
        assert(Array.isArray(SETTING_CONFIG_PROPERTIES[key]) &&
            SETTING_CONFIG_PROPERTIES[key].length > 0,
        `direct setting ${key} is missing runtime config mapping`);
}
assert(GEOMETRY_KEYS.has('icon-size') && STYLE_KEYS.has('background-opacity') &&
    AUTOHIDE_KEYS.has('hide-delay') && TOOLTIP_KEYS.has('tooltip-delay') &&
    ITEM_REFRESH_KEYS.has('show-badges') && PASSIVE_CONFIG_KEYS.has('preview-delay'),
    'representative settings impact classifications changed');
assert(!hasKnownDirectSettingImpact('icon-size') &&
    hasKnownDirectSettingImpact('background-opacity') &&
    hasKnownDirectSettingImpact('left-click-action'),
    'direct settings routing boundary changed');

for (const key of schema.list_keys())
    assert(settings.get_user_value(key) === null, `construction wrote setting ${key}`);

manager.destroy();

settings.set_boolean('show-autohide-handle', false);
const hiddenRimManager = new SettingsManager(settings, bus);
assert(!hiddenRimManager.config.showAutohideHandle,
    'the hidden dock rim preference could not be disabled');
hiddenRimManager.destroy();
settings.reset('show-autohide-handle');

settings.set_double('dock-scale', 0.75);
const scaledManager = new SettingsManager(settings, bus);
assert(scaledManager.config.iconSpacing === 10 && scaledManager.config.cellPad === 5,
    'the default spacing no longer preserves legacy fractional-scale geometry');
scaledManager.destroy();
settings.reset('dock-scale');

settings.set_boolean('auto-shrink-to-fit', false);
settings.set_int('icon-spacing', 3);
const manualManager = new SettingsManager(settings, bus);
assert(!manualManager.config.autoShrink,
    'explicitly disabled screen-fit shrinking did not reach the runtime snapshot');
assert(manualManager.config.iconSpacing === 3 && manualManager.config.cellPad === 1.5 &&
    manualManager.config.cellW === manualManager.config.iconSize + 3,
    'configured icon spacing did not reach dock cell geometry');
manualManager.destroy();
settings.reset('auto-shrink-to-fit');
settings.reset('icon-spacing');

settings.set_boolean('show-custom-dock-items', true);
settings.set_strv('custom-dock-items', [
    JSON.stringify({ id: 'folder', type: 'folder', uri: 'file:///tmp', name: 'Temp' }),
]);
const customManager = new SettingsManager(settings, bus);
assert(customManager.config.showCustomDockItems &&
    customManager.config.customDockItems[0]?.uri === 'file:///tmp',
    'custom dock locations did not reach the runtime snapshot');
customManager.destroy();
settings.reset('show-custom-dock-items');
settings.reset('custom-dock-items');

setReduceMotionOverride(true);
assert(!animationsEnabled(), 'the explicit reduced-motion preference was ignored');
setReduceMotionOverride(false);

print(`settings: ok (${schema.list_keys().length} keys)`);
