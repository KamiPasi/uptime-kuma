const { before, describe, test } = require("node:test");
const assert = require("node:assert");
let claimHeartbeatHistory;
let releaseHeartbeatHistory;
let mergeHeartbeatHistory;
before(async () => {
    ({ claimHeartbeatHistory, releaseHeartbeatHistory, mergeHeartbeatHistory } =
        await import("../../src/heartbeat-history.mjs"));
});

describe("mergeHeartbeatHistory()", () => {
    test("a delayed snapshot retains newer live beats and removes duplicates", () => {
        const history = [
            { id: 1, time: "001" },
            { id: 2, time: "002", status: 1 },
        ];
        const live = [
            { id: 2, time: "002", status: 0 },
            { id: 3, time: "003", responseValidationFailed: true },
        ];
        const result = mergeHeartbeatHistory(history, live);
        assert.deepStrictEqual(
            result.map((beat) => beat.id),
            [1, 2, 3]
        );
        assert.strictEqual(result[1].status, 0);
        assert.strictEqual(result[2].responseValidationFailed, true);
    });

    test("the initial latest-beat snapshot does not replace already loaded history", () => {
        const loaded = Array.from({ length: 100 }, (_, id) => ({ id, time: String(id).padStart(3, "0") }));
        assert.strictEqual(mergeHeartbeatHistory([loaded.at(-1)], loaded).length, 100);
    });

    test("retains at most the newest 150 beats", () => {
        const history = Array.from({ length: 200 }, (_, id) => ({ id, time: String(id).padStart(3, "0") }));
        const result = mergeHeartbeatHistory(history, []);
        assert.strictEqual(result.length, 150);
        assert.strictEqual(result[0].id, 50);
        assert.strictEqual(result.at(-1).id, 199);
    });
});

describe("heartbeat history requests", () => {
    test("claims a monitor once", () => {
        const requested = new Set();

        assert.strictEqual(claimHeartbeatHistory(requested, 42), true);
        assert.strictEqual(claimHeartbeatHistory(requested, 42), false);
    });

    test("tracks each monitor separately", () => {
        const requested = new Set();

        assert.strictEqual(claimHeartbeatHistory(requested, 1), true);
        assert.strictEqual(claimHeartbeatHistory(requested, 2), true);
        assert.deepStrictEqual([...requested], [1, 2]);
    });

    test("allows a retry after the request is released", () => {
        const requested = new Set();

        claimHeartbeatHistory(requested, 7);
        releaseHeartbeatHistory(requested, 7);

        assert.strictEqual(claimHeartbeatHistory(requested, 7), true);
    });

    test("releasing an unknown monitor is a no-op", () => {
        const requested = new Set();

        releaseHeartbeatHistory(requested, 9);

        assert.strictEqual(requested.size, 0);
    });
});
