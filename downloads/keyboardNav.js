// Keyboard and hover selection model for Downloads stack popups.

import Clutter from 'gi://Clutter';

import { animationsEnabled, clamp } from '../core/utils.js';

export class SelectionModel {
    constructor(selClass = 'aqua-dl-row-sel') {
        this._selClass = selClass;
        this._rows = [];
        this._i = -1;
    }

    setRows(rows) { this._rows = rows; this._i = -1; }
    get rows() { return this._rows; }
    get index() { return this._i; }
    get current() { return this._rows[this._i] ?? null; }

    select(i) {
        if (!this._rows.length) return;
        i = clamp(i, 0, this._rows.length - 1);
        if (i === this._i) return;
        const animate = animationsEnabled();
        if (this._i >= 0 && this._i < this._rows.length)
            this._paint(this._rows[this._i], false, animate);
        this._paint(this._rows[i], true, animate);
        this._i = i;
    }

    activateCurrent() {
        const row = this.current;
        if (row?._activate) row._activate();
        else if (row) { try { row.emit('clicked', 0); } catch { } }
    }

    _paint(row, on, animate) {
        if (!row) return;
        if (on) row.add_style_class_name(this._selClass);
        else row.remove_style_class_name(this._selClass);
        row._updatePillStyle?.(on);
        if (row._thumb) {
            if (!animate) {
                row._thumb.set_scale(on ? 1.10 : 1, on ? 1.10 : 1);
                return;
            }
            row._thumb.ease({
                scale_x: on ? 1.10 : 1, scale_y: on ? 1.10 : 1, duration: 180,
                mode: on ? Clutter.AnimationMode.EASE_OUT_BACK : Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    clear() { this._rows = []; this._i = -1; }
}
