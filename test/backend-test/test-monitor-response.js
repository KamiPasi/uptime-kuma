const { describe, test } = require("node:test");
const assert = require("node:assert");
const Monitor = require("../../server/model/monitor");
const Heartbeat = require("../../server/model/heartbeat");
const { RESPONSE_BODY_LENGTH_DEFAULT } = require("../../src/util");

describe("Monitor response saving", () => {
    test("getSaveResponse and getSaveErrorResponse parse booleans", () => {
        const monitor = Object.create(Monitor.prototype);
        monitor.save_response = 1;
        monitor.save_error_response = 0;

        assert.strictEqual(monitor.getSaveResponse(), true);
        assert.strictEqual(monitor.getSaveErrorResponse(), false);
    });

    test("saveResponseData stores and truncates response", async () => {
        const monitor = Object.create(Monitor.prototype);
        monitor.response_max_length = 5;

        const bean = {};
        await monitor.saveResponseData(bean, "abcdef");

        assert.strictEqual(await Heartbeat.decodeResponseValue(bean.response), "abcde... (truncated)");
    });

    test("saveResponseData stringifies objects", async () => {
        const monitor = Object.create(Monitor.prototype);
        monitor.response_max_length = RESPONSE_BODY_LENGTH_DEFAULT;

        const bean = {};
        await monitor.saveResponseData(bean, { ok: true });

        assert.strictEqual(await Heartbeat.decodeResponseValue(bean.response), JSON.stringify({ ok: true }));
    });

    test("response max length zero does not truncate", async () => {
        const monitor = Object.create(Monitor.prototype);
        monitor.response_max_length = 0;

        const bean = {};
        await monitor.saveResponseData(bean, "unlimited response");

        assert.strictEqual(await Heartbeat.decodeResponseValue(bean.response), "unlimited response");
    });

    test("client heartbeat JSON exposes only response availability", async () => {
        const heartbeat = Object.create(Heartbeat.prototype);
        heartbeat._id = 42;
        heartbeat._monitorId = 7;
        heartbeat._status = 1;
        heartbeat._time = "2026-08-05 12:00:00.000";
        heartbeat._msg = "200 - OK";
        heartbeat._ping = 10;
        heartbeat._important = 0;
        heartbeat._duration = 60;
        heartbeat._retries = 0;

        const monitor = Object.create(Monitor.prototype);
        monitor.response_max_length = RESPONSE_BODY_LENGTH_DEFAULT;
        const storedHeartbeat = {};
        await monitor.saveResponseData(storedHeartbeat, "private response");
        heartbeat._response = storedHeartbeat.response;

        const clientJSON = heartbeat.toJSON();
        assert.strictEqual(clientJSON.id, 42);
        assert.strictEqual(clientJSON.hasResponse, true);
        assert.strictEqual(Object.hasOwn(clientJSON, "response"), false);

        const notificationJSON = await heartbeat.toJSONAsync({ decodeResponse: true });
        assert.strictEqual(notificationJSON.response, "private response");
    });

    test("raw heartbeat rows are converted to the client-safe shape", () => {
        const clientJSON = Heartbeat.toClientJSON({
            id: 42,
            monitor_id: 7,
            status: 0,
            time: "2026-08-05 12:00:00.000",
            msg: "503",
            response: "must-not-leak",
        });

        assert.strictEqual(clientJSON.monitorID, 7);
        assert.strictEqual(clientJSON.hasResponse, true);
        assert.strictEqual(Object.hasOwn(clientJSON, "response"), false);
    });
});
