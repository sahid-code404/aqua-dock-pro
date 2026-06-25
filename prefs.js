// AquaDockPro — preferences entry point.
//
// Builds the Adwaita preferences window for GNOME Shell 50. Settings are grouped
// by FEATURE across a handful of scannable pages (Dock / Motion / Behavior /
// Widgets / Downloads / About). Each page lives in its own module;
// this file only wires them and manages the shared settings-signal cleanup.

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { buildDockPage } from './prefs/pages/dockPage.js';
import { buildMotionPage } from './prefs/pages/motionPage.js';
import { buildBehaviorPage } from './prefs/pages/behaviorPage.js';
import { buildPopupsPage } from './prefs/pages/popupsPage.js';
import { buildDownloadsPage } from './prefs/pages/downloadsPage.js';
import { buildAboutPage } from './prefs/pages/aboutPage.js';

export default class AquaDockProPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window._settings = s;
        window._settingsSignalIds = [];

        window.set_default_size(740, 820);
        window.set_search_enabled(true);   // every option is searchable — no digging

        buildDockPage(window, s);
        buildMotionPage(window, s);
        buildBehaviorPage(window, s);
        buildPopupsPage(window, s);
        buildDownloadsPage(window, s);
        buildAboutPage(window, s, this.metadata);

        window.connect('close-request', () => {
            for (const id of (window._settingsSignalIds ?? [])) {
                try { s.disconnect(id); } catch { }
            }
            window._settingsSignalIds = [];
        });
    }
}
