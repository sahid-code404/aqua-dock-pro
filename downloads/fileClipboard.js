// Native file-list clipboard payloads for folder stack items.

import GLib from 'gi://GLib';
import St from 'gi://St';

export const FILE_LIST_MIME = 'text/uri-list';

export function fileListPayload(uris) {
    const safeUris = (uris ?? []).filter(uri =>
        typeof uri === 'string' && uri.length > 0 && !/[\r\n]/.test(uri));
    if (!safeUris.length) return null;
    // GDK's native file-list serializer uses CRLF-delimited URIs with a final
    // delimiter. Files converts this standard format back to GdkFileList, and
    // non-GNOME applications can consume it without knowing Nautilus' private
    // x-special/gnome-copied-files format.
    return `${safeUris.join('\r\n')}\r\n`;
}

export function copyFileToClipboard(file) {
    const payload = fileListPayload([file?.get_uri?.()]);
    if (!payload) return false;

    const bytes = GLib.Bytes.new(new TextEncoder().encode(payload));
    St.Clipboard.get_default().set_content(
        St.ClipboardType.CLIPBOARD, FILE_LIST_MIME, bytes);
    return true;
}
