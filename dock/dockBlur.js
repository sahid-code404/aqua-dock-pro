// Dock blur coordinator for Aqua Dock Pro.
// Integrates with Blur my Shell pipelines.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { SignalGroup } from '../core/utils.js';

export class DockBlurManager {
    constructor({
        container,
        bg,
        blurRegion,
        handle,
        handleBlurRegion,
        getConfig,
        getMonitor,
        onBlurStateChanged = null,
    }) {
        this._container = container;
        this._bg = bg;
        this._blurRegion = blurRegion;
        this._handle = handle;
        this._handleBlurRegion = handleBlurRegion;
        this._getConfig = getConfig;
        this._getMonitor = getMonitor;
        this._onBlurStateChanged = onBlurStateChanged;
        this._signals = new SignalGroup();

        this._bmsActive = false;

        if (Main.extensionManager) {
            this._signals.connect(
                Main.extensionManager,
                'extension-state-changed',
                () => this.syncBlurState()
            );
        }

        if (this._bg && typeof this._bg.connect === 'function') {
            this._signals.connect(
                this._bg,
                'notify::style-class-name',
                () => {
                    const isTrans = Boolean(this._bg.has_style_class_name?.('transparent-dash'));
                    if (this._lastBgTransparent !== isTrans) {
                        this._lastBgTransparent = isTrans;
                        this._onBlurStateChanged?.(this._bmsActive || isTrans);
                    }
                }
            );
        }

        this.syncBlurState();
    }

    get bmsActive() {
        return this._bmsActive;
    }

    _isBmsDockBlurActive() {
        try {
            const bms = global.blur_my_shell;
            if (!bms || !bms._dash_to_dock_blur)
                return false;
            return Boolean(bms._dash_to_dock_blur.enabled);
        } catch {
            return false;
        }
    }

    _removeBmsBlur() {
        try {
            const bms = global.blur_my_shell;
            if (!bms || !bms._dash_to_dock_blur) return;
            const dashes = bms._dash_to_dock_blur.dashes;
            if (Array.isArray(dashes)) {
                const surface = dashes.find(d =>
                    d.dash_container === this._container || d.dash === this._bg);
                surface?.remove_dash_blur();
            }
            bms._dash_to_dock_blur.pending_docks?.get(this._container)?.destroy();
        } catch { }
        try {
            for (const cls of ['transparent-dash', 'light-dash', 'dark-dash']) {
                this._bg?.remove_style_class_name?.(cls);
                this._container?.remove_style_class_name?.(cls);
                this._handle?.remove_style_class_name?.(cls);
            }
        } catch { }
    }

    _ensureBmsTargetHook() {
        try {
            const bms = global.blur_my_shell;
            const dashBlur = bms?._dash_to_dock_blur;
            if (!dashBlur || dashBlur._aquaDockHooked)
                return;
            this._origTryBlur = dashBlur.try_blur.bind(dashBlur);
            dashBlur.try_blur = (dashContainer) => {
                if (dashContainer === this._container || dashContainer?._isAquaDock) {
                    if (dashContainer._dockBlurEnabled === false) {
                        const existing = Array.isArray(dashBlur.dashes)
                            ? dashBlur.dashes.find(d =>
                                d.dash_container === dashContainer || d.dash === dashContainer._dockBg)
                            : null;
                        existing?.remove_dash_blur();
                        dashBlur.pending_docks?.get(dashContainer)?.destroy();
                        return;
                    }
                }
                return this._origTryBlur(dashContainer);
            };
            dashBlur._aquaDockHooked = true;
        } catch { }
    }

    _removeBmsHook() {
        try {
            const bms = global.blur_my_shell;
            const dashBlur = bms?._dash_to_dock_blur;
            if (dashBlur && this._origTryBlur) {
                dashBlur.try_blur = this._origTryBlur;
                delete dashBlur._aquaDockHooked;
                this._origTryBlur = null;
            }
        } catch { }
    }

    syncBlurState() {
        const cfg = this._getConfig?.() ?? {};
        const blurEnabled = Boolean(cfg.blurEffect);
        const bmsActive = blurEnabled && this._isBmsDockBlurActive();
        const prevBms = this._bmsActive;
        this._bmsActive = bmsActive;

        if (this._container)
            this._container._dockBlurEnabled = blurEnabled;

        if (!blurEnabled) {
            this._removeBmsBlur();
            if (this._blurRegion)
                this._blurRegion.hide();
            if (this._handleBlurRegion)
                this._handleBlurRegion.hide();
            if (prevBms !== bmsActive)
                this._onBlurStateChanged?.(false);
            return;
        }

        if (bmsActive) {
            this._ensureBmsTargetHook();
            if (this._blurRegion)
                this._blurRegion.hide();
            if (this._handleBlurRegion)
                this._handleBlurRegion.hide();

            try {
                global.blur_my_shell._dash_to_dock_blur.queue_discovery();
            } catch { }
            if (prevBms !== bmsActive)
                this._onBlurStateChanged?.(true);
            return;
        }

        // Native blur path removed: when blur-effect is enabled and BMS is not active,
        // no blur is applied and regions remain hidden.
        this._removeBmsBlur();
        if (this._blurRegion)
            this._blurRegion.hide();
        if (this._handleBlurRegion)
            this._handleBlurRegion.hide();
        if (prevBms !== bmsActive)
            this._onBlurStateChanged?.(false);
    }

    update(cfg) {
        this.syncBlurState();
    }

    destroy() {
        this._signals.disconnectAll();
        this._removeBmsHook();
        this._removeBmsBlur();
        if (this._container)
            this._container._dockBlurEnabled = false;
        this._container = null;
        this._bg = null;
        this._blurRegion = null;
        this._handle = null;
        this._handleBlurRegion = null;
        this._onBlurStateChanged = null;
    }
}
