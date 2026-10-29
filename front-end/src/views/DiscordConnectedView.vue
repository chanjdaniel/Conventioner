<script setup lang="ts">
/**
 * Where Discord's approval screen sends the organizer back (E46/F01/S02).
 *
 * Connect Discord, on Market Setup's Discord card, began with a state that leads with the market's
 * id; Discord returns it here with a code, and this page posts both to that market, which checks
 * the state against the organizer's session and asks Discord which server the bot was added to.
 * Then it goes on to the market's Market Setup, where the card shows the server. The `guild_id`
 * Discord also adds is never read: anyone can type one, and the server's answer is the authority.
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthCard from '@/components/AuthCard.vue';
import { api, getApiErrorMessage } from '@/utils/api';
import { marketPath } from '@/utils/market';

const route = useRoute();
const router = useRouter();

const one = (value: unknown): string => (typeof value === 'string' ? value : '');
const state = one(route.query.state);
/** The market the state names: everything before its first dot. */
const marketId = state.includes('.') ? state.slice(0, state.indexOf('.')) : '';
const back = computed(() => (marketId ? marketPath(marketId, 'setup') : '/markets'));

const error = ref<string | null>(null);

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
    await router.replace(back.value);
  } catch (err) {
    error.value = getApiErrorMessage(err, 'Discord was not connected.');
  }
});
</script>

<template>
  <AuthCard>
    <h1>Connecting Discord</h1>
    <p v-if="!error" class="discord-connected-text" role="status">
      Finishing the connection with Discord…
    </p>
    <template v-else>
      <p class="discord-connected-text" role="alert" data-testid="discord-connected-error">
        {{ error }}
      </p>
      <RouterLink :to="back" class="discord-connected-link" data-testid="discord-connected-back">
        {{ marketId ? 'Back to Market Setup' : 'Go to your markets' }}
      </RouterLink>
    </template>
  </AuthCard>
</template>

<style scoped>
.discord-connected-text {
  margin: var(--space-4) 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
  line-height: 1.5;
}

.discord-connected-link {
  color: var(--mm-text-link);
  text-decoration: underline;
  font-size: var(--text-sm);
}
</style>
