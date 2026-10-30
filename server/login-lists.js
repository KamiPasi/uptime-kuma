/**
 * Sends the heartbeat/stats lists after the client painted the dashboard,
 * with a timer fallback for clients that never signal. Runs at most once.
 */
class DeferredListsSender {
    /**
     * @param {object} options Send callback and optional timer overrides.
     */
    constructor(options) {
        this.options = options;
        this.sent = false;
        this.fallback = null;
        /**
         * Client signalled that the dashboard was painted.
         * @returns {void}
         */
        this.onRendered = () => {
            this.run();
        };
        const setTimer = options.setTimer ?? setTimeout;
        this.fallback = setTimer(() => this.run(), options.fallbackMs ?? 5000);
    }
    /**
     * Cancel the fallback timer, e.g. when the socket disconnects
     * @returns {void}
     */
    dispose() {
        this.sent = true;
        if (this.fallback) {
            const clearTimer = this.options.clearTimer ?? clearTimeout;
            clearTimer(this.fallback);
            this.fallback = null;
        }
    }
    /**
     * Send once, whether triggered by a paint signal or the fallback timer.
     * @returns {void}
     */
    run() {
        if (this.sent) {
            return;
        }
        this.sent = true;
        this.dispose();
        this.options.send().catch((error) => this.options.onError(error));
    }
}

module.exports = { DeferredListsSender };
