// AquaDockPro — extension entry point.
//
// Deliberately thin: it owns nothing but the ExtensionManager and forwards the
// GNOME enable()/disable() lifecycle to it. All wiring, ownership, and teardown
// live in core/extensionManager.js so this file never grows.

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ExtensionManager } from './core/extensionManager.js';

export default class AquaDockProExtension extends Extension {
    enable() {
        this._manager = new ExtensionManager(this);
        this._manager.enable();
    }

    disable() {
        this._manager?.disable();
        this._manager = null;
    }
}
