<template>
    <teleport to="body">
        <div
            v-if="visible && content"
            ref="tooltip"
            class="tooltip-wrapper"
            :style="tooltipStyle"
            :class="{ 'tooltip-above': actualPosition === 'above' }"
            @mouseenter="$emit('mouseenter')"
            @mouseleave="$emit('mouseleave')"
        >
            <div class="tooltip-content">
                <slot :content="content">
                    <!-- Default content if no slot provided -->
                    <div class="tooltip-status" :class="statusClass">
                        {{ statusText }}
                    </div>
                    <div class="tooltip-time">{{ timeText }}</div>
                    <div v-if="content?.msg" class="tooltip-message">{{ content.msg }}</div>
                    <div v-if="showResponsePreview" class="tooltip-response">
                        <button
                            v-if="
                                content.responsePreviewAvailable &&
                                !content.responsePreviewLoading &&
                                !hasResponsePreview
                            "
                            type="button"
                            class="tooltip-response-load"
                            @click.stop="$emit('load-response')"
                        >
                            <font-awesome-icon icon="eye" />
                            <span>{{ $t("viewResponse") }}</span>
                        </button>
                        <div v-else-if="content.responsePreviewLoading" class="tooltip-response-loading">
                            <font-awesome-icon icon="spinner" spin />
                            {{ $t("Loading...") }}
                        </div>
                        <div v-else-if="hasResponsePreview" class="tooltip-response-content">
                            <div class="tooltip-response-title">{{ $t("Response") }}</div>
                            <div class="tooltip-response-body">{{ content.responsePreview }}</div>
                            <div v-if="content.responsePreviewTruncated" class="tooltip-response-truncated">
                                {{ $t("responsePreviewTruncated") }}
                            </div>
                        </div>
                    </div>
                </slot>
            </div>
            <div class="tooltip-arrow" :class="{ 'arrow-above': actualPosition === 'above' }"></div>
        </div>
    </teleport>
</template>

<script>
import { DOWN, UP, PENDING, MAINTENANCE } from "../util.ts";
import { isResponseValidationFailure } from "../util-frontend.js";

export default {
    name: "Tooltip",
    props: {
        /** Whether tooltip is visible */
        visible: {
            type: Boolean,
            default: false,
        },
        /** Content object to display */
        content: {
            type: Object,
            default: null,
        },
        /** X position (viewport coordinates) */
        x: {
            type: Number,
            default: 0,
        },
        /** Top of the heartbeat bar (viewport coordinates) */
        targetTop: {
            type: Number,
            default: 0,
        },
        /** Bottom of the heartbeat bar (viewport coordinates) */
        targetBottom: {
            type: Number,
            default: 0,
        },
        /** Position relative to target element */
        position: {
            type: String,
            default: "below",
            validator: (value) => ["above", "below"].includes(value),
        },
    },
    emits: ["mouseenter", "mouseleave", "load-response"],
    data() {
        return {
            calculatedX: 0,
            calculatedTop: 0,
            actualPosition: this.position,
            positioned: false,
        };
    },
    computed: {
        tooltipStyle() {
            return {
                left: (this.positioned ? this.calculatedX : this.x) + "px",
                top: (this.positioned ? this.calculatedTop : this.targetBottom + 8) + "px",
                visibility: this.positioned ? "visible" : "hidden",
            };
        },

        showResponsePreview() {
            return (
                Boolean(this.content?.responsePreviewAvailable) ||
                Boolean(this.content?.responsePreviewLoading) ||
                this.hasResponsePreview
            );
        },

        hasResponsePreview() {
            return Object.prototype.hasOwnProperty.call(this.content ?? {}, "responsePreview");
        },

        statusText() {
            if (!this.content || this.content === 0) {
                return this.$t("Unknown");
            }

            switch (Number(this.content.status)) {
                case DOWN:
                    return this.$t("Down");
                case UP:
                    return this.$t("Up");
                case PENDING:
                    return this.$t("Pending");
                case MAINTENANCE:
                    return this.$t("Maintenance");
                default:
                    return this.$t("Unknown");
            }
        },

        statusClass() {
            if (!this.content || this.content === 0) {
                return "status-empty";
            }

            if (isResponseValidationFailure(this.content)) {
                return "status-response-validation";
            }

            switch (Number(this.content.status)) {
                case DOWN:
                    return "status-down";
                case UP:
                    return "status-up";
                case PENDING:
                    return "status-pending";
                case MAINTENANCE:
                    return "status-maintenance";
                default:
                    return "status-unknown";
            }
        },

        timeText() {
            if (!this.content || this.content === 0) {
                return "";
            }
            return this.$root.datetime(this.content.time);
        },
    },
    watch: {
        visible(value) {
            this.positioned = false;
            if (value) {
                this.queuePositionUpdate();
            }
        },
        content: {
            handler() {
                this.queuePositionUpdate();
            },
            deep: true,
        },
        x() {
            this.queuePositionUpdate();
        },
        targetTop() {
            this.queuePositionUpdate();
        },
        targetBottom() {
            this.queuePositionUpdate();
        },
    },
    mounted() {
        window.addEventListener("resize", this.queuePositionUpdate);
        this.queuePositionUpdate();
    },
    beforeUnmount() {
        window.removeEventListener("resize", this.queuePositionUpdate);
    },
    methods: {
        /**
         * Reposition after Vue has rendered any content-size changes.
         * @returns {void}
         */
        queuePositionUpdate() {
            if (this.visible) {
                this.$nextTick(() => this.updatePosition());
            }
        },

        /**
         * Fit the measured tooltip into the current viewport.
         * @returns {void}
         */
        updatePosition() {
            const tooltip = this.$refs.tooltip;
            if (!tooltip || !this.visible) {
                return;
            }

            const margin = 10;
            const targetGap = 8;
            const tooltipWidth = tooltip.offsetWidth;
            const tooltipHeight = tooltip.offsetHeight;
            const spaceAbove = this.targetTop - targetGap - margin;
            const spaceBelow = window.innerHeight - this.targetBottom - targetGap - margin;

            let nextPosition = this.position;
            if (nextPosition === "above" && tooltipHeight > spaceAbove && spaceBelow > spaceAbove) {
                nextPosition = "below";
            } else if (nextPosition === "below" && tooltipHeight > spaceBelow && spaceAbove > spaceBelow) {
                nextPosition = "above";
            }

            const desiredTop =
                nextPosition === "above" ? this.targetTop - targetGap - tooltipHeight : this.targetBottom + targetGap;
            const maximumTop = Math.max(margin, window.innerHeight - tooltipHeight - margin);

            this.actualPosition = nextPosition;
            this.calculatedTop = Math.min(Math.max(desiredTop, margin), maximumTop);

            if (tooltipWidth >= window.innerWidth - margin * 2) {
                this.calculatedX = window.innerWidth / 2;
            } else {
                const minimumX = margin + tooltipWidth / 2;
                const maximumX = window.innerWidth - margin - tooltipWidth / 2;
                this.calculatedX = Math.min(Math.max(this.x, minimumX), maximumX);
            }

            this.positioned = true;
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.tooltip-wrapper {
    position: fixed;
    z-index: 9999;
    width: max-content;
    max-width: calc(100vw - 20px);
    pointer-events: auto;
    transform: translateX(-50%);

    .tooltip-content {
        background: rgba(17, 24, 39, 0.95);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(75, 85, 99, 0.3);
        border-radius: 8px;
        padding: 8px 12px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
        min-width: 120px;
        max-width: calc(100vw - 20px);
        max-height: calc(100vh - 20px);
        overflow: hidden;
        text-align: center;
        position: relative;

        &::before {
            content: "";
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            width: 14px;
            height: 2px;
            background: rgba(17, 24, 39, 0.95);
            top: -1px;
        }

        .tooltip-status {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;

            &.status-up {
                color: $primary;
            }

            &.status-down {
                color: $danger;
            }

            &.status-response-validation {
                color: $response-validation;
            }

            &.status-pending {
                color: $warning;
            }

            &.status-maintenance {
                color: $maintenance;
            }

            &.status-empty {
                color: $secondary-text;
            }
        }

        .tooltip-time {
            color: #d1d5db;
            font-size: 13px;
            margin-bottom: 2px;
        }

        .tooltip-message {
            color: #f3f4f6;
            font-size: 12px;
            margin-top: 4px;
            padding-top: 4px;
            border-top: 1px solid rgba(75, 85, 99, 0.3);
            max-height: min(100px, 20vh);
            overflow: auto;
            overflow-wrap: anywhere;
            white-space: pre-wrap;
        }

        .tooltip-response {
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px solid rgba(75, 85, 99, 0.3);
            color: #f3f4f6;
            font-size: 12px;
            text-align: center;

            .tooltip-response-title {
                margin-bottom: 4px;
                font-weight: 600;
            }

            .tooltip-response-loading,
            .tooltip-response-truncated {
                color: #d1d5db;
                font-size: 11px;
            }

            .tooltip-response-loading {
                display: inline-flex;
                min-height: 30px;
                align-items: center;
                gap: 6px;
            }

            .tooltip-response-load {
                display: inline-flex;
                min-height: 30px;
                align-items: center;
                gap: 6px;
                border: 0;
                border-radius: 6px;
                padding: 4px 10px;
                background: transparent;
                color: #d1d5db;
                cursor: pointer;
                font-size: 12px;
                line-height: 1;
                transition:
                    color 0.15s ease,
                    background-color 0.15s ease;

                &:hover {
                    background: rgba(255, 255, 255, 0.07);
                    color: #fff;
                }

                &:focus-visible {
                    outline: 2px solid $primary;
                    outline-offset: 1px;
                }
            }

            .tooltip-response-content {
                width: min(400px, calc(100vw - 44px));
                text-align: left;
            }

            .tooltip-response-body {
                max-height: min(240px, 40vh);
                overflow: auto;
                overflow-wrap: anywhere;
                overscroll-behavior: contain;
                white-space: pre-wrap;
                word-break: break-word;
            }

            .tooltip-response-truncated {
                margin-top: 4px;
                font-style: italic;
            }
        }
    }

    .tooltip-arrow {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        width: 12px;
        height: 6px;
        overflow: hidden;
        top: -6px;

        &::before {
            content: "";
            position: absolute;
            left: 50%;
            top: 100%;
            transform: translateX(-50%) translateY(-50%) rotate(45deg);
            width: 8px;
            height: 8px;
            background: rgba(17, 24, 39, 0.95);
            border: 1px solid rgba(75, 85, 99, 0.3);
            border-bottom: none;
            border-right: none;
        }

        &.arrow-above {
            top: auto;
            bottom: -6px;

            &::before {
                top: 0%;
                transform: translateX(-50%) translateY(-50%) rotate(225deg);
                border: 1px solid rgba(75, 85, 99, 0.3);
                border-bottom: none;
                border-right: none;
            }
        }
    }

    // Smooth entrance animation
    animation: tooltip-fade-in 0.2s $easing-out;

    &.tooltip-above {
        .tooltip-content::before {
            top: auto;
            bottom: -1px;
        }
    }
}

// Dark theme adjustments
.dark .tooltip-wrapper {
    .tooltip-content {
        background: rgba(31, 41, 55, 0.95);
        border-color: rgba(107, 114, 128, 0.3);

        &::before {
            background: rgba(31, 41, 55, 0.95);
        }
    }

    .tooltip-arrow {
        &::before {
            background: rgba(31, 41, 55, 0.95);
            border-color: rgba(107, 114, 128, 0.3);
        }
    }
}

@keyframes tooltip-fade-in {
    from {
        opacity: 0;
        transform: translateX(-50%) translateY(4px);
    }

    to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
    }
}

// Accessibility improvements

@media (prefers-reduced-motion: reduce) {
    .tooltip-wrapper {
        animation: none !important;
    }
}
</style>
