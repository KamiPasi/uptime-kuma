// Grouped dashboard aggregates adapted from upstream #8030.
const { R } = require("redbean-node");
const dayjs = require("dayjs");

const MINUTE = 60;
const DAY = 86400;
const CHUNK_SIZE = 500;

/** Read dashboard statistics without loading every monitor's history. */
class MonitorStats {
    /**
     * Compute dashboard statistics with two grouped queries per chunk.
     * Live updates continue to use the existing 2.5 uptime calculators.
     * @param {Array<number|string>} monitorIDs Authorized monitor ids.
     * @param {dayjs.Dayjs} now Current time, injectable for tests.
     * @returns {Promise<object>} Statistics keyed by monitor id.
     */
    static async compute(monitorIDs, now = dayjs.utc()) {
        const ids = [...new Set(monitorIDs.map(Number))];
        if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
            throw new Error("Invalid monitor ID.");
        }

        const unix = now.unix();
        const minuteKey = Math.floor(unix / MINUTE) * MINUTE;
        const dayKey = Math.floor(unix / DAY) * DAY;
        const minutelySince = minuteKey - MINUTE * (1440 - 1);
        const monthSince = dayKey - DAY * (30 - 1);
        const yearSince = dayKey - DAY * (365 - 1);
        const result = {};

        for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
            const chunk = ids.slice(i, i + CHUNK_SIZE);
            const placeholders = chunk.map(() => "?").join(",");
            const [minutelyRows, dailyRows] = await Promise.all([
                R.getAll(
                    `SELECT monitor_id, SUM(up) AS up, SUM(down) AS down, SUM(ping * up) AS ping_sum
                     FROM stat_minutely
                     WHERE timestamp >= ? AND timestamp <= ? AND monitor_id IN (${placeholders})
                     GROUP BY monitor_id`,
                    [minutelySince, minuteKey, ...chunk]
                ),
                R.getAll(
                    `SELECT monitor_id,
                            SUM(CASE WHEN timestamp >= ? THEN up ELSE 0 END) AS up30,
                            SUM(CASE WHEN timestamp >= ? THEN down ELSE 0 END) AS down30,
                            SUM(up) AS up1y, SUM(down) AS down1y
                     FROM stat_daily
                     WHERE timestamp >= ? AND timestamp <= ? AND monitor_id IN (${placeholders})
                     GROUP BY monitor_id`,
                    [monthSince, monthSince, yearSince, dayKey, ...chunk]
                ),
            ]);
            const minutely = new Map(minutelyRows.map((row) => [Number(row.monitor_id), row]));
            const daily = new Map(dailyRows.map((row) => [Number(row.monitor_id), row]));
            for (const id of chunk) {
                const minute = minutely.get(id);
                const day = daily.get(id);
                const up = Number(minute?.up) || 0;
                const pingSum = Number(minute?.ping_sum) || 0;
                result[id] = {
                    avgPing: up === 0 ? null : Number((pingSum / up).toFixed(2)),
                    uptime24: this.uptime(up, minute?.down),
                    uptime720: this.uptime(day?.up30, day?.down30),
                    uptime1y: this.uptime(day?.up1y, day?.down1y),
                };
            }
        }
        return result;
    }

    /**
     * Convert aggregate duration values to an uptime fraction.
     * @param {number|string} up Time up.
     * @param {number|string} down Time down.
     * @returns {number} Uptime fraction, or zero without any measurements.
     */
    static uptime(up, down) {
        up = Number(up) || 0;
        down = Number(down) || 0;
        return up + down === 0 ? 0 : up / (up + down);
    }
}

module.exports = { MonitorStats };
