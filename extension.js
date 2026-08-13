// Extension entry point. Forwards lifecycle to ExtensionManager.

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
