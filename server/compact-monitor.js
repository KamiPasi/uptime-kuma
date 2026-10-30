/**
 * Fields the dashboard needs for one monitor. toJSON() builds ~60 fields per
 * monitor, which costs over a second for thousands of monitors at login.
 * @param {object} monitor Monitor bean
 * @param {object} preloadData Data prepared for the whole list
 * @returns {object} Slim monitor payload
 */
function toCompactMonitor(monitor, preloadData) {
    const path = preloadData.paths.get(monitor.id) || [];
    return {
        id: monitor.id,
        name: monitor.name,
        type: monitor.type,
        active: preloadData.activeStatus.get(monitor.id),
        forceInactive: preloadData.forceInactive?.get(monitor.id) ?? false,
        maintenance: preloadData.maintenanceStatus?.get(monitor.id) ?? false,
        // Status page editing still needs the URL when adding a public monitor.
        url: monitor.url,
        parent: monitor.parent ?? null,
        childrenIDs: preloadData.childrenIDs.get(monitor.id) || [],
        tags: preloadData.tags.get(monitor.id) || [],
        path,
        pathName: path.join(" / "),
        interval: monitor.interval,
        weight: monitor.weight ?? null,
    };
}

module.exports = { toCompactMonitor };
