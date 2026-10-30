<script setup lang="ts">
/**
 * Where Discord's approval screen sends the organizer back (E46/F01/S02).
 *
 * Connect Discord, on the Tools tab's Discord card, opened Discord's screen in a new tab with a
 * state that leads with the market's id; Discord returns it here, in that tab, with a code, and
 * this page posts both to that market, which checks the state against the organizer's session and
 * asks Discord which server the bot was added to. Then it tells the market's own tab, whose card
 * shows the server, and says this tab can be closed. The `guild_id` Discord also adds is never
 * read: anyone can type one, and the server's answer is the authority.
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import AuthCard from '@/components/AuthCard.vue';
import { api, getApiErrorMessage } from '@/utils/api';
import { announceDiscordConnected } from '@/utils/discordConnected';
import { marketPath } from '@/utils/market';

const route = useRoute();

const one = (value: unknown): string => (typeof value === 'string' ? value : '');
const state = one(route.query.state);
/** The market the state names: everything before its first dot. */
const marketId = state.includes('.') ? state.slice(0, state.indexOf('.')) : '';
const back = computed(() => (marketId ? marketPath(marketId, 'tools') : '/markets'));

const error = ref<string | null>(null);
const done = ref(false);

onMounted(async () => {
  const code = one(route.query.code);
  if (!marketId) {
    error.value = 'This page finishes connecting Discord, and was reached without a connection.';
    return;
  }
  if (route.query.error || !code) {
    error.value = 'Discord was not connected: the approval was cancelled.';
    return;
  }
  try {
    await api.post(`/markets/${encodeURIComponent(marketId)}/discord/connection`, { code, state });
    announceDiscordConnected(marketId);
    done.value = true;
  } catch (err) {
    error.value = getApiErrorMessage(err, 'Discord was not connected.');
  }
});
</script>

<template>
  <AuthCard>
    <h1>Connecting Discord</h1>
    <p
      v-if="done"
      class="discord-connected-text"
      role="status"
      data-testid="discord-connected-done"
    >
      Discord is connected. You can close this tab: the market's Tools tab shows the server.
    </p>
    <p v-else-if="!error" class="discord-connected-text" role="status">
      Finishing the connection with Discord…
    </p>
    <template v-else>
      <p class="discord-connected-text" role="alert" data-testid="discord-connected-error">
        {{ error }}
      </p>
      <p v-if="marketId" class="discord-connected-text">You can close this tab.</p>
    </template>
    <RouterLink
      v-if="done || error"
      :to="back"
      class="discord-connected-link"
      data-testid="discord-connected-back"
    >
      {{ marketId ? "Open the market's Tools" : 'Go to your markets' }}
    </RouterLink>
  </AuthCard>
</template>

<style scoped>
.discord-connected-text {
  margin: var(--space-4) 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
  line-height: 1.5;
}

/* A link on its own line: at least a target's height, a thumb's 44px on a phone. */
.discord-connected-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--target-min);
  color: var(--mm-text-link);
  text-decoration: underline;
  font-size: var(--text-sm);
}
</style>
