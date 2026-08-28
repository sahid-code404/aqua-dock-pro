// Standard file-list clipboard payload helpers.

export const FILE_LIST_MIME = 'text/uri-list';

export function fileListPayload(uris) {
    const safeUris = (uris ?? []).filter(uri =>
        typeof uri === 'string' && uri.length > 0 && !/[\r\n]/.test(uri));
    if (!safeUris.length) return null;
    return `${safeUris.join('\r\n')}\r\n`;
}
