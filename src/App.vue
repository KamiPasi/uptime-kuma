<template>
    <router-view />
    <HeartbeatResponseDialog v-if="$root.loggedIn" />
</template>

<script>
import { setPageLocale } from "./util-frontend";
import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import HeartbeatResponseDialog from "./components/HeartbeatResponseDialog.vue";
export default {
    components: { HeartbeatResponseDialog },
    created() {
        setPageLocale();
    },
};
polyfillCountryFlagEmojis();
</script>
