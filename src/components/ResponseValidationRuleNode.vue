<template>
    <div v-if="isGroup" class="response-validation-group" :class="{ 'is-root': isRoot }">
        <div class="group-heading">
            <div class="d-flex align-items-center gap-2 flex-wrap">
                <span class="group-label">
                    <font-awesome-icon icon="stream" />
                    {{ $t("responseValidationConditionGroup") }}
                </span>
                <div class="btn-group btn-group-sm" role="group" :aria-label="$t('responseValidationGroupLogic')">
                    <button
                        type="button"
                        class="btn"
                        :class="modelValue.combinator === 'and' ? 'btn-primary' : 'btn-outline-secondary'"
                        :aria-pressed="modelValue.combinator === 'and'"
                        @click="setCombinator('and')"
                    >
                        {{ $t("responseValidationAll") }}
                    </button>
                    <button
                        type="button"
                        class="btn"
                        :class="modelValue.combinator === 'or' ? 'btn-primary' : 'btn-outline-secondary'"
                        :aria-pressed="modelValue.combinator === 'or'"
                        @click="setCombinator('or')"
                    >
                        {{ $t("responseValidationAny") }}
                    </button>
                </div>
            </div>
            <button
                v-if="!isRoot"
                type="button"
                class="btn btn-sm btn-outline-danger"
                :aria-label="$t('responseValidationDeleteGroup')"
                @click="$emit('remove')"
            >
                <font-awesome-icon icon="trash" />
            </button>
        </div>

        <div class="group-children">
            <ResponseValidationRuleNode
                v-for="(child, index) in modelValue.children"
                :key="child.id"
                :model-value="child"
                :depth="depth + 1"
                :selected-condition-id="selectedConditionId"
                :can-add-condition="canAddCondition"
                :can-add-group="canAddGroup"
                :max-depth="maxDepth"
                @update:model-value="updateChild(index, $event)"
                @remove="removeChild(index)"
                @select-condition="$emit('select-condition', $event)"
            />

            <div v-if="modelValue.children.length === 0" class="empty-group">
                {{ $t("responseValidationEmptyGroup") }}
            </div>
        </div>

        <div class="group-actions">
            <button
                type="button"
                class="btn btn-sm btn-outline-secondary"
                :disabled="!canAddCondition"
                :aria-describedby="!canAddCondition ? limitMessageId : null"
                @click="addCondition"
            >
                <font-awesome-icon icon="plus" />
                {{ $t("responseValidationAddCondition") }}
            </button>
            <button
                type="button"
                class="btn btn-sm btn-outline-secondary"
                :disabled="!canCreateGroup"
                :aria-describedby="!canCreateGroup ? limitMessageId : null"
                @click="addGroup"
            >
                <font-awesome-icon icon="folder" />
                {{ $t("responseValidationAddGroup") }}
            </button>
            <span
                v-if="!canAddCondition || !canCreateGroup"
                :id="limitMessageId"
                class="form-text rule-limit-note"
                role="status"
            >
                {{ $t("responseValidationRuleLimitReached") }}
            </span>
        </div>
    </div>

    <div
        v-else
        class="response-validation-condition"
        :class="{ selected: selectedConditionId === modelValue.id }"
        role="group"
        :aria-current="selectedConditionId === modelValue.id ? 'true' : null"
        :aria-label="$t('responseValidationConditionEditor')"
        @click="$emit('select-condition', modelValue.id)"
        @focusin="$emit('select-condition', modelValue.id)"
    >
        <div class="condition-heading">
            <span class="condition-label">
                <font-awesome-icon icon="file" />
                JSON
                <span v-if="selectedConditionId === modelValue.id" class="visually-hidden">
                    {{ $t("responseValidationSelectedCondition") }}
                </span>
            </span>
            <button
                type="button"
                class="btn btn-sm btn-outline-danger"
                :aria-label="$t('responseValidationDeleteCondition')"
                @click.stop="$emit('remove')"
            >
                <font-awesome-icon icon="trash" />
            </button>
        </div>

        <div class="condition-fields">
            <div class="path-field">
                <label :for="fieldId('path')" class="form-label">{{ $t("responseValidationJsonPath") }}</label>
                <input
                    :id="fieldId('path')"
                    :value="modelValue.path"
                    type="text"
                    class="form-control"
                    maxlength="512"
                    placeholder="$.responses.usage.input_tokens"
                    @focus="$emit('select-condition', modelValue.id)"
                    @input="updateField('path', $event.target.value)"
                />
            </div>

            <div>
                <label :for="fieldId('operator')" class="form-label">{{ $t("Condition") }}</label>
                <select
                    :id="fieldId('operator')"
                    :value="modelValue.operator"
                    class="form-select"
                    @change="changeOperator($event.target.value)"
                >
                    <option v-for="operator in operatorOptions" :key="operator.value" :value="operator.value">
                        {{ $t(operator.label) }}
                    </option>
                </select>
            </div>

            <div>
                <label :for="fieldId('value-type')" class="form-label">
                    {{ $t("responseValidationValueType") }}
                </label>
                <select
                    :id="fieldId('value-type')"
                    :value="modelValue.valueType"
                    class="form-select"
                    :disabled="isExistenceOperator"
                    @change="changeValueType($event.target.value)"
                >
                    <option v-for="valueType in valueTypeOptions" :key="valueType.value" :value="valueType.value">
                        {{ $t(valueType.label) }}
                    </option>
                </select>
            </div>

            <div v-if="!isExistenceOperator" class="expected-value-field">
                <label :for="fieldId('expected-value')" class="form-label">
                    {{ $t("Expected Value") }}
                </label>
                <select
                    v-if="modelValue.valueType === 'boolean'"
                    :id="fieldId('expected-value')"
                    :value="String(modelValue.expectedValue)"
                    class="form-select"
                    @change="updateField('expectedValue', $event.target.value === 'true')"
                >
                    <option value="true">true</option>
                    <option value="false">false</option>
                </select>
                <input
                    v-else-if="modelValue.valueType === 'number'"
                    :id="fieldId('expected-value')"
                    :value="modelValue.expectedValue"
                    type="number"
                    class="form-control"
                    step="any"
                    @input="updateNumberValue($event.target.value)"
                />
                <input
                    v-else-if="modelValue.valueType === 'null'"
                    :id="fieldId('expected-value')"
                    value="null"
                    type="text"
                    class="form-control"
                    disabled
                />
                <input
                    v-else
                    :id="fieldId('expected-value')"
                    :value="modelValue.expectedValue"
                    type="text"
                    class="form-control"
                    maxlength="4096"
                    @input="updateField('expectedValue', $event.target.value)"
                />
            </div>

            <div v-else class="existence-note">
                <span class="form-text">{{ $t("responseValidationNoExpectedValue") }}</span>
            </div>
        </div>
    </div>
</template>

<script>
let nextNodeId = 0;

/**
 * Create a stable-enough identifier for a newly added rule node.
 * @param {string} prefix Node type prefix
 * @returns {string} Generated identifier
 */
function createNodeId(prefix) {
    nextNodeId += 1;
    return `${prefix}-${Date.now().toString(36)}-${nextNodeId.toString(36)}`;
}

/**
 * Create an empty JSON response condition.
 * @returns {object} Condition node
 */
function createCondition() {
    return {
        id: createNodeId("condition"),
        type: "condition",
        source: "json",
        path: "",
        operator: "equals",
        valueType: "string",
        expectedValue: "",
    };
}

/**
 * Create a nested response condition group.
 * @returns {object} Group node
 */
function createGroup() {
    return {
        id: createNodeId("group"),
        type: "group",
        combinator: "and",
        children: [createCondition()],
    };
}

export default {
    name: "ResponseValidationRuleNode",

    props: {
        modelValue: {
            type: Object,
            required: true,
        },
        depth: {
            type: Number,
            default: 0,
        },
        selectedConditionId: {
            type: String,
            default: null,
        },
        canAddCondition: {
            type: Boolean,
            default: true,
        },
        canAddGroup: {
            type: Boolean,
            default: true,
        },
        maxDepth: {
            type: Number,
            default: 5,
        },
    },

    emits: ["update:modelValue", "remove", "select-condition"],

    data() {
        return {
            operatorOptions: [
                { value: "equals", label: "responseValidationOperatorEquals" },
                { value: "notEquals", label: "responseValidationOperatorNotEquals" },
                { value: "contains", label: "responseValidationOperatorContains" },
                { value: "notContains", label: "responseValidationOperatorNotContains" },
                { value: "greaterThan", label: "responseValidationOperatorGreaterThan" },
                { value: "greaterThanOrEqual", label: "responseValidationOperatorGreaterThanOrEqual" },
                { value: "lessThan", label: "responseValidationOperatorLessThan" },
                { value: "lessThanOrEqual", label: "responseValidationOperatorLessThanOrEqual" },
                { value: "exists", label: "responseValidationOperatorExists" },
                { value: "notExists", label: "responseValidationOperatorNotExists" },
            ],
        };
    },

    computed: {
        isGroup() {
            return this.modelValue.type === "group";
        },

        isRoot() {
            return this.depth === 0;
        },

        isExistenceOperator() {
            return ["exists", "notExists"].includes(this.modelValue.operator);
        },

        valueTypeOptions() {
            if (this.isExistenceOperator) {
                return [{ value: "null", label: "responseValidationNull" }];
            }
            if (["contains", "notContains"].includes(this.modelValue.operator)) {
                return [{ value: "string", label: "responseValidationString" }];
            }
            if (
                ["greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual"].includes(this.modelValue.operator)
            ) {
                return [{ value: "number", label: "responseValidationNumber" }];
            }
            return [
                { value: "string", label: "responseValidationString" },
                { value: "number", label: "responseValidationNumber" },
                { value: "boolean", label: "responseValidationBoolean" },
                { value: "null", label: "responseValidationNull" },
            ];
        },

        canCreateGroup() {
            // A new group also contains one condition. Keep both nodes inside
            // the server's root-relative maximum depth.
            return this.canAddGroup && this.depth < this.maxDepth - 2;
        },

        limitMessageId() {
            return `response-validation-${this.modelValue.id}-limit`;
        },
    },

    methods: {
        fieldId(field) {
            return `response-validation-${this.modelValue.id}-${field}`;
        },

        setCombinator(combinator) {
            this.$emit("update:modelValue", {
                ...this.modelValue,
                combinator,
            });
        },

        updateField(field, value) {
            this.$emit("update:modelValue", {
                ...this.modelValue,
                [field]: value,
            });
        },

        updateNumberValue(value) {
            this.updateField("expectedValue", value === "" ? "" : Number(value));
        },

        changeOperator(operator) {
            const update = { operator };
            if (["exists", "notExists"].includes(operator)) {
                update.valueType = "null";
                update.expectedValue = null;
            } else if (["contains", "notContains"].includes(operator)) {
                if (this.modelValue.valueType !== "string") {
                    update.valueType = "string";
                    update.expectedValue = "";
                }
            } else if (["greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual"].includes(operator)) {
                if (this.modelValue.valueType !== "number") {
                    update.valueType = "number";
                    update.expectedValue = 0;
                }
            } else if (["exists", "notExists"].includes(this.modelValue.operator)) {
                update.valueType = "string";
                update.expectedValue = "";
            }
            this.$emit("update:modelValue", {
                ...this.modelValue,
                ...update,
            });
        },

        changeValueType(valueType) {
            this.$emit("update:modelValue", {
                ...this.modelValue,
                valueType,
                expectedValue: this.defaultValueForType(valueType),
            });
        },

        defaultValueForType(valueType) {
            if (valueType === "number") {
                return 0;
            }
            if (valueType === "boolean") {
                return true;
            }
            if (valueType === "null") {
                return null;
            }
            return "";
        },

        updateChild(index, child) {
            const children = [...this.modelValue.children];
            children[index] = child;
            this.$emit("update:modelValue", {
                ...this.modelValue,
                children,
            });
        },

        removeChild(index) {
            const children = [...this.modelValue.children];
            children.splice(index, 1);
            this.$emit("update:modelValue", {
                ...this.modelValue,
                children,
            });
        },

        addCondition() {
            if (!this.canAddCondition) {
                return;
            }
            this.$emit("update:modelValue", {
                ...this.modelValue,
                children: [...this.modelValue.children, createCondition()],
            });
        },

        addGroup() {
            if (!this.canCreateGroup) {
                return;
            }
            this.$emit("update:modelValue", {
                ...this.modelValue,
                children: [...this.modelValue.children, createGroup()],
            });
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.response-validation-group {
    container: validation-group / inline-size;
    box-sizing: border-box;
    max-width: 100%;
    min-width: 0;
    padding: 14px;
    border: 1px solid #dfe3e8;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.018);
}

.response-validation-group:not(.is-root) {
    width: auto;
    margin-left: 14px;
    border-left: 3px solid rgba($primary, 0.65);
}

.group-heading,
.condition-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    min-width: 0;
}

.group-heading > *,
.condition-heading > * {
    min-width: 0;
}

.group-heading > button,
.condition-heading > button {
    flex: 0 0 auto;
    max-width: 100%;
    margin-left: auto;
}

.group-heading .btn-group {
    flex-wrap: wrap;
    max-width: 100%;
}

.group-label,
.condition-label {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 0.82rem;
    font-weight: 600;
    color: #5b6470;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    overflow-wrap: anywhere;
}

.group-children {
    display: grid;
    gap: 12px;
    min-width: 0;
    margin-top: 12px;
}

.group-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
}

.rule-limit-note {
    flex-basis: 100%;
    margin: 0;
}

.empty-group {
    padding: 14px;
    border: 1px dashed #c8cfd7;
    border-radius: 8px;
    color: #7b8490;
    text-align: center;
}

.response-validation-condition {
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    padding: 13px;
    border: 1px solid #dfe3e8;
    border-radius: 9px;
    background: #fff;
    transition:
        border-color 0.15s ease,
        box-shadow 0.15s ease;
}

.response-validation-condition.selected {
    border-color: $primary;
    box-shadow: 0 0 0 3px rgba($primary, 0.16);
}

.condition-fields {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 1fr);
    gap: 10px;
    align-items: end;
    margin-top: 10px;
}

.condition-fields > *,
.condition-fields input,
.condition-fields select {
    width: 100%;
    max-width: 100%;
    min-width: 0;
}

.form-label {
    margin-bottom: 5px;
    font-size: 0.8rem;
}

.existence-note {
    display: flex;
    align-items: center;
    min-height: 38px;
}

/* stylelint-disable-next-line selector-pseudo-class-no-unknown */
:global(.dark) {
    .response-validation-group {
        border-color: $dark-border-color;
        background: rgba(255, 255, 255, 0.025);
    }

    .response-validation-condition {
        border-color: $dark-border-color;
        background: $dark-bg2;
    }

    .response-validation-condition.selected {
        border-color: $primary;
    }

    .group-label,
    .condition-label,
    .empty-group {
        color: $dark-font-color;
    }

    .empty-group {
        border-color: $dark-border-color;
    }
}

@container validation-group (max-width: 760px) {
    .condition-fields {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@container validation-group (max-width: 480px) {
    .response-validation-group:not(.is-root) {
        margin-left: 4px;
        padding: 10px;
    }

    .condition-fields {
        grid-template-columns: 1fr;
    }

    .group-heading,
    .condition-heading {
        align-items: flex-start;
    }
}

@supports not (container-type: inline-size) {
    @media (max-width: 1599px) {
        .condition-fields {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
}

@media (max-width: 575px) {
    .response-validation-group:not(.is-root) {
        margin-left: 4px;
        padding: 10px;
    }

    .condition-fields {
        grid-template-columns: 1fr;
    }
}
</style>
