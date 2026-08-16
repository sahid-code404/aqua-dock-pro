// Downloads grid and list view.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { animationsEnabled, clamp, launchUri } from '../core/utils.js';
import { _, format, ngettext } from '../core/i18n.js';
import { iconForInfo } from './fileEnumerator.js';
import { FileItemMenu } from './fileItemMenu.js';
import { STACK_CLEARANCE, sideFanX } from './fanGeometry.js';
import { applyTileStyle } from './tileStyle.js';
import { SelectionModel } from './keyboardNav.js';
import { buildPlaceIcon } from './placeIcon.js';

const GRID_COLS = 2;
const CONTENT_GAP = 12;

export class PanelView {
    // opts: { folder, files, cfg, mon, origin:{x,y}, close }
    constructor(opts) {
        Object.assign(this, opts);
        this._view = opts.cfg.downloadsView;   // 'grid' | 'list'
        this._model = new SelectionModel('aqua-dl-row-sel');
        this._actor = null;
        this._cols = this._view === 'grid' ? GRID_COLS : 1;
        this._reduce = false;
        this._fileMenu = new FileItemMenu(opts.mon, opts.cfg);
    }

    get actor() { return this._actor; }

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

        const panel = new St.BoxLayout({
            style_class: `aqua-dl-panel aqua-dl-${view}`,
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            can_focus: true,
        });
        this._actor = panel;
        if (cfg.highContrast) panel.add_style_class_name('aqua-high-contrast');
        panel.add_child(this._header(folder, files.length));
        panel.add_child(new St.Widget({ style_class: 'aqua-dl-divider' }));

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
        panel.add_child(box);

        panel.set_width(panelW);
        const a = clamp(cfg.bgOpacity, 0.1, 1.0).toFixed(2);
        const radius = cfg.downloadsBorderRadius ?? clamp((cfg.dockRadius ?? 16) + 2, 0, 26);
        const bw = cfg.highContrast ? Math.max(2, cfg.downloadsBorderWidth ?? 1)
            : (cfg.downloadsBorderWidth ?? cfg.borderWidth ?? 1);
        const bc = cfg.highContrast ? '#ffffff'
            : (cfg.downloadsBorderColor ?? cfg.borderColor ?? 'rgba(255,255,255,0.16)');
        const border = bw > 0 ? `${bw}px solid ${bc}` : 'none';
        const fill = cfg.highContrast ? 'rgba(0,0,0,0.96)'
            : (cfg.downloadsPillColor ?? cfg.pillColor ?? `rgba(28,28,32,${a})`);
        panel.set_style(`border-radius: ${radius}px; background-color: ${fill}; border: ${border};`);
        panel.set_pivot_point(0.5, 1.0);
        panel.opacity = 0;

        Main.uiGroup.add_child(panel);
        this._fileMenu.bind(panel);
        const [, natH] = panel.get_preferred_height(panelW);
        const sideX = sideFanX(cfg.position, originX, cfg.dockH, panelW);
        const targetX = sideX ?? originX - panelW / 2;
        const targetY = cfg.vertical ? ay - natH / 2 : ay - natH - panelGap;
        const px = clamp(Math.round(targetX), mon.x + 8, mon.x + mon.width - panelW - 8);
        const py = clamp(Math.round(targetY), mon.y + 8, mon.y + mon.height - natH - 8);
        panel.set_position(px, py);

        this._model.setRows(tiles);
        this._animateOpen(panel, tiles, view);
        return panel;
    }

    _header(folder, count) {
        const header = new St.BoxLayout({ style_class: 'aqua-dl-header' });
        header.get_layout_manager().set_spacing(10);
        header.add_child(buildPlaceIcon(
            this.gicon ?? Gio.ThemedIcon.new('folder-download'),
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

    _tile(view, extraClass = '') {
        const row = new St.Button({
            style_class: `aqua-dl-row aqua-dl-row-${view} ${extraClass}`.trim(),
            reactive: true, track_hover: true, can_focus: true, x_expand: view !== 'grid',
        });
        row.set_style('background-color: transparent; border: none; box-shadow: none;');
        const box = new St.BoxLayout({
            style_class: 'aqua-dl-row-inner',
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
        });
        return { row, box };
    }

    _contentGap() {
        return new St.Widget({
            width: CONTENT_GAP,
            x_expand: false,
            reactive: false,
        });
    }

    _thumbBin(thumbSz) {
        const thumbW = thumbSz, thumbH = Math.round(thumbSz * 0.72);
        const thumb = new St.Bin({
            style_class: 'aqua-dl-fan-thumb', x_expand: false, y_expand: false,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
        });
        thumb.set_size(thumbW, thumbH);
        thumb.set_pivot_point(0.5, 0.5);
        return { thumb, thumbW, thumbH, thumbRadius: Math.round(Math.min(thumbW, thumbH) * 0.22) };
    }

    _labelPill(text, extra = '') {
        const labelPill = new St.Bin({
            style_class: 'aqua-dl-fan-label-pill', x_expand: true,
            x_align: Clutter.ActorAlign.FILL, y_align: Clutter.ActorAlign.CENTER,
        });
        const label = new St.Label({
            text, style_class: `aqua-dl-fan-label ${extra}`.trim(), x_expand: true,
            x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.set_line_wrap(false);
        label.clutter_text.set_ellipsize(3);
        labelPill.set_child(label);
        return { labelPill, label };
    }

    _wireHover(row) {
        row.connect('notify::hover', () => {
            if (!row.hover) return;
            const idx = this._model.rows.indexOf(row);
            if (idx >= 0) this._model.select(idx);
        });
    }

    _row(info, view, thumbSz) {
        const { row, box } = this._tile(view);
        const file = this.folder.get_child(info.get_name());
        const { thumb, thumbW, thumbH, thumbRadius } = this._thumbBin(thumbSz);
        thumb.set_child(new St.Icon({
            gicon: iconForInfo(info), icon_size: Math.round(Math.min(thumbW, thumbH) * 0.78),
            style_class: 'aqua-dl-fan-icon',
        }));
        box.add_child(thumb);
        box.add_child(this._contentGap());
        const { labelPill, label } = this._labelPill(info.get_display_name());
        row.accessible_name = info.get_display_name();
        box.add_child(labelPill);
        row.set_child(box);
        row._thumb = thumb;
        row._updatePillStyle = hover => applyTileStyle(this.cfg, labelPill, label, thumb, thumbRadius, hover, '4px 12px');
        row._updatePillStyle(false);
        row._activate = () => { launchUri(file.get_uri()); this.close(); };
        this._fileMenu.attach(row, file, row._activate);
        this._wireHover(row);
        return row;
    }

    _moreRow(more, view, thumbSz, firstHidden) {
        const { row, box } = this._tile(view, 'aqua-dl-row-more');
        const { thumb, thumbW, thumbH, thumbRadius } = this._thumbBin(thumbSz);
        thumb.set_child(new St.Icon({
            gicon: firstHidden ? iconForInfo(firstHidden) : Gio.ThemedIcon.new('folder-download'),
            icon_size: Math.round(Math.min(thumbW, thumbH) * 0.72), style_class: 'aqua-dl-fan-icon',
        }));
        box.add_child(thumb);
        box.add_child(this._contentGap());
        const { labelPill, label } = this._labelPill(format(
            ngettext('+%d more item in Files', '+%d more items in Files', more), more),
            'aqua-dl-fan-more');
        box.add_child(labelPill);
        row.set_child(box);
        row._thumb = thumb;
        row._updatePillStyle = hover => applyTileStyle(this.cfg, labelPill, label, thumb, thumbRadius, hover, '4px 12px');
        row._updatePillStyle(false);
        row._activate = () => { launchUri(this.folder.get_uri()); this.close(); };
        row.connect('clicked', row._activate);
        this._wireHover(row);
        return row;
    }

    _animateOpen(panel, tiles, view) {
        if (this._reduce) {
            panel.opacity = 255;
            panel.set_scale(1, 1);
            panel.translation_y = 0;
            for (const tile of tiles) {
                tile.opacity = 255;
                tile.translation_y = 0;
            }
            return;
        }
        if (view === 'grid') {
            panel.set_scale(0.88, 0.88);
            panel.ease({
                opacity: 255,
                scale_x: 1,
                scale_y: 1,
                duration: 240,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        } else {
            panel.translation_y = 12; panel.scale_y = 0.9;
            panel.ease({
                opacity: 255,
                translation_y: 0,
                scale_y: 1,
                duration: 240,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        }
        tiles.forEach((tile, i) => {
            tile.opacity = 0; tile.translation_y = 6;
            const delay = view === 'grid' ? 50 + Math.floor(i / GRID_COLS) * 30 : 50 + i * 22;
            tile.ease({ opacity: 255, translation_y: 0, duration: 200, delay, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        });
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

    animateClose(onDone) {
        const actor = this._actor;
        if (!actor) { onDone(); return; }
        actor.remove_all_transitions();
        if (this._reduce || !animationsEnabled()) { onDone(); return; }
        if (this._view === 'grid') {
            actor.ease({ opacity: 0, scale_x: 0.88, scale_y: 0.88, duration: 200, mode: Clutter.AnimationMode.EASE_IN_CUBIC, onComplete: onDone });
        } else {
            actor.ease({ opacity: 0, scale_y: 0.9, translation_y: 12, duration: 200, mode: Clutter.AnimationMode.EASE_IN_CUBIC, onComplete: onDone });
        }
    }
}
