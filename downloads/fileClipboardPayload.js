// Standard file-list clipboard payload helpers.

export const FILE_LIST_MIME = 'text/uri-list';

/**
 * Formats an array of URI strings into a standard CRLF-delimited text/uri-list payload.
 *
 * @param {string[]|null} uris - Array of file URI strings.
 * @returns {string|null} Formatted text/uri-list payload, or null if array contains no valid URIs.
 */
export function fileListPayload(uris) {
    const safeUris = (uris ?? []).filter(uri =>
        typeof uri === 'string' && uri.length > 0 && !/[\r\n]/.test(uri));
    if (!safeUris.length) return null;
    return `${safeUris.join('\r\n')}\r\n`;
}
