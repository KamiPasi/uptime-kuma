import { DOWN, MAINTENANCE, PENDING, UP } from "./util.js";
/**
 * Display text and color for a heartbeat status
 * @param {Function} translate Translation function
 * @param {object} beat Latest heartbeat, if any
 * @returns {object} Status entry for the dashboard
 */
export function beatStatusEntry(translate, beat) {
    if (!beat) {
        return { text: translate("Unknown"), color: "secondary" };
    }
    if (beat.status === DOWN && (beat.responseValidationFailed || beat.response_validation_failed)) {
        return { text: translate("Down"), color: "response-validation" };
    }
    switch (beat.status) {
        case UP:
            return { text: translate("Up"), color: "primary" };
        case DOWN:
            return { text: translate("Down"), color: "danger" };
        case PENDING:
            return { text: translate("Pending"), color: "warning" };
        case MAINTENANCE:
            return { text: translate("statusMaintenance"), color: "maintenance" };
        default:
            return { text: translate("Unknown"), color: "secondary" };
    }
}
/**
 * Store the newest beat of a monitor, in place, so a beat stays O(1)
 * @param {object} state Mixin state
 * @param {number|string} monitorID Monitor id
 * @param {object} beat Latest heartbeat
 * @param {object} entry Display status for the heartbeat
 * @returns {void}
 */
export function applyBeat(state, monitorID, beat, entry) {
    state.lastHeartbeatList[monitorID] = beat;
    state.statusList[monitorID] = entry;
    state.lastBeatRaw[monitorID] = beat;
}
