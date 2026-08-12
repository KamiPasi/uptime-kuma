<template>
    <div class="response-validation-layout-container">
        <section class="response-validation-workbench" aria-labelledby="response-validation-workbench-title">
            <div class="rules-panel">
                <div class="panel-heading">
                    <div>
                        <h2 id="response-validation-workbench-title" class="h4 mb-1">
                            {{ $t("responseValidationRulesTitle") }}
                        </h2>
                        <p class="form-text mb-0">{{ $t("responseValidationRulesDescription") }}</p>
                    </div>
                    <div class="add-scenario-control">
                        <button
                            type="button"
                            class="btn btn-sm btn-outline-primary"
                            :disabled="!canAddScenario"
                            :aria-describedby="!canAddScenario ? 'response-validation-scenario-limit' : null"
                            @click="addScenario"
                        >
                            <font-awesome-icon icon="plus" />
                            {{ $t("responseValidationAddScenario") }}
                        </button>
                        <span
                            v-if="!canAddScenario"
                            id="response-validation-scenario-limit"
                            class="form-text limit-note"
                            role="status"
                        >
                            {{ $t("responseValidationRuleLimitReached") }}
                        </span>
                    </div>
                </div>

                <div
                    v-if="scenarios.length"
                    class="scenario-tabs"
                    role="group"
                    :aria-label="$t('responseValidationRulesTitle')"
                >
                    <button
                        v-for="(scenario, index) in scenarios"
                        :key="scenario.id"
                        type="button"
                        class="scenario-tab"
                        :class="{ active: scenario.id === activeScenarioId }"
                        :aria-pressed="scenario.id === activeScenarioId"
                        @click="selectScenario(scenario)"
                    >
                        <span class="scenario-number">{{ index + 1 }}</span>
                        <span>{{ scenarioLabel(scenario) }}</span>
                    </button>
                </div>

                <div v-if="activeScenario" class="scenario-editor">
                    <div class="scenario-toolbar">
                        <div class="status-code-field">
                            <label for="response-validation-status-codes" class="form-label">
                                {{ $t("responseValidationWhenStatus") }}
                            </label>
                            <VueMultiselect
                                id="response-validation-status-codes"
                                v-model="activeStatusCodes"
                                class="response-validation-status-select"
                                :options="statusCodeOptions"
                                :multiple="true"
                                :close-on-select="false"
                                :clear-on-select="false"
                                :preserve-search="true"
                                :placeholder="$t('Pick Accepted Status Codes...')"
                                :preselect-first="false"
                                :max-height="420"
                                :max="limits.maxStatusCodesPerScenario"
                                :taggable="true"
                                @tag="addStatusCode"
                            />
                        </div>
                        <button
                            type="button"
                            class="btn btn-sm btn-outline-danger delete-scenario"
                            @click="removeActiveScenario"
                        >
                            <font-awesome-icon icon="trash" />
                            {{ $t("responseValidationDeleteScenario") }}
                        </button>
                    </div>

                    <div class="logic-description">
                        <font-awesome-icon icon="info-circle" />
                        {{ $t("responseValidationLogicDescription") }}
                    </div>

                    <ResponseValidationRuleNode
                        :model-value="activeScenario.root"
                        :selected-condition-id="activeConditionId"
                        :can-add-condition="canAddNode"
                        :can-add-group="canAddGroupNode"
                        :max-depth="limits.maxDepth"
                        @update:model-value="updateActiveRoot"
                        @select-condition="activeConditionId = $event"
                    />
                </div>

                <div v-else class="empty-panel">
                    <font-awesome-icon icon="stream" class="empty-icon" />
                    <strong>{{ $t("responseValidationNoScenarios") }}</strong>
                    <span>{{ $t("responseValidationNoScenariosDescription") }}</span>
                    <button type="button" class="btn btn-primary btn-sm" @click="addScenario">
                        <font-awesome-icon icon="plus" />
                        {{ $t("responseValidationAddFirstScenario") }}
                    </button>
                </div>
            </div>

            <aside class="test-panel" aria-labelledby="response-validation-test-title">
                <div class="panel-heading test-heading">
                    <div>
                        <h2 id="response-validation-test-title" class="h4 mb-1">
                            {{ $t("responseValidationTestTitle") }}
                        </h2>
                        <p class="form-text mb-0">{{ $t("responseValidationTestDescription") }}</p>
                    </div>
                    <button type="button" class="btn btn-sm btn-primary" :disabled="testing" @click="runTest">
                        <font-awesome-icon v-if="testing" icon="spinner" spin />
                        <font-awesome-icon v-else icon="play" />
                        {{ testing ? $t("responseValidationTesting") : $t("responseValidationRunTest") }}
                    </button>
                </div>

                <div v-if="testError" class="alert alert-danger test-alert" role="alert">
                    <font-awesome-icon icon="exclamation-circle" />
                    {{ testError }}
                </div>

                <div v-if="!testResult && !testing && !testError" class="empty-panel test-empty">
                    <font-awesome-icon icon="play" class="empty-icon" />
                    <strong>{{ $t("responseValidationNoTestYet") }}</strong>
                    <span>{{ $t("responseValidationNoTestYetDescription") }}</span>
                </div>

                <div v-if="testing && !testResult" class="empty-panel test-empty" aria-live="polite">
                    <font-awesome-icon icon="spinner" spin class="empty-icon" />
                    <strong>{{ $t("responseValidationTesting") }}</strong>
                    <span>{{ $t("responseValidationTestingDescription") }}</span>
                </div>

                <template v-if="testResult">
                    <div class="response-summary">
                        <div class="status-block" :class="responseStatusClass">
                            <span class="status-code">{{ responseData.status ?? "—" }}</span>
                            <span class="status-text">
                                {{ responseData.statusText || $t("responseValidationUnknownStatus") }}
                            </span>
                        </div>
                        <div class="response-meta">
                            <div>
                                <span>{{ $t("responseValidationDuration") }}</span>
                                <strong>{{ formatDuration(responseData.duration) }}</strong>
                            </div>
                            <div>
                                <span>Content-Type</span>
                                <strong :title="responseData.contentType || ''">
                                    {{ responseData.contentType || "—" }}
                                </strong>
                            </div>
                            <div>
                                <span>{{ $t("responseValidationResponseSize") }}</span>
                                <strong>{{ formatSize(responseData.size) }}</strong>
                            </div>
                        </div>
                    </div>

                    <div v-if="responseData.truncated" class="alert alert-warning py-2 small" role="status">
                        <font-awesome-icon icon="exclamation-circle" />
                        {{ $t("responseValidationResponseTruncated") }}
                    </div>
                    <div
                        v-if="responseData.bodyJsonPreviewUnavailable"
                        class="alert alert-warning py-2 small"
                        role="status"
                    >
                        <font-awesome-icon icon="exclamation-circle" />
                        {{ $t("responseValidationJsonPreviewUnavailable") }}
                    </div>
                    <div v-if="validationStale" class="alert alert-info py-2 small" role="status">
                        <font-awesome-icon icon="info-circle" />
                        {{ $t("responseValidationTestResultStale") }}
                    </div>

                    <div class="response-content">
                        <div class="response-tabs" role="group" :aria-label="$t('responseValidationTestTitle')">
                            <button
                                v-for="tab in responseTabs"
                                :key="tab.id"
                                type="button"
                                class="response-tab"
                                :class="{ active: activeResponseTab === tab.id }"
                                :aria-pressed="activeResponseTab === tab.id"
                                @click="activeResponseTab = tab.id"
                            >
                                {{ $t(tab.label) }}
                            </button>
                        </div>

                        <div v-if="activeResponseTab === 'body'" class="response-tab-content">
                            <div
                                v-if="hasJsonBodyPreview"
                                class="field-picker-note"
                                :class="{ ready: activeConditionId }"
                            >
                                <font-awesome-icon icon="info-circle" />
                                {{
                                    activeConditionId
                                        ? $t("responseValidationFieldPickerReady")
                                        : $t("responseValidationFieldPickerSelectCondition")
                                }}
                            </div>
                            <ResponseValidationJsonViewer
                                v-if="hasJsonBodyPreview"
                                :value="parsedJsonBody"
                                @select-path="applyJsonPath"
                            />
                            <pre v-else>{{ formattedBody }}</pre>
                        </div>
                        <div v-else-if="activeResponseTab === 'headers'" class="response-tab-content">
                            <pre>{{ formattedHeaders }}</pre>
                        </div>
                        <div v-else class="response-tab-content">
                            <pre>{{ formattedRawBody }}</pre>
                        </div>
                    </div>

                    <div
                        v-if="validationData"
                        class="validation-summary"
                        :class="validationData.passed ? 'passed' : 'failed'"
                        role="status"
                        aria-live="polite"
                    >
                        <div class="validation-summary-title">
                            <font-awesome-icon :icon="validationData.passed ? 'check-circle' : 'times-circle'" />
                            <strong>
                                {{
                                    validationData.passed
                                        ? $t("responseValidationOverallPassed")
                                        : $t("responseValidationOverallFailed")
                                }}
                            </strong>
                        </div>
                        <div class="validation-summary-detail">
                            <span v-if="validationData.scenarioId">
                                {{ $t("responseValidationMatchedScenario") }}: {{ matchedScenarioLabel }}
                            </span>
                            <span v-else>{{ $t("responseValidationNoScenarioMatched") }}</span>
                        </div>
                        <div v-if="validationData.message" class="validation-message">{{ validationData.message }}</div>
                    </div>

                    <div v-if="validationData && validationData.root" class="validation-tree">
                        <h3 class="h6">{{ $t("responseValidationEvaluationDetails") }}</h3>
                        <ResponseValidationResultNode :node="validationData.root" />
                    </div>

                    <div v-if="lastAppliedPath" class="alert alert-success path-applied" role="status">
                        <font-awesome-icon icon="check" />
                        {{ $t("responseValidationPathApplied", { path: lastAppliedPath }) }}
                    </div>
                </template>
            </aside>
        </section>
    </div>
</template>

<script>
import VueMultiselect from "vue-multiselect";
import ResponseValidationJsonViewer from "./ResponseValidationJsonViewer.vue";
import ResponseValidationResultNode from "./ResponseValidationResultNode.vue";
import ResponseValidationRuleNode from "./ResponseValidationRuleNode.vue";

let nextWorkbenchId = 0;

/**
 * Create an identifier for a scenario or rule node.
 * @param {string} prefix Identifier prefix
 * @returns {string} Generated identifier
 */
function createWorkbenchId(prefix) {
    nextWorkbenchId += 1;
    return `${prefix}-${Date.now().toString(36)}-${nextWorkbenchId.toString(36)}`;
}

/**
 * Create an empty JSON condition for a new scenario.
 * @returns {object} Condition node
 */
function createCondition() {
    return {
        id: createWorkbenchId("condition"),
        type: "condition",
        source: "json",
        path: "",
        operator: "equals",
        valueType: "string",
        expectedValue: "",
    };
}

/**
 * Create a response scenario with a single condition.
 * @returns {object} Response scenario
 */
function createScenario() {
    return {
        id: createWorkbenchId("scenario"),
        statusCodes: ["200"],
        root: {
            id: createWorkbenchId("group"),
            type: "group",
            combinator: "and",
            children: [createCondition()],
        },
    };
}

/**
 * Clone serializable monitor configuration.
 * @param {any} value Value to clone
 * @returns {any} Cloned value
 */
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

const responseValidationUiLimits = Object.freeze({
    maxScenarios: 20,
    maxStatusCodesPerScenario: 20,
    maxTotalNodes: 100,
    maxDepth: 5,
});

const responseValidationRequestDraftFields = Object.freeze([
    "type",
    "url",
    "method",
    "body",
    "headers",
    "httpBodyEncoding",
    "timeout",
    "maxredirects",
    "ipFamily",
    "ignoreTls",
    "cacheBust",
    "accepted_statuscodes",
    "proxyId",
    "authMethod",
    "auth_method",
    "basic_auth_user",
    "basic_auth_pass",
    "bearer_token",
    "authDomain",
    "authWorkstation",
    "oauth_client_id",
    "oauth_client_secret",
    "oauth_token_url",
    "oauth_scopes",
    "oauth_audience",
    "oauth_auth_method",
    "tlsCa",
    "tlsCert",
    "tlsKey",
]);

/**
 * Count group and condition nodes in one response-validation tree.
 * @param {object|null} node Rule-tree node
 * @returns {number} Total nodes in the tree
 */
function countResponseValidationNodes(node) {
    if (!node || typeof node !== "object") {
        return 0;
    }
    if (node.type !== "group") {
        return 1;
    }
    return 1 + (node.children || []).reduce((total, child) => total + countResponseValidationNodes(child), 0);
}

export default {
    name: "ResponseValidationWorkbench",

    components: {
        ResponseValidationJsonViewer,
        ResponseValidationResultNode,
        ResponseValidationRuleNode,
        VueMultiselect,
    },

    props: {
        modelValue: {
            type: Object,
            required: true,
        },
        monitorDraft: {
            type: Object,
            required: true,
        },
        statusCodeOptions: {
            type: Array,
            required: true,
        },
    },

    emits: ["update:modelValue"],

    data() {
        return {
            activeScenarioId: null,
            activeConditionId: null,
            activeResponseTab: "body",
            testing: false,
            testError: "",
            testResult: null,
            lastAppliedPath: "",
            testRequestId: 0,
            validationStale: false,
            limits: responseValidationUiLimits,
            responseTabs: [
                { id: "body", label: "responseValidationResponseBody" },
                { id: "headers", label: "responseValidationResponseHeaders" },
                { id: "raw", label: "responseValidationRawResponse" },
            ],
        };
    },

    computed: {
        scenarios() {
            return Array.isArray(this.modelValue?.scenarios) ? this.modelValue.scenarios : [];
        },

        activeScenario() {
            return this.scenarios.find((scenario) => scenario.id === this.activeScenarioId) || null;
        },

        activeStatusCodes: {
            get() {
                return this.activeScenario?.statusCodes || [];
            },
            set(statusCodes) {
                if (!this.activeScenario) {
                    return;
                }
                this.updateScenario({
                    ...this.activeScenario,
                    statusCodes,
                });
            },
        },

        responseData() {
            return this.testResult?.response || {};
        },

        validationData() {
            return this.testResult?.validation || null;
        },

        totalNodeCount() {
            return this.scenarios.reduce((total, scenario) => total + countResponseValidationNodes(scenario.root), 0);
        },

        canAddScenario() {
            return (
                this.scenarios.length < this.limits.maxScenarios && this.totalNodeCount <= this.limits.maxTotalNodes - 2
            );
        },

        canAddNode() {
            return this.totalNodeCount < this.limits.maxTotalNodes;
        },

        canAddGroupNode() {
            return this.totalNodeCount <= this.limits.maxTotalNodes - 2;
        },

        requestDraftFingerprint() {
            const draft = {};
            for (const field of responseValidationRequestDraftFields) {
                draft[field] = this.monitorDraft[field];
            }
            return JSON.stringify(draft);
        },

        responseStatusClass() {
            const status = Number(this.responseData.status);
            if (status >= 200 && status < 400) {
                return "status-success";
            }
            if (status >= 400) {
                return "status-error";
            }
            return "status-neutral";
        },

        hasJsonBodyPreview() {
            return this.responseData.bodyIsJson === true && !this.responseData.bodyJsonPreviewUnavailable;
        },

        parsedJsonBody() {
            return this.hasJsonBodyPreview ? this.responseData.body : null;
        },

        formattedBody() {
            if (this.responseData.bodyJsonPreviewUnavailable) {
                return this.responseData.body || this.$t("responseValidationEmptyResponse");
            }
            if (this.responseData.bodyIsJson) {
                return JSON.stringify(this.responseData.body, null, 2);
            }
            return this.formatContent(this.responseData.body);
        },

        formattedHeaders() {
            return this.formatContent(this.responseData.headers);
        },

        formattedRawBody() {
            const content = this.responseData.rawBody ?? this.responseData.body;
            if (content === undefined || content === null || content === "") {
                return this.$t("responseValidationEmptyResponse");
            }
            return typeof content === "string" ? content : this.formatContent(content);
        },

        matchedScenarioLabel() {
            const scenario = this.scenarios.find((item) => item.id === this.validationData?.scenarioId);
            return scenario ? this.scenarioLabel(scenario) : this.validationData?.scenarioId || "—";
        },
    },

    watch: {
        requestDraftFingerprint() {
            this.invalidateTestResult();
        },

        modelValue: {
            deep: true,
            handler() {
                this.invalidateValidationResult();
            },
        },

        scenarios: {
            immediate: true,
            deep: true,
            handler(scenarios) {
                if (!scenarios.some((scenario) => scenario.id === this.activeScenarioId)) {
                    this.activeScenarioId = scenarios[0]?.id || null;
                    this.activeConditionId = this.findFirstConditionId(scenarios[0]?.root);
                    return;
                }

                const activeScenario = scenarios.find((scenario) => scenario.id === this.activeScenarioId);
                if (!this.findCondition(activeScenario ? [activeScenario] : [], this.activeConditionId)) {
                    this.activeConditionId = this.findFirstConditionId(activeScenario?.root);
                }
            },
        },
    },

    methods: {
        scenarioLabel(scenario) {
            if (!scenario.statusCodes || scenario.statusCodes.length === 0) {
                return this.$t("responseValidationStatusUnset");
            }
            return scenario.statusCodes.join(", ");
        },

        selectScenario(scenario) {
            this.activeScenarioId = scenario.id;
            this.activeConditionId = this.findFirstConditionId(scenario.root);
            this.lastAppliedPath = "";
        },

        addScenario() {
            if (!this.canAddScenario) {
                return;
            }
            const scenario = createScenario();
            if (this.scenarios.length > 0) {
                scenario.statusCodes = [];
            }
            this.emitScenarios([...this.scenarios, scenario]);
            this.activeScenarioId = scenario.id;
            this.activeConditionId = this.findFirstConditionId(scenario.root);
        },

        removeActiveScenario() {
            if (!this.activeScenario) {
                return;
            }
            const currentIndex = this.scenarios.findIndex((scenario) => scenario.id === this.activeScenario.id);
            const scenarios = this.scenarios.filter((scenario) => scenario.id !== this.activeScenario.id);
            this.emitScenarios(scenarios);
            const nextScenario = scenarios[Math.min(currentIndex, scenarios.length - 1)] || null;
            this.activeScenarioId = nextScenario?.id || null;
            this.activeConditionId = this.findFirstConditionId(nextScenario?.root);
        },

        addStatusCode(statusCode) {
            const normalized = String(statusCode || "").trim();
            if (
                !normalized ||
                this.activeStatusCodes.includes(normalized) ||
                this.activeStatusCodes.length >= this.limits.maxStatusCodesPerScenario
            ) {
                return;
            }
            this.activeStatusCodes = [...this.activeStatusCodes, normalized];
        },

        updateScenario(scenario) {
            const scenarios = this.scenarios.map((item) => (item.id === scenario.id ? scenario : item));
            this.emitScenarios(scenarios);
        },

        updateActiveRoot(root) {
            if (!this.activeScenario) {
                return;
            }
            this.updateScenario({
                ...this.activeScenario,
                root,
            });
        },

        emitScenarios(scenarios) {
            this.$emit("update:modelValue", {
                version: 1,
                scenarios,
            });
        },

        findFirstConditionId(node) {
            if (!node) {
                return null;
            }
            if (node.type === "condition") {
                return node.id;
            }
            for (const child of node.children || []) {
                const id = this.findFirstConditionId(child);
                if (id) {
                    return id;
                }
            }
            return null;
        },

        applyJsonPath(selection) {
            if (!this.activeConditionId) {
                this.lastAppliedPath = "";
                return;
            }

            const rules = clone(this.modelValue);
            const condition = this.findCondition(rules.scenarios, this.activeConditionId);
            if (!condition) {
                return;
            }
            condition.path = selection.path;
            this.$emit("update:modelValue", rules);
            this.lastAppliedPath = selection.path;
        },

        findCondition(scenarios, conditionId) {
            const findInNode = (node) => {
                if (node.type === "condition") {
                    return node.id === conditionId ? node : null;
                }
                for (const child of node.children || []) {
                    const condition = findInNode(child);
                    if (condition) {
                        return condition;
                    }
                }
                return null;
            };

            for (const scenario of scenarios || []) {
                const condition = findInNode(scenario.root);
                if (condition) {
                    return condition;
                }
            }
            return null;
        },

        runTest() {
            const requestId = ++this.testRequestId;
            this.testing = true;
            this.testError = "";
            this.lastAppliedPath = "";
            this.validationStale = false;

            let monitorDraft;
            try {
                monitorDraft = clone(this.monitorDraft);
            } catch (error) {
                this.testing = false;
                this.testError = error.message;
                return;
            }

            this.$root.getSocket().emit("testResponseValidation", monitorDraft, (result) => {
                if (requestId !== this.testRequestId) {
                    return;
                }
                this.testing = false;
                if (!result?.ok) {
                    this.testResult = null;
                    this.testError = result?.msg || this.$t("responseValidationTestFailed");
                    return;
                }
                this.testResult = {
                    response: result.response || {},
                    validation: result.validation || null,
                };
                this.validationStale = false;
                this.activeResponseTab = "body";
            });
        },

        invalidateValidationResult() {
            if (this.testing) {
                this.testRequestId += 1;
                this.testing = false;
                this.testResult = null;
            } else if (this.testResult?.validation) {
                this.testResult = {
                    ...this.testResult,
                    validation: null,
                };
                this.validationStale = true;
            }
            this.testError = "";
        },

        invalidateTestResult() {
            if (!this.testing && !this.testResult && !this.testError) {
                return;
            }
            this.testRequestId += 1;
            this.testing = false;
            this.testResult = null;
            this.testError = "";
            this.lastAppliedPath = "";
            this.validationStale = false;
        },

        formatDuration(duration) {
            return Number.isFinite(Number(duration)) ? `${Number(duration)} ms` : "—";
        },

        formatSize(size) {
            const numericSize = Number(size);
            if (!Number.isFinite(numericSize)) {
                return "—";
            }
            if (numericSize < 1024) {
                return `${numericSize} B`;
            }
            if (numericSize < 1024 * 1024) {
                return `${(numericSize / 1024).toFixed(1)} KB`;
            }
            return `${(numericSize / (1024 * 1024)).toFixed(1)} MB`;
        },

        formatContent(content) {
            if (content === undefined || content === null || content === "") {
                return this.$t("responseValidationEmptyResponse");
            }
            if (typeof content === "string") {
                try {
                    return JSON.stringify(JSON.parse(content), null, 2);
                } catch (_) {
                    return content;
                }
            }
            try {
                return JSON.stringify(content, null, 2);
            } catch (_) {
                return String(content);
            }
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.response-validation-layout-container {
    container: response-validation-layout / inline-size;
    width: 100%;
    min-width: 0;
}

.response-validation-workbench {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(330px, 2fr);
    gap: 18px;
    width: 100%;
    min-width: 0;
    margin-top: 16px;
}

.response-validation-workbench > *,
.panel-heading > *,
.scenario-editor,
.scenario-toolbar > *,
.response-summary,
.response-content,
.validation-tree {
    min-width: 0;
}

.rules-panel,
.test-panel {
    min-width: 0;
    padding: 18px;
    border: 1px solid #dfe3e8;
    border-radius: 12px;
    background: #fff;
}

.test-panel {
    background: #f8fafb;
}

.panel-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 14px;
    margin-bottom: 15px;
}

.add-scenario-control {
    display: grid;
    min-width: 0;
    justify-items: end;
    gap: 4px;
}

.limit-note {
    max-width: 210px;
    margin: 0;
    text-align: right;
}

.scenario-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 14px;
    padding-bottom: 4px;
}

.scenario-tab,
.response-tab {
    border: 0;
    color: #5c6672;
    background: transparent;
    white-space: nowrap;
}

.scenario-tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 11px;
    border: 1px solid #d9dee4;
    border-radius: 999px;
    font-size: 0.82rem;
}

.scenario-tab.active {
    border-color: $primary;
    color: #0b4421;
    background: $highlight-white;
}

.scenario-number {
    display: inline-grid;
    place-items: center;
    width: 19px;
    height: 19px;
    border-radius: 50%;
    color: #fff;
    background: #78828e;
    font-size: 0.68rem;
    font-weight: 700;
}

.scenario-tab.active .scenario-number {
    color: #073616;
    background: $primary;
}

.scenario-editor {
    display: grid;
    gap: 13px;
}

.scenario-toolbar {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 12px;
}

.status-code-field {
    flex: 1;
    min-width: 0;
}

.response-validation-status-select {
    width: 100%;
    max-width: 100%;
    min-width: 0;
}

.delete-scenario {
    flex: 0 0 auto;
    max-width: 100%;
    margin-bottom: 1px;
}

.logic-description,
.field-picker-note {
    padding: 8px 10px;
    border-radius: 7px;
    color: #66717d;
    background: #f1f3f5;
    font-size: 0.78rem;
    overflow-wrap: anywhere;
}

.empty-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 240px;
    padding: 28px;
    border: 1px dashed #ccd2d9;
    border-radius: 9px;
    color: #68727e;
    text-align: center;
}

.empty-icon {
    margin-bottom: 5px;
    color: #8d97a2;
    font-size: 1.5rem;
}

.test-alert {
    margin-bottom: 0;
}

.response-summary {
    display: grid;
    gap: 10px;
    margin-bottom: 12px;
}

.status-block {
    display: flex;
    align-items: baseline;
    gap: 9px;
    padding: 12px;
    border-radius: 9px;
}

.status-success {
    color: #0f5132;
    background: #d1e7dd;
}

.status-error {
    color: #842029;
    background: #f8d7da;
}

.status-neutral {
    color: #41464b;
    background: #e2e3e5;
}

.status-code {
    font-size: 1.55rem;
    font-weight: 750;
    line-height: 1;
}

.status-text {
    font-size: 0.85rem;
}

.response-meta {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 7px;
}

.response-meta > div {
    min-width: 0;
    padding: 8px;
    border: 1px solid #e1e5e9;
    border-radius: 7px;
    background: #fff;
}

.response-meta span,
.response-meta strong {
    display: block;
}

.response-meta span {
    margin-bottom: 2px;
    color: #7a838e;
    font-size: 0.68rem;
}

.response-meta strong {
    overflow: hidden;
    font-size: 0.75rem;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.validation-summary {
    margin-top: 12px;
    margin-bottom: 12px;
    padding: 11px;
    border-left: 3px solid;
    border-radius: 8px;
}

.validation-summary.passed {
    border-color: #198754;
    color: #0f5132;
    background: #e6f4ec;
}

.validation-summary.failed {
    border-color: $danger;
    color: #842029;
    background: #fbeaec;
}

.validation-summary-title {
    display: flex;
    align-items: center;
    gap: 7px;
}

.validation-summary-detail,
.validation-message {
    margin-top: 4px;
    font-size: 0.77rem;
}

.validation-tree {
    display: grid;
    gap: 7px;
    margin-bottom: 12px;
}

.response-content {
    border: 1px solid #dfe3e8;
    border-radius: 9px;
    overflow: hidden;
    background: #fff;
}

.response-tabs {
    display: flex;
    flex-wrap: wrap;
    border-bottom: 1px solid #dfe3e8;
}

.response-tab {
    padding: 8px 11px;
    border-bottom: 2px solid transparent;
    font-size: 0.78rem;
}

.response-tab.active {
    border-bottom-color: $primary;
    color: #173d25;
    font-weight: 650;
}

.response-tab-content {
    max-height: 430px;
    padding: 10px;
    overflow: auto;
}

.response-tab-content pre {
    min-height: 0;
    margin: 0;
    font-size: 0.75rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.field-picker-note {
    margin-bottom: 8px;
}

.field-picker-note.ready {
    color: #0f5132;
    background: #d1e7dd;
}

.path-applied {
    margin-top: 10px;
    margin-bottom: 0;
    padding: 8px 10px;
    font-size: 0.77rem;
    overflow-wrap: anywhere;
}

/* stylelint-disable-next-line selector-pseudo-class-no-unknown */
:global(.dark) {
    .rules-panel,
    .test-panel,
    .response-content,
    .response-meta > div {
        border-color: $dark-border-color;
        color: $dark-font-color;
        background: $dark-bg;
    }

    .test-panel,
    .response-tab-content {
        background: $dark-bg2;
    }

    .scenario-tab,
    .response-tab {
        color: $dark-font-color;
    }

    .scenario-tab {
        border-color: $dark-border-color;
    }

    .scenario-tab.active,
    .response-tab.active {
        color: $highlight;
        background: rgba($primary, 0.08);
    }

    .logic-description,
    .field-picker-note,
    .empty-panel {
        border-color: $dark-border-color;
        color: $dark-font-color;
        background: $dark-bg2;
    }

    .response-tabs {
        border-color: $dark-border-color;
    }
}

@container response-validation-layout (max-width: 1120px) {
    .response-validation-workbench {
        grid-template-columns: 1fr;
    }
}

@container response-validation-layout (max-width: 620px) {
    .panel-heading,
    .scenario-toolbar {
        align-items: stretch;
        flex-direction: column;
    }

    .add-scenario-control {
        justify-items: start;
    }

    .limit-note {
        text-align: left;
    }

    .delete-scenario,
    .test-heading .btn {
        align-self: flex-start;
    }
}

@container response-validation-layout (max-width: 520px) {
    .rules-panel,
    .test-panel {
        padding: 13px;
    }

    .response-meta {
        grid-template-columns: 1fr;
    }
}

@supports not (container-type: inline-size) {
    @media (max-width: 1599px) {
        .response-validation-workbench {
            grid-template-columns: 1fr;
        }
    }
}

@media (max-width: 575px) {
    .rules-panel,
    .test-panel {
        padding: 13px;
    }
}
</style>
