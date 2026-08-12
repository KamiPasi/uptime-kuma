<template>
    <div class="validation-result-node" :class="[`node-${nodeType}`, resultClass]">
        <div class="result-heading">
            <span class="result-icon" aria-hidden="true">
                <font-awesome-icon v-if="passed" icon="check-circle" />
                <font-awesome-icon v-else icon="times-circle" />
            </span>
            <div class="result-title">
                <template v-if="nodeType === 'group'">
                    {{
                        $t("responseValidationResultGroup", {
                            combinator: String(node.combinator || "and").toUpperCase(),
                        })
                    }}
                </template>
                <template v-else>
                    <code>{{ node.path || "$" }}</code>
                    <span>{{ operatorLabel }}</span>
                    <code v-if="!isExistenceOperator">{{ formattedExpectedValue }}</code>
                    <span v-if="node.expectedValueTruncated" class="truncated-badge">
                        {{ $t("responseValidationValueTruncated") }}
                    </span>
                </template>
            </div>
            <span class="result-badge" :class="resultClass">
                {{ passed ? $t("responseValidationPassed") : $t("responseValidationFailed") }}
            </span>
        </div>

        <div v-if="nodeType === 'condition'" class="condition-result-detail">
            <span>
                {{ $t("responseValidationActualValue") }}:
                <code>{{ formattedActualValue }}</code>
                <span v-if="node.actualValueTruncated" class="truncated-badge">
                    {{ $t("responseValidationValueTruncated") }}
                </span>
            </span>
            <span v-if="typeof node.exists === 'boolean'">
                {{ $t("responseValidationFieldExists") }}:
                <strong>{{ node.exists ? $t("Yes") : $t("No") }}</strong>
            </span>
        </div>

        <div v-if="node.reason" class="result-reason">{{ node.reason }}</div>

        <div v-if="nodeType === 'group' && node.children && node.children.length" class="result-children">
            <ResponseValidationResultNode v-for="child in node.children" :key="child.id" :node="child" />
        </div>
    </div>
</template>

<script>
export default {
    name: "ResponseValidationResultNode",

    props: {
        node: {
            type: Object,
            required: true,
        },
    },

    computed: {
        nodeType() {
            return this.node.type === "group" ? "group" : "condition";
        },

        passed() {
            return this.node.passed === true;
        },

        resultClass() {
            return this.passed ? "passed" : "failed";
        },

        isExistenceOperator() {
            return ["exists", "notExists"].includes(this.node.operator);
        },

        operatorLabel() {
            const labels = {
                equals: "responseValidationOperatorEquals",
                notEquals: "responseValidationOperatorNotEquals",
                contains: "responseValidationOperatorContains",
                notContains: "responseValidationOperatorNotContains",
                greaterThan: "responseValidationOperatorGreaterThan",
                greaterThanOrEqual: "responseValidationOperatorGreaterThanOrEqual",
                lessThan: "responseValidationOperatorLessThan",
                lessThanOrEqual: "responseValidationOperatorLessThanOrEqual",
                exists: "responseValidationOperatorExists",
                notExists: "responseValidationOperatorNotExists",
            };
            return this.$t(labels[this.node.operator] || this.node.operator || "Condition");
        },

        formattedExpectedValue() {
            return this.formatValue(this.node.expectedValue, this.node.expectedValueTruncated);
        },

        formattedActualValue() {
            return this.formatValue(this.node.actualValue, this.node.actualValueTruncated);
        },
    },

    methods: {
        formatValue(value, truncated = false) {
            if (truncated) {
                return String(value);
            }
            if (value === undefined) {
                return this.$t("responseValidationUndefined");
            }
            if (value === null) {
                return "null";
            }
            if (typeof value === "string") {
                return JSON.stringify(value);
            }
            if (typeof value === "object") {
                try {
                    return JSON.stringify(value);
                } catch (_) {
                    return String(value);
                }
            }
            return String(value);
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.validation-result-node {
    padding: 10px;
    border: 1px solid #e1e5e9;
    border-radius: 8px;
    background: #fff;
}

.validation-result-node.passed {
    border-left: 3px solid #198754;
}

.validation-result-node.failed {
    border-left: 3px solid $danger;
}

.result-heading {
    display: flex;
    align-items: center;
    gap: 8px;
}

.result-icon.passed,
.passed .result-icon {
    color: #198754;
}

.result-icon.failed,
.failed .result-icon {
    color: $danger;
}

.result-title {
    display: flex;
    align-items: center;
    flex: 1;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
    font-size: 0.84rem;
}

.result-title code {
    overflow-wrap: anywhere;
}

.result-badge {
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
}

.result-badge.passed {
    color: #0f5132;
    background: #d1e7dd;
}

.result-badge.failed {
    color: #842029;
    background: #f8d7da;
}

.condition-result-detail {
    display: flex;
    flex-wrap: wrap;
    gap: 7px 16px;
    margin-top: 7px;
    color: #69727d;
    font-size: 0.76rem;
}

.truncated-badge {
    color: #8a5a00;
    font-size: 0.7rem;
    font-weight: 600;
}

.result-reason {
    margin-top: 7px;
    color: $danger;
    font-size: 0.78rem;
}

.result-children {
    display: grid;
    gap: 8px;
    margin-top: 9px;
    margin-left: 10px;
}

/* stylelint-disable-next-line selector-pseudo-class-no-unknown */
:global(.dark) {
    .validation-result-node {
        border-color: $dark-border-color;
        background: $dark-bg2;
    }

    .condition-result-detail {
        color: $dark-font-color;
    }

    .truncated-badge {
        color: #f6c76f;
    }
}
</style>
