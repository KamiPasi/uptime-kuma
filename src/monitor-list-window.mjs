/** Height used for a row until the component has measured it */
export const DEFAULT_ROW_HEIGHT = 58;
/** Rows mounted above and below the viewport */
const OVERSCAN = 300;
/**
 * Cumulative offsets of the monitor rows, used to window the list.
 * @param {Array<number|string>} ids Monitor ids, in display order
 * @param {object} rowHeights Measured row heights by monitor id
 * @param {number} defaultHeight Height for rows that were not measured yet
 * @returns {object} Row heights, offsets and total height
 */
export function computeRowMetrics(ids, rowHeights, defaultHeight = DEFAULT_ROW_HEIGHT) {
    const heights = [];
    const offsets = [];
    let total = 0;
    for (const id of ids) {
        offsets.push(total);
        const height = rowHeights[id] ?? defaultHeight;
        heights.push(height);
        total += height;
    }
    return { heights, offsets, total };
}
/**
 * Rows to mount for the current scroll offset, plus the spacer heights that keep
 * the scrollbar proportional to the full list.
 * @param {number[]} offsets Cumulative row offsets
 * @param {number[]} heights Row heights
 * @param {number} total Total height of all rows
 * @param {number} scrollTop Current scroll offset
 * @param {number} viewportHeight Visible height (0 falls back to 800)
 * @param {number} overscan Extra pixels mounted above and below the viewport
 * @returns {object} Window bounds and spacer heights
 */
export function computeListWindow(offsets, heights, total, scrollTop, viewportHeight, overscan = OVERSCAN) {
    if (offsets.length === 0) {
        return { start: 0, end: 0, top: 0, bottom: 0 };
    }
    const viewport = viewportHeight || 800;
    const startY = Math.max(0, scrollTop - overscan);
    const endY = scrollTop + viewport + overscan;
    let start = 0;
    while (start < offsets.length - 1 && offsets[start] + heights[start] < startY) {
        start++;
    }
    let end = start;
    while (end < offsets.length && offsets[end] < endY) {
        end++;
    }
    const last = end - 1;
    return {
        start,
        end,
        top: offsets[start],
        bottom: total - (offsets[last] + heights[last]),
    };
}
