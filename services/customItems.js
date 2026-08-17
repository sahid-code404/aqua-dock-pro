// Validation and serialization for user-defined dock locations.

const LOCATION_TYPES = new Set(['folder', 'file', 'url']);
const STRUCTURE_TYPES = new Set(['separator', 'spacer']);
const MAX_ITEMS = 32;

function cleanText(value, limit) {
    return typeof value === 'string'
        ? value.replace(/[\r\n\0]/g, ' ').trim().slice(0, limit)
        : '';
}

export function normalizeCustomItem(value, fallbackId = '') {
    if (!value || typeof value !== 'object') return null;
    const type = cleanText(value.type, 16);
    if (!LOCATION_TYPES.has(type) && !STRUCTURE_TYPES.has(type)) return null;

    const id = cleanText(value.id, 80) || cleanText(fallbackId, 80);
    if (!id) return null;
    if (STRUCTURE_TYPES.has(type)) return { id, type };

    const uri = cleanText(value.uri, 4096);
    if (!uri) return null;
    return {
        id,
        type,
        uri,
        name: cleanText(value.name, 160),
    };
}

export function parseCustomItems(records) {
    if (!Array.isArray(records)) return [];
    const result = [];
    const ids = new Set();
    for (let i = 0; i < records.length && result.length < MAX_ITEMS; i++) {
        let raw;
        try { raw = JSON.parse(records[i]); }
        catch { continue; }
        const item = normalizeCustomItem(raw, `legacy-${i}`);
        if (!item || ids.has(item.id)) continue;
        ids.add(item.id);
        result.push(item);
    }
    return result;
}

export function serializeCustomItems(items) {
    const result = [];
    const ids = new Set();
    for (let i = 0; i < (items ?? []).length && result.length < MAX_ITEMS; i++) {
        const item = normalizeCustomItem(items[i], `item-${i}`);
        if (!item || ids.has(item.id)) continue;
        ids.add(item.id);
        result.push(JSON.stringify(item));
    }
    return result;
}

