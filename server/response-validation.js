const EMPTY_RESPONSE_VALIDATION_RULES = Object.freeze({
    version: 1,
    scenarios: [],
});

const RESPONSE_VALIDATION_LIMITS = Object.freeze({
    maxScenarios: 20,
    maxStatusCodesPerScenario: 20,
    maxTotalNodes: 100,
    maxDepth: 5,
    maxIdLength: 64,
    maxPathLength: 512,
    maxExpectedStringLength: 4096,
    maxSummaryValueLength: 200,
});

const RESPONSE_VALIDATION_OPERATORS = new Set([
    "equals",
    "notEquals",
    "contains",
    "notContains",
    "greaterThan",
    "greaterThanOrEqual",
    "lessThan",
    "lessThanOrEqual",
    "exists",
    "notExists",
]);

const RESPONSE_VALIDATION_VALUE_TYPES = new Set(["string", "number", "boolean", "null"]);

/**
 * Error raised for invalid response-validation configuration or a failed
 * runtime response validation.
 */
class ResponseValidationError extends Error {
    /**
     * @param {string} message Human-readable error message.
     * @param {{code?: string, validation?: object|null, response?: object|null}} options Error metadata.
     */
    constructor(message, options = {}) {
        super(message);
        this.name = "ResponseValidationError";
        this.code = options.code || "response_validation_error";
        this.validation = options.validation || null;
        this.response = options.response || null;
    }
}

/**
 * Throw a consistently shaped configuration error.
 * @param {string} code Stable machine-readable error code.
 * @param {string} message Human-readable error message.
 * @returns {never} This function always throws.
 * @throws {ResponseValidationError}
 */
function throwConfigError(code, message) {
    throw new ResponseValidationError(message, { code });
}

/**
 * Parse the deliberately small, non-executable JSON field-path syntax used by
 * response validation. Supported examples include `responses.usage.tokens`,
 * `$.responses.items[0].id`, and backtick-quoted field names.
 * @param {string} path JSON field path.
 * @returns {(string|number)[]} Property names and array indexes.
 * @throws {ResponseValidationError} If the path is not a plain field selector.
 */
function parseResponseValidationPath(path) {
    const invalidPath = () =>
        throwConfigError(
            "invalid_path",
            "Response validation paths may contain only field names, quoted field names, and array indexes."
        );
    if (typeof path !== "string" || path.length === 0) {
        invalidPath();
    }

    const isIdentifierStart = (character) => /[A-Za-z_$]/.test(character);
    const isIdentifierPart = (character) => /[A-Za-z0-9_$]/.test(character);
    const segments = [];
    let index = 0;
    let hasRoot = false;
    let requireProperty = false;

    if (path[index] === "$" && (path.length === 1 || path[index + 1] === "." || path[index + 1] === "[")) {
        hasRoot = true;
        index++;
        if (index === path.length) {
            return segments;
        }
        if (path[index] === ".") {
            index++;
            requireProperty = true;
        }
    }

    while (index < path.length) {
        if (path[index] === "[") {
            if (requireProperty || (!hasRoot && segments.length === 0)) {
                invalidPath();
            }
            index++;
            const start = index;
            while (index < path.length && /[0-9]/.test(path[index])) {
                index++;
            }
            if (start === index || path[index] !== "]") {
                invalidPath();
            }
            const arrayIndex = Number(path.substring(start, index));
            if (!Number.isSafeInteger(arrayIndex)) {
                invalidPath();
            }
            segments.push(arrayIndex);
            index++;
        } else {
            let property = "";
            if (path[index] === "`") {
                index++;
                let closed = false;
                while (index < path.length) {
                    if (path[index] === "\\") {
                        index++;
                        if (index >= path.length) {
                            invalidPath();
                        }
                        property += path[index];
                        index++;
                    } else if (path[index] === "`") {
                        closed = true;
                        index++;
                        break;
                    } else {
                        property += path[index];
                        index++;
                    }
                }
                if (!closed) {
                    invalidPath();
                }
            } else {
                if (!isIdentifierStart(path[index])) {
                    invalidPath();
                }
                const start = index;
                index++;
                while (index < path.length && isIdentifierPart(path[index])) {
                    index++;
                }
                property = path.substring(start, index);
            }
            segments.push(property);
            requireProperty = false;
        }

        if (index === path.length) {
            break;
        }
        if (path[index] === ".") {
            index++;
            if (index === path.length) {
                invalidPath();
            }
            requireProperty = true;
        } else if (path[index] !== "[") {
            invalidPath();
        }
    }

    if (requireProperty || (!hasRoot && segments.length === 0)) {
        invalidPath();
    }
    return segments;
}

/**
 * Resolve a validated response field path without executing expressions or
 * traversing inherited properties.
 * @param {string} path JSON field path.
 * @param {unknown} body Parsed response body.
 * @returns {unknown} Resolved value, or undefined when the path is absent.
 */
function evaluateResponseValidationPath(path, body) {
    let value = body;
    for (const segment of parseResponseValidationPath(path)) {
        if (value === null || value === undefined || (typeof value !== "object" && typeof value !== "function")) {
            return undefined;
        }
        if (typeof segment === "number" && !Array.isArray(value)) {
            return undefined;
        }
        if (!Object.prototype.hasOwnProperty.call(value, segment)) {
            return undefined;
        }
        value = value[segment];
    }
    return value;
}

/**
 * Parse an exact HTTP status code or inclusive status-code range.
 * @param {string} pattern Status code pattern such as "200" or "200-299".
 * @returns {{start: number, end: number, normalized: string}} Parsed inclusive range.
 */
function parseStatusCodePattern(pattern) {
    if (typeof pattern !== "string") {
        throwConfigError("invalid_status_code", "Response validation status codes must be strings.");
    }

    const normalized = pattern.trim();
    const match = /^(\d{3})(?:-(\d{3}))?$/.exec(normalized);
    if (!match) {
        throwConfigError(
            "invalid_status_code",
            `Invalid response validation status code pattern: ${JSON.stringify(normalized)}`
        );
    }

    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (start < 100 || start > 599 || end < 100 || end > 599 || start > end) {
        throwConfigError(
            "invalid_status_code",
            `Response validation status code pattern must be within 100-599: ${JSON.stringify(normalized)}`
        );
    }

    return {
        start,
        end,
        normalized: start === end ? String(start) : `${start}-${end}`,
    };
}

/**
 * Check a status code against validated or unvalidated exact/range patterns.
 * @param {number} statusCode HTTP response status code.
 * @param {string[]} patterns Exact status codes or inclusive ranges.
 * @returns {boolean} Whether the status code matches at least one pattern.
 */
function statusCodeMatches(statusCode, patterns) {
    if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599 || !Array.isArray(patterns)) {
        return false;
    }

    return patterns.some((pattern) => {
        const parsed = parseStatusCodePattern(pattern);
        return statusCode >= parsed.start && statusCode <= parsed.end;
    });
}

/**
 * Validate and normalize a node ID.
 * @param {unknown} id Node or scenario ID.
 * @param {string} owner Human-readable owner for errors.
 * @param {Set<string>} seenIds IDs already used in this configuration.
 * @param {string} duplicateCode Duplicate-ID error code.
 * @returns {string} Normalized unique ID.
 */
function normalizeId(id, owner, seenIds, duplicateCode) {
    if (typeof id !== "string" || id.trim() === "") {
        throwConfigError("invalid_node", `${owner} must have a non-empty string ID.`);
    }

    const normalized = id.trim();
    if (normalized.length > RESPONSE_VALIDATION_LIMITS.maxIdLength) {
        throwConfigError(
            "id_too_long",
            `${owner} ID cannot exceed ${RESPONSE_VALIDATION_LIMITS.maxIdLength} characters.`
        );
    }

    if (seenIds.has(normalized)) {
        throwConfigError(duplicateCode, `${owner} ID must be unique: ${JSON.stringify(normalized)}`);
    }
    seenIds.add(normalized);
    return normalized;
}

/**
 * Validate an expected value against its declared type.
 * @param {unknown} value Expected value.
 * @param {string} valueType Declared expected-value type.
 * @returns {unknown} Type-checked expected value.
 */
function normalizeExpectedValue(value, valueType) {
    if (valueType === "string") {
        if (typeof value !== "string") {
            throwConfigError("invalid_expected_value", "Expected value must be a string.");
        }
        if (value.length > RESPONSE_VALIDATION_LIMITS.maxExpectedStringLength) {
            throwConfigError(
                "expected_value_too_long",
                `Expected string cannot exceed ${RESPONSE_VALIDATION_LIMITS.maxExpectedStringLength} characters.`
            );
        }
        return value;
    }

    if (valueType === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            throwConfigError("invalid_expected_value", "Expected value must be a finite number.");
        }
        return value;
    }

    if (valueType === "boolean") {
        if (typeof value !== "boolean") {
            throwConfigError("invalid_expected_value", "Expected value must be a boolean.");
        }
        return value;
    }

    if (value !== null) {
        throwConfigError("invalid_expected_value", "Expected value must be null when valueType is null.");
    }
    return null;
}

/**
 * Validate and normalize one recursive response-validation node.
 * @param {unknown} node Raw node.
 * @param {number} depth Current root-relative depth, starting at 1.
 * @param {{count: number}} nodeCounter Mutable total-node counter.
 * @param {Set<string>} seenNodeIds Node IDs already used in this configuration.
 * @returns {object} Normalized node.
 */
function normalizeNode(node, depth, nodeCounter, seenNodeIds) {
    if (depth > RESPONSE_VALIDATION_LIMITS.maxDepth) {
        throwConfigError(
            "max_depth_exceeded",
            `Response validation groups cannot exceed depth ${RESPONSE_VALIDATION_LIMITS.maxDepth}.`
        );
    }

    nodeCounter.count++;
    if (nodeCounter.count > RESPONSE_VALIDATION_LIMITS.maxTotalNodes) {
        throwConfigError(
            "too_many_nodes",
            `Response validation cannot contain more than ${RESPONSE_VALIDATION_LIMITS.maxTotalNodes} nodes.`
        );
    }

    if (!node || typeof node !== "object" || Array.isArray(node)) {
        throwConfigError("invalid_node", "Response validation nodes must be objects.");
    }

    const id = normalizeId(node.id, "Response validation node", seenNodeIds, "duplicate_node_id");
    if (node.type === "group") {
        if (node.combinator !== "and" && node.combinator !== "or") {
            throwConfigError("invalid_combinator", `Invalid response validation combinator for node ${id}.`);
        }
        if (!Array.isArray(node.children) || node.children.length === 0) {
            throwConfigError("empty_group", `Response validation group ${id} must contain at least one child.`);
        }

        return {
            id,
            type: "group",
            combinator: node.combinator,
            children: node.children.map((child) => normalizeNode(child, depth + 1, nodeCounter, seenNodeIds)),
        };
    }

    if (node.type !== "condition") {
        throwConfigError("invalid_node", `Invalid response validation node type for node ${id}.`);
    }
    if (node.source !== "json") {
        throwConfigError("invalid_source", `Response validation condition ${id} must use the json source.`);
    }
    if (typeof node.path !== "string" || node.path.trim() === "") {
        throwConfigError("invalid_path", `Response validation condition ${id} must have a JSON field path.`);
    }

    const path = node.path.trim();
    if (path.length > RESPONSE_VALIDATION_LIMITS.maxPathLength) {
        throwConfigError(
            "path_too_long",
            `JSON field path cannot exceed ${RESPONSE_VALIDATION_LIMITS.maxPathLength} characters.`
        );
    }
    parseResponseValidationPath(path);

    if (!RESPONSE_VALIDATION_OPERATORS.has(node.operator)) {
        throwConfigError("invalid_operator", `Invalid response validation operator for condition ${id}.`);
    }

    let valueType = node.valueType;
    let expectedValue = node.expectedValue;
    if (node.operator === "exists" || node.operator === "notExists") {
        valueType = "null";
        expectedValue = null;
    } else {
        if (!RESPONSE_VALIDATION_VALUE_TYPES.has(valueType)) {
            throwConfigError("invalid_value_type", `Invalid response validation value type for condition ${id}.`);
        }
        expectedValue = normalizeExpectedValue(expectedValue, valueType);
    }

    if ((node.operator === "contains" || node.operator === "notContains") && valueType !== "string") {
        throwConfigError("invalid_value_type", `${node.operator} requires a string expected value.`);
    }
    if (
        ["greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual"].includes(node.operator) &&
        valueType !== "number"
    ) {
        throwConfigError("invalid_value_type", `${node.operator} requires a numeric expected value.`);
    }

    return {
        id,
        type: "condition",
        source: "json",
        path,
        operator: node.operator,
        valueType,
        expectedValue,
    };
}

/**
 * Validate response-validation rules and return a normalized, detached copy.
 * Nullish/empty input is normalized to the legal disabled-state default.
 * @param {unknown} rules Raw response-validation configuration.
 * @returns {{version: 1, scenarios: object[]}} Normalized response-validation rules.
 * @throws {ResponseValidationError} If the configuration is invalid.
 */
function validateResponseValidationRules(rules) {
    if (rules === null || rules === undefined || rules === "") {
        return { version: 1, scenarios: [] };
    }
    if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
        throwConfigError("invalid_rules", "Response validation rules must be an object.");
    }
    if (rules.version !== 1) {
        throwConfigError("invalid_version", "Response validation rules version must be 1.");
    }
    if (!Array.isArray(rules.scenarios)) {
        throwConfigError("invalid_rules", "Response validation scenarios must be an array.");
    }
    if (rules.scenarios.length > RESPONSE_VALIDATION_LIMITS.maxScenarios) {
        throwConfigError(
            "too_many_scenarios",
            `Response validation cannot contain more than ${RESPONSE_VALIDATION_LIMITS.maxScenarios} scenarios.`
        );
    }

    const seenScenarioIds = new Set();
    const seenNodeIds = new Set();
    const claimedStatusCodes = new Map();
    const nodeCounter = { count: 0 };

    const scenarios = rules.scenarios.map((scenario) => {
        if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
            throwConfigError("invalid_scenario", "Response validation scenarios must be objects.");
        }
        const id = normalizeId(scenario.id, "Response validation scenario", seenScenarioIds, "duplicate_scenario_id");
        if (!Array.isArray(scenario.statusCodes) || scenario.statusCodes.length === 0) {
            throwConfigError("invalid_status_codes", `Response validation scenario ${id} needs a status code.`);
        }
        if (scenario.statusCodes.length > RESPONSE_VALIDATION_LIMITS.maxStatusCodesPerScenario) {
            throwConfigError(
                "too_many_status_codes",
                `Scenario ${id} cannot contain more than ${RESPONSE_VALIDATION_LIMITS.maxStatusCodesPerScenario} status codes.`
            );
        }

        const statusCodes = scenario.statusCodes.map((statusCodePattern) => {
            const parsed = parseStatusCodePattern(statusCodePattern);
            for (let statusCode = parsed.start; statusCode <= parsed.end; statusCode++) {
                if (claimedStatusCodes.has(statusCode)) {
                    throwConfigError(
                        "overlapping_status_codes",
                        `HTTP status ${statusCode} is covered by both response validation scenarios ${claimedStatusCodes.get(
                            statusCode
                        )} and ${id}.`
                    );
                }
                claimedStatusCodes.set(statusCode, id);
            }
            return parsed.normalized;
        });

        const root = normalizeNode(scenario.root, 1, nodeCounter, seenNodeIds);
        if (root.type !== "group") {
            throwConfigError("invalid_node", `Response validation scenario ${id} root must be a group.`);
        }

        return {
            id,
            statusCodes,
            root,
        };
    });

    return {
        version: 1,
        scenarios,
    };
}

/**
 * Normalize rules before persistence. Enabled validators remain strict; a
 * disabled validator may safely discard an incomplete hidden draft instead of
 * blocking an otherwise unrelated monitor save.
 * @param {unknown} rules Raw response-validation configuration.
 * @param {boolean} enabled Whether response validation is enabled.
 * @returns {{version: 1, scenarios: object[]}} Persistable rules.
 * @throws {ResponseValidationError} If enabled rules are invalid.
 */
function normalizeResponseValidationRulesForStorage(rules, enabled) {
    if (enabled) {
        return validateResponseValidationRules(rules);
    }
    try {
        return validateResponseValidationRules(rules);
    } catch (error) {
        if (!(error instanceof ResponseValidationError)) {
            throw error;
        }
        return { version: 1, scenarios: [] };
    }
}

/**
 * Convert an Axios response body to a value suitable for field-path evaluation.
 * @param {unknown} body Axios response data.
 * @returns {unknown} Parsed JSON body or the original response value.
 */
function normalizeResponseBody(body) {
    if (typeof body !== "string") {
        return body;
    }
    try {
        return JSON.parse(body);
    } catch (_) {
        return body;
    }
}

/**
 * Return a bounded representation safe for heartbeat/error summaries.
 * @param {unknown} value Raw evaluated value.
 * @returns {unknown} Bounded scalar/string representation.
 */
function summarizeValue(value) {
    if (value === null || typeof value === "number" || typeof value === "boolean") {
        return value;
    }

    let text;
    if (typeof value === "string") {
        text = value;
    } else {
        try {
            text = JSON.stringify(value);
        } catch (_) {
            text = String(value);
        }
    }

    if (text.length > RESPONSE_VALIDATION_LIMITS.maxSummaryValueLength) {
        return text.substring(0, RESPONSE_VALIDATION_LIMITS.maxSummaryValueLength) + "… (truncated)";
    }
    return text;
}

/**
 * Check whether an actual value strictly matches the configured type.
 * @param {unknown} actualValue Actual field-path result.
 * @param {string} valueType Expected type.
 * @returns {boolean} Whether the value has the exact configured type.
 */
function hasExpectedType(actualValue, valueType) {
    if (valueType === "null") {
        return actualValue === null;
    }
    if (valueType === "number") {
        return typeof actualValue === "number" && Number.isFinite(actualValue);
    }
    return typeof actualValue === valueType;
}

/**
 * Evaluate one condition node.
 * @param {object} condition Normalized condition.
 * @param {unknown} body Parsed response body.
 * @returns {Promise<object>} Evaluated leaf result.
 */
async function evaluateCondition(condition, body) {
    let actualValue;
    let evaluationError = null;
    try {
        actualValue = evaluateResponseValidationPath(condition.path, body);
    } catch (error) {
        evaluationError = error;
    }

    const exists = evaluationError === null && actualValue !== undefined;
    let passed = false;
    let reason = null;

    if (evaluationError) {
        reason = `Response path evaluation failed: ${summarizeValue(evaluationError.message)}`;
    } else if (condition.operator === "exists") {
        passed = exists;
        if (!passed) {
            reason = "Response path did not resolve to a value.";
        }
    } else if (condition.operator === "notExists") {
        passed = !exists;
        if (!passed) {
            reason = "Response path resolved to a value.";
        }
    } else if (!exists) {
        reason = "Response path did not resolve to a value.";
    } else if (condition.operator === "notEquals" && condition.valueType === "null") {
        // `not equals null` is the useful typed form of "present and non-null".
        // Other notEquals comparisons still require the configured actual type.
        passed = actualValue !== null;
        if (!passed) {
            reason = "Comparison did not pass.";
        }
    } else if (!hasExpectedType(actualValue, condition.valueType)) {
        reason = `Actual value does not have expected type ${condition.valueType}.`;
    } else {
        switch (condition.operator) {
            case "equals":
                passed = actualValue === condition.expectedValue;
                break;
            case "notEquals":
                passed = actualValue !== condition.expectedValue;
                break;
            case "contains":
                passed = actualValue.includes(condition.expectedValue);
                break;
            case "notContains":
                passed = !actualValue.includes(condition.expectedValue);
                break;
            case "greaterThan":
                passed = actualValue > condition.expectedValue;
                break;
            case "greaterThanOrEqual":
                passed = actualValue >= condition.expectedValue;
                break;
            case "lessThan":
                passed = actualValue < condition.expectedValue;
                break;
            case "lessThanOrEqual":
                passed = actualValue <= condition.expectedValue;
                break;
        }

        if (!passed) {
            reason = "Comparison did not pass.";
        }
    }

    return {
        id: condition.id,
        type: "condition",
        passed,
        source: condition.source,
        path: condition.path,
        operator: condition.operator,
        valueType: condition.valueType,
        expectedValue: condition.expectedValue,
        actualValue: exists ? actualValue : null,
        exists,
        reason,
    };
}

/**
 * Recursively evaluate a normalized condition tree.
 * @param {object} node Normalized group or condition.
 * @param {unknown} body Parsed response body.
 * @param {boolean} collectAll Whether to suppress logical short-circuiting.
 * @returns {Promise<object>} Evaluated node tree.
 */
async function evaluateNode(node, body, collectAll) {
    if (node.type === "condition") {
        return evaluateCondition(node, body);
    }

    const children = [];
    let passed = node.combinator === "and";
    for (const child of node.children) {
        const result = await evaluateNode(child, body, collectAll);
        children.push(result);

        if (node.combinator === "and") {
            passed = passed && result.passed;
            if (!collectAll && !passed) {
                break;
            }
        } else {
            passed = passed || result.passed;
            if (!collectAll && passed) {
                break;
            }
        }
    }

    return {
        id: node.id,
        type: "group",
        passed,
        combinator: node.combinator,
        children,
    };
}

/**
 * Find the first failed leaf from an evaluated node tree.
 * @param {object} node Evaluated root node.
 * @returns {object|null} First failed evaluated condition, if any.
 */
function findFirstFailure(node) {
    if (node.passed) {
        return null;
    }
    if (node.type === "condition") {
        return node;
    }
    for (const child of node.children) {
        const failure = findFirstFailure(child);
        if (failure) {
            return failure;
        }
    }
    return null;
}

/**
 * Evaluate response-validation rules against one HTTP response.
 * @param {unknown} rules Response-validation configuration.
 * @param {number} statusCode HTTP response status.
 * @param {unknown} body Axios response data.
 * @param {{collectAll?: boolean, fallbackStatusAccepted?: boolean}} options Evaluation options.
 * @returns {Promise<{passed: boolean, applied: boolean, statusCode: number, scenarioId: string|null, message: string, root: object|null}>} Evaluated response-validation tree.
 */
async function evaluateResponseValidation(
    rules,
    statusCode,
    body,
    { collectAll = false, fallbackStatusAccepted = false } = {}
) {
    const normalized = validateResponseValidationRules(rules);
    if (normalized.scenarios.length === 0) {
        return {
            passed: true,
            applied: false,
            statusCode,
            scenarioId: null,
            message: "Response validation is not configured.",
            root: null,
        };
    }

    const scenario = normalized.scenarios.find((candidate) => statusCodeMatches(statusCode, candidate.statusCodes));
    if (!scenario) {
        return {
            passed: fallbackStatusAccepted,
            applied: false,
            statusCode,
            scenarioId: null,
            message: fallbackStatusAccepted
                ? `No response body validation scenario matches HTTP status ${statusCode}; the valid status-code check passed.`
                : `HTTP status ${statusCode} is not accepted and no response body validation scenario matches it.`,
            root: null,
        };
    }

    const root = await evaluateNode(scenario.root, normalizeResponseBody(body), Boolean(collectAll));
    let message = `Response validation passed for HTTP status ${statusCode}.`;
    if (!root.passed) {
        const failure = findFirstFailure(root);
        message = `Response validation failed for HTTP status ${statusCode}`;
        if (failure) {
            message += ` at ${JSON.stringify(failure.path)}.`;
        } else {
            message += ".";
        }
    }

    return {
        passed: root.passed,
        applied: true,
        statusCode,
        scenarioId: scenario.id,
        message,
        root,
    };
}

module.exports = {
    EMPTY_RESPONSE_VALIDATION_RULES,
    RESPONSE_VALIDATION_LIMITS,
    ResponseValidationError,
    evaluateResponseValidation,
    evaluateResponseValidationPath,
    normalizeResponseValidationRulesForStorage,
    parseStatusCodePattern,
    parseResponseValidationPath,
    statusCodeMatches,
    summarizeValue,
    validateResponseValidationRules,
};
