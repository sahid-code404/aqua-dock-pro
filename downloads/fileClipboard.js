// User-triggered folder-stack file copy integration.

import GLib from 'gi://GLib';
import St from 'gi://St';

import { FILE_LIST_MIME, fileListPayload } from './fileClipboardPayload.js';

/**
 * Copies a Gio.File reference to the desktop clipboard formatted as a text/uri-list payload.
 *
 * @param {Gio.File|null} file - GIO file instance to copy.
 * @returns {boolean} True if file URI list payload was successfully written to the clipboard.
 */
export function copyFileToClipboard(file) {
    const payload = fileListPayload([file?.get_uri?.()]);
    if (!payload) return false;

    const bytes = GLib.Bytes.new(new TextEncoder().encode(payload));
    St.Clipboard.get_default().set_content(
        St.ClipboardType.CLIPBOARD, FILE_LIST_MIME, bytes);
    return true;
}
