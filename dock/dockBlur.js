// Dock blur coordinator for Aqua Dock Pro.
// Integrates with Blur my Shell pipelines at runtime via in-memory hooks.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { SignalGroup } from '../core/utils.js';

export function getBmsSettings(schemaId) {
    try {
        const defaultSource = Gio.SettingsSchemaSource.get_default();
        if (defaultSource && !defaultSource.lookup(schemaId, true)) {
            return null;
        }
        return new Gio.Settings({ schema_id: schemaId });
    } catch {
        return null;
    }
}

export function isBmsDockBlurActive() {
    try {
        const bms = globalThis.global?.blur_my_shell;
        if (!bms || !bms._dash_to_dock_blur)
            return false;
        return Boolean(bms._dash_to_dock_blur.enabled);
    } catch {
        return false;
    }
}

export function isBmsPopupBlurActive() {
    try {
        const bms = globalThis.global?.blur_my_shell;
        if (!bms || !bms._popup)
            return false;
        return Boolean(bms._popup.enabled);
    } catch {
        return false;
    }
}

export function isBmsMenuBlurActive(cfg = null) {
    if (cfg && (!cfg.blurEffect || cfg.highContrast))
        return false;
    return isBmsPopupBlurActive() || isBmsDockBlurActive();
}

export function isBmsTooltipBlurActive(cfg = null) {
    if (cfg && (!cfg.blurEffect || cfg.highContrast))
        return false;
    return isBmsPopupBlurActive() || isBmsDockBlurActive();
}

// LOCKED ARCHITECTURE: Background blur for downloads stack views (Grid, List, Fan).
// Permanently enabled and locked. DO NOT remove, disable, or modify without explicit user permission.
export function isBmsStackBlurActive(cfg = null) {
    if (cfg && (!cfg.blurEffect || cfg.highContrast))
        return false;
    return isBmsPopupBlurActive() || isBmsDockBlurActive();
}

export function getBmsPopupSettings(dashBlur = null) {
    try {
        const bms = globalThis.global?.blur_my_shell;
        const bmsSettings = dashBlur?.settings ?? bms?.settings;
        if (bmsSettings?.popup)
            return bmsSettings.popup;
        const gioSettings = getBmsSettings('org.gnome.shell.extensions.blur-my-shell.popup');
        if (gioSettings) {
            return {
                settings: gioSettings,
                get PIPELINE() {
                    try { return gioSettings.get_string('pipeline'); } catch { return 'pipeline_default'; }
                },
                get STATIC_BLUR() {
                    try { return gioSettings.get_boolean('static-blur'); } catch { return false; }
                },
                get BLUR() {
                    try { return gioSettings.get_boolean('blur'); } catch { return true; }
                },
            };
        }
    } catch { }
    return null;
}

export function getBmsGeneralSettings(dashBlur = null) {
    try {
        const bms = globalThis.global?.blur_my_shell;
        return dashBlur?.settings?.settings ?? bms?.settings?.settings ?? getBmsSettings('org.gnome.shell.extensions.blur-my-shell');
    } catch {
        return null;
    }
}

// LOCKED ARCHITECTURE: 'aquaDownloadsPanel' and '.aqua-dl-panel' background blur
// registration and popup classification are permanently locked.
// DO NOT remove, disable, or alter without explicit user permission.
export function isAquaPopupTarget(container) {
    if (!container) return false;
    if (container._blurType === 'popup') return true;
    if (container._blurType === 'dock') return false;
    const name = container.name || container.get_name?.();
    if (name === 'aquaTooltip' || name === 'aquaMenu' || name === 'aquaStackAnchor' || name === 'aquaDownloadsPanel') return true;
    if (typeof container.has_style_class_name === 'function' &&
        (container.has_style_class_name('aqua-menu') ||
         container.has_style_class_name('aqua-stack-anchor-tile') ||
         container.has_style_class_name('aqua-dl-panel'))) return true;
    return false;
}

export function addBlurForTarget(dashBlur, container, target) {
    if (!dashBlur || typeof dashBlur.add_blur !== 'function') return null;
    const isPopup = isAquaPopupTarget(container) || Boolean(target?.is_popup);
    if (!isPopup) {
        return dashBlur.add_blur(container, target);
    }

    const popup = getBmsPopupSettings(dashBlur);
    const isStatic = popup ? Boolean(popup.STATIC_BLUR) : false;
    const pipelineName = popup?.PIPELINE ?? 'pipeline_default';

    const proxyDashBlur = new Proxy(dashBlur, {
        get(bmsTarget, prop, receiver) {
            if (prop === 'settings') {
                const realSettings = bmsTarget.settings;
                return new Proxy(realSettings || {}, {
                    get(sTarget, sProp, sReceiver) {
                        if (sProp === 'dash_to_dock') {
                            return {
                                get STATIC_BLUR() { return isStatic; },
                                get PIPELINE() { return pipelineName; },
                            };
                        }
                        return Reflect.get(sTarget, sProp, sReceiver);
                    },
                });
            }
            return Reflect.get(bmsTarget, prop, receiver);
        },
    });

    return dashBlur.add_blur.call(proxyDashBlur, container, target);
}

export function setupBackgroundCorners(background, getRadius = null) {
    if (!background) return;
    if (getRadius) {
        background._aquaGetRadius = getRadius;
    } else if (!background._aquaGetRadius) {
        background._aquaGetRadius = (typeof background.get_dock_radius === 'function'
            ? () => background.get_dock_radius()
            : () => (background._dockRadius ?? 28));
    }
    if (background._aquaThemeNodeHooked) return;
    background._aquaThemeNodeHooked = true;

    const origGetThemeNode = background.get_theme_node?.bind(background);
    background.get_theme_node = function() {
        const node = origGetThemeNode ? origGetThemeNode() : null;
        const radius = (typeof background._aquaGetRadius === 'function'
            ? background._aquaGetRadius()
            : (typeof background.get_dock_radius === 'function'
                ? background.get_dock_radius()
                : background._dockRadius)) ?? 28;
        let scale = 1;
        try {
            const stage = globalThis.global?.stage;
            if (stage && St?.ThemeContext?.get_for_stage) {
                scale = St.ThemeContext.get_for_stage(stage)?.scale_factor ?? 1;
            }
        } catch { }
        const scaled = Math.round(radius * scale);
        const customRadius = {
            get_border_radius: (corner) => {
                const nodeRadius = node?.get_border_radius?.(corner) ?? 0;
                return nodeRadius > 0 ? nodeRadius : scaled;
            },
        };
        return node ? new Proxy(node, {
            get(target, prop, receiver) {
                if (prop === 'get_border_radius')
                    return customRadius.get_border_radius;
                const val = Reflect.get(target, prop, receiver);
                return typeof val === 'function' ? val.bind(target) : val;
            },
        }) : customRadius;
    };
}

export function resolveAquaDockTarget(container) {
    if (!container) return null;
    const isAqua = Boolean(
        container._isAquaDock ||
        container.name === 'aquaDockContainer' ||
        container.name === 'aquaDownloadsPanel' ||
        container.name === 'aquaDownloadsFan' ||
        container.name === 'aquaDownloadsFanItem' ||
        container.name === 'aquaStackAnchor' ||
        container.name === 'aquaTooltip' ||
        container.name === 'aquaMenu' ||
        container.get_name?.() === 'aquaDockContainer' ||
        container.get_name?.() === 'aquaDownloadsPanel' ||
        container.get_name?.() === 'aquaDownloadsFan' ||
        container.get_name?.() === 'aquaDownloadsFanItem' ||
        container.get_name?.() === 'aquaStackAnchor' ||
        container.get_name?.() === 'aquaTooltip' ||
        container.get_name?.() === 'aquaMenu' ||
        (typeof container.has_style_class_name === 'function' &&
            (container.has_style_class_name('aqua-menu') ||
             container.has_style_class_name('aqua-stack-anchor-tile') ||
             container.has_style_class_name('aqua-dl-panel')))
    );
    if (!isAqua) return null;
    if (container._dockBlurEnabled === false) return null;

    const background = container._dockBg ?? container;
    const content = container._dockContent ?? background;
    const content_parent = container._dockContentParent ?? container.get_parent?.() ?? container;

    let sibling = container._dockBlurRegion ?? container._blurRegion ?? background;
    if (sibling && typeof sibling.get_parent === 'function' && sibling.get_parent() !== content_parent) {
        if (typeof content.get_parent === 'function' && content.get_parent() === content_parent) {
            sibling = content;
        } else if (typeof container.get_parent === 'function' && container.get_parent() === content_parent) {
            sibling = container;
        } else if (typeof background.get_parent === 'function' && background.get_parent() === content_parent) {
            sibling = background;
        } else {
            sibling = null;
        }
    }

    return {
        content,
        content_parent,
        background,
        slider: container._slider ?? null,
        theme_manager: container._themeManager ?? null,
        sibling,
        is_popup: isAquaPopupTarget(container),
    };
}

export class AquaDockSurface {
    constructor(dashBlur, dashContainer, target, blur) {
        this.dash_blur = dashBlur;
        this.dash_container = dashContainer;
        this.dash = target.content;
        this.dash_background = target.background;
        this.theme_manager = target.theme_manager;
        this.settings = dashBlur?.settings;
        this._isPopupType = isAquaPopupTarget(dashContainer) || Boolean(target?.is_popup);
        this._signals = new SignalGroup();
        this._bgSignals = new SignalGroup();
        this._updateId = 0;
        this.current_monitor_index = (
            Main.layoutManager?.findMonitorForActor?.(dashContainer) ??
            Main.layoutManager?.primaryMonitor
        )?.index ?? null;
        this._isChangingBlurType = false;
        this._isRemoving = false;
        this._lastStaticGeom = null;
        this._lastDynamicGeom = null;

        this.set_blur(blur);

        const schedule = () => this.schedule_update();

        const GEOMETRY_SIGNALS = [
            'notify::allocation',
            'notify::position',
            'notify::size',
            'notify::x',
            'notify::y',
            'notify::width',
            'notify::height',
            'notify::opacity',
            'notify::scale-x',
            'notify::scale-y',
            'notify::translation-x',
            'notify::translation-y',
            'notify::visible',
            'notify::mapped',
        ];

        for (const sig of GEOMETRY_SIGNALS) {
            if (this.dash && typeof this.dash.connect === 'function')
                this._signals.connect(this.dash, sig, schedule);
            if (this.dash_container && this.dash_container !== this.dash && typeof this.dash_container.connect === 'function')
                this._signals.connect(this.dash_container, sig, schedule);
            if (this.dash_background && this.dash_background !== this.dash && typeof this.dash_background.connect === 'function')
                this._signals.connect(this.dash_background, sig, schedule);
        }

        const parent = this.background_group?.get_parent?.();
        if (parent && parent !== Main.uiGroup && parent !== this.dash_container && parent !== this.dash && typeof parent.connect === 'function') {
            for (const sig of GEOMETRY_SIGNALS) {
                this._signals.connect(parent, sig, schedule);
            }
        }

        if (this.dash && typeof this.dash.connect === 'function')
            this._signals.connect(this.dash, 'destroy', () => this.remove_dash_blur());
        if (this.dash_container && this.dash_container !== this.dash && typeof this.dash_container.connect === 'function')
            this._signals.connect(this.dash_container, 'destroy', () => this.remove_dash_blur());

        if (dashBlur && typeof dashBlur.connect === 'function') {
            this._signals.connect(dashBlur, 'remove-dashes', () => {
                if (this._isPopupType && isBmsTooltipBlurActive()) {
                    return;
                }
                this.remove_dash_blur(true);
            });
            this._signals.connect(dashBlur, 'override-style', () => this.override_style());
            this._signals.connect(dashBlur, 'remove-style', () => this.remove_style());
            this._signals.connect(dashBlur, 'show', () => this.update_visibility());
            this._signals.connect(dashBlur, 'hide', () => this.update_visibility());
            this._signals.connect(dashBlur, 'update-size', schedule);
            if (!this._isPopupType) {
                this._signals.connect(dashBlur, 'change-blur-type', () => this.change_blur_type());
                this._signals.connect(dashBlur, 'update-pipeline', () => this.update_pipeline());
            }
        }

        if (!this._isPopupType && Main.overview && typeof Main.overview.connect === 'function') {
            const updateVis = () => this.update_visibility();
            for (const sig of ['showing', 'shown', 'hiding', 'hidden']) {
                this._signals.connect(Main.overview, sig, updateVis);
            }
        }

        if (this._isPopupType) {
            const popup = getBmsPopupSettings(dashBlur);
            const popupSettings = popup?.settings ?? getBmsSettings('org.gnome.shell.extensions.blur-my-shell.popup');
            if (popupSettings && typeof popupSettings.connect === 'function') {
                this._signals.connect(popupSettings, 'changed::pipeline', () => this.update_pipeline());
                this._signals.connect(popupSettings, 'changed::static-blur', () => this.change_blur_type());
            }
            const generalSettings = getBmsGeneralSettings(dashBlur);
            if (generalSettings && typeof generalSettings.connect === 'function') {
                this._signals.connect(generalSettings, 'changed::pipelines', () => this.update_pipeline());
            }
        }

        this.update_visibility();
    }

    set_blur({ background, background_group, bg_manager, pipeline, rounded_pipeline, corner_settings }) {
        this.background = background;
        this.background_group = background_group;
        this.bg_manager = bg_manager;
        this.pipeline = pipeline;
        this.rounded_pipeline = rounded_pipeline;
        this.corner_settings = corner_settings;
        this._isStatic = Boolean(rounded_pipeline);
        this._lastCornerRadius = null;

        this._bgSignals.disconnectAll();
        if (background_group && typeof background_group.connect === 'function') {
            this._bgSignals.connect(background_group, 'destroy', () => this.remove_dash_blur());
        }
    }

    get is_static() {
        if (this._isStatic !== undefined && this._isStatic !== null)
            return this._isStatic;
        if (this._isPopupType) {
            const popup = getBmsPopupSettings(this.dash_blur);
            return popup ? Boolean(popup.STATIC_BLUR) : false;
        }
        return Boolean(this.dash_blur?.is_static ?? this.settings?.dash_to_dock?.STATIC_BLUR);
    }

    schedule_update() {
        if (this._updateId) return;
        try {
            const laters = globalThis.global?.compositor?.get_laters?.();
            if (laters) {
                this._updateId = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
                    this._updateId = 0;
                    this.update_size();
                    return GLib.SOURCE_REMOVE;
                });
                return;
            }
        } catch { }
        this.update_size();
    }

    clear_pending_update() {
        if (this._updateId) {
            try {
                globalThis.global?.compositor?.get_laters?.()?.remove?.(this._updateId);
            } catch { }
            this._updateId = 0;
        }
    }

    update_visibility() {
        if (!this.background_group) return;
        let opacity = 255;
        let visible = true;
        for (const actor of [this.dash_container, this.dash, this.dash_background]) {
            if (actor) {
                opacity = Math.round(opacity * ((actor.opacity ?? 255) / 255));
                visible = visible && (actor.visible ?? true);
            }
        }
        let ancestor = (this.dash ?? this.dash_container)?.get_parent?.();
        const parent = this.background_group.get_parent?.();
        while (ancestor && ancestor !== parent) {
            opacity = Math.round(opacity * ((ancestor.opacity ?? 255) / 255));
            visible = visible && (ancestor.visible ?? true);
            ancestor = ancestor.get_parent?.();
        }
        const unblurInOverview = !this._isPopupType && Boolean(this.settings?.dash_to_dock?.UNBLUR_IN_OVERVIEW);
        const overviewVisible = Boolean(Main.overview?.visible);
        if (this.background_group.opacity !== undefined)
            this.background_group.opacity = opacity;
        if (this.background_group.visible !== undefined)
            this.background_group.visible = visible && !(unblurInOverview && overviewVisible);
    }

    update_size() {
        if (!this.background_group || !this.background) return;
        this.clear_pending_update();
        this.update_visibility();

        if (this.is_static) {
            this._update_static_size();
        } else {
            this._update_dynamic_size();
        }
        this.update_corner_radius();
    }

    _update_dynamic_size() {
        const parent = this.background_group.get_parent?.();
        if (!parent || !this.dash_background) return;

        let x = 0;
        let y = 0;
        let w = (this.dash_background.width && this.dash_background.width > 0)
            ? this.dash_background.width : (this.dash_background.get_width?.() ?? 0);
        let h = (this.dash_background.height && this.dash_background.height > 0)
            ? this.dash_background.height : (this.dash_background.get_height?.() ?? 0);

        if (this.dash_background === parent) {
            // background_group is nested directly inside the background actor (e.g. blurRegion)
            // Hardware-accelerated: x=0, y=0, w=parent.width, h=parent.height
            // No Graphene transforms or allocation flushes needed!
            w = parent.width ?? w;
            h = parent.height ?? h;
            if (typeof this.background_group.set_position === 'function') {
                this.background_group.set_position(0, 0);
            } else {
                this.background_group.x = 0;
                this.background_group.y = 0;
            }
        } else {
            let isDirectSibling = false;
            try {
                isDirectSibling = (this.dash_background.get_parent?.() === parent);
            } catch { }

            if (isDirectSibling) {
                x = this.dash_background.x ?? 0;
                y = this.dash_background.y ?? 0;
                const groupX = this.background_group.x ?? 0;
                const groupY = this.background_group.y ?? 0;
                x -= groupX;
                y -= groupY;

                if (this._isPopupType) {
                    try {
                        const pivot = this.dash_background.get_pivot_point?.();
                        if (pivot) {
                            const px = pivot[0] ?? pivot.x ?? 0.5;
                            const py = pivot[1] ?? pivot.y ?? 1.0;
                            this.background_group.set_pivot_point?.(px, py);
                        }
                        this.background_group.scale_x = this.dash_background.scale_x ?? 1;
                        this.background_group.scale_y = this.dash_background.scale_y ?? 1;
                        this.background_group.translation_x = this.dash_background.translation_x ?? 0;
                        this.background_group.translation_y = this.dash_background.translation_y ?? 0;
                    } catch { }
                }
            } else {
                if (typeof this.dash_background.get_allocation_box === 'function') {
                    try { this.dash_background.get_allocation_box(); } catch { }
                }
                if (typeof this.dash_background.apply_relative_transform_to_point === 'function') {
                    try {
                        const corners = [
                            [0, 0], [w, 0], [0, h], [w, h]
                        ].map(([px, py]) => this.dash_background.apply_relative_transform_to_point(
                            parent,
                            new Graphene.Point3D({ x: px, y: py, z: 0 })
                        ));
                        const xs = corners.map(p => (p?.x ?? p?.[0] ?? 0));
                        const ys = corners.map(p => (p?.y ?? p?.[1] ?? 0));
                        const x1 = Math.min(...xs);
                        const y1 = Math.min(...ys);
                        x = x1;
                        y = y1;
                        w = Math.max(...xs) - x1;
                        h = Math.max(...ys) - y1;
                    } catch { }
                }

                let groupX = 0, groupY = 0;
                if (typeof this.background_group.apply_relative_transform_to_point === 'function') {
                    try {
                        const pt = this.background_group.apply_relative_transform_to_point(
                            parent,
                            new Graphene.Point3D({ x: 0, y: 0, z: 0 })
                        );
                        groupX = pt?.x ?? pt?.[0] ?? 0;
                        groupY = pt?.y ?? pt?.[1] ?? 0;
                    } catch { }
                }
                x -= groupX;
                y -= groupY;
            }
        }

        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
            const last = this._lastDynamicGeom;
            if (last &&
                last.x === x &&
                last.y === y &&
                last.w === w &&
                last.h === h) {
                return;
            }
            this._lastDynamicGeom = { x, y, w, h };

            try { this.background?.remove_all_transitions?.(); } catch { }
            try { this.background_group?.remove_all_transitions?.(); } catch { }
            if (typeof this.background.set_position === 'function') {
                this.background.set_position(x, y);
            } else {
                this.background.x = x;
                this.background.y = y;
            }
            if (typeof this.background.set_size === 'function') {
                this.background.set_size(w, h);
            } else {
                this.background.width = w;
                this.background.height = h;
            }
        }
    }

    _update_static_size() {
        const monitor = Main.layoutManager?.findMonitorForActor?.(this.dash_container)
            ?? Main.layoutManager?.primaryMonitor;
        if (!monitor) return;

        if (this.current_monitor_index !== monitor.index) {
            this.current_monitor_index = monitor.index;
            this.change_blur_type();
            return;
        }

        const parent = this.background_group?.get_parent?.();
        if (!parent || !this.dash_background) return;

        try {
            const isDirectSibling = (this.dash_background.get_parent?.() === parent);
            let bg_stage_x, bg_stage_y, bg_stage_width, bg_stage_height;
            let parent_stage_x, parent_stage_y, parent_stage_width, parent_stage_height;

            if (parent === Main.uiGroup) {
                parent_stage_x = 0;
                parent_stage_y = 0;
                parent_stage_width = parent.width || (monitor.x + monitor.width);
                parent_stage_height = parent.height || (monitor.y + monitor.height);
            } else {
                [parent_stage_x, parent_stage_y] = parent.get_transformed_position?.() ?? [parent.x ?? 0, parent.y ?? 0];
                [parent_stage_width, parent_stage_height] = parent.get_transformed_size?.() ?? [parent.width ?? 0, parent.height ?? 0];
            }

            const parent_scale_x = parent.width > 0 ? parent_stage_width / parent.width : 1;
            const parent_scale_y = parent.height > 0 ? parent_stage_height / parent.height : 1;
            if (parent_scale_x <= 0 || parent_scale_y <= 0) return;

            if (this.dash_background === parent) {
                bg_stage_x = parent_stage_x;
                bg_stage_y = parent_stage_y;
                bg_stage_width = parent_stage_width;
                bg_stage_height = parent_stage_height;
            } else if (isDirectSibling) {
                const transX = (this.dash_background.translation_x ?? 0) * parent_scale_x;
                const transY = (this.dash_background.translation_y ?? 0) * parent_scale_y;
                bg_stage_x = parent_stage_x + (this.dash_background.x ?? 0) * parent_scale_x + transX;
                bg_stage_y = parent_stage_y + (this.dash_background.y ?? 0) * parent_scale_y + transY;
                bg_stage_width = ((this.dash_background.width && this.dash_background.width > 0)
                    ? this.dash_background.width : (this.dash_background.get_width?.() ?? 0)) * parent_scale_x;
                bg_stage_height = ((this.dash_background.height && this.dash_background.height > 0)
                    ? this.dash_background.height : (this.dash_background.get_height?.() ?? 0)) * parent_scale_y;
            } else {
                [bg_stage_x, bg_stage_y] = this.dash_background.get_transformed_position?.() ?? [this.dash_background.x ?? 0, this.dash_background.y ?? 0];
                [bg_stage_width, bg_stage_height] = this.dash_background.get_transformed_size?.() ?? [this.dash_background.width ?? 0, this.dash_background.height ?? 0];
            }

            const background_x = (monitor.x - parent_stage_x) / parent_scale_x;
            const background_y = (monitor.y - parent_stage_y) / parent_scale_y;

            const targetScaleX = 1 / parent_scale_x;
            const targetScaleY = 1 / parent_scale_y;

            const clip_x = Math.floor(bg_stage_x - monitor.x);
            const clip_y = Math.floor(bg_stage_y - monitor.y);
            const clip_w = Math.ceil(bg_stage_width);
            const clip_h = Math.ceil(bg_stage_height);

            if (clip_w <= 0 || clip_h <= 0) return;

            if (!Number.isFinite(background_x) || !Number.isFinite(background_y) ||
                !Number.isFinite(targetScaleX) || !Number.isFinite(targetScaleY) ||
                !Number.isFinite(clip_x) || !Number.isFinite(clip_y) ||
                !Number.isFinite(clip_w) || !Number.isFinite(clip_h)) {
                return;
            }

            const last = this._lastStaticGeom;
            if (last &&
                last.background_x === background_x &&
                last.background_y === background_y &&
                last.targetScaleX === targetScaleX &&
                last.targetScaleY === targetScaleY &&
                last.clip_x === clip_x &&
                last.clip_y === clip_y &&
                last.clip_w === clip_w &&
                last.clip_h === clip_h) {
                return;
            }

            this._lastStaticGeom = {
                background_x,
                background_y,
                targetScaleX,
                targetScaleY,
                clip_x,
                clip_y,
                clip_w,
                clip_h,
            };

            this.background.set_pivot_point?.(0, 0);
            try { this.background?.remove_all_transitions?.(); } catch { }
            try { this.background_group?.remove_all_transitions?.(); } catch { }
            this.background.scale_x = targetScaleX;
            this.background.scale_y = targetScaleY;
            this.background.x = background_x;
            this.background.y = background_y;

            this.background.set_clip?.(clip_x, clip_y, clip_w, clip_h);
        } catch { }
    }

    update_corner_radius() {
        const radius = (typeof this.dash_background?.get_dock_radius === 'function'
            ? this.dash_background.get_dock_radius()
            : (this.dash_background?._dockRadius ?? this.dash_container?._dockRadius ?? 28));
        if (this._lastCornerRadius === radius) return;
        this._lastCornerRadius = radius;
        if (this.corner_settings) {
            this.corner_settings.radius = radius;
        }
        if (this.rounded_pipeline) {
            this.rounded_pipeline.update?.();
        } else {
            this.pipeline?.set_corner_radius?.(radius);
        }
    }

    override_style() {
        this.remove_style();
    }

    remove_style() {
        const DASH_STYLES = [
            'transparent-dash', 'light-dash', 'dark-dash',
            'bms-popup-background-transparent', 'bms-popup-background-light', 'bms-popup-background-dark',
            'bms-popup-surface-transparent', 'bms-popup-surface-light', 'bms-popup-surface-dark',
        ];
        for (const actor of [this.dash, this.dash_container, this.dash_background]) {
            if (!actor) continue;
            for (const s of DASH_STYLES) {
                actor.remove_style_class_name?.(s);
            }
        }
    }

    change_blur_type() {
        if (this._isChangingBlurType) return;
        this._isChangingBlurType = true;
        try {
            this.destroy_dash();
            const target = resolveAquaDockTarget(this.dash_container);
            if (!target) return;
            const blur = addBlurForTarget(this.dash_blur, this.dash_container, target);
            if (!blur) return;
            let sibling = target.sibling ?? target.content;
            if (sibling === target.content_parent || (sibling && typeof sibling.get_parent === 'function' && sibling.get_parent() !== target.content_parent)) {
                sibling = null;
            }
            target.content_parent?.insert_child_below?.(blur.background_group, sibling);
            this.set_blur(blur);
            this.schedule_update();
        } finally {
            this._isChangingBlurType = false;
        }
    }

    update_pipeline() {
        try {
            const pipelineName = this._isPopupType
                ? (getBmsPopupSettings(this.dash_blur)?.PIPELINE ?? 'pipeline_default')
                : (this.settings?.dash_to_dock?.PIPELINE ?? 'pipeline_default');
            if (this.pipeline?.change_pipeline_to && pipelineName) {
                this.pipeline.change_pipeline_to(pipelineName);
            }
            this.rounded_pipeline?.update?.();
        } catch { }
    }

    destroy_dash() {
        this.clear_pending_update();
        this._bgSignals?.disconnectAll();

        try { this.rounded_pipeline?.destroy?.(); } catch { }
        try { this.pipeline?.destroy?.(); } catch { }
        try { this.bg_manager?.destroy?.(); } catch { }

        const bgGroup = this.background_group;
        this.background = null;
        this.background_group = null;
        this.bg_manager = null;
        this.pipeline = null;
        this.rounded_pipeline = null;
        this.corner_settings = null;
        this._lastStaticGeom = null;
        this._lastDynamicGeom = null;
        this._lastCornerRadius = null;
        this._isStatic = null;

        if (!bgGroup) return;
        try { bgGroup.destroy?.(); } catch { }
    }

    remove_dash_blur(isBmsRemove = false) {
        if (this._isRemoving) return;
        this._isRemoving = true;
        try {
            if (this.dash_container?._aquaDockSurface === this) {
                this.dash_container._aquaDockSurface = null;
            }
            this._bgSignals?.disconnectAll();
            this._signals.disconnectAll();
            this.remove_style();
            this.destroy_dash();
            if (Array.isArray(this.dash_blur?.dashes)) {
                const idx = this.dash_blur.dashes.indexOf(this);
                if (idx !== -1) {
                    this.dash_blur.dashes.splice(idx, 1);
                }
            }
            if (this.dash_container?._aquaBlurManager) {
                if (isBmsRemove) {
                    this.dash_container._aquaBlurManager.handleBmsBlurRemoved();
                } else if (this.dash_container._aquaBlurManager.bmsActive) {
                    this.dash_container._aquaBlurManager.syncBlurState();
                }
            }
        } finally {
            this._isRemoving = false;
        }
    }
}

const activeAquaContainers = new Set();
let origTryBlur = null;
let origBlurExistingDashes = null;

function tryBlurAquaDock(dashBlur, container) {
    if (!container || container._dockBlurEnabled === false) return;
    const target = resolveAquaDockTarget(container);
    if (!target) return;

    const bg = target.background;
    const w = (bg?.width && bg.width > 0) ? bg.width : (bg?.get_width?.() || (container?.width && container.width > 0 ? container.width : (container?.get_width?.() || 0)));
    const h = (bg?.height && bg.height > 0) ? bg.height : (bg?.get_height?.() || (container?.height && container.height > 0 ? container.height : (container?.get_height?.() || 0)));
    if (w <= 0 || h <= 0) {
        if (!container._aquaAllocWatch && typeof container.connect === 'function') {
            container._aquaAllocWatch = container.connect('notify::allocation', () => {
                const curW = (target.background?.width && target.background.width > 0)
                    ? target.background.width : (target.background?.get_width?.() || (container?.width && container.width > 0 ? container.width : (container?.get_width?.() || 0)));
                const curH = (target.background?.height && target.background.height > 0)
                    ? target.background.height : (target.background?.get_height?.() || (container?.height && container.height > 0 ? container.height : (container?.get_height?.() || 0)));
                if (curW > 0 && curH > 0) {
                    try { container.disconnect(container._aquaAllocWatch); } catch { }
                    container._aquaAllocWatch = null;
                    dashBlur.try_blur(container);
                }
            });
        }
        return;
    }

    if (container._aquaAllocWatch) {
        try { container.disconnect(container._aquaAllocWatch); } catch { }
        container._aquaAllocWatch = null;
    }

    dashBlur.pending_docks?.get(container)?.destroy();

    const { content: dash, content_parent: dash_box, background: dash_background } = target;

    const existing = Array.isArray(dashBlur.dashes)
        ? dashBlur.dashes.find(d => d.dash === dash || d.dash_container === container || d.dash_background === dash_background)
        : null;
    if (existing) {
        if (existing.dash_background === dash_background &&
            existing.background_group?.get_parent?.() === dash_box) {
            container._aquaDockSurface = existing;
            existing.update_size();
            existing.update_corner_radius();
            return;
        }
        existing.remove_dash_blur();
    }

    if (typeof dashBlur.add_blur !== 'function') return;

    const blur = addBlurForTarget(dashBlur, container, target);
    if (!blur) return;

    if (dash_box && typeof dash_box.insert_child_below === 'function') {
        let sibling = target.sibling ?? dash;
        if (sibling === dash_box || (sibling && typeof sibling.get_parent === 'function' && sibling.get_parent() !== dash_box)) {
            sibling = null;
        }
        dash_box.insert_child_below(blur.background_group, sibling);
    }

    const surface = new AquaDockSurface(dashBlur, container, target, blur);
    if (Array.isArray(dashBlur.dashes)) {
        dashBlur.dashes.push(surface);
    }
    container._aquaDockSurface = surface;
    surface.update_size();
    surface.update_corner_radius();
    if (container.name === 'aquaDockContainer' || container._isMainDock) {
        dashBlur.update_background?.();
    }
    if (container._aquaBlurManager && !container._aquaBlurManager.bmsActive) {
        container._aquaBlurManager.syncBlurState();
    }
}

function ensureBmsHooked() {
    const bms = globalThis.global?.blur_my_shell;
    const dashBlur = bms?._dash_to_dock_blur;
    if (!dashBlur || dashBlur._aquaDockHooked || typeof dashBlur.try_blur !== 'function') return;

    origTryBlur = dashBlur.try_blur.bind(dashBlur);
    origBlurExistingDashes = dashBlur.blur_existing_dashes?.bind(dashBlur);

    dashBlur.try_blur = function(dashContainer) {
        if (activeAquaContainers.has(dashContainer)) {
            if (dashContainer._dockBlurEnabled === false) {
                const existing = Array.isArray(dashBlur.dashes)
                    ? dashBlur.dashes.find(d =>
                        d.dash_container === dashContainer || d.dash === dashContainer || d.dash === dashContainer._dockBg)
                    : null;
                existing?.remove_dash_blur();
                dashBlur.pending_docks?.get(dashContainer)?.destroy();
                return;
            }
            return tryBlurAquaDock(dashBlur, dashContainer);
        } else if (dashContainer?._isAquaDock) {
            const existing = Array.isArray(dashBlur.dashes)
                ? dashBlur.dashes.find(d =>
                    d.dash_container === dashContainer || d.dash === dashContainer || d.dash === dashContainer._dockBg)
                : null;
            existing?.remove_dash_blur();
            dashBlur.pending_docks?.get(dashContainer)?.destroy();
            return;
        }
        return origTryBlur(dashContainer);
    };

    if (origBlurExistingDashes) {
        dashBlur.blur_existing_dashes = function() {
            origBlurExistingDashes();
            for (const container of activeAquaContainers) {
                if (container._dockBlurEnabled !== false) {
                    dashBlur.try_blur(container);
                }
            }
        };
    }

    dashBlur._aquaDockHooked = true;
}

function unhookBms() {
    const bms = globalThis.global?.blur_my_shell;
    const dashBlur = bms?._dash_to_dock_blur;
    if (dashBlur && dashBlur._aquaDockHooked) {
        if (origTryBlur) dashBlur.try_blur = origTryBlur;
        if (origBlurExistingDashes) dashBlur.blur_existing_dashes = origBlurExistingDashes;
        delete dashBlur._aquaDockHooked;
        origTryBlur = null;
        origBlurExistingDashes = null;
    }
}

export function registerBmsTarget(container, getRadius = null) {
    if (!container) return;
    activeAquaContainers.add(container);
    const bg = container._dockBg ?? container;
    if (getRadius) {
        setupBackgroundCorners(bg, getRadius);
    } else if (!bg._aquaGetRadius) {
        const radiusFn = typeof container.get_dock_radius === 'function'
            ? () => container.get_dock_radius()
            : () => (container._dockRadius ?? 28);
        setupBackgroundCorners(bg, radiusFn);
    }
    ensureBmsHooked();
    const bms = globalThis.global?.blur_my_shell;
    const dashBlur = bms?._dash_to_dock_blur;
    const isPopup = isAquaPopupTarget(container);
    const shouldBlur = dashBlur && (isPopup ? isBmsTooltipBlurActive() : dashBlur.enabled);
    if (shouldBlur && typeof dashBlur.try_blur === 'function') {
        dashBlur.try_blur(container);
    }
}

export function unregisterBmsTarget(container) {
    if (!container) return;
    if (container._aquaAllocWatch && typeof container.disconnect === 'function') {
        try { container.disconnect(container._aquaAllocWatch); } catch { }
        container._aquaAllocWatch = null;
    }
    activeAquaContainers.delete(container);
    try {
        const bms = globalThis.global?.blur_my_shell;
        const dashBlur = bms?._dash_to_dock_blur;
        if (dashBlur && Array.isArray(dashBlur.dashes)) {
            for (const d of [...dashBlur.dashes]) {
                if (d.dash_container === container || d.dash === container || d.dash === container._dockBg) {
                    d.remove_dash_blur?.();
                }
            }
        }
        dashBlur?.pending_docks?.get(container)?.destroy();
    } catch { }
    if (activeAquaContainers.size === 0) {
        unhookBms();
    }
}

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
        this._bmsDashSettings = null;
        this._bmsSettings = null;

        if (this._container) {
            this._container._aquaBlurManager = this;
        }

        setupBackgroundCorners(this._bg, () => (this._getConfig?.()?.dockRadius ?? this._bg?._dockRadius ?? 28));

        this._initBmsSettings();

        if (Main.extensionManager) {
            this._signals.connect(
                Main.extensionManager,
                'extension-state-changed',
                () => {
                    this._initBmsSettings();
                    this.syncBlurState();
                }
            );
        }

        this.syncBlurState();
    }

    _initBmsSettings() {
        if (!this._bmsDashSettings) {
            this._bmsDashSettings = getBmsSettings('org.gnome.shell.extensions.blur-my-shell.dash-to-dock');
            if (this._bmsDashSettings) {
                this._signals.connect(this._bmsDashSettings, 'changed', (settings, key) => {
                    this._onBmsDashSettingsChanged(settings, key);
                });
            }
        }
        if (!this._bmsSettings) {
            this._bmsSettings = getBmsSettings('org.gnome.shell.extensions.blur-my-shell');
            if (this._bmsSettings) {
                this._signals.connect(this._bmsSettings, 'changed', (settings, key) => {
                    this._onBmsSettingsChanged(settings, key);
                });
            }
        }
    }

    _onBmsDashSettingsChanged(settings, key) {
        if (!key || key === 'blur') {
            this.syncBlurState();
        } else if (key === 'static-blur') {
            const surface = this._container?._aquaDockSurface;
            if (surface && typeof surface.change_blur_type === 'function') {
                const bms = globalThis.global?.blur_my_shell;
                const dashBlur = bms?._dash_to_dock_blur;
                if (dashBlur) {
                    try {
                        dashBlur.is_static = settings.get_boolean('static-blur');
                    } catch { }
                }
                surface.change_blur_type();
            }
        } else if (key === 'pipeline') {
            this._container?._aquaDockSurface?.update_pipeline?.();
        }
    }

    _onBmsSettingsChanged(settings, key) {
        if (!key || key === 'pipelines') {
            this._container?._aquaDockSurface?.update_pipeline?.();
        }
    }

    get bmsActive() {
        return this._bmsActive;
    }

    handleBmsBlurRemoved() {
        if (!this._bmsActive) return;
        this._bmsActive = false;
        this._removeBmsBlur();
        this._onBlurStateChanged?.(false);
    }

    _removeBmsBlur() {
        this._bmsRemoveConnected = false;
        if (this._container) {
            unregisterBmsTarget(this._container);
        }
        try {
            const bms = globalThis.global?.blur_my_shell;
            const dashes = bms?._dash_to_dock_blur?.dashes;
            if (Array.isArray(dashes)) {
                for (const d of [...dashes]) {
                    if (d.dash_container === this._container || d.dash === this._bg || d.dash === this._container) {
                        d.remove_dash_blur?.();
                    }
                }
            }
            bms?._dash_to_dock_blur?.pending_docks?.get(this._container)?.destroy();
        } catch { }
        try {
            for (const cls of ['transparent-dash', 'light-dash', 'dark-dash']) {
                this._bg?.remove_style_class_name?.(cls);
                this._container?.remove_style_class_name?.(cls);
                this._handle?.remove_style_class_name?.(cls);
            }
        } catch { }
    }

    syncBlurState() {
        this._initBmsSettings();
        const cfg = this._getConfig?.() ?? {};
        const blurEnabled = Boolean(cfg.blurEffect);
        let bmsActive = blurEnabled && isBmsDockBlurActive();
        if (bmsActive && this._bmsDashSettings) {
            try {
                if (!this._bmsDashSettings.get_boolean('blur'))
                    bmsActive = false;
            } catch { }
        }
        const prevBms = this._bmsActive;
        this._bmsActive = bmsActive;

        if (this._container)
            this._container._dockBlurEnabled = blurEnabled;

        if (this._blurRegion)
            this._blurRegion.hide();
        if (this._handleBlurRegion)
            this._handleBlurRegion.hide();

        if (!blurEnabled || !bmsActive) {
            this._removeBmsBlur();
            if (prevBms !== bmsActive)
                this._onBlurStateChanged?.(false);
            return;
        }

        registerBmsTarget(this._container, () => (this._getConfig?.()?.dockRadius ?? this._bg?._dockRadius ?? 28));

        const bms = globalThis.global?.blur_my_shell;
        const dashBlur = bms?._dash_to_dock_blur;
        if (dashBlur && typeof dashBlur.connect === 'function' && !this._bmsRemoveConnected) {
            this._bmsRemoveConnected = true;
            this._signals.connect(dashBlur, 'remove-dashes', () => {
                this._bmsRemoveConnected = false;
                this.handleBmsBlurRemoved();
            });
        }

        try {
            dashBlur?.queue_discovery?.();
        } catch { }

        if (prevBms !== bmsActive)
            this._onBlurStateChanged?.(true);
    }

    update(cfg) {
        this.syncBlurState();
    }

    destroy() {
        this._signals.disconnectAll();
        this._bmsDashSettings = null;
        this._bmsSettings = null;
        if (this._container?._aquaAllocWatch && typeof this._container.disconnect === 'function') {
            try { this._container.disconnect(this._container._aquaAllocWatch); } catch { }
            this._container._aquaAllocWatch = null;
        }
        this._removeBmsBlur();
        if (this._container) {
            if (this._container._aquaBlurManager === this)
                delete this._container._aquaBlurManager;
            this._container._dockBlurEnabled = false;
        }
        this._container = null;
        this._bg = null;
        this._blurRegion = null;
        this._handle = null;
        this._handleBlurRegion = null;
        this._onBlurStateChanged = null;
    }
}
