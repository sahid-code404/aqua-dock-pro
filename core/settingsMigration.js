// AquaDockPro settings migrations.

export const SETTINGS_DATA_VERSION = 1;

export function migrateSettings(settings) {
    if (!settings?.settings_schema?.has_key('settings-version')) return;
    let version = settings.get_int('settings-version');
    if (version >= SETTINGS_DATA_VERSION) return;

    // Gio.Settings.delay() is sticky for the lifetime of a Settings object.
    // This runtime object is retained by SettingsManager, so migrations must not
    // switch it into delayed-apply mode. Run each future migration step directly
    // and advance the version only after that step succeeds.
    while (version < SETTINGS_DATA_VERSION) {
        const nextVersion = version + 1;

        // Add future migrations here as small version-to-version steps. Any key
        // writes for a step must complete successfully before settings-version is
        // advanced, making an interrupted migration naturally retryable.

        if (!settings.set_int('settings-version', nextVersion))
            throw new Error(`Could not record settings migration ${nextVersion}`);
        version = nextVersion;
    }
}
