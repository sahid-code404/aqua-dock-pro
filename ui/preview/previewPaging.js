// Pure page sizing for window previews; keeps every page inside its monitor.

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

