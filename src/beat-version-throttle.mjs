/**
 * Coalesce heartbeat version bumps: thousands of beats arrive every minute and
 * each one may want to refresh the counters, but once per interval is enough.
 */
export class BeatVersionThrottle {
    /**
     * @param {Function} bump Called at most once per interval
     * @param {number} delayMs Minimum time between bumps
     */
    constructor(bump, delayMs = 1000) {
        this.bump = bump;
        this.delayMs = delayMs;
        this.timer = null;
    }
    /**
     * Request a bump, ignored while one is already pending
     * @returns {void}
     */
    schedule() {
        if (this.timer) {
            return;
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            this.bump();
        }, this.delayMs);
    }
    /**
     * Drop a pending bump
     * @returns {void}
     */
    cancel() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
