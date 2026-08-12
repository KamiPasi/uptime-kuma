const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const Monitor = require("../../server/model/monitor");

const {
    RESPONSE_VALIDATION_LIMITS,
    ResponseValidationError,
    evaluateResponseValidation,
    evaluateResponseValidationPath,
    normalizeResponseValidationRulesForStorage,
    parseResponseValidationPath,
    statusCodeMatches,
    validateResponseValidationRules,
} = require("../../server/response-validation");
const {
    RESPONSE_VALIDATION_JSON_PREVIEW_MAX_DEPTH,
    RESPONSE_VALIDATION_JSON_PREVIEW_MAX_NODES,
    RESPONSE_VALIDATION_PREVIEW_VALUE_MAX_LENGTH,
    createResponseValidationPreview,
    isResponseValidationJsonPreviewSafe,
} = require("../../server/response-validation-preview");

let nextID = 0;

/**
 * @param {Partial<object>} overrides Condition overrides
 * @returns {object} Valid response validation condition
 */
function condition(overrides = {}) {
    nextID += 1;
    return {
        id: `condition-${nextID}`,
        type: "condition",
        source: "json",
        path: "value",
        operator: "equals",
        valueType: "number",
        expectedValue: 1,
        ...overrides,
    };
}

/**
 * @param {object[]} children Child nodes
 * @param {Partial<object>} overrides Group overrides
 * @returns {object} Valid response validation group
 */
function group(children, overrides = {}) {
    nextID += 1;
    return {
        id: `group-${nextID}`,
        type: "group",
        combinator: "and",
        children,
        ...overrides,
    };
}

/**
 * @param {Partial<object>} overrides Scenario overrides
 * @returns {object} Valid response validation scenario
 */
function scenario(overrides = {}) {
    nextID += 1;
    return {
        id: `scenario-${nextID}`,
        statusCodes: ["200"],
        root: group([condition()]),
        ...overrides,
    };
}

/**
 * @param {object[]} scenarios Response validation scenarios
 * @returns {object} Response validation rule set
 */
function rules(scenarios = [scenario()]) {
    return {
        version: 1,
        scenarios,
    };
}

/**
 * @param {Partial<Monitor>} overrides Monitor field overrides
 * @returns {Monitor} Minimal monitor suitable for validate() tests
 */
function monitor(overrides = {}) {
    const result = Object.create(Monitor.prototype);
    Object.assign(result, {
        interval: 60,
        retryInterval: 60,
        type: "http",
        response_validation_enabled: false,
        response_validation_rules_json: JSON.stringify(rules([])),
        ...overrides,
    });
    return result;
}

/**
 * @param {() => unknown} callback Validation callback
 * @param {string} expectedCode Expected stable validation error code
 * @returns {void}
 */
function assertValidationError(callback, expectedCode) {
    assert.throws(callback, (error) => {
        assert.ok(error instanceof ResponseValidationError);
        assert.strictEqual(error.code, expectedCode);
        return true;
    });
}

describe("response validation configuration", () => {
    test("validateResponseValidationRules() normalizes empty configurations", async () => {
        const emptyRules = { version: 1, scenarios: [] };

        assert.deepStrictEqual(validateResponseValidationRules(null), emptyRules);
        assert.deepStrictEqual(validateResponseValidationRules(undefined), emptyRules);
        assert.deepStrictEqual(validateResponseValidationRules(""), emptyRules);
        assert.deepStrictEqual(validateResponseValidationRules(emptyRules), emptyRules);

        for (const input of [null, undefined, "", emptyRules]) {
            const result = await evaluateResponseValidation(input, 500, { ignored: true });
            assert.strictEqual(result.passed, true);
            assert.strictEqual(result.scenarioId, null);
            assert.strictEqual(result.root, null);
        }
    });

    test("validateResponseValidationRules() returns a deep clone for a valid configuration", () => {
        const input = rules([
            scenario({
                id: "success-response",
                root: group([
                    condition({
                        id: "input-token-count",
                        path: "responses.usage.input_tokens",
                        expectedValue: 7,
                    }),
                ]),
            }),
        ]);

        const normalized = validateResponseValidationRules(input);

        assert.deepStrictEqual(normalized, input);
        assert.notStrictEqual(normalized, input);
        assert.notStrictEqual(normalized.scenarios, input.scenarios);
        assert.notStrictEqual(normalized.scenarios[0].root, input.scenarios[0].root);

        input.scenarios[0].root.children[0].expectedValue = 8;
        assert.strictEqual(normalized.scenarios[0].root.children[0].expectedValue, 7);
    });

    test("validateResponseValidationRules() rejects an unsupported version", () => {
        assertValidationError(() => validateResponseValidationRules({ version: 2, scenarios: [] }), "invalid_version");
    });

    test("validateResponseValidationRules() rejects duplicate scenario and node IDs", () => {
        assertValidationError(
            () =>
                validateResponseValidationRules(
                    rules([
                        scenario({ id: "duplicate", statusCodes: ["200"] }),
                        scenario({ id: "duplicate", statusCodes: ["400"] }),
                    ])
                ),
            "duplicate_scenario_id"
        );

        assertValidationError(
            () =>
                validateResponseValidationRules(
                    rules([
                        scenario({
                            root: group([
                                condition({ id: "duplicate-node", path: "first" }),
                                condition({ id: "duplicate-node", path: "second" }),
                            ]),
                        }),
                    ])
                ),
            "duplicate_node_id"
        );
    });

    test("validateResponseValidationRules() rejects malformed status codes", () => {
        const invalidPatterns = ["", "abc", "99", "600", "200-", "400-399", "200-299-300"];

        for (const statusCode of invalidPatterns) {
            assertValidationError(
                () => validateResponseValidationRules(rules([scenario({ statusCodes: [statusCode] })])),
                "invalid_status_code"
            );
        }
    });

    test("validateResponseValidationRules() rejects duplicate and overlapping status coverage", () => {
        assert.throws(
            () => validateResponseValidationRules(rules([scenario({ statusCodes: ["200", "200"] })])),
            (error) => error instanceof ResponseValidationError && error.code === "overlapping_status_codes"
        );

        assert.throws(
            () => validateResponseValidationRules(rules([scenario({ statusCodes: ["200-299", "200"] })])),
            (error) => error instanceof ResponseValidationError && error.code === "overlapping_status_codes"
        );

        assert.throws(
            () =>
                validateResponseValidationRules(
                    rules([
                        scenario({ id: "success-range", statusCodes: ["200-299"] }),
                        scenario({ id: "specific-success", statusCodes: ["200"] }),
                    ])
                ),
            (error) => error instanceof ResponseValidationError && error.code === "overlapping_status_codes"
        );

        assert.throws(
            () =>
                validateResponseValidationRules(
                    rules([
                        scenario({ id: "first-client-error", statusCodes: ["400"] }),
                        scenario({ id: "second-client-error", statusCodes: ["400"] }),
                    ])
                ),
            (error) => error instanceof ResponseValidationError && error.code === "overlapping_status_codes"
        );
    });

    test("validateResponseValidationRules() rejects an unknown condition operator", () => {
        const input = rules([
            scenario({
                root: group([condition({ operator: "matchesRegex" })]),
            }),
        ]);

        assertValidationError(() => validateResponseValidationRules(input), "invalid_operator");
    });

    test("validateResponseValidationRules() rejects invalid combinators, sources, and value types", () => {
        assertValidationError(
            () =>
                validateResponseValidationRules(
                    rules([
                        scenario({
                            root: group([condition()], { combinator: "xor" }),
                        }),
                    ])
                ),
            "invalid_combinator"
        );

        assertValidationError(
            () =>
                validateResponseValidationRules(
                    rules([
                        scenario({
                            root: group([condition({ source: "header" })]),
                        }),
                    ])
                ),
            "invalid_source"
        );

        assertValidationError(
            () =>
                validateResponseValidationRules(
                    rules([
                        scenario({
                            root: group([condition({ valueType: "integer" })]),
                        }),
                    ])
                ),
            "invalid_value_type"
        );
    });

    test("validateResponseValidationRules() rejects an empty JSON path", () => {
        const input = rules([
            scenario({
                root: group([condition({ path: "   " })]),
            }),
        ]);

        assertValidationError(() => validateResponseValidationRules(input), "invalid_path");
    });

    test("validateResponseValidationRules() rejects malformed or executable paths", () => {
        const invalidPaths = [
            "responses[",
            "$number(value)",
            "($f:=function($x){$f($x)};$f(1))",
            "items[0..100]",
            "items.*",
            "items[foo]",
        ];

        for (const path of invalidPaths) {
            const input = rules([
                scenario({
                    root: group([condition({ path })]),
                }),
            ]);
            assertValidationError(() => validateResponseValidationRules(input), "invalid_path");
        }
    });

    test("normalizeResponseValidationRulesForStorage() discards only invalid disabled drafts", () => {
        const incomplete = rules([
            scenario({
                root: group([condition({ path: "" })]),
            }),
        ]);
        const valid = rules([scenario({ statusCodes: ["200"] })]);

        assert.deepStrictEqual(normalizeResponseValidationRulesForStorage(incomplete, false), {
            version: 1,
            scenarios: [],
        });
        assert.deepStrictEqual(normalizeResponseValidationRulesForStorage(valid, false), valid);
        assertValidationError(() => normalizeResponseValidationRulesForStorage(incomplete, true), "invalid_path");
    });

    test("validateResponseValidationRules() rejects an empty group", () => {
        const input = rules([
            scenario({
                root: group([]),
            }),
        ]);

        assertValidationError(() => validateResponseValidationRules(input), "empty_group");
    });

    test("validateResponseValidationRules() rejects mismatched expected-value types", () => {
        const invalidValues = [
            { valueType: "string", expectedValue: 7 },
            { valueType: "number", expectedValue: "7" },
            { valueType: "boolean", expectedValue: "true" },
            { valueType: "null", expectedValue: false },
        ];

        for (const invalidValue of invalidValues) {
            const input = rules([
                scenario({
                    root: group([condition(invalidValue)]),
                }),
            ]);
            assertValidationError(() => validateResponseValidationRules(input), "invalid_expected_value");
        }
    });

    test("validateResponseValidationRules() normalizes existence operators without an expected value", () => {
        const input = rules([
            scenario({
                root: group([
                    condition({
                        operator: "exists",
                        valueType: undefined,
                        expectedValue: undefined,
                    }),
                    condition({
                        operator: "notExists",
                        valueType: undefined,
                        expectedValue: undefined,
                    }),
                ]),
            }),
        ]);

        const normalized = validateResponseValidationRules(input);

        for (const child of normalized.scenarios[0].root.children) {
            assert.strictEqual(child.valueType, "null");
            assert.strictEqual(child.expectedValue, null);
        }
    });

    test("validateResponseValidationRules() enforces scenario and status-code limits", () => {
        const maximumScenarios = Array.from({ length: RESPONSE_VALIDATION_LIMITS.maxScenarios }, (_, index) =>
            scenario({ id: `valid-scenario-${index}`, statusCodes: [String(100 + index)] })
        );
        assert.doesNotThrow(() => validateResponseValidationRules(rules(maximumScenarios)));

        const tooManyScenarios = Array.from({ length: RESPONSE_VALIDATION_LIMITS.maxScenarios + 1 }, (_, index) =>
            scenario({ id: `scenario-${index}`, statusCodes: [String(100 + index)] })
        );
        assertValidationError(() => validateResponseValidationRules(rules(tooManyScenarios)), "too_many_scenarios");

        const maximumStatusCodes = Array.from(
            { length: RESPONSE_VALIDATION_LIMITS.maxStatusCodesPerScenario },
            (_, index) => String(200 + index)
        );
        assert.doesNotThrow(() =>
            validateResponseValidationRules(rules([scenario({ statusCodes: maximumStatusCodes })]))
        );

        const tooManyStatusCodes = Array.from(
            { length: RESPONSE_VALIDATION_LIMITS.maxStatusCodesPerScenario + 1 },
            (_, index) => String(200 + index)
        );
        assertValidationError(
            () => validateResponseValidationRules(rules([scenario({ statusCodes: tooManyStatusCodes })])),
            "too_many_status_codes"
        );
    });

    test("validateResponseValidationRules() enforces total-node limit", () => {
        const maximumChildren = Array.from({ length: RESPONSE_VALIDATION_LIMITS.maxTotalNodes - 1 }, (_, index) =>
            condition({ id: `valid-condition-${index}` })
        );
        assert.doesNotThrow(() => validateResponseValidationRules(rules([scenario({ root: group(maximumChildren) })])));

        const children = Array.from({ length: RESPONSE_VALIDATION_LIMITS.maxTotalNodes }, (_, index) =>
            condition({ id: `condition-${index}` })
        );
        const input = rules([scenario({ root: group(children) })]);

        assertValidationError(() => validateResponseValidationRules(input), "too_many_nodes");
    });

    test("validateResponseValidationRules() enforces nesting-depth limit", () => {
        let maximumDepthRoot = condition();
        for (let depth = 1; depth < RESPONSE_VALIDATION_LIMITS.maxDepth; depth++) {
            maximumDepthRoot = group([maximumDepthRoot]);
        }
        assert.doesNotThrow(() => validateResponseValidationRules(rules([scenario({ root: maximumDepthRoot })])));

        let root = condition();
        for (let depth = 0; depth < RESPONSE_VALIDATION_LIMITS.maxDepth; depth++) {
            root = group([root]);
        }
        const input = rules([scenario({ root })]);

        assertValidationError(() => validateResponseValidationRules(input), "max_depth_exceeded");
    });

    test("validateResponseValidationRules() enforces ID, path, and expected-string limits", () => {
        assertValidationError(
            () =>
                validateResponseValidationRules(
                    rules([scenario({ id: "s".repeat(RESPONSE_VALIDATION_LIMITS.maxIdLength + 1) })])
                ),
            "id_too_long"
        );

        assertValidationError(
            () =>
                validateResponseValidationRules(
                    rules([
                        scenario({
                            root: group([
                                condition({ path: "p".repeat(RESPONSE_VALIDATION_LIMITS.maxPathLength + 1) }),
                            ]),
                        }),
                    ])
                ),
            "path_too_long"
        );

        assertValidationError(
            () =>
                validateResponseValidationRules(
                    rules([
                        scenario({
                            root: group([
                                condition({
                                    valueType: "string",
                                    expectedValue: "x".repeat(RESPONSE_VALIDATION_LIMITS.maxExpectedStringLength + 1),
                                }),
                            ]),
                        }),
                    ])
                ),
            "expected_value_too_long"
        );
    });
});

describe("response validation status helpers", () => {
    test("statusCodeMatches() supports exact status codes and inclusive ranges", () => {
        assert.strictEqual(statusCodeMatches(200, ["200"]), true);
        assert.strictEqual(statusCodeMatches(201, ["200"]), false);
        assert.strictEqual(statusCodeMatches(400, ["400-499"]), true);
        assert.strictEqual(statusCodeMatches(499, ["400-499"]), true);
        assert.strictEqual(statusCodeMatches(500, ["400-499"]), false);
    });
});

describe("response validation field paths", () => {
    test("plain selectors support roots, arrays, and escaped quoted field names", () => {
        const path = "$.responses.items[0].`error-message`.`a\\\\b`";
        const body = {
            responses: {
                items: [
                    {
                        "error-message": {
                            "a\\b": 7,
                        },
                    },
                ],
            },
        };

        assert.deepStrictEqual(parseResponseValidationPath(path), ["responses", "items", 0, "error-message", "a\\b"]);
        assert.strictEqual(evaluateResponseValidationPath(path, body), 7);
        assert.strictEqual(evaluateResponseValidationPath("responses.items[0].missing", body), undefined);
        assert.strictEqual(evaluateResponseValidationPath("$", body), body);
    });

    test("field selectors never traverse inherited properties", () => {
        assert.strictEqual(evaluateResponseValidationPath("constructor.constructor", {}), undefined);
        assert.strictEqual(evaluateResponseValidationPath("toString", {}), undefined);
    });
});

describe("Monitor response validation configuration", () => {
    test("validate() accepts an empty persisted configuration while validation is disabled", () => {
        assert.doesNotThrow(() => monitor().validate());
    });

    test("validate() rejects an enabled response validator without scenarios", () => {
        assert.throws(
            () => monitor({ response_validation_enabled: true }).validate(),
            (error) => error instanceof ResponseValidationError && error.code === "empty_scenarios"
        );
    });

    test("validate() rejects response validation for a non-HTTP monitor", () => {
        assert.throws(
            () =>
                monitor({
                    type: "keyword",
                    response_validation_enabled: true,
                    response_validation_rules_json: JSON.stringify(rules()),
                }).validate(),
            (error) => error instanceof ResponseValidationError && error.code === "unsupported_monitor_type"
        );
    });

    test("validate() accepts valid enabled HTTP response-validation rules", () => {
        assert.doesNotThrow(() =>
            monitor({
                response_validation_enabled: true,
                response_validation_rules_json: JSON.stringify(rules()),
            }).validate()
        );
    });

    test("getResponseValidationRules() rejects malformed persisted JSON", () => {
        assert.throws(
            () => monitor({ response_validation_rules_json: "{" }).getResponseValidationRules(),
            (error) => error instanceof ResponseValidationError && error.code === "invalid_rules"
        );
    });

    test("buildHttpRequestOptions() preserves legacy accepted 401 behavior while validation is disabled", async () => {
        const testMonitor = monitor({
            name: "oauth compatibility",
            url: "https://example.com",
            method: "GET",
            timeout: 10,
            maxredirects: 0,
            accepted_statuscodes_json: JSON.stringify(["401"]),
            auth_method: "oauth2-cc",
            oauthAccessToken: {
                token_type: "Bearer",
                access_token: "test-token",
                expires_at: Math.floor(Date.now() / 1000) + 3600,
            },
        });

        const options = await testMonitor.buildHttpRequestOptions();

        assert.strictEqual(options.validateStatus(401), true);
    });

    test("buildHttpRequestOptions() gives OAuth refresh priority over an enabled 401 scenario", async () => {
        const validationRules = rules([scenario({ statusCodes: ["401"] })]);
        const testMonitor = monitor({
            name: "oauth response validation",
            url: "https://example.com",
            method: "GET",
            timeout: 10,
            maxredirects: 0,
            accepted_statuscodes_json: JSON.stringify(["200-299"]),
            auth_method: "oauth2-cc",
            oauthAccessToken: {
                token_type: "Bearer",
                access_token: "test-token",
                expires_at: Math.floor(Date.now() / 1000) + 3600,
            },
            response_validation_enabled: true,
            response_validation_rules_json: JSON.stringify(validationRules),
        });

        const options = await testMonitor.buildHttpRequestOptions();

        assert.strictEqual(options.validateStatus(401), false);
    });

    test("buildHttpRequestOptions() gives an NTLM challenge priority over an enabled 401 scenario", async () => {
        const validationRules = rules([scenario({ statusCodes: ["401"] })]);
        const testMonitor = monitor({
            name: "ntlm response validation",
            url: "https://example.com",
            method: "GET",
            timeout: 10,
            maxredirects: 0,
            accepted_statuscodes_json: JSON.stringify(["200-299"]),
            auth_method: "ntlm",
            response_validation_enabled: true,
            response_validation_rules_json: JSON.stringify(validationRules),
        });

        const options = await testMonitor.buildHttpRequestOptions();

        assert.strictEqual(options.validateStatus(401), false);
    });

    test("buildHttpRequestOptions() preserves accepted statuses and adds configured scenario statuses", async () => {
        const testMonitor = monitor({
            name: "status fallback",
            url: "https://example.com",
            method: "GET",
            timeout: 10,
            maxredirects: 0,
            accepted_statuscodes_json: JSON.stringify(["200-299", "304"]),
            response_validation_enabled: true,
            response_validation_rules_json: JSON.stringify(rules([scenario({ statusCodes: ["400"] })])),
        });

        const options = await testMonitor.buildHttpRequestOptions();

        assert.strictEqual(options.validateStatus(204), true);
        assert.strictEqual(options.validateStatus(304), true);
        assert.strictEqual(options.validateStatus(400), true);
        assert.strictEqual(options.validateStatus(500), false);
    });

    test("toJSON() includes rules only in the sensitive monitor representation", () => {
        const validationRules = rules([
            scenario({
                root: group([
                    condition({
                        valueType: "string",
                        expectedValue: "private expected value",
                    }),
                ]),
            }),
        ]);
        const testMonitor = monitor({
            id: 1,
            name: "safe monitor JSON",
            accepted_statuscodes_json: JSON.stringify(["200-299"]),
            kafkaProducerBrokers: "[]",
            kafkaProducerSaslOptions: "{}",
            rabbitmqNodes: "[]",
            conditions: "[]",
            response_validation_enabled: true,
            response_validation_rules_json: JSON.stringify(validationRules),
        });
        const preloadData = {
            paths: new Map([[1, []]]),
            childrenIDs: new Map([[1, []]]),
            activeStatus: new Map([[1, false]]),
            forceInactive: new Map([[1, false]]),
            notifications: new Map([[1, {}]]),
            tags: new Map([[1, []]]),
            maintenanceStatus: new Map([[1, false]]),
        };

        const publicMonitor = testMonitor.toJSON(preloadData, false);
        const privateMonitor = testMonitor.toJSON(preloadData, true);

        assert.strictEqual(publicMonitor.responseValidationEnabled, true);
        assert.strictEqual(Object.hasOwn(publicMonitor, "responseValidationRules"), false);
        assert.deepStrictEqual(publicMonitor.accepted_statuscodes, ["200-299"]);
        assert.deepStrictEqual(privateMonitor.accepted_statuscodes, ["200-299"]);
        assert.deepStrictEqual(privateMonitor.responseValidationRules, validationRules);
    });
});

describe("response validation evaluation", () => {
    test("evaluateResponseValidation() applies independent rules for the 200 and 400 response shapes", async () => {
        const input = rules([
            scenario({
                id: "status-200",
                statusCodes: ["200"],
                root: group([
                    condition({
                        path: "responses.usage.input_tokens",
                        expectedValue: 7,
                    }),
                ]),
            }),
            scenario({
                id: "status-400",
                statusCodes: ["400"],
                root: group([
                    condition({
                        path: "responses.error.message",
                        operator: "contains",
                        valueType: "string",
                        expectedValue: "not supported",
                    }),
                ]),
            }),
        ]);

        const success = await evaluateResponseValidation(input, 200, {
            responses: { usage: { input_tokens: 7 } },
        });
        assert.strictEqual(success.passed, true);
        assert.strictEqual(success.scenarioId, "status-200");

        const expectedClientError = await evaluateResponseValidation(input, 400, {
            responses: { error: { message: "This operation is not supported" } },
        });
        assert.strictEqual(expectedClientError.passed, true);
        assert.strictEqual(expectedClientError.scenarioId, "status-400");
    });

    test("evaluateResponseValidation() passes when a 200 response has exactly seven input tokens", async () => {
        const input = rules([
            scenario({
                id: "status-200",
                root: group([
                    condition({
                        id: "input-tokens",
                        path: "responses.usage.input_tokens",
                        expectedValue: 7,
                    }),
                ]),
            }),
        ]);

        const result = await evaluateResponseValidation(input, 200, {
            responses: { usage: { input_tokens: 7 } },
        });

        assert.strictEqual(result.passed, true);
        assert.strictEqual(result.statusCode, 200);
        assert.strictEqual(result.scenarioId, "status-200");
        assert.strictEqual(result.root.passed, true);
        assert.strictEqual(result.root.children[0].actualValue, 7);
        assert.strictEqual(result.root.children[0].exists, true);
    });

    test("evaluateResponseValidation() fails and reports the actual value for a 200 token mismatch", async () => {
        const input = rules([
            scenario({
                id: "status-200",
                root: group([
                    condition({
                        id: "input-tokens",
                        path: "responses.usage.input_tokens",
                        expectedValue: 7,
                    }),
                ]),
            }),
        ]);

        const result = await evaluateResponseValidation(input, 200, {
            responses: { usage: { input_tokens: 8 } },
        });

        assert.strictEqual(result.passed, false);
        assert.strictEqual(result.root.children[0].passed, false);
        assert.strictEqual(result.root.children[0].actualValue, 8);
        assert.strictEqual(result.root.children[0].expectedValue, 7);
        assert.match(result.message, /responses\.usage\.input_tokens/);
        assert.doesNotMatch(result.message, /actual 8/);
        assert.strictEqual(result.root.children[0].reason, "Comparison did not pass.");
    });

    test("evaluateResponseValidation() supports contains and notContains for a 400 error message", async () => {
        const containsRules = rules([
            scenario({
                id: "status-400",
                statusCodes: ["400"],
                root: group([
                    condition({
                        id: "supported-error",
                        path: "responses.error.message",
                        operator: "contains",
                        valueType: "string",
                        expectedValue: "not supported",
                    }),
                ]),
            }),
        ]);
        const body = { responses: { error: { message: "This model is not supported here" } } };

        const contains = await evaluateResponseValidation(containsRules, 400, body);
        assert.strictEqual(contains.passed, true);

        const notContainsRules = structuredClone(containsRules);
        notContainsRules.scenarios[0].root.children[0].operator = "notContains";
        notContainsRules.scenarios[0].root.children[0].expectedValue = "temporarily unavailable";
        const notContains = await evaluateResponseValidation(notContainsRules, 400, body);
        assert.strictEqual(notContains.passed, true);

        notContainsRules.scenarios[0].root.children[0].expectedValue = "not supported";
        const rejected = await evaluateResponseValidation(notContainsRules, 400, body);
        assert.strictEqual(rejected.passed, false);
    });

    test("evaluateResponseValidation() evaluates nested AND and OR groups", async () => {
        const input = rules([
            scenario({
                root: group([
                    condition({ path: "enabled", valueType: "boolean", expectedValue: true }),
                    group(
                        [
                            condition({ path: "choice", expectedValue: 1 }),
                            condition({ path: "choice", expectedValue: 2 }),
                        ],
                        { combinator: "or" }
                    ),
                ]),
            }),
        ]);

        assert.strictEqual((await evaluateResponseValidation(input, 200, { enabled: true, choice: 1 })).passed, true);
        assert.strictEqual((await evaluateResponseValidation(input, 200, { enabled: true, choice: 2 })).passed, true);
        assert.strictEqual((await evaluateResponseValidation(input, 200, { enabled: true, choice: 3 })).passed, false);
        assert.strictEqual((await evaluateResponseValidation(input, 200, { enabled: false, choice: 1 })).passed, false);
    });

    test("evaluateResponseValidation() reports a failure that actually caused the root group to fail", async () => {
        const input = rules([
            scenario({
                root: group([
                    group(
                        [
                            condition({ id: "choice-one", path: "choice", expectedValue: 1 }),
                            condition({ id: "choice-two", path: "choice", expectedValue: 2 }),
                        ],
                        { id: "choice-group", combinator: "or" }
                    ),
                    condition({
                        id: "enabled-condition",
                        path: "enabled",
                        valueType: "boolean",
                        expectedValue: true,
                    }),
                ]),
            }),
        ]);

        const result = await evaluateResponseValidation(input, 200, { enabled: false, choice: 2 });
        assert.strictEqual(result.passed, false);
        assert.match(result.message, /"enabled"/);
        assert.doesNotMatch(result.message, /"choice"/);
    });

    test("evaluateResponseValidation() short-circuits AND and OR groups unless collectAll is enabled", async () => {
        const orRules = rules([
            scenario({
                root: group(
                    [
                        condition({ id: "first-true", path: "value", expectedValue: 1 }),
                        condition({
                            id: "second-false",
                            path: "missing",
                            operator: "exists",
                            valueType: "null",
                            expectedValue: null,
                        }),
                    ],
                    { combinator: "or" }
                ),
            }),
        ]);

        const shortOr = await evaluateResponseValidation(orRules, 200, { value: 1 });
        assert.strictEqual(shortOr.passed, true);
        assert.deepStrictEqual(
            shortOr.root.children.map((child) => child.id),
            ["first-true"]
        );

        const allOr = await evaluateResponseValidation(orRules, 200, { value: 1 }, { collectAll: true });
        assert.strictEqual(allOr.passed, true);
        assert.deepStrictEqual(
            allOr.root.children.map((child) => [child.id, child.passed]),
            [
                ["first-true", true],
                ["second-false", false],
            ]
        );

        const andRules = rules([
            scenario({
                root: group([
                    condition({ id: "first-false", path: "value", expectedValue: 2 }),
                    condition({ id: "second-true", path: "value", expectedValue: 1 }),
                ]),
            }),
        ]);

        const shortAnd = await evaluateResponseValidation(andRules, 200, { value: 1 });
        assert.strictEqual(shortAnd.passed, false);
        assert.deepStrictEqual(
            shortAnd.root.children.map((child) => child.id),
            ["first-false"]
        );

        const allAnd = await evaluateResponseValidation(andRules, 200, { value: 1 }, { collectAll: true });
        assert.strictEqual(allAnd.passed, false);
        assert.deepStrictEqual(
            allAnd.root.children.map((child) => [child.id, child.passed]),
            [
                ["first-false", false],
                ["second-true", true],
            ]
        );
    });

    test("evaluateResponseValidation() distinguishes missing paths from existing null values", async () => {
        const input = rules([
            scenario({
                root: group([
                    condition({
                        id: "nullable-present",
                        path: "nullable",
                        operator: "exists",
                        valueType: "null",
                        expectedValue: null,
                    }),
                    condition({
                        id: "optional-missing",
                        path: "optional",
                        operator: "notExists",
                        valueType: "null",
                        expectedValue: null,
                    }),
                ]),
            }),
        ]);

        const result = await evaluateResponseValidation(input, 200, { nullable: null }, { collectAll: true });

        assert.strictEqual(result.passed, true);
        assert.strictEqual(result.root.children[0].exists, true);
        assert.strictEqual(result.root.children[0].actualValue, null);
        assert.strictEqual(result.root.children[1].exists, false);
        assert.strictEqual(result.root.children[1].actualValue, null);

        const missingRequired = await evaluateResponseValidation(
            rules([
                scenario({
                    root: group([
                        condition({
                            path: "missing",
                            operator: "exists",
                            valueType: "null",
                            expectedValue: null,
                        }),
                    ]),
                }),
            ]),
            200,
            {}
        );
        assert.strictEqual(missingRequired.passed, false);
        assert.strictEqual(missingRequired.root.children[0].exists, false);
        assert.match(missingRequired.root.children[0].reason, /resolve|exist/i);
    });

    test("evaluateResponseValidation() compares string, number, boolean, and null values strictly", async () => {
        const input = rules([
            scenario({
                root: group([
                    condition({ path: "stringValue", valueType: "string", expectedValue: "7" }),
                    condition({ path: "numberValue", valueType: "number", expectedValue: 7 }),
                    condition({ path: "booleanValue", valueType: "boolean", expectedValue: true }),
                    condition({ path: "nullValue", valueType: "null", expectedValue: null }),
                ]),
            }),
        ]);

        const matching = await evaluateResponseValidation(
            input,
            200,
            { stringValue: "7", numberValue: 7, booleanValue: true, nullValue: null },
            { collectAll: true }
        );
        assert.strictEqual(matching.passed, true);

        const mismatching = await evaluateResponseValidation(
            input,
            200,
            { stringValue: 7, numberValue: "7", booleanValue: "true", nullValue: "null" },
            { collectAll: true }
        );
        assert.strictEqual(mismatching.passed, false);
        assert.deepStrictEqual(
            mismatching.root.children.map((child) => child.passed),
            [false, false, false, false]
        );
    });

    test("evaluateResponseValidation() applies notEquals without coercing values", async () => {
        const input = rules([
            scenario({
                root: group([
                    condition({
                        path: "value",
                        operator: "notEquals",
                        valueType: "number",
                        expectedValue: 7,
                    }),
                ]),
            }),
        ]);

        assert.strictEqual((await evaluateResponseValidation(input, 200, { value: 8 })).passed, true);
        assert.strictEqual((await evaluateResponseValidation(input, 200, { value: 7 })).passed, false);

        const wrongType = await evaluateResponseValidation(input, 200, { value: "8" });
        assert.strictEqual(wrongType.passed, false);
        assert.match(wrongType.root.children[0].reason, /type|number/i);
    });

    test("evaluateResponseValidation() treats notEquals null as present and non-null", async () => {
        const input = rules([
            scenario({
                root: group([
                    condition({
                        path: "value",
                        operator: "notEquals",
                        valueType: "null",
                        expectedValue: null,
                    }),
                ]),
            }),
        ]);

        assert.strictEqual((await evaluateResponseValidation(input, 200, { value: "text" })).passed, true);
        assert.strictEqual((await evaluateResponseValidation(input, 200, { value: 7 })).passed, true);
        assert.strictEqual((await evaluateResponseValidation(input, 200, { value: false })).passed, true);
        assert.strictEqual((await evaluateResponseValidation(input, 200, { value: null })).passed, false);

        const missing = await evaluateResponseValidation(input, 200, {});
        assert.strictEqual(missing.passed, false);
        assert.strictEqual(missing.root.children[0].exists, false);
    });

    test("evaluateResponseValidation() supports all numeric comparison operators", async () => {
        const input = rules([
            scenario({
                root: group([
                    condition({ path: "value", operator: "greaterThan", expectedValue: 6 }),
                    condition({ path: "value", operator: "greaterThanOrEqual", expectedValue: 7 }),
                    condition({ path: "value", operator: "lessThan", expectedValue: 8 }),
                    condition({ path: "value", operator: "lessThanOrEqual", expectedValue: 7 }),
                ]),
            }),
        ]);

        const result = await evaluateResponseValidation(input, 200, { value: 7 }, { collectAll: true });

        assert.strictEqual(result.passed, true);
        assert.deepStrictEqual(
            result.root.children.map((child) => child.passed),
            [true, true, true, true]
        );

        const wrongType = await evaluateResponseValidation(input, 200, { value: "7" }, { collectAll: true });
        assert.strictEqual(wrongType.passed, false);
        assert.deepStrictEqual(
            wrongType.root.children.map((child) => child.passed),
            [false, false, false, false]
        );
    });

    test("evaluateResponseValidation() selects a scenario using an inclusive status range", async () => {
        const input = rules([
            scenario({
                id: "client-errors",
                statusCodes: ["400-499"],
                root: group([condition({ path: "error", valueType: "boolean", expectedValue: true })]),
            }),
        ]);

        const result = await evaluateResponseValidation(input, 429, { error: true });

        assert.strictEqual(result.passed, true);
        assert.strictEqual(result.applied, true);
        assert.strictEqual(result.scenarioId, "client-errors");

        const failed = await evaluateResponseValidation(
            input,
            429,
            { error: false },
            {
                fallbackStatusAccepted: true,
            }
        );
        assert.strictEqual(failed.passed, false);
        assert.strictEqual(failed.applied, true);
    });

    test("evaluateResponseValidation() falls back to the existing status-code result when no scenario matches", async () => {
        const accepted = await evaluateResponseValidation(
            rules(),
            204,
            { value: 1 },
            {
                fallbackStatusAccepted: true,
            }
        );
        const rejected = await evaluateResponseValidation(
            rules(),
            500,
            { value: 1 },
            {
                fallbackStatusAccepted: false,
            }
        );

        assert.strictEqual(accepted.passed, true);
        assert.strictEqual(accepted.applied, false);
        assert.strictEqual(accepted.statusCode, 204);
        assert.strictEqual(accepted.scenarioId, null);
        assert.strictEqual(accepted.root, null);
        assert.match(accepted.message, /204/);

        assert.strictEqual(rejected.passed, false);
        assert.strictEqual(rejected.applied, false);
        assert.strictEqual(rejected.statusCode, 500);
        assert.strictEqual(rejected.scenarioId, null);
        assert.strictEqual(rejected.root, null);
        assert.match(rejected.message, /500/);
    });

    test("evaluateResponseValidation() preserves actual values without placing them in the heartbeat message", async () => {
        const actualValue = "x".repeat(RESPONSE_VALIDATION_LIMITS.maxSummaryValueLength + 100);
        const input = rules([
            scenario({
                root: group([
                    condition({
                        id: "large-value",
                        path: "message",
                        valueType: "string",
                        expectedValue: "expected",
                    }),
                ]),
            }),
        ]);

        const result = await evaluateResponseValidation(input, 200, { message: actualValue });

        assert.strictEqual(result.passed, false);
        assert.strictEqual(result.root.children[0].actualValue, actualValue);
        assert.strictEqual(result.message.includes(actualValue), false);
        assert.match(result.message, /failed.*message/i);
        assert.strictEqual(result.root.children[0].reason, "Comparison did not pass.");
    });
});

describe("response validation test previews", () => {
    test("structured JSON previews enforce depth and node limits without recursion", () => {
        const normal = { responses: { usage: { input_tokens: 7 } } };
        let tooDeep = { value: true };
        for (let index = 0; index <= RESPONSE_VALIDATION_JSON_PREVIEW_MAX_DEPTH; index++) {
            tooDeep = { child: tooDeep };
        }
        const tooWide = Array.from({ length: RESPONSE_VALIDATION_JSON_PREVIEW_MAX_NODES + 1 }, () => true);
        const extremelyWide = Array.from({ length: 125_000 }, () => true);

        assert.strictEqual(isResponseValidationJsonPreviewSafe(normal), true);
        assert.strictEqual(isResponseValidationJsonPreviewSafe(tooDeep), false);
        assert.strictEqual(isResponseValidationJsonPreviewSafe(tooWide), false);
        assert.strictEqual(isResponseValidationJsonPreviewSafe(extremelyWide), false);
    });

    test("createResponseValidationPreview() bounds repeated actual values, reasons, and messages", () => {
        const largeObject = { payload: "x".repeat(20_000) };
        const largeText = "y".repeat(20_000);
        const leaf = (id) => ({
            id,
            type: "condition",
            passed: false,
            source: "json",
            path: "$",
            operator: "equals",
            valueType: "string",
            expectedValue: "expected",
            actualValue: largeObject,
            exists: true,
            reason: largeText,
        });
        const validation = {
            passed: false,
            statusCode: 200,
            scenarioId: "large-response",
            message: largeText,
            root: {
                id: "root",
                type: "group",
                passed: false,
                combinator: "and",
                children: [leaf("first"), leaf("second")],
            },
        };

        const preview = createResponseValidationPreview(validation);

        assert.strictEqual(preview.root.children[0].actualValueTruncated, true);
        assert.strictEqual(preview.root.children[1].actualValueTruncated, true);
        assert.match(preview.root.children[0].actualValue, /truncated/);
        assert.ok(preview.message.length < RESPONSE_VALIDATION_PREVIEW_VALUE_MAX_LENGTH + 30);
        assert.ok(preview.root.children[0].reason.length < RESPONSE_VALIDATION_PREVIEW_VALUE_MAX_LENGTH + 30);
        assert.ok(JSON.stringify(preview).length < 15_000);
    });

    test("createResponseValidationPreview() replaces values too deeply nested to serialize", () => {
        let deeplyNested = { value: true };
        for (let index = 0; index < 5000; index++) {
            deeplyNested = { child: deeplyNested };
        }
        const validation = {
            passed: false,
            statusCode: 200,
            scenarioId: "deep-response",
            message: "Response validation failed.",
            root: {
                id: "root",
                type: "group",
                passed: false,
                combinator: "and",
                children: [
                    {
                        id: "deep-value",
                        type: "condition",
                        passed: false,
                        source: "json",
                        path: "$",
                        operator: "equals",
                        valueType: "string",
                        expectedValue: "expected",
                        actualValue: deeplyNested,
                        exists: true,
                        reason: "Wrong type.",
                    },
                ],
            },
        };

        const preview = createResponseValidationPreview(validation);
        const actual = preview.root.children[0];

        assert.strictEqual(actual.actualValueTruncated, true);
        assert.match(actual.actualValue, /truncated|could not/i);
        assert.doesNotThrow(() => JSON.stringify(preview));
    });

    test("createResponseValidationPreview() stops serializing distinct large ancestor objects at the budget", () => {
        const sharedPayload = { payload: "x".repeat(500_000) };
        const children = Array.from({ length: 100 }, (_, index) => ({
            id: `ancestor-${index}`,
            type: "condition",
            passed: false,
            source: "json",
            path: `items[${index}]`,
            operator: "equals",
            valueType: "string",
            expectedValue: "expected",
            actualValue: { index, child: sharedPayload },
            exists: true,
            reason: "Wrong value.",
        }));
        const validation = {
            passed: false,
            statusCode: 200,
            scenarioId: "large-ancestors",
            message: "Response validation failed.",
            root: {
                id: "root",
                type: "group",
                passed: false,
                combinator: "and",
                children,
            },
        };

        const preview = createResponseValidationPreview(validation);

        assert.ok(preview.root.children.every((child) => child.actualValueTruncated));
        assert.ok(JSON.stringify(preview).length < 100_000);
    });
});
