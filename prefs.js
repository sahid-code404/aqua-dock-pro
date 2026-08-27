// Preferences entry point. Builds the Adwaita settings window.

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { buildDockPage } from './prefs/pages/dockPage.js';
import { buildMotionPage } from './prefs/pages/motionPage.js';
import { buildBehaviorPage } from './prefs/pages/behaviorPage.js';
import { buildPopupsPage } from './prefs/pages/popupsPage.js';
import { buildDownloadsPage } from './prefs/pages/downloadsPage.js';
import { buildDevicesPage } from './prefs/pages/devicesPage.js';
import { buildAboutPage } from './prefs/pages/aboutPage.js';
import { buildAccessibilityPage } from './prefs/pages/accessibilityPage.js';

export default class AquaDockProPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window._settings = s;
        window._settingsSignalIds = [];
        window._cleanupCallbacks = [];
        window._dialogCancellables = new Set();

        // Slightly wider and shorter than the old layout: the new expandable
        // feature cards keep the first screen calm while leaving enough width
        // for subtitles, pickers, and monitor/device names.
        window.set_default_size(820, 760);
        window.set_search_enabled(true);

        // Put the everyday configuration flow first, then progressively more
        // specialized appearance/content/accessibility pages.
        buildDockPage(window, s);
        buildBehaviorPage(window, s);
        buildMotionPage(window, s);
        buildPopupsPage(window, s);
        buildDownloadsPage(window, s);
        buildDevicesPage(window, s);
        buildAccessibilityPage(window, s);
        buildAboutPage(window, s, this.metadata);

        window.connect('close-request', () => {
            for (const cancellable of (window._dialogCancellables ?? [])) {
                try { cancellable.cancel(); } catch { }
            }
            window._dialogCancellables?.clear();

            for (const cleanup of (window._cleanupCallbacks ?? [])) {
                try { cleanup(); } catch { }
            }
            window._cleanupCallbacks = [];
            for (const id of (window._settingsSignalIds ?? [])) {
                try { s.disconnect(id); } catch { }
            }
            window._settingsSignalIds = [];
        });
    }
}
