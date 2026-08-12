const RESPONSE_VALIDATION_PREVIEW_VALUE_MAX_LENGTH = 2048;
const RESPONSE_VALIDATION_JSON_PREVIEW_MAX_DEPTH = 20;
const RESPONSE_VALIDATION_JSON_PREVIEW_MAX_NODES = 2000;

/**
 * Decide whether a parsed response can be safely serialized over Socket.IO and
 * rendered by the recursive JSON viewer.
 * @param {unknown} value Parsed JSON value.
 * @returns {boolean} Whether the value stays within depth and node limits.
 */
function isResponseValidationJsonPreviewSafe(value) {
    const stack = [{ value, depth: 0 }];
    // Count scheduled nodes, not only popped nodes, so a very wide container is
    // rejected before allocating one stack wrapper per child.
    let nodeCount = 1;

    while (stack.length > 0) {
        const current = stack.pop();
        if (current.value === null || typeof current.value !== "object") {
            continue;
        }

        const isArray = Array.isArray(current.value);
        const keys = isArray ? null : Object.keys(current.value);
        const childCount = isArray ? current.value.length : keys.length;
        if (current.depth >= RESPONSE_VALIDATION_JSON_PREVIEW_MAX_DEPTH) {
            if (childCount > 0) {
                return false;
            }
            continue;
        }

        if (nodeCount + childCount > RESPONSE_VALIDATION_JSON_PREVIEW_MAX_NODES) {
            return false;
        }
        nodeCount += childCount;

        if (isArray) {
            for (let index = 0; index < current.value.length; index++) {
                stack.push({ value: current.value[index], depth: current.depth + 1 });
            }
        } else {
            for (const key of keys) {
                stack.push({ value: current.value[key], depth: current.depth + 1 });
            }
        }
    }
    return true;
}

const PREVIEW_LENGTH_EXCEEDED = Symbol("preview-length-exceeded");

/**
 * Serialize only while a value can plausibly fit in the preview budget. The
 * replacer throws before JSON.stringify constructs a large intermediate
 * string, which keeps many distinct ancestor-object previews bounded.
 * @param {unknown} value Object-like preview value.
 * @returns {{serialized: string|undefined, exceeded: boolean}} Bounded serialization result.
 * @throws {Error} If JSON serialization fails for a reason other than the preview budget.
 */
function stringifyWithinPreviewBudget(value) {
    let estimatedLength = 0;
    const addEstimatedLength = (length) => {
        estimatedLength += length;
        if (estimatedLength > RESPONSE_VALIDATION_PREVIEW_VALUE_MAX_LENGTH) {
            throw PREVIEW_LENGTH_EXCEEDED;
        }
    };

    try {
        const serialized = JSON.stringify(value, (key, child) => {
            // Include conservative separators/quotes for every visited entry.
            addEstimatedLength(String(key).length + 4);
            if (child === null) {
                addEstimatedLength(4);
            } else if (typeof child === "string") {
                addEstimatedLength(child.length + 2);
            } else if (typeof child === "number" || typeof child === "boolean") {
                addEstimatedLength(String(child).length);
            } else if (typeof child === "object") {
                addEstimatedLength(2);
            }
            return child;
        });
        return { serialized, exceeded: false };
    } catch (error) {
        if (error === PREVIEW_LENGTH_EXCEEDED) {
            return { serialized: undefined, exceeded: true };
        }
        throw error;
    }
}

/**
 * Bound one scalar/object value before it crosses the Socket.IO boundary.
 * Evaluation always uses the complete accepted response; this only limits the
 * result preview returned to the browser.
 * @param {unknown} value Raw evaluation value.
 * @param {WeakMap<object, {value: unknown, truncated: boolean}>} objectCache Reused object previews.
 * @returns {{value: unknown, truncated: boolean}} Bounded preview value.
 */
function createValuePreview(value, objectCache) {
    if (value === null || typeof value === "number" || typeof value === "boolean" || value === undefined) {
        return { value, truncated: false };
    }

    if (typeof value === "string") {
        if (value.length <= RESPONSE_VALIDATION_PREVIEW_VALUE_MAX_LENGTH) {
            return { value, truncated: false };
        }
        return {
            value: value.substring(0, RESPONSE_VALIDATION_PREVIEW_VALUE_MAX_LENGTH) + "… (truncated)",
            truncated: true,
        };
    }

    if (typeof value === "object" && objectCache.has(value)) {
        return objectCache.get(value);
    }

    let serialization;
    try {
        serialization = stringifyWithinPreviewBudget(value);
    } catch (_) {
        const result = { value: "[Value could not be previewed]", truncated: true };
        if (typeof value === "object" && value !== null) {
            objectCache.set(value, result);
        }
        return result;
    }
    if (serialization.exceeded) {
        const result = { value: "[Value preview truncated]", truncated: true };
        if (typeof value === "object" && value !== null) {
            objectCache.set(value, result);
        }
        return result;
    }

    let serialized = serialization.serialized;
    if (typeof serialized !== "string") {
        try {
            serialized = String(value);
        } catch (_) {
            return { value: "[Value could not be previewed]", truncated: true };
        }
    }

    const result =
        serialized.length <= RESPONSE_VALIDATION_PREVIEW_VALUE_MAX_LENGTH
            ? { value, truncated: false }
            : {
                  value: serialized.substring(0, RESPONSE_VALIDATION_PREVIEW_VALUE_MAX_LENGTH) + "… (truncated)",
                  truncated: true,
              };
    if (typeof value === "object" && value !== null) {
        objectCache.set(value, result);
    }
    return result;
}

/**
 * Create a bounded copy of an evaluated rule tree for the interactive tester.
 * @param {object|null} validation Full evaluation result.
 * @returns {object|null} Socket-safe preview result.
 */
function createResponseValidationPreview(validation) {
    if (!validation) {
        return null;
    }

    const objectCache = new WeakMap();
    const previewText = (value) => createValuePreview(value, objectCache).value;
    const previewNode = (node) => {
        if (node.type === "group") {
            return {
                id: node.id,
                type: "group",
                passed: node.passed,
                combinator: node.combinator,
                children: (node.children || []).map(previewNode),
            };
        }

        const expected = createValuePreview(node.expectedValue, objectCache);
        const actual = createValuePreview(node.actualValue, objectCache);
        return {
            id: node.id,
            type: "condition",
            passed: node.passed,
            source: node.source,
            path: node.path,
            operator: node.operator,
            valueType: node.valueType,
            expectedValue: expected.value,
            expectedValueTruncated: expected.truncated,
            actualValue: actual.value,
            actualValueTruncated: actual.truncated,
            exists: node.exists,
            reason: node.reason === null ? null : previewText(node.reason),
        };
    };

    return {
        passed: validation.passed,
        applied: Boolean(validation.applied),
        statusCode: validation.statusCode,
        scenarioId: validation.scenarioId,
        message: previewText(validation.message),
        root: validation.root ? previewNode(validation.root) : null,
    };
}

module.exports = {
    RESPONSE_VALIDATION_JSON_PREVIEW_MAX_DEPTH,
    RESPONSE_VALIDATION_JSON_PREVIEW_MAX_NODES,
    RESPONSE_VALIDATION_PREVIEW_VALUE_MAX_LENGTH,
    createResponseValidationPreview,
    isResponseValidationJsonPreviewSafe,
};
