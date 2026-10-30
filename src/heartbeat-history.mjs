/**
 * Claim the history request of a monitor, so concurrent rows emit it only once.
 * @param {Set<number>} requested Monitors whose history was already requested
 * @param {number} monitorId Monitor id
 * @returns {boolean} True when the caller should emit the request
 */
export function claimHeartbeatHistory(requested, monitorId) {
    if (requested.has(monitorId)) {
        return false;
    }
    requested.add(monitorId);
    return true;
}
/**
 * Release the claim, so a later render can retry (socket not ready, request failed).
 * @param {Set<number>} requested Monitors whose history was already requested
 * @param {number} monitorId Monitor id
 * @returns {void}
 */
export function releaseHeartbeatHistory(requested, monitorId) {
    requested.delete(monitorId);
}

/**
 * Merge a history snapshot with beats received while its request was in flight.
 * @param {object[]} history Historical snapshot.
 * @param {object[]} current Beats already held by the client.
 * @param {number} limit Maximum retained beats.
 * @returns {object[]} Unique beats in chronological order.
 */
export function mergeHeartbeatHistory(history, current, limit = 150) {
    const beats = new Map();
    for (const beat of [...history, ...current]) {
        const key = beat.id != null ? `id:${beat.id}` : `time:${beat.time}`;
        beats.set(key, beat);
    }
    return [...beats.values()]
        .sort((a, b) => String(a.time).localeCompare(String(b.time)) || Number(a.id || 0) - Number(b.id || 0))
        .slice(-limit);
}
