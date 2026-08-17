import { SETTINGS_DATA_VERSION, migrateSettings } from '../core/settingsMigration.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

let version = 0;
const writes = [];
const settings = {
    settings_schema: { has_key: key => key === 'settings-version' },
    get_int: key => {
        assert(key === 'settings-version', 'migration read an unexpected key');
        return version;
    },
    set_int: (key, value) => {
        assert(key === 'settings-version', 'migration wrote an unexpected key');
        writes.push(value);
        version = value;
        return true;
    },
    delay: () => { throw new Error('runtime migrations must not call Gio.Settings.delay()'); },
    apply: () => { throw new Error('runtime migrations must not depend on delayed apply'); },
    revert: () => { throw new Error('runtime migrations must not depend on delayed revert'); },
};

migrateSettings(settings);
assert(version === SETTINGS_DATA_VERSION, 'migration did not reach the current data version');
assert(writes.length === SETTINGS_DATA_VERSION && writes.at(-1) === SETTINGS_DATA_VERSION,
    'migration version writes were not monotonic');

const writeCount = writes.length;
migrateSettings(settings);
assert(writes.length === writeCount, 'an up-to-date settings object should not be rewritten');

let failed = false;
try {
    migrateSettings({
        settings_schema: { has_key: () => true },
        get_int: () => 0,
        set_int: () => false,
    });
} catch {
    failed = true;
}
assert(failed, 'a failed migration version write must be surfaced');

print('settingsMigration: ok');
