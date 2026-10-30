// Downloads grid and list view.
// Stack background blur disabled per user directive.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { animationsEnabled, clamp, launchUri } from '../core/utils.js';
import { _, format, ngettext } from '../core/i18n.js';
import { getCachedThemedIcon } from '../services/fileService.js';
import { iconForInfo } from './fileEnumerator.js';
import { FileItemMenu } from './fileItemMenu.js';
import { STACK_CLEARANCE, sideFanX } from './fanGeometry.js';
import { getRowStyles } from './tileStyle.js';
import { SelectionModel } from './keyboardNav.js';
import { buildPlaceIcon } from './placeIcon.js';
import { applyAlpha } from '../dock/dockLayout.js';
import { isBmsStackBlurActive, registerBmsTarget, unregisterBmsTarget, setupBackgroundCorners } from '../dock/dockBlur.js';
import { ActorPool, stopSubtreeTransitions } from './actorPool.js';

const GRID_COLS = 2;

export class PanelView {
    // opts: { folder, files, cfg, mon, origin:{x,y}, close, pool }
    constructor(opts) {
        Object.assign(this, opts);
        this.pool = opts.pool ?? null;
        this._fallbackPool = null;
        this._view = opts.cfg.downloadsView;   // 'grid' | 'list'
        this._model = new SelectionModel('aqua-dl-row-sel');
        this._actor = null;
        this._cols = this._view === 'grid' ? GRID_COLS : 1;
        this._reduce = false;
        this._fileMenu = new FileItemMenu(opts.mon, opts.cfg);
        this._blurRegion = null;
        this._pivot = null;
        this._trans = null;
    }

    get actor() { return this._actor; }
    get blurRegion() { return this._blurRegion; }
    get blurRegions() { return this._blurRegion ? [this._blurRegion] : []; }

    build() {
        const { cfg, mon, files, folder } = this;
        this._reduce = !animationsEnabled();
        const view = this._view;
        const panelW = view === 'grid' ? 360 : 340;
        const boxPadH = view === 'grid' ? 24 : 20;
        const colGap = view === 'grid' ? 12 : 0;
        const contentW = panelW - boxPadH;
        const tileW = view === 'grid'
            ? Math.floor((contentW - colGap * (GRID_COLS - 1)) / GRID_COLS) : contentW;

        const thumbSz = clamp(Math.round(cfg.iconSize * 0.88), 44, 96);
        const thumbH = Math.round(thumbSz * 0.72);
        const tileH = Math.max(thumbH, 32) + 20;
        const rowSpacing = 6;
        // Preserve the small-icon compensation while adding a little more
        // air between the folder icon and the opened panel.
        const panelGap = Math.max(40 - tileH / 2, 2) + STACK_CLEARANCE + 6;

        const originX = this.origin.x, ay = this.origin.y;
        const headerH = 60;
        const availH = ay - mon.y - 8 - panelGap - headerH;
        const maxRowsFit = Math.max(1, Math.floor(availH / (tileH + rowSpacing)));
        const maxTilesFit = view === 'grid' ? maxRowsFit * GRID_COLS : maxRowsFit;
        const userMax = Math.min(11, Math.max(3, cfg.downloadsMaxFiles ?? 9));
        const actualMax = Math.min(userMax, maxTilesFit);
        const shown = files.slice(0, actualMax);
        const more = Math.max(0, (this.totalFiles ?? files.length) - shown.length);
        const firstHidden = more > 0 ? files[actualMax] : null;

        const tiles = shown.map(info => this._row(info, view, thumbSz));
        if (more > 0) tiles.push(this._moreRow(more, view, thumbSz, firstHidden));

        const panel = new St.Widget({
            name: 'aquaDownloadsPanel',
            style_class: `aqua-dl-panel aqua-dl-${view}`,
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            can_focus: true,
        });
        panel.name = 'aquaDownloadsPanel';
        this._actor = panel;
        if (cfg.highContrast) panel.add_style_class_name('aqua-high-contrast');

        const content = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });
        content.add_child(this._header(folder, this.totalFiles ?? files.length));
        content.add_child(new St.Widget({ style_class: 'aqua-dl-divider' }));

        let box;
        if (view === 'grid') {
            box = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'aqua-dl-filebox aqua-dl-filebox-grid',
                x_expand: true,
            });
            box.get_layout_manager().set_spacing(rowSpacing);
            for (let i = 0; i < tiles.length; i += GRID_COLS) {
                const r = new St.BoxLayout({ style_class: 'aqua-dl-grid-row', x_expand: true });
                r.get_layout_manager().set_spacing(colGap);
                for (let j = i; j < Math.min(i + GRID_COLS, tiles.length); j++) {
                    tiles[j].set_width(tileW);
                    r.add_child(tiles[j]);
                }
                box.add_child(r);
            }
        } else {
            box = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'aqua-dl-filebox',
                x_expand: true,
            });
            box.get_layout_manager().set_spacing(rowSpacing);
            for (const t of tiles) box.add_child(t);
        }
        content.add_child(box);

        panel.set_width(panelW);
        const a = clamp(cfg.bgOpacity ?? 0.8, 0.1, 1.0).toFixed(2);
        const radius = cfg.downloadsBorderRadius ?? clamp((cfg.dockRadius ?? 16) + 2, 0, 26);
        const bw = cfg.highContrast ? Math.max(2, cfg.downloadsBorderWidth ?? 1)
            : (cfg.downloadsBorderWidth ?? cfg.borderWidth ?? 1);
        const bc = cfg.highContrast ? '#ffffff'
            : (cfg.downloadsBorderColor ?? cfg.borderColor ?? 'rgba(255,255,255,0.16)');
        const border = bw > 0 ? `${bw}px solid ${bc}` : 'none';

        // Frosted glass background blur enabled for Grid & List views (matching dock pill)
        const blurActive = isBmsStackBlurActive(cfg);
        this._blurActive = blurActive;

        const normalFill = cfg.downloadsPillColor ?? (cfg.pillColor ? applyAlpha(cfg.pillColor, clamp(cfg.bgOpacity ?? 0.8, 0.1, 1.0)) : `rgba(28,28,32,${a})`);
        const fill = cfg.highContrast ? 'rgba(0,0,0,0.96)'
            : (blurActive ? 'transparent' : normalFill);
        panel.set_style(`border-radius: ${radius}px; background-color: ${fill}; border: ${border};`);
        panel.opacity = 0;

        let blurRegion = null;
        if (blurActive) {
            blurRegion = new St.Widget({
                name: 'aquaDownloadsPanelBlurRegion',
                style_class: 'aqua-blur-region',
                reactive: false,
                x_expand: true,
                y_expand: true,
            });
            blurRegion._isAquaDock = true;
            blurRegion._blurType = 'popup';
            blurRegion._dockRadius = radius;
            blurRegion.get_dock_radius = () => radius;
            blurRegion.set_style(`border-radius: ${radius}px;`);
            setupBackgroundCorners(blurRegion, () => radius);
            panel.add_child(blurRegion);
        }
        this._blurRegion = blurRegion;

        panel.add_child(content);

        panel._isAquaDock = true;
        panel._blurType = 'popup';
        panel._dockBlurEnabled = blurActive;
        panel._dockRadius = radius;
        panel.get_dock_radius = () => radius;
        panel._dockBg = panel;
        panel._dockContent = panel;
        panel._dockContentParent = panel;
        if (blurRegion) {
            panel._blurRegion = blurRegion;
            panel._dockBlurRegion = blurRegion;
        }
        setupBackgroundCorners(panel, () => radius);

        const dockContainer = this.dockContainer;
        if (dockContainer && typeof Main.uiGroup?.insert_child_below === 'function') {
            Main.uiGroup.insert_child_below(panel, dockContainer);
        } else if (Main.uiGroup?.add_child) {
            Main.uiGroup.add_child(panel);
        }

        panel.connect('destroy', () => {
            unregisterBmsTarget(panel);
        });

        this._fileMenu.bind(panel);
        const [, natH] = content.get_preferred_height(panelW);
        const sideX = sideFanX(cfg.position, originX, cfg.dockH, panelW);
        const targetX = sideX ?? originX - panelW / 2;
        const targetY = cfg.vertical ? ay - natH / 2 : ay - natH - panelGap;
        const px = clamp(Math.round(targetX), mon.x + 8, mon.x + mon.width - panelW - 8);
        const py = clamp(Math.round(targetY), mon.y + 8, mon.y + mon.height - natH - 8);
        panel.set_position(px, py);
        panel.set_size(panelW, natH);

        // Dynamic anchor-relative pivot point so stack springs directly out from clicked icon
        let pivotX = 0.5;
        let pivotY = 1.0;
        let transX = 0;
        let transY = 18;

        if (cfg.position === 'LEFT') {
            pivotX = 0.0;
            pivotY = clamp((ay - py) / Math.max(1, natH), 0.05, 0.95);
            transX = -18;
            transY = 0;
        } else if (cfg.position === 'RIGHT') {
            pivotX = 1.0;
            pivotY = clamp((ay - py) / Math.max(1, natH), 0.05, 0.95);
            transX = 18;
            transY = 0;
        } else if (cfg.position === 'TOP') {
            pivotX = clamp((originX - px) / Math.max(1, panelW), 0.05, 0.95);
            pivotY = 0.0;
            transX = 0;
            transY = -18;
        } else {
            pivotX = clamp((originX - px) / Math.max(1, panelW), 0.05, 0.95);
            pivotY = 1.0;
            transX = 0;
            transY = 18;
        }

        panel.set_pivot_point(pivotX, pivotY);
        this._pivot = { x: pivotX, y: pivotY };
        this._trans = { x: transX, y: transY };

        if (blurActive) {
            registerBmsTarget(panel, () => radius);
        }

        this._model.setRows(tiles);
        this._animateOpen(panel, tiles, view);
        return panel;
    }

    _getPool() {
        return this.pool ?? (this._fallbackPool ??= new ActorPool(16));
    }

    _header(folder, count) {
        const header = new St.BoxLayout({ style_class: 'aqua-dl-header' });
        header.get_layout_manager().set_spacing(10);
        header.add_child(buildPlaceIcon(
            this.gicon ?? getCachedThemedIcon('folder-download'),
            22,
            this.cfg.placeIconSourceSize,
            'aqua-dl-hdr-icon'));
        const titleBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const title = new St.Label({
            text: this.title ?? _('Downloads'),
            style_class: 'aqua-dl-hdr-label',
        });
        title.set_style(`font-size: ${(12.5 * (this.cfg.interfaceTextScale ?? 1)).toFixed(2)}pt;`);
        titleBox.add_child(title);
        const countLabel = new St.Label({
            text: format(ngettext('%d item', '%d items', count), count),
            style_class: 'aqua-dl-hdr-sub',
        });
        countLabel.set_style(`font-size: ${(8.5 * (this.cfg.interfaceTextScale ?? 1)).toFixed(2)}pt;`);
        titleBox.add_child(countLabel);
        header.add_child(titleBox);
        const openBtn = new St.Button({ label: _('Open Folder'), style_class: 'aqua-dl-open-btn' });
        openBtn.set_style(
            `font-size: ${(9.5 * (this.cfg.interfaceTextScale ?? 1)).toFixed(2)}pt;`);
        openBtn.connect('clicked', () => { launchUri(folder.get_uri()); this.close(); });
        header.add_child(openBtn);
        return header;
    }

    _row(info, view, thumbSz) {
        const card = this._getPool().acquirePanelItem(view);
        const { row, box, labelPill, label, gap, thumb, icon } = card;
        const file = this.folder.get_child(info.get_name());
        const displayName = info.get_display_name();
        const thumbW = thumbSz, thumbH = Math.round(thumbSz * 0.72);
        const thumbRadius = Math.round(Math.min(thumbW, thumbH) * 0.22);

        thumb.set_size(thumbW, thumbH);
        thumb.width = thumbW;
        thumb.height = thumbH;
        const iconSize = Math.round(Math.min(thumbW, thumbH) * 0.78);
        const gicon = iconForInfo(info);
        if (icon && !icon.is_destroyed?.()) {
            icon.gicon = gicon;
            icon.icon_size = iconSize;
            icon.set_size(iconSize, iconSize);
            if (thumb.get_child() !== icon) thumb.set_child(icon);
        } else {
            const newIcon = new St.Icon({
                gicon,
                icon_size: iconSize,
                style_class: 'aqua-dl-fan-icon',
            });
            newIcon.set_size(iconSize, iconSize);
            row._icon = newIcon;
            thumb.set_child(newIcon);
        }

        label.text = displayName;
        row.accessible_name = displayName;
        labelPill.set_height(thumbH);
        labelPill.height = thumbH;

        const rowStyles = getRowStyles(this.cfg, thumbRadius, '0 12px', this._blurActive, thumbH, labelPill);
        if (row._appliedStyleKey !== rowStyles.key) {
            row._appliedStyleKey = rowStyles.key;
            label.set_style(rowStyles.normal.label);
            labelPill.set_style(rowStyles.normal.pill);
            thumb.set_style(rowStyles.normal.thumb);
            row._appliedHover = false;
        }

        row._updatePillStyle = hover => {
            if (row._appliedHover === hover) return;
            row._appliedHover = hover;
            const s = hover ? rowStyles.hover : rowStyles.normal;
            labelPill.set_style(s.pill);
            thumb.set_style(s.thumb);
        };
        row._updatePillStyle(false);

        row._activate = () => { launchUri(file.get_uri()); this.close(); };
        row._openFileMenu = () => { this._fileMenu.openFor(labelPill, file); };
        row._onHover = () => {
            const idx = this._model.rows.indexOf(row);
            if (idx >= 0) this._model.select(idx);
        };

        return row;
    }

    _moreRow(more, view, thumbSz, firstHidden) {
        const card = this._getPool().acquirePanelItem(view);
        const { row, box, labelPill, label, gap, thumb, icon } = card;
        row.add_style_class_name('aqua-dl-row-more');
        const thumbW = thumbSz, thumbH = Math.round(thumbSz * 0.72);
        const thumbRadius = Math.round(Math.min(thumbW, thumbH) * 0.22);

        thumb.set_size(thumbW, thumbH);
        thumb.width = thumbW;
        thumb.height = thumbH;
        const iconSize = Math.round(Math.min(thumbW, thumbH) * 0.72);
        const gicon = firstHidden ? iconForInfo(firstHidden) : getCachedThemedIcon('folder-download');
        if (icon && !icon.is_destroyed?.()) {
            icon.gicon = gicon;
            icon.icon_size = iconSize;
            icon.set_size(iconSize, iconSize);
            if (thumb.get_child() !== icon) thumb.set_child(icon);
        } else {
            const newIcon = new St.Icon({
                gicon,
                icon_size: iconSize,
                style_class: 'aqua-dl-fan-icon',
            });
            newIcon.set_size(iconSize, iconSize);
            row._icon = newIcon;
            thumb.set_child(newIcon);
        }

        const moreText = format(ngettext('+%d more item in Files', '+%d more items in Files', more), more);
        label.text = moreText;
        row.accessible_name = moreText;
        label.add_style_class_name('aqua-dl-fan-more');
        labelPill.set_height(thumbH);
        labelPill.height = thumbH;

        const rowStyles = getRowStyles(this.cfg, thumbRadius, '0 12px', this._blurActive, thumbH, labelPill);
        if (row._appliedStyleKey !== rowStyles.key) {
            row._appliedStyleKey = rowStyles.key;
            label.set_style(rowStyles.normal.label);
            labelPill.set_style(rowStyles.normal.pill);
            thumb.set_style(rowStyles.normal.thumb);
            row._appliedHover = false;
        }

        row._updatePillStyle = hover => {
            if (row._appliedHover === hover) return;
            row._appliedHover = hover;
            const s = hover ? rowStyles.hover : rowStyles.normal;
            labelPill.set_style(s.pill);
            thumb.set_style(s.thumb);
        };
        row._updatePillStyle(false);

        row._activate = () => { launchUri(this.folder.get_uri()); this.close(); };
        row._openFileMenu = null;
        row._onHover = () => {
            const idx = this._model.rows.indexOf(row);
            if (idx >= 0) this._model.select(idx);
        };

        return row;
    }

    _animateOpen(panel, tiles, _view) {
        const blurEnabled = Boolean(this._blurActive);
        if (this._reduce) {
            panel.opacity = 255;
            panel.set_scale(1, 1);
            panel.translation_x = 0;
            panel.translation_y = 0;
            if (this._blurRegion && blurEnabled) {
                this._blurRegion.opacity = 255;
                this._blurRegion.set_scale(1, 1);
                this._blurRegion.translation_x = 0;
                this._blurRegion.translation_y = 0;
            }
            for (const tile of tiles) {
                tile.opacity = 255;
                tile.translation_y = 0;
            }
            return;
        }

        const initScale = 0.80;
        const transX = this._trans?.x ?? 0;
        const transY = this._trans?.y ?? 18;

        panel.set_scale(initScale, initScale);
        panel.translation_x = transX;
        panel.translation_y = transY;
        panel.opacity = 0;

        panel.ease({
            scale_x: 1,
            scale_y: 1,
            translation_x: 0,
            translation_y: 0,
            duration: 250,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
        panel.ease({
            opacity: 255,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        for (const tile of tiles) {
            tile.opacity = 255;
            tile.translation_y = 0;
        }
    }

    handleKey(ev) {
        const sym = ev.get_key_symbol();
        const tiles = this._model.rows;
        if (sym === Clutter.KEY_Escape) { this.close(); return Clutter.EVENT_STOP; }
        if (!tiles.length) return Clutter.EVENT_PROPAGATE;
        const cols = this._cols, i = this._model.index, last = tiles.length - 1;
        const menuKey = sym === Clutter.KEY_Menu ||
            (sym === Clutter.KEY_F10 &&
                ((ev.get_state?.() ?? 0) & Clutter.ModifierType.SHIFT_MASK));
        if (menuKey && this._model.current?._openFileMenu) {
            this._model.current._openFileMenu();
            return Clutter.EVENT_STOP;
        }
        if (sym === Clutter.KEY_Up) { this._model.select(i < 0 ? 0 : Math.max(0, i - cols)); return Clutter.EVENT_STOP; }
        if (sym === Clutter.KEY_Down) { this._model.select(i < 0 ? 0 : Math.min(last, i + cols)); return Clutter.EVENT_STOP; }
        if (cols > 1 && sym === Clutter.KEY_Left) { this._model.select(i < 0 ? 0 : Math.max(0, i - 1)); return Clutter.EVENT_STOP; }
        if (cols > 1 && sym === Clutter.KEY_Right) { this._model.select(i < 0 ? 0 : Math.min(last, i + 1)); return Clutter.EVENT_STOP; }
        if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter || sym === Clutter.KEY_space) {
            this._model.activateCurrent();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    settleAnimations() {
        const actor = this._actor;
        if (!actor) return;
        try {
            stopSubtreeTransitions(actor);
            actor.opacity = 255;
            actor.translation_x = 0;
            actor.translation_y = 0;
            actor.set_scale(1, 1);
        } catch { /* intentionally ignored: stack view row or blur actor may already be destroyed */ }
        for (const tile of this._model.rows) {
            try {
                stopSubtreeTransitions(tile);
                tile.opacity = 255;
                tile.translation_y = 0;
            } catch { /* intentionally ignored: stack view row or blur actor may already be destroyed */ }
        }
    }

    /**
     * Detach all rows from the view container and release them to the pool.
     * Prevents Clutter from recursively destroying pooled actors when view.actor.destroy() runs.
     */
    releaseRows() {
        const pool = this.pool ?? this._fallbackPool;
        if (!pool) return;
        const rows = this._model?.rows ?? [];
        for (const row of rows) {
            try {
                stopSubtreeTransitions(row);
                const parent = row.get_parent?.();
                if (parent) parent.remove_child(row);
            } catch { /* intentionally ignored: stack view row or blur actor may already be destroyed */ }
            pool.releasePanelItem(row);
        }
        this._model?.setRows([]);
    }

    animateClose(onDone) {
        const actor = this._actor;
        if (!actor) { onDone(); return; }
        stopSubtreeTransitions(actor);
        if (this._reduce || !animationsEnabled()) {
            this.releaseRows();
            onDone();
            return;
        }
        const finish = () => {
            if (this._isClosed) return;
            this._isClosed = true;
            this.releaseRows();
            onDone();
        };

        const targetScale = 0.80;
        const transX = this._trans?.x ?? 0;
        const transY = this._trans?.y ?? 18;
        const closeDuration = 150;
        const closeMode = Clutter.AnimationMode.EASE_IN_CUBIC;

        actor.ease({
            opacity: 0,
            scale_x: targetScale,
            scale_y: targetScale,
            translation_x: transX,
            translation_y: transY,
            duration: closeDuration,
            mode: closeMode,
            onComplete: finish,
        });
    }
}
