<template>
    <div class="json-viewer" :class="{ 'json-viewer-root': depth === 0 }">
        <template v-if="isContainer">
            <details :open="depth < 2">
                <summary>
                    <span class="summary-mark">{{ isArray ? "[ ]" : "{ }" }}</span>
                    <span class="summary-count">
                        {{ $t("responseValidationJsonItems", { count: entries.length }) }}
                    </span>
                </summary>

                <div class="json-children">
                    <div
                        v-for="([key, childValue], index) in visibleEntries"
                        :key="`${path}-${key}-${index}`"
                        class="json-row"
                    >
                        <div class="json-key-line">
                            <code class="json-key">{{ key }}</code>
                            <button
                                type="button"
                                class="btn btn-sm btn-link use-field-button"
                                :title="$t('responseValidationUseFieldHelp')"
                                @click="$emit('select-path', { path: childPath(key), value: childValue })"
                            >
                                <font-awesome-icon icon="plus-circle" />
                                {{ $t("responseValidationUseField") }}
                            </button>
                        </div>

                        <ResponseValidationJsonViewer
                            v-if="isObject(childValue)"
                            :value="childValue"
                            :path="childPath(key)"
                            :depth="depth + 1"
                            @select-path="$emit('select-path', $event)"
                        />
                        <code v-else class="json-value" :class="valueClass(childValue)">
                            {{ formatValue(childValue) }}
                        </code>
                    </div>

                    <div v-if="entries.length > visibleEntries.length" class="truncated-note">
                        {{
                            $t("responseValidationJsonTruncated", {
                                count: entries.length - visibleEntries.length,
                            })
                        }}
                    </div>
                </div>
            </details>
        </template>

        <div v-else class="json-primitive">
            <code class="json-value" :class="valueClass(value)">{{ formatValue(value) }}</code>
            <button
                type="button"
                class="btn btn-sm btn-link use-field-button"
                @click="$emit('select-path', { path, value })"
            >
                <font-awesome-icon icon="plus-circle" />
                {{ $t("responseValidationUseField") }}
            </button>
        </div>
    </div>
</template>

<script>
export default {
    name: "ResponseValidationJsonViewer",

    props: {
        value: {
            type: null,
            required: true,
        },
        path: {
            type: String,
            default: "$",
        },
        depth: {
            type: Number,
            default: 0,
        },
    },

    emits: ["select-path"],

    computed: {
        isContainer() {
            return this.isObject(this.value);
        },

        isArray() {
            return Array.isArray(this.value);
        },

        entries() {
            return this.isContainer ? Object.entries(this.value) : [];
        },

        visibleEntries() {
            return this.entries.slice(0, 200);
        },
    },

    methods: {
        isObject(value) {
            return value !== null && typeof value === "object";
        },

        childPath(key) {
            if (this.isArray) {
                return `${this.path}[${key}]`;
            }
            if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
                return `${this.path}.${key}`;
            }
            return `${this.path}.\`${String(key).replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
        },

        formatValue(value) {
            if (typeof value === "string") {
                return JSON.stringify(value);
            }
            if (value === null) {
                return "null";
            }
            return String(value);
        },

        valueClass(value) {
            if (value === null) {
                return "value-null";
            }
            return `value-${typeof value}`;
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.json-viewer-root {
    padding: 10px;
    border: 1px solid #e2e6ea;
    border-radius: 8px;
    background: #fbfcfd;
}

details > summary {
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    color: #67717e;
    user-select: none;
}

.summary-mark {
    font-family: var(--bs-font-monospace);
    font-weight: 700;
    color: #57606a;
}

.summary-count {
    font-size: 0.78rem;
}

.json-children {
    display: grid;
    gap: 7px;
    margin-top: 7px;
    margin-left: 13px;
    padding-left: 10px;
    border-left: 1px solid #dfe3e8;
}

.json-row {
    min-width: 0;
}

.json-key-line,
.json-primitive {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
}

.json-key {
    color: #8246af;
    overflow-wrap: anywhere;
}

.json-value {
    display: inline-block;
    max-width: 100%;
    color: #39424e;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.value-string {
    color: #137333;
}

.value-number {
    color: #0b57d0;
}

.value-boolean {
    color: #a142f4;
}

.value-null {
    color: #70757a;
    font-style: italic;
}

.use-field-button {
    flex: 0 0 auto;
    padding: 0 3px;
    font-size: 0.72rem;
    text-decoration: none;
}

.truncated-note {
    padding: 6px;
    color: #747d88;
    font-size: 0.78rem;
}

/* stylelint-disable-next-line selector-pseudo-class-no-unknown */
:global(.dark) {
    .json-viewer-root {
        border-color: $dark-border-color;
        background: $dark-bg2;
    }

    details > summary,
    .summary-mark,
    .json-value,
    .truncated-note {
        color: $dark-font-color;
    }

    .json-children {
        border-color: $dark-border-color;
    }

    .json-key {
        color: #d3a4ff;
    }

    .value-string {
        color: #75d993;
    }

    .value-number {
        color: #8ab4f8;
    }
}
</style>
