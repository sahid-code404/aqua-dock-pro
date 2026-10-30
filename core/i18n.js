// AquaDockPro translation helpers. English remains the fallback when no
// compiled locale is installed.

import GLib from 'gi://GLib';

const DOMAIN = 'aqua-dock-pro';

/**
 * Translates a gettext message string using the extension's translation domain.
 *
 * @param {string} message - Untranslated string.
 * @returns {string} Localized string, or the original message if untranslated.
 */
export function _(message) {
    return GLib.dgettext(DOMAIN, message);
}

/**
 * Translates a pluralized gettext message string based on item count.
 *
 * @param {string} single - Untranslated singular message format.
 * @param {string} plural - Untranslated plural message format.
 * @param {number} count - Count determining singular vs plural form.
 * @returns {string} Localized string for the specified count.
 */
export function ngettext(single, plural, count) {
    return GLib.dngettext(DOMAIN, single, plural, count);
}

/**
 * Formats a template string by replacing %s and %d format specifiers sequentially with given values.
 *
 * @param {string} message - Format template string.
 * @param {...*} values - Values to interpolate into the template.
 * @returns {string} Interpolated output string.
 */
export function format(message, ...values) {
    let index = 0;
    return message.replace(/%[sd]/g, () => String(values[index++] ?? ''));
}
