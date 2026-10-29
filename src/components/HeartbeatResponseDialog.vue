<template>
    <Teleport to="body">
        <dialog
            ref="dialog"
            class="response-dialog"
            aria-labelledby="response-dialog-title"
            @cancel.prevent="close"
            @click.self="close"
        >
            <section class="response-sheet">
                <header class="response-header">
                    <div class="response-heading">
                        <span class="response-heading-icon"><font-awesome-icon icon="code" /></span>
                        <div class="response-heading-text">
                            <h2 id="response-dialog-title">{{ $t("responseBody") }}</h2>
                            <div class="response-context">
                                <span class="response-monitor" :title="monitorName">{{ monitorName }}</span>
                                <span v-if="heartbeat?.time" class="response-time">
                                    {{ $root.datetime(heartbeat.time) }}
                                </span>
                            </div>
                        </div>
                    </div>
                    <button type="button" class="response-close" :aria-label="$t('Close')" autofocus @click="close">
                        <font-awesome-icon icon="times" />
                    </button>
                </header>

                <div v-if="heartbeat" class="response-event">
                    <Status
                        :status="heartbeat.status"
                        :response-validation-failed="heartbeat.responseValidationFailed"
                    />
                    <span class="response-event-message" :title="heartbeat.msg">{{ heartbeat.msg }}</span>
                </div>

                <div class="response-toolbar">
                    <div class="response-view-controls">
                        <div
                            v-if="model?.isJSON"
                            class="response-view-switch"
                            :aria-label="$t('responseView')"
                            role="group"
                        >
                            <button
                                type="button"
                                :class="{ active: mode === 'formatted' }"
                                :aria-pressed="mode === 'formatted'"
                                @click="setMode('formatted')"
                            >
                                {{ $t("responseFormatted") }}
                            </button>
                            <button
                                type="button"
                                :class="{ active: mode === 'raw' }"
                                :aria-pressed="mode === 'raw'"
                                @click="setMode('raw')"
                            >
                                {{ $t("responseRaw") }}
                            </button>
                        </div>
                        <span v-if="hasResponse" class="response-format">
                            {{ model?.isJSON ? "JSON" : $t("responseText") }}
                        </span>
                        <span v-if="hasResponse" class="response-size">{{ responseSize }}</span>
                    </div>
                    <div class="response-actions">
                        <template v-if="model?.isJSON && mode === 'formatted'">
                            <button
                                type="button"
                                class="response-tool"
                                :title="$t('responseExpandAll')"
                                :aria-label="$t('responseExpandAll')"
                                @click="expandAll"
                            >
                                <font-awesome-icon icon="expand-arrows-alt" />
                                <span class="tool-label">{{ $t("responseExpandAll") }}</span>
                            </button>
                            <button
                                type="button"
                                class="response-tool"
                                :title="$t('responseCollapseAll')"
                                :aria-label="$t('responseCollapseAll')"
                                @click="collapseAll"
                            >
                                <font-awesome-icon icon="compress-arrows-alt" />
                                <span class="tool-label">{{ $t("responseCollapseAll") }}</span>
                            </button>
                            <span class="response-tool-divider"></span>
                        </template>
                        <button
                            type="button"
                            class="response-tool response-copy"
                            :disabled="!hasResponse"
                            :title="$t('responseCopyFull')"
                            @click="copyResponse"
                        >
                            <font-awesome-icon :icon="copyState === 'copied' ? 'check' : 'copy'" />
                            <span aria-live="polite">
                                {{ $t(copyState === "copied" ? "responseCopied" : "responseCopy") }}
                            </span>
                        </button>
                    </div>
                </div>

                <div ref="viewport" class="response-viewport" :aria-busy="loading" @scroll="onScroll">
                    <div v-if="loading" class="response-state" role="status">
                        <font-awesome-icon icon="spinner" spin class="response-state-icon" />
                        <strong>{{ $t("responseLoading") }}</strong>
                        <span>{{ $t("responseLoadingHint") }}</span>
                    </div>
                    <div v-else-if="error" class="response-state" role="alert">
                        <font-awesome-icon icon="exclamation-circle" class="response-state-icon response-state-error" />
                        <strong>{{ $t("responseLoadFailed") }}</strong>
                        <button type="button" class="response-retry" @click="loadResponse">
                            {{ $t("retryResponse") }}
                        </button>
                    </div>
                    <div v-else-if="response === null || response === ''" class="response-state" role="status">
                        <font-awesome-icon icon="file" class="response-state-icon" />
                        <strong>{{ $t(response === null ? "responseUnavailable" : "responseEmpty") }}</strong>
                    </div>
                    <div
                        v-else-if="model.isJSON && mode === 'formatted'"
                        class="response-json"
                        :style="{ height: `${visibleLines.length * rowHeight}px` }"
                    >
                        <div
                            class="response-json-window"
                            :style="{ transform: `translateY(${windowStart * rowHeight}px)` }"
                        >
                            <div v-for="line in windowLines" :key="line.id" class="response-json-line">
                                <span class="response-line-number" aria-hidden="true">{{ line.id + 1 }}</span>
                                <span class="response-fold-slot">
                                    <button
                                        v-if="line.endLine !== undefined"
                                        type="button"
                                        class="response-fold"
                                        :class="{ collapsed: collapsed.has(line.id) }"
                                        :aria-expanded="!collapsed.has(line.id)"
                                        :aria-label="
                                            $t(collapsed.has(line.id) ? 'responseExpandLine' : 'responseCollapseLine', {
                                                line: line.id + 1,
                                            })
                                        "
                                        @click="toggleLine(line)"
                                    >
                                        <font-awesome-icon icon="chevron-down" />
                                    </button>
                                </span>
                                <code
                                    class="response-line-code"
                                    :style="{ paddingInlineStart: `${line.depth * 18}px` }"
                                >
                                    <span
                                        v-for="(part, index) in line.parts"
                                        :key="index"
                                        :class="`response-token-${part.type}`"
                                    >
                                        {{ part.text }}
                                    </span>
                                    <template v-if="collapsed.has(line.id)">
                                        <button
                                            class="response-fold-summary"
                                            type="button"
                                            :aria-label="$t('responseExpandLine', { line: line.id + 1 })"
                                            @click="toggleLine(line)"
                                        >
                                            {{ $t("responseItems", { count: line.itemCount }) }}
                                        </button>
                                        <span class="response-token-punctuation">{{ closingText(line) }}</span>
                                    </template>
                                </code>
                            </div>
                        </div>
                    </div>
                    <pre v-else class="response-raw" tabindex="0">{{ response }}</pre>
                </div>

                <footer class="response-footer">
                    <span v-if="copyState === 'error'" class="response-copy-error" role="alert">
                        {{ $t("responseCopyFailed") }}
                    </span>
                    <span v-else-if="hasResponse" class="response-loaded">
                        <span class="response-loaded-dot"></span>
                        {{ $t("responseLoaded") }}
                        <span v-if="model?.isJSON" class="response-line-count">
                            {{ $t("responseLines", { count: model.lines.length }) }}
                        </span>
                    </span>
                    <span v-else></span>
                    <span class="response-keyboard-hint">
                        <kbd>Esc</kbd>
                        {{ $t("Close") }}
                    </span>
                </footer>
            </section>
        </dialog>
    </Teleport>
</template>

<script>
import { markRaw } from "vue";
import Status from "./Status.vue";
import { prepareResponseBody } from "../response-body.mjs";

export default {
    components: { Status },
    data() {
        return {
            heartbeat: null,
            monitorName: "",
            response: null,
            model: null,
            loading: false,
            error: false,
            mode: "formatted",
            collapsed: new Set(),
            requestToken: 0,
            copyState: "idle",
            copyTimer: null,
            previousOverflow: null,
            scrollTop: 0,
            viewportHeight: 600,
            rowHeight: 24,
            resizeObserver: null,
        };
    },
    computed: {
        hasResponse() {
            return !this.loading && !this.error && this.response !== null;
        },
        responseSize() {
            const bytes = new TextEncoder().encode(this.response ?? "").length;
            if (bytes >= 1024 * 1024) {
                return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
            }
            return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
        },
        visibleLines() {
            const lines = this.model?.lines ?? [];
            const result = [];
            for (let index = 0; index < lines.length; index++) {
                const line = lines[index];
                result.push(line);
                if (this.collapsed.has(line.id)) {
                    index = line.endLine;
                }
            }
            return result;
        },
        windowStart() {
            return Math.max(0, Math.floor(this.scrollTop / this.rowHeight) - 15);
        },
        windowLines() {
            return this.visibleLines.slice(
                this.windowStart,
                this.windowStart + Math.ceil(this.viewportHeight / this.rowHeight) + 30
            );
        },
    },
    watch: {
        "$route.fullPath"() {
            this.close();
        },
    },
    mounted() {
        this.$root.emitter.on("viewHeartbeatResponse", this.show);
        this.resizeObserver = new ResizeObserver(([entry]) => {
            this.viewportHeight = entry.contentRect.height;
        });
        this.resizeObserver.observe(this.$refs.viewport);
    },
    beforeUnmount() {
        this.$root.emitter.off("viewHeartbeatResponse", this.show);
        this.resizeObserver?.disconnect();
        this.close();
    },
    methods: {
        /**
         * Open one shared response viewer from any authenticated heartbeat entry.
         * @param {object} heartbeat Selected heartbeat.
         * @returns {void}
         */
        show(heartbeat) {
            if (!this.$root.loggedIn || !heartbeat?.id || !heartbeat.hasResponse) {
                return;
            }
            this.heartbeat = { ...heartbeat };
            this.monitorName = this.$root.monitorList[heartbeat.monitorID]?.name ?? "";
            this.mode = "formatted";
            this.copyState = "idle";
            clearTimeout(this.copyTimer);
            if (!this.$refs.dialog.open) {
                this.previousOverflow = document.body.style.overflow;
                document.body.style.overflow = "hidden";
                this.$refs.dialog.showModal();
            }
            this.loadResponse();
        },
        /**
         * Close the viewer and discard any pending response or copy result.
         * @returns {void}
         */
        close() {
            this.requestToken++;
            clearTimeout(this.copyTimer);
            this.$refs.dialog?.close();
            if (this.previousOverflow !== null) {
                document.body.style.overflow = this.previousOverflow;
                this.previousOverflow = null;
            }
            this.response = null;
            this.model = null;
            this.loading = false;
        },
        /**
         * Load the complete saved body only when the user opens the viewer.
         * @returns {void}
         */
        loadResponse() {
            const requestToken = ++this.requestToken;
            this.loading = true;
            this.error = false;
            this.response = null;
            this.model = null;
            this.resetScroll();
            this.$root
                .getSocket()
                .timeout(15000)
                .emit("getHeartbeatResponse", this.heartbeat.id, (error, result) => {
                    if (requestToken !== this.requestToken || !this.$refs.dialog?.open) {
                        return;
                    }
                    this.loading = false;
                    if (error || !result?.ok) {
                        this.error = true;
                        return;
                    }
                    this.response = result.data?.response ?? null;
                    if (this.response !== null) {
                        this.model = markRaw(prepareResponseBody(this.response));
                        this.collapsed = new Set(
                            this.model.lines
                                .filter(
                                    (line) =>
                                        line.endLine !== undefined &&
                                        (line.depth >= 2 || (line.depth > 0 && line.itemCount > 12))
                                )
                                .map((line) => line.id)
                        );
                    }
                });
        },
        /**
         * Change between formatted JSON and the original saved text.
         * @param {string} mode Selected view.
         * @returns {void}
         */
        setMode(mode) {
            this.mode = mode;
            this.copyState = "idle";
            clearTimeout(this.copyTimer);
            this.resetScroll();
        },
        /**
         * Return the editor to its first line.
         * @returns {void}
         */
        resetScroll() {
            this.scrollTop = 0;
            this.$refs.viewport?.scrollTo(0, 0);
        },
        /**
         * Track the visible window without mounting every JSON line.
         * @param {Event} event Scroll event.
         * @returns {void}
         */
        onScroll(event) {
            this.scrollTop = event.target.scrollTop;
        },
        /**
         * Toggle one JSON container.
         * @param {object} line Container's opening line.
         * @returns {void}
         */
        toggleLine(line) {
            if (this.collapsed.has(line.id)) {
                this.collapsed.delete(line.id);
            } else {
                this.collapsed.add(line.id);
            }
        },
        /**
         * Expand every JSON object and array.
         * @returns {void}
         */
        expandAll() {
            this.collapsed = new Set();
            this.resetScroll();
        },
        /**
         * Collapse every JSON object and array.
         * @returns {void}
         */
        collapseAll() {
            this.collapsed = new Set(
                this.model.lines.filter((line) => line.endLine !== undefined).map((line) => line.id)
            );
            this.resetScroll();
        },
        /**
         * Preserve closing punctuation when a container is collapsed.
         * @param {object} line Container's opening line.
         * @returns {string} Closing bracket and optional comma.
         */
        closingText(line) {
            return this.model.lines[line.endLine].parts.map((part) => part.text).join("");
        },
        /**
         * Copy the complete current representation, including folded content.
         * HTTP deployments use a textarea inside the modal as a clipboard fallback.
         * @returns {Promise<void>} Resolves after the copy attempt.
         */
        async copyResponse() {
            const requestToken = this.requestToken;
            const text = this.mode === "formatted" ? this.model.formatted : this.response;
            let copied = false;
            if (navigator.clipboard && window.isSecureContext) {
                try {
                    await navigator.clipboard.writeText(text);
                    copied = true;
                } catch {
                    // Some browser permission settings require the legacy fallback.
                }
            }
            if (requestToken !== this.requestToken) {
                return;
            }
            if (!copied) {
                const activeElement = document.activeElement;
                const textarea = document.createElement("textarea");
                textarea.value = text;
                textarea.readOnly = true;
                textarea.style.cssText =
                    "position:fixed;opacity:0;pointer-events:none;top:0;left:0;width:1px;height:1px";
                this.$refs.dialog.appendChild(textarea);
                try {
                    textarea.focus();
                    textarea.select();
                    copied = document.execCommand("copy");
                } catch {
                    copied = false;
                } finally {
                    textarea.remove();
                    activeElement?.focus({ preventScroll: true });
                }
            }
            this.copyState = copied ? "copied" : "error";
            clearTimeout(this.copyTimer);
            this.copyTimer = setTimeout(() => {
                this.copyState = "idle";
            }, 2500);
        },
    },
};
</script>

<style lang="scss" scoped>
.response-dialog {
    --response-surface: #fff;
    --response-code-bg: #f8fafc;
    --response-border: #e7ebf0;
    --response-ink: #273444;
    --response-muted: #7b8797;
    --response-hover: #edf1f5;
    --response-accent: #167847;
    --response-accent-bg: #e8f8ef;
    --response-key: #315a95;
    --response-string: #207346;
    --response-number: #8253b0;
    --response-boolean: #b65d20;

    width: min(1100px, calc(100vw - 64px));
    height: min(800px, 86vh);
    height: min(800px, 86dvh);
    max-width: none;
    max-height: none;
    padding: 0;
    border: 1px solid var(--response-border);
    border-radius: 16px;
    margin: auto;
    overflow: hidden;
    color: var(--response-ink);
    background: var(--response-surface);
    box-shadow: 0 24px 90px rgba(10, 20, 35, 0.24);
    text-align: left;

    &::backdrop {
        background: rgba(15, 23, 42, 0.45);
        backdrop-filter: blur(3px);
    }

    button {
        font: inherit;
    }

    button:focus-visible {
        outline: 2px solid #5cdd8b;
        outline-offset: 2px;
    }
}

.response-sheet {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}

.response-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 24px 24px 16px;
}

.response-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
}

.response-heading-icon {
    display: grid;
    flex: 0 0 42px;
    height: 42px;
    place-items: center;
    color: var(--response-accent);
    background: var(--response-accent-bg);
    border-radius: 12px;
    font-size: 18px;
}

.response-heading-text {
    min-width: 0;

    h2 {
        margin: 0 0 5px;
        font-size: 19px;
        font-weight: 650;
        color: var(--response-ink);
    }
}

.response-context {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    color: var(--response-muted);
    font-size: 12px;
}

.response-monitor {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 420px;
}

.response-time {
    font-variant-numeric: tabular-nums;
}

.response-close {
    display: grid;
    flex: 0 0 32px;
    height: 32px;
    place-items: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--response-muted);

    &:hover {
        background: var(--response-hover);
        color: var(--response-ink);
    }
}

.response-event {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 24px 20px;
    font-size: 12px;

    .badge {
        flex-shrink: 0;
        margin: 0;
    }
}

.response-event-message {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--response-muted);
}

.response-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 20px;
    border-top: 1px solid var(--response-border);
    border-bottom: 1px solid var(--response-border);
}

.response-view-controls,
.response-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.response-view-switch {
    display: inline-flex;
    padding: 3px;
    border-radius: 8px;
    background: var(--response-hover);

    button {
        padding: 4px 12px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--response-muted);
        font-size: 12px;
        line-height: 22px;

        &.active {
            color: var(--response-ink);
            background: var(--response-surface);
            box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1);
            font-weight: 600;
        }
    }
}

.response-format {
    padding: 3px 7px;
    border: 1px solid var(--response-border);
    border-radius: 5px;
    font: 11px/1.4 var(--bs-font-monospace);
    color: var(--response-muted);
}

.response-size {
    color: var(--response-muted);
    font-size: 11px;
    white-space: nowrap;
}

.response-tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 32px;
    padding: 6px 9px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--response-muted);
    font-size: 12px !important;
    white-space: nowrap;

    &:hover {
        color: var(--response-ink);
        background: var(--response-hover);
    }

    &:disabled {
        opacity: 0.45;
        cursor: default;
    }
}

.response-copy {
    background: var(--response-accent-bg);
    color: var(--response-accent);
    font-weight: 600 !important;
    min-width: 76px;

    &:hover:not(:disabled) {
        background: #d6f4e2;
        color: #116b3d;
    }
}

.response-tool-divider {
    width: 1px;
    height: 18px;
    background: var(--response-border);
}

.response-viewport {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    background: var(--response-code-bg);
    scrollbar-color: #b7c2cf transparent;
}

.response-json {
    margin: 16px 0;
    min-width: 100%;
}

.response-json-window {
    min-width: 100%;
    width: max-content;
}

.response-json-line {
    display: flex;
    height: 24px;
    padding-right: 24px;
    font: 12.5px/24px var(--bs-font-monospace);

    &:hover {
        background: var(--response-hover);
    }
}

.response-line-number {
    flex: 0 0 48px;
    padding-right: 12px;
    color: #9ba6b5;
    text-align: right;
    user-select: none;
}

.response-fold-slot {
    flex: 0 0 22px;
}

.response-fold {
    display: grid;
    width: 20px;
    height: 24px;
    padding: 0;
    place-items: center;
    border: 0;
    background: transparent;
    color: var(--response-muted);
    font-size: 9px !important;

    &.collapsed svg {
        transform: rotate(-90deg);
    }

    &:hover {
        color: var(--response-accent);
    }
}

.response-line-code {
    font: inherit;
    color: inherit;
    white-space: pre;
}

.response-token-key {
    color: var(--response-key);
}

.response-token-string {
    color: var(--response-string);
}

.response-token-number {
    color: var(--response-number);
}

.response-token-boolean {
    color: var(--response-boolean);
}

.response-token-null,
.response-token-punctuation {
    color: var(--response-muted);
}

.response-fold-summary {
    margin: 0 6px;
    padding: 0 7px;
    border: 1px solid var(--response-border);
    border-radius: 4px;
    background: var(--response-surface);
    color: var(--response-muted);
    font-size: 11px !important;
    line-height: 17px;
    vertical-align: middle;
}

.response-raw {
    padding: 20px 24px;
    margin: 0;
    color: var(--response-ink);
    font: 12.5px/1.8 var(--bs-font-monospace);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.response-state {
    display: flex;
    min-height: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 32px;
    text-align: center;
    color: var(--response-muted);
    font-size: 13px;

    strong {
        color: var(--response-ink);
        font-size: 14px;
        font-weight: 500;
    }
}

.response-state-icon {
    font-size: 26px;
    margin-bottom: 4px;
    color: #a1b4c8;
}

.response-state-error,
.response-copy-error {
    color: #dc3545;
}

.response-retry {
    padding: 7px 18px;
    border: 1px solid var(--response-border);
    border-radius: 8px;
    color: var(--response-ink);
    background: var(--response-surface);
}

.response-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 40px;
    padding: 8px 22px;
    border-top: 1px solid var(--response-border);
    color: var(--response-muted);
    font-size: 11px;
}

.response-loaded {
    display: inline-flex;
    align-items: center;
    gap: 7px;
}

.response-loaded-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #40bb78;
}

.response-line-count {
    border-left: 1px solid var(--response-border);
    padding-left: 8px;
    margin-left: 3px;
}

.response-keyboard-hint kbd {
    padding: 2px 4px;
    margin-right: 4px;
    border: 1px solid var(--response-border);
    border-radius: 3px;
    color: var(--response-muted);
    background: transparent;
    font-size: 10px;
}

.dark .response-dialog {
    --response-surface: #161d28;
    --response-code-bg: #101722;
    --response-border: #2a3444;
    --response-ink: #dbe4ee;
    --response-muted: #91a0b4;
    --response-hover: #222e3f;
    --response-accent: #85dfae;
    --response-accent-bg: #1c3b30;
    --response-key: #91b7ee;
    --response-string: #8dd4a5;
    --response-number: #c5a2ed;
    --response-boolean: #eeb67b;
}

@media (max-width: 650px) {
    .response-dialog {
        width: calc(100vw - 20px);
        height: calc(100vh - 24px);
        height: calc(100dvh - 24px);
        border-radius: 12px;
    }

    .response-header {
        padding: 18px 16px 14px;
    }

    .response-event {
        padding: 0 16px 16px;
    }

    .response-toolbar {
        padding: 8px 12px;
    }

    .response-footer {
        padding: 8px 14px;
    }

    .response-heading-icon {
        display: none;
    }

    .response-monitor {
        max-width: 240px;
    }

    .response-view-controls {
        gap: 5px;
    }

    .response-actions {
        gap: 2px;
        margin-left: auto;
    }

    .response-format {
        display: none;
    }

    .tool-label,
    .response-tool-divider,
    .response-keyboard-hint {
        display: none;
    }

    .response-tool {
        padding: 6px 8px;
    }

    .response-line-number {
        flex-basis: 34px;
        padding-right: 6px;
    }

    .response-raw {
        padding: 16px;
    }
}
</style>
