// AquaDockPro translation helpers. English remains the fallback when no
// compiled locale is installed.

import GLib from 'gi://GLib';

const DOMAIN = 'aqua-dock-pro';

export function _(message) {
    return GLib.dgettext(DOMAIN, message);
}

export function ngettext(single, plural, count) {
    return GLib.dngettext(DOMAIN, single, plural, count);
}

export function format(message, ...values) {
    let index = 0;
    return message.replace(/%[sd]/g, () => String(values[index++] ?? ''));
}
