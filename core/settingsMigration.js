// AquaDockPro settings migrations.

export const SETTINGS_DATA_VERSION = 1;

export function migrateSettings(settings) {
    if (!settings?.settings_schema?.has_key('settings-version')) return;
    let version = settings.get_int('settings-version');
    if (version >= SETTINGS_DATA_VERSION) return;

    // Add future migrations as small version-to-version steps. Existing keys
    // stay readable until their values have been copied successfully.
    settings.delay();
    try {
        while (version < SETTINGS_DATA_VERSION) version++;
        settings.set_int('settings-version', version);
        settings.apply();
    } catch (e) {
        settings.revert();
        throw e;
    }
}
