// Pure page sizing for window previews; keeps every page inside its monitor.

/**
 * Calculates page layout and thumbnail count boundaries for window preview popups.
 * Constrains preview card counts to fit comfortably within physical monitor dimensions.
 *
 * @param {object} params - Calculation parameters.
 * @param {number} params.total - Total number of open windows for the application.
 * @param {number} params.targetWidth - Desired width of an individual window thumbnail card.
 * @param {number} params.monitorWidth - Physical width of the current monitor.
 * @param {'summary'|'pages'} [params.mode='summary'] - Paging mode.
 * @param {number} [params.requestedSize=4] - Target number of cards per page.
 * @param {number} [params.requestedPage=0] - Requested page index.
 * @param {number} [params.spacing=10] - Spacing between adjacent thumbnail cards.
 * @param {number} [params.margin=32] - Total horizontal margin clearance.
 * @returns {{ paged: boolean, page: number, pageCount: number, pageSize: number, start: number, end: number, remaining: number }} Page layout geometry plan.
 */
export function previewPagePlan({
    total,
    targetWidth,
    monitorWidth,
    mode = 'summary',
    requestedSize = 4,
    requestedPage = 0,
    spacing = 10,
    margin = 32,
}) {
    const count = Math.max(0, Math.floor(total));
    const width = Math.max(1, targetWidth);
    const available = Math.max(width, monitorWidth - margin);
    const widthFit = Math.max(1, Math.floor((available + spacing) / (width + spacing)));
    const pageSize = Math.max(1, Math.min(Math.floor(requestedSize), widthFit));
    const paged = mode === 'pages';
    const pageCount = paged ? Math.max(1, Math.ceil(count / pageSize)) : 1;
    const page = paged
        ? Math.max(0, Math.min(Math.floor(requestedPage), pageCount - 1)) : 0;
    const start = page * pageSize;
    const shown = Math.max(0, Math.min(pageSize, count - start));
    return {
        paged,
        page,
        pageCount,
        pageSize,
        start,
        end: start + shown,
        remaining: paged ? Math.max(0, count - (start + shown)) : Math.max(0, count - shown),
    };
}

