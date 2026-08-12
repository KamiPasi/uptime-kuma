const { BeanModel } = require("redbean-node/dist/bean-model");
const zlib = require("node:zlib");
const { promisify } = require("node:util");
const brotliDecompress = promisify(zlib.brotliDecompress);

/**
 * status:
 *      0 = DOWN
 *      1 = UP
 *      2 = PENDING
 *      3 = MAINTENANCE
 */
class Heartbeat extends BeanModel {
    /**
     * Return an object that ready to parse to JSON for public
     * Only show necessary data to public
     * @returns {object} Object ready to parse
     */
    toPublicJSON() {
        return {
            status: this.status,
            time: this.time,
            msg: "", // Hide for public
            ping: this.ping,
            responseValidationFailed: Boolean(this.responseValidationFailed),
        };
    }

    /**
     * Return an object that ready to parse to JSON
     * @returns {object} Object ready to parse
     */
    toJSON() {
        return {
            id: this._id,
            monitorID: this._monitorId,
            status: this._status,
            time: this._time,
            msg: this._msg,
            ping: this._ping,
            important: this._important,
            duration: this._duration,
            retries: this._retries,
            hasResponse: Boolean(this._response),
            responseValidationFailed: Boolean(this._responseValidationFailed),
        };
    }

    /**
     * Return an object that ready to parse to JSON
     * @param {{ decodeResponse?: boolean }} opts Options for JSON serialization
     * @returns {Promise<object>} Object ready to parse
     */
    async toJSONAsync(opts) {
        return {
            ...this.toJSON(),
            response: opts?.decodeResponse ? await Heartbeat.decodeResponseValue(this._response) : undefined,
        };
    }

    /**
     * Convert a raw heartbeat row to the client-safe heartbeat shape.
     * The stored response itself must only be exposed by the authenticated,
     * on-demand response handler.
     * @param {object} row Raw heartbeat database row.
     * @returns {object} Client-safe heartbeat data.
     */
    static toClientJSON(row) {
        return {
            id: row.id,
            monitorID: row.monitorID ?? row.monitor_id,
            status: row.status,
            time: row.time,
            msg: row.msg,
            ping: row.ping,
            important: row.important,
            duration: row.duration,
            retries: row.retries,
            hasResponse: Boolean(row.hasResponse ?? row.has_response ?? row.response),
            responseValidationFailed: Boolean(row.responseValidationFailed ?? row.response_validation_failed),
        };
    }

    /**
     * Decode compressed response payload stored in database.
     * @param {string|null} response Encoded response payload.
     * @returns {string|null} Decoded response payload.
     */
    static async decodeResponseValue(response) {
        if (!response) {
            return response;
        }

        try {
            // Offload brotli decode from main event loop to libuv thread pool
            return (await brotliDecompress(Buffer.from(response, "base64"))).toString("utf8");
        } catch (error) {
            return response;
        }
    }
}

module.exports = Heartbeat;
