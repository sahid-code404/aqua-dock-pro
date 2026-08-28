// User-triggered folder-stack file copy integration.

import GLib from 'gi://GLib';
import St from 'gi://St';

import { FILE_LIST_MIME, fileListPayload } from './fileClipboardPayload.js';

export function copyFileToClipboard(file) {
    const payload = fileListPayload([file?.get_uri?.()]);
    if (!payload) return false;

    const bytes = GLib.Bytes.new(new TextEncoder().encode(payload));
    St.Clipboard.get_default().set_content(
        St.ClipboardType.CLIPBOARD, FILE_LIST_MIME, bytes);
    return true;
}
