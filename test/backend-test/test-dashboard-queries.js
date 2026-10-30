const { before, after, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const knex = require("knex");
const { R } = require("redbean-node");
const { getHeartbeatHistory, sendHeartbeatLists } = require("../../server/client");
const { MonitorStats } = require("../../server/monitor-stats");
const { toCompactMonitor } = require("../../server/compact-monitor");

let db;
const now = 1704067200;

before(async () => {
    const Dialect = require("knex/lib/dialects/sqlite3/index.js");
    Dialect.prototype._driver = () => require("@louislam/sqlite3");
    db = knex({
        client: Dialect,
        connection: { filename: ":memory:" },
        useNullAsDefault: true,
        pool: { min: 1, max: 1 },
    });
    R.setup(db);
    await db.schema.createTable("monitor", (table) => {
        table.integer("id").primary();
        table.integer("user_id");
    });
    await db.schema.createTable("heartbeat", (table) => {
        table.integer("id").primary();
        table.integer("monitor_id");
        table.integer("status");
        table.string("msg");
        table.string("time");
        table.integer("ping");
        table.integer("important");
        table.integer("duration");
        table.integer("retries");
        table.text("response");
        table.integer("response_validation_failed");
        table.index(["monitor_id", "time"]);
    });
    for (const name of ["stat_minutely", "stat_daily"]) {
        await db.schema.createTable(name, (table) => {
            table.integer("monitor_id");
            table.integer("timestamp");
            table.integer("up");
            table.integer("down");
            table.float("ping");
        });
    }
    await db("monitor").insert([
        { id: 1, user_id: 1 },
        { id: 2, user_id: 2 },
        { id: 3, user_id: 1 },
    ]);
    await db("heartbeat").insert(
        Array.from({ length: 102 }, (_, index) => ({
            id: index + 1,
            monitor_id: 1,
            status: 0,
            msg: "validation failed",
            time: String(index).padStart(5, "0"),
            ping: 10,
            important: 1,
            duration: 60,
            retries: 0,
            response: "private-body",
            response_validation_failed: 1,
        }))
    );
    await db("heartbeat").insert({ id: 103, monitor_id: 2, status: 1, time: "99999", response: "other-user-body" });
    await db("stat_minutely").insert([
        { monitor_id: 1, timestamp: now, up: 3, down: 1, ping: 100 },
        { monitor_id: 1, timestamp: now - 60 * 1440, up: 100, down: 0, ping: 999 },
        { monitor_id: 1, timestamp: now + 60, up: 100, down: 0, ping: 999 },
        { monitor_id: 2, timestamp: now, up: 1, down: 0, ping: 999 },
    ]);
    await db("stat_daily").insert([
        { monitor_id: 1, timestamp: now, up: 29, down: 1 },
        { monitor_id: 1, timestamp: now - 86400 * 30, up: 335, down: 0 },
        { monitor_id: 1, timestamp: now - 86400 * 365, up: 1000, down: 0 },
    ]);
});

after(async () => db?.destroy());

describe("Dashboard heartbeat queries", () => {
    test("history is bounded, ordered, and contains availability without response bodies", async () => {
        const rows = await getHeartbeatHistory(1, 1);
        assert.strictEqual(rows.length, 100);
        assert.strictEqual(rows[0].id, 3);
        assert.strictEqual(rows.at(-1).id, 102);
        assert.strictEqual(rows.at(-1).monitorID, 1);
        assert.strictEqual(rows.at(-1).responseValidationFailed, true);
        assert.strictEqual(rows.at(-1).hasResponse, true);
        assert.ok(rows.every((row) => !Object.hasOwn(row, "response")));
    });

    test("history never returns another user's monitor", async () => {
        assert.deepStrictEqual(await getHeartbeatHistory(2, 1), []);
        assert.deepStrictEqual(await getHeartbeatHistory(1, 2), []);
    });

    test("initial snapshot sends only the latest beat of owned monitors", async () => {
        const events = [];
        await sendHeartbeatLists({ userID: 1, connected: true, emit: (...args) => events.push(args) }, [1, 2, 3]);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0][0], "heartbeatLists");
        assert.deepStrictEqual(Object.keys(events[0][1]), ["1"]);
        assert.strictEqual(events[0][1][1].length, 1);
        assert.strictEqual(events[0][1][1][0].id, 102);
        assert.strictEqual(events[0][1][1][0].hasResponse, true);
        assert.ok(!Object.hasOwn(events[0][1][1][0], "response"));
    });

    test("disconnected clients do not receive query results", async () => {
        let emitted = false;
        await sendHeartbeatLists(
            {
                userID: 1,
                connected: false,
                emit: () => {
                    emitted = true;
                },
            },
            [1]
        );
        assert.strictEqual(emitted, false);
    });
});

describe("Grouped dashboard statistics", () => {
    test("matches the 24-hour, 30-day, and yearly bucket boundaries", async () => {
        const stats = await MonitorStats.compute(["1", 3], { unix: () => now });
        assert.deepStrictEqual(stats[1], { avgPing: 100, uptime24: 0.75, uptime720: 29 / 30, uptime1y: 364 / 365 });
        assert.deepStrictEqual(stats[3], { avgPing: null, uptime24: 0, uptime720: 0, uptime1y: 0 });
        assert.ok(!stats[2]);
    });

    test("empty and invalid monitor selections are handled before querying", async () => {
        assert.deepStrictEqual(await MonitorStats.compute([], { unix: () => now }), {});
        for (const id of [0, -1, 1.5, "invalid", NaN]) {
            await assert.rejects(MonitorStats.compute([id], { unix: () => now }), /Invalid monitor ID/);
        }
    });
});

describe("Compact monitor payload", () => {
    test("keeps list and status-page fields while excluding request bodies and credentials", () => {
        const compact = toCompactMonitor(
            {
                id: 1,
                name: "API",
                type: "http",
                interval: 60,
                url: "https://example.com/",
                body: "large-request-body",
                headers: "private-header",
                basic_auth_pass: "private-password",
            },
            {
                paths: new Map([[1, ["Group", "API"]]]),
                activeStatus: new Map([[1, false]]),
                forceInactive: new Map([[1, true]]),
                maintenanceStatus: new Map([[1, true]]),
                childrenIDs: new Map(),
                tags: new Map(),
            }
        );
        assert.strictEqual(compact.pathName, "Group / API");
        assert.strictEqual(compact.forceInactive, true);
        assert.strictEqual(compact.maintenance, true);
        assert.strictEqual(compact.url, "https://example.com/");
        for (const field of ["body", "headers", "basic_auth_pass"]) {
            assert.ok(!Object.hasOwn(compact, field));
        }
    });
});
