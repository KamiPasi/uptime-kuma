const { describe, test } = require("node:test");
const assert = require("node:assert");
const Monitor = require("../../server/model/monitor");
const Heartbeat = require("../../server/model/heartbeat");
const { Notification } = require("../../server/notification");
const { UptimeKumaServer } = require("../../server/uptime-kuma-server");
const { R } = require("redbean-node");
const { RESPONSE_BODY_LENGTH_DEFAULT } = require("../../src/util");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

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

    test("responses longer than the old storage and preview limits are saved in full by default", async () => {
        const monitor = Object.create(Monitor.prototype);
        const response = JSON.stringify({ text: "完整响应😀".repeat(10000), end: "response-end" });
        const bean = {};

        await monitor.saveResponseData(bean, response);

        assert.strictEqual(await Heartbeat.decodeResponseValue(bean.response), response);
    });

    test("response max length zero does not truncate", async () => {
        const monitor = Object.create(Monitor.prototype);
        monitor.response_max_length = 0;

        const bean = {};
        const response = "unlimited response".repeat(10000);
        await monitor.saveResponseData(bean, response);

        assert.strictEqual(await Heartbeat.decodeResponseValue(bean.response), response);
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
        heartbeat._responseValidationFailed = true;

        const monitor = Object.create(Monitor.prototype);
        monitor.response_max_length = RESPONSE_BODY_LENGTH_DEFAULT;
        const storedHeartbeat = {};
        await monitor.saveResponseData(storedHeartbeat, "private response");
        heartbeat._response = storedHeartbeat.response;

        const clientJSON = heartbeat.toJSON();
        assert.strictEqual(clientJSON.id, 42);
        assert.strictEqual(clientJSON.hasResponse, true);
        assert.strictEqual(clientJSON.responseValidationFailed, true);
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
            response_validation_failed: 1,
        });

        assert.strictEqual(clientJSON.monitorID, 7);
        assert.strictEqual(clientJSON.hasResponse, true);
        assert.strictEqual(clientJSON.responseValidationFailed, true);
        assert.strictEqual(Object.hasOwn(clientJSON, "response"), false);
    });

    test("public heartbeat JSON exposes the response-validation failure marker", () => {
        const heartbeat = Object.create(Heartbeat.prototype);
        heartbeat.status = 0;
        heartbeat.time = "2026-08-05 12:00:00.000";
        heartbeat.ping = 10;
        heartbeat.responseValidationFailed = 1;

        assert.strictEqual(heartbeat.toPublicJSON().responseValidationFailed, true);
    });
});

describe("Response-validation notification shutdown", () => {
    test("only a final DOWN validation failure uses the one-shot flow", () => {
        assert.strictEqual(
            Monitor.isResponseValidationFinalDown({ status: 0, response_validation_failed: true }),
            true
        );
        assert.strictEqual(
            Monitor.isResponseValidationFinalDown({ status: 2, response_validation_failed: true }),
            false
        );
        assert.strictEqual(
            Monitor.isResponseValidationFinalDown({ status: 0, response_validation_failed: false }),
            false
        );
        assert.strictEqual(Monitor.isResponseValidationFinalDown({ status: 0, responseValidationFailed: true }), true);
        assert.strictEqual(
            Monitor.isResponseValidationFailureTrigger(
                { status: 0, responseValidationFailed: false },
                { status: 0, response_validation_failed: true }
            ),
            true
        );
        assert.strictEqual(
            Monitor.isResponseValidationFailureTrigger(
                { status: 0, responseValidationFailed: true },
                { status: 0, response_validation_failed: true }
            ),
            false
        );
        assert.strictEqual(
            Monitor.isResponseValidationFailureTrigger(
                { status: 2, responseValidationFailed: true },
                { status: 0, response_validation_failed: true }
            ),
            true
        );
    });

    test("notification provider failures still count as an attempted notification", async () => {
        const originalGetNotificationList = Monitor.getNotificationList;
        const originalPreparePreloadData = Monitor.preparePreloadData;
        const originalNotificationSend = Notification.send;
        const originalGetInstance = UptimeKumaServer.getInstance;
        let notificationMessage;

        try {
            Monitor.getNotificationList = async () => [{ name: "broken", config: "{}" }];
            Monitor.preparePreloadData = async () => ({});
            Notification.send = async (_notification, msg) => {
                notificationMessage = msg;
                throw new Error("provider failed");
            };
            UptimeKumaServer.getInstance = () => ({
                getTimezone: async () => "UTC",
                getTimezoneOffset: () => "+00:00",
            });

            const attemptedCount = await Monitor.sendNotification(
                false,
                {
                    id: 7,
                    active: 1,
                    name: "Validation monitor",
                    toJSON: () => ({ id: 7 }),
                },
                {
                    status: 0,
                    msg: "Response validation failed",
                    response_validation_failed: true,
                    toJSONAsync: async () => ({
                        status: 0,
                        msg: "Response validation failed",
                        time: "2026-08-05 12:00:00.000",
                    }),
                }
            );

            assert.strictEqual(attemptedCount, 1);
            assert.match(notificationMessage, /🟣 Down/);
        } finally {
            Monitor.getNotificationList = originalGetNotificationList;
            Monitor.preparePreloadData = originalPreparePreloadData;
            Notification.send = originalNotificationSend;
            UptimeKumaServer.getInstance = originalGetInstance;
        }
    });

    test("attempted validation notifications disable only that monitor and refresh clients", async () => {
        const originalSendNotification = Monitor.sendNotification;
        const originalExec = R.exec;
        const originalGetInstance = UptimeKumaServer.getInstance;
        const execCalls = [];
        const emitted = [];

        try {
            Monitor.sendNotification = async () => 2;
            R.exec = async (sql, params) => {
                execCalls.push({ sql, params });
            };
            UptimeKumaServer.getInstance = () => ({
                getMonitorJSONList: async () => ({
                    7: { id: 7, notificationIDList: {} },
                }),
            });

            const io = {
                to: (userID) => ({
                    emit: (event, ...args) => emitted.push({ userID, event, args }),
                }),
            };
            const monitor = { id: 7, user_id: 3, name: "Validation monitor" };
            const bean = { status: 0, response_validation_failed: true };

            const attemptedCount = await Monitor.notifyResponseValidationFailure(false, monitor, bean, io);

            assert.strictEqual(attemptedCount, 2);
            assert.deepStrictEqual(execCalls, [
                {
                    sql: "DELETE FROM monitor_notification WHERE monitor_id = ? ",
                    params: [7],
                },
            ]);
            assert.deepStrictEqual(emitted, [
                {
                    userID: 3,
                    event: "updateMonitorIntoList",
                    args: [{ 7: { id: 7, notificationIDList: {} } }],
                },
                {
                    userID: 3,
                    event: "monitorNotificationsDisabled",
                    args: [7],
                },
            ]);
        } finally {
            Monitor.sendNotification = originalSendNotification;
            R.exec = originalExec;
            UptimeKumaServer.getInstance = originalGetInstance;
        }
    });

    test("a validation failure without enabled notifications leaves settings untouched", async () => {
        const originalSendNotification = Monitor.sendNotification;
        const originalExec = R.exec;

        try {
            Monitor.sendNotification = async () => 0;
            R.exec = async () => {
                throw new Error("notification associations must not be changed");
            };

            const attemptedCount = await Monitor.notifyResponseValidationFailure(
                false,
                { id: 7, user_id: 3, name: "Validation monitor" },
                { status: 0, response_validation_failed: true },
                null
            );

            assert.strictEqual(attemptedCount, 0);
        } finally {
            Monitor.sendNotification = originalSendNotification;
            R.exec = originalExec;
        }
    });
});
