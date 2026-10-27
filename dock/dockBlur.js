// Dock blur coordinator for Aqua Dock Pro.
// Integrates with Blur my Shell pipelines at runtime via in-memory hooks.

import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { SignalGroup } from '../core/utils.js';

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
        container.get_name?.() === 'aquaDockContainer' ||
        container.get_name?.() === 'aquaDownloadsPanel' ||
        container.get_name?.() === 'aquaDownloadsFan' ||
        container.get_name?.() === 'aquaDownloadsFanItem'
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
        this._signals = new SignalGroup();
        this._updateId = 0;
        this.current_monitor_index = null;

        this.set_blur(blur);

        const schedule = () => this.schedule_update();

        const GEOMETRY_SIGNALS = [
            'notify::allocation',
            'notify::position',
            'notify::size',
            'notify::translation-x',
            'notify::translation-y',
            'notify::scale-x',
            'notify::scale-y',
            'notify::opacity',
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
        if (parent && parent !== this.dash_container && parent !== this.dash && typeof parent.connect === 'function') {
            for (const sig of GEOMETRY_SIGNALS) {
                this._signals.connect(parent, sig, schedule);
            }
        }

        if (this.dash && typeof this.dash.connect === 'function')
            this._signals.connect(this.dash, 'destroy', () => this.remove_dash_blur());
        if (this.dash_container && this.dash_container !== this.dash && typeof this.dash_container.connect === 'function')
            this._signals.connect(this.dash_container, 'destroy', () => this.remove_dash_blur());

        if (dashBlur && typeof dashBlur.connect === 'function') {
            this._signals.connect(dashBlur, 'remove-dashes', () => this.remove_dash_blur(true));
            this._signals.connect(dashBlur, 'override-style', () => this.override_style());
            this._signals.connect(dashBlur, 'remove-style', () => this.remove_style());
            this._signals.connect(dashBlur, 'show', () => this.update_visibility());
            this._signals.connect(dashBlur, 'hide', () => this.update_visibility());
            this._signals.connect(dashBlur, 'update-size', schedule);
            this._signals.connect(dashBlur, 'change-blur-type', () => this.change_blur_type());
            this._signals.connect(dashBlur, 'update-pipeline', () => this.update_pipeline());
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

        if (background_group && typeof background_group.connect === 'function') {
            this._signals.connect(background_group, 'notify::allocation', () => this.schedule_update());
            this._signals.connect(background_group, 'destroy', () => this.remove_dash_blur());
        }
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
        let ancestor = this.dash;
        const parent = this.background_group.get_parent?.();
        while (ancestor && ancestor !== parent) {
            opacity = Math.round(opacity * ((ancestor.opacity ?? 255) / 255));
            visible = visible && (ancestor.visible ?? true);
            ancestor = ancestor.get_parent?.();
        }
        const unblurInOverview = Boolean(this.settings?.dash_to_dock?.UNBLUR_IN_OVERVIEW);
        const overviewVisible = Boolean(Main.overview?.visible);
        if (this.background_group.opacity !== undefined)
            this.background_group.opacity = opacity;
        if (this.background_group.visible !== undefined)
            this.background_group.visible = visible && !(unblurInOverview && overviewVisible);
    }

    update_size() {
        if (!this.background_group || !this.background) return;
        this.update_visibility();

        if (this.dash_blur?.is_static) {
            this._update_static_size();
        } else {
            this._update_dynamic_size();
        }
        this.update_corner_radius();
    }

    _update_dynamic_size() {
        const parent = this.background_group.get_parent?.();
        if (!parent || !this.dash_background) return;

        let x = this.dash_background.x ?? 0;
        let y = this.dash_background.y ?? 0;
        let w = this.dash_background.width ?? 0;
        let h = this.dash_background.height ?? 0;

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

        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
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

        const parent = this.background_group.get_parent?.();
        if (!parent || !this.dash_background) return;

        try {
            const [parent_stage_x, parent_stage_y] = parent.get_transformed_position?.() ?? [0, 0];
            const [parent_stage_width, parent_stage_height] = parent.get_transformed_size?.() ?? [parent.width, parent.height];
            const [bg_stage_x, bg_stage_y] = this.dash_background.get_transformed_position?.() ?? [this.dash_background.x, this.dash_background.y];
            const [bg_stage_width, bg_stage_height] = this.dash_background.get_transformed_size?.() ?? [this.dash_background.width, this.dash_background.height];

            const parent_scale_x = parent.width > 0 ? parent_stage_width / parent.width : 1;
            const parent_scale_y = parent.height > 0 ? parent_stage_height / parent.height : 1;
            if (parent_scale_x <= 0 || parent_scale_y <= 0) return;

            const background_x = (monitor.x - parent_stage_x) / parent_scale_x;
            const background_y = (monitor.y - parent_stage_y) / parent_scale_y;

            const clip_x = Math.floor(bg_stage_x - monitor.x);
            const clip_y = Math.floor(bg_stage_y - monitor.y);
            const clip_w = Math.ceil(bg_stage_width);
            const clip_h = Math.ceil(bg_stage_height);

            this.background.set_pivot_point?.(0, 0);
            this.background.scale_x = 1 / parent_scale_x;
            this.background.scale_y = 1 / parent_scale_y;
            this.background.x = background_x;
            this.background.y = background_y;

            this.background.set_clip?.(clip_x, clip_y, clip_w, clip_h);
        } catch { }
    }

    update_corner_radius() {
        const radius = (typeof this.dash_background?.get_dock_radius === 'function'
            ? this.dash_background.get_dock_radius()
            : (this.dash_background?._dockRadius ?? this.dash_container?._dockRadius ?? 28));
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
        const DASH_STYLES = ['transparent-dash', 'light-dash', 'dark-dash'];
        const styleIndex = this.settings?.dash_to_dock?.STYLE_DASH_TO_DOCK ?? 0;
        const style = DASH_STYLES[styleIndex] ?? DASH_STYLES[0];
        if (style) {
            for (const actor of [this.dash, this.dash_container, this.dash_background]) {
                actor?.add_style_class_name?.(style);
            }
        }
    }

    remove_style() {
        const DASH_STYLES = ['transparent-dash', 'light-dash', 'dark-dash'];
        for (const actor of [this.dash, this.dash_container, this.dash_background]) {
            if (!actor) continue;
            for (const s of DASH_STYLES) {
                actor.remove_style_class_name?.(s);
            }
        }
    }

    change_blur_type() {
        this.destroy_dash();
        const target = resolveAquaDockTarget(this.dash_container);
        if (!target) return;
        const blur = this.dash_blur?.add_blur?.(this.dash_container, target);
        if (!blur) return;
        let sibling = target.sibling ?? target.content;
        if (sibling && typeof sibling.get_parent === 'function' && sibling.get_parent() !== target.content_parent) {
            sibling = null;
        }
        target.content_parent?.insert_child_below?.(blur.background_group, sibling);
        this.set_blur(blur);
        this.schedule_update();
    }

    update_pipeline() {
        try {
            if (this.pipeline?.change_pipeline_to && this.settings?.dash_to_dock?.PIPELINE) {
                this.pipeline.change_pipeline_to(this.settings.dash_to_dock.PIPELINE);
            }
            this.rounded_pipeline?.update?.();
        } catch { }
    }

    destroy_dash() {
        this.clear_pending_update();
        const bgGroup = this.background_group;
        this.background = null;
        this.background_group = null;
        this.bg_manager = null;
        this.pipeline = null;
        this.rounded_pipeline = null;
        this.corner_settings = null;

        if (!bgGroup) return;
        try { this.rounded_pipeline?.destroy?.(); } catch { }
        try { this.pipeline?.destroy?.(); } catch { }
        try { this.bg_manager?.destroy?.(); } catch { }
        try { bgGroup.destroy?.(); } catch { }
    }

    remove_dash_blur(isBmsRemove = false) {
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
    const w = (bg?.width && bg.width > 0) ? bg.width : (container?.width ?? 0);
    const h = (bg?.height && bg.height > 0) ? bg.height : (container?.height ?? 0);
    if (w <= 0 || h <= 0) {
        if (!container._aquaAllocWatch && typeof container.connect === 'function') {
            container._aquaAllocWatch = container.connect('notify::allocation', () => {
                const curW = (target.background?.width && target.background.width > 0)
                    ? target.background.width : (container?.width ?? 0);
                const curH = (target.background?.height && target.background.height > 0)
                    ? target.background.height : (container?.height ?? 0);
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
            return;
        }
        existing.remove_dash_blur();
    }

    if (typeof dashBlur.add_blur !== 'function') return;

    const blur = dashBlur.add_blur(container, target);
    if (!blur) return;

    if (dash_box && typeof dash_box.insert_child_below === 'function') {
        dash_box.insert_child_below(blur.background_group, target.sibling ?? dash);
    }

    const surface = new AquaDockSurface(dashBlur, container, target, blur);
    if (Array.isArray(dashBlur.dashes)) {
        dashBlur.dashes.push(surface);
    }
    surface.schedule_update();
    dashBlur.update_background?.();
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
    if (dashBlur && dashBlur.enabled && typeof dashBlur.try_blur === 'function') {
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

        if (this._container) {
            this._container._aquaBlurManager = this;
        }

        setupBackgroundCorners(this._bg, () => (this._getConfig?.()?.dockRadius ?? this._bg?._dockRadius ?? 28));

        if (Main.extensionManager) {
            this._signals.connect(
                Main.extensionManager,
                'extension-state-changed',
                () => this.syncBlurState()
            );
        }

        this.syncBlurState();
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
        const cfg = this._getConfig?.() ?? {};
        const blurEnabled = Boolean(cfg.blurEffect);
        const bmsActive = blurEnabled && isBmsDockBlurActive();
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
