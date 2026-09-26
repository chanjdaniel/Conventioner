<script setup lang="ts">
import { inject, ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { type Market } from '@/assets/types/datatypes';
import { fetchMarkets, openMarket } from '@/utils/market';
import { forgetLastMarket, lastMarketId } from '@/utils/lastMarket';
import { useMarketStore } from '@/stores/market';
import MarketSummaryCard from '@/components/MarketSummaryCard.vue';

const setUser: (user: unknown) => void = inject('setUser')!;
const hostname = import.meta.env.VITE_FLASK_HOST;
const router = useRouter();

/**
 * Every market this account can reach, or null while that is still unknown.
 *
 * How many markets an account has is a fact about the ACCOUNT, and only the server holds it. This
 * screen used to answer it from `localStorage`, which holds a fact about the BROWSER - the market
 * last opened here - so a fresh sign-in, a second device or cleared site data all produced "You
 * have not set up a market yet" for an organizer who had several, over a button that makes a
 * duplicate rather than opening what they have (E14/F01/S02).
 *
 * Null is a third state on purpose: a request that failed must not be able to say "you have none"
 * either, which is the same falsehood arriving by a different road.
 */
const markets = ref<Market[] | null>(null);

/**
 * Which market this browser last opened: an id, never a copy (E21/F02/S05). What that market is
 * called now, and whether it still exists for this account, is the server's to say.
 */
const rememberedId = ref<string | null>(lastMarketId());
/** Whether this browser ever opened one. */
const everOpenedOne = computed(() => rememberedId.value !== null);

/**
 * The market to offer reopening, as the server reports it.
 *
 * Only ever the server's copy. It used to fall back to a whole market cached in `localStorage`
 * when the list could not be fetched; nothing about a market is kept in the browser now, so with
 * no answer there is simply no card - a convenience lost, never a stale market shown.
 */
const lastMarket = computed(() =>
  markets.value?.find((m) => m.id === rememberedId.value) ?? null,
);
/** Nothing below may be said until the server has answered. */
const countKnown = computed(() => markets.value !== null);
const reachableCount = computed(() => markets.value?.length ?? 0);
/**
 * Their remembered market is gone. Worth saying rather than folding into the other two states: an
 * organizer who had one is not a first-time organizer, and one who has others is not empty-handed.
 */
const lastMarketIsGone = computed(
  () => countKnown.value && everOpenedOne.value && lastMarket.value === null,
);

/**
 * What to say when there is no market card to show, or null when nothing may be said yet.
 *
 * One shape - a sentence and the step that answers it - so the three cases read side by side as
 * the three different truths they are, rather than as three near-identical blocks of markup.
 */
const emptyState = computed(() => {
  if (!countKnown.value || lastMarket.value) return null;
  if (lastMarketIsGone.value) {
    return reachableCount.value > 0
      ? {
          testid: 'dashboard-last-market-unavailable',
          text: 'The market you last opened is no longer available. Your other markets are still here.',
          action: 'Open a market',
          actionTestid: 'dashboard-open-market-button',
        }
      : {
          // They had one and it is gone, so "your first market" would be the falsehood this story
          // exists to remove, worn the other way round.
          testid: 'dashboard-last-market-unavailable',
          text: 'The market you last opened is no longer available, and there are no others.',
          action: 'Set up a market',
          actionTestid: 'dashboard-create-market-button',
        };
  }
  if (reachableCount.value > 0) {
    // "Open to you", not "you have": the endpoint answers what this account can REACH, which
    // includes markets reached through an organization as a viewer rather than owned.
    return {
      testid: 'dashboard-has-markets',
      text:
        reachableCount.value === 1
          ? '1 market is open to you.'
          : `${reachableCount.value} markets are open to you.`,
      action: 'Open a market',
      actionTestid: 'dashboard-open-market-button',
    };
  }
  return {
    // First sign-in. It used to read "Open a market to get started" on a page offering no way to
    // make one, which is an instruction the organizer cannot follow: there is no market to open
    // yet. Say what is true and hand them the step that starts it.
    testid: 'dashboard-no-market-yet',
    text: 'You have not set up a market yet. A market belongs to an organization, and the next screen will make one with you as its owner if you have none.',
    action: 'Set up your first market',
    actionTestid: 'dashboard-create-market-button',
  };
});

onMounted(async () => {
  try {
    markets.value = await fetchMarkets();
  } catch {
    // Leave it unknown rather than guessing at zero; the template makes no claim either way.
    markets.value = null;
    return;
  }
  // Gone, or no longer reachable by this account: said once (below), then forgotten, so the next
  // visit does not keep announcing it.
  if (rememberedId.value && !lastMarket.value) forgetLastMarket();
});

const handleLoadLastMarket = () => {
  if (!lastMarket.value) return;
  openMarket(router, lastMarket.value);
};

const handleMarkets = () => {
  router.push('/markets');
};

const handleOrganizations = () => {
  router.push('/organizations');
};

const handleSignOut = async () => {
  try {
    await fetch(`${hostname}/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch (error) {
    console.error('Logout failed:', error);
  } finally {
    localStorage.clear();
    useMarketStore().clear();
    setUser(null);
    router.push('/login');
  }
};
</script>

<template>
  <div class="dashboard-view">
    <div class="main-buttons">
      <!-- The section keeps its space while the answer is in flight, so nothing below it jumps
           when the request lands. What goes inside it is another matter: no claim about the
           account may be made until the server has answered one. -->
      <div class="last-market-section">
        <template v-if="lastMarket">
          <span class="last-market-label">Previously opened</span>
          <MarketSummaryCard
            class="last-market-row"
            :market="lastMarket"
            data-testid="dashboard-last-market-card"
            @open="handleLoadLastMarket"
          />
        </template>
        <div
          v-else-if="emptyState"
          class="last-market-card last-market-card--welcome"
          :data-testid="emptyState.testid"
        >
          <span class="welcome-text">{{ emptyState.text }}</span>
          <button
            class="welcome-action"
            @click="handleMarkets"
            :data-testid="emptyState.actionTestid"
          >
            {{ emptyState.action }}
          </button>
        </div>
      </div>

      <div class="button-row">
        <button
          class="button button-half"
          @click="handleMarkets"
          data-testid="dashboard-markets-button"
        >
          <h3>Markets</h3>
        </button>
        <button
          class="button button-half"
          @click="handleOrganizations"
          data-testid="dashboard-organizations-button"
        >
          <h3>Organizations</h3>
        </button>
      </div>
    </div>

    <div class="secondary-buttons">
      <button
        class="button button-small"
        @click="handleSignOut"
        data-testid="dashboard-sign-out-button"
      >
        <h4>Sign out</h4>
      </button>
    </div>
  </div>
</template>

<style scoped>
.dashboard-view {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 48px;
  height: 100%;
  width: 100%;
  margin: 0;
}

.main-buttons {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.last-market-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  /* Holds the space the answer will fill. Without it the section is empty until the markets
     request returns and then shoves the whole centred column down as it appears. 119px is the
     height of both states a returning organizer sees - the remembered card and the count - so
     neither settles. The welcome card is taller, but it is only ever the first thing drawn. */
  min-height: 119px;
  width: 716px;
}

.last-market-label {
  width: 716px;
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--mm-text-muted);
}

.button-row {
  display: flex;
  flex-direction: row;
  gap: 24px;
}

.button {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 10px;
  background: var(--mm-black);
  box-shadow: var(--shadow-card);
  border-radius: var(--radius-card);
  border: none;
  cursor: pointer;
  transition: opacity 0.2s ease-in-out;
}

.button:hover {
  opacity: 0.9;
}

.button-full {
  width: 716px;
  height: 95px;
}

.button-half {
  width: 346px;
  height: 95px;
}

.last-market-card {
  width: 716px;
  padding: 16px 24px;
  border: 1.5px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 24px;
  box-shadow: var(--shadow-card);
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.last-market-card:hover {
  border-color: var(--mm-green);
  box-shadow: var(--shadow-card);
  transform: translateY(-2px);
}

/* The dashboard shows one row at the width of the two buttons beside it, not the full page. */
.last-market-row {
  width: 716px;
}

.last-market-card--welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  text-align: center;
  padding: 22px 24px;
}

.welcome-text {
  color: rgba(39, 35, 35, 0.7);
  max-width: 52ch;
  line-height: 1.5;
}

.welcome-action {
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: var(--radius-control);
  padding: 10px 20px;
  cursor: pointer;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
}

.welcome-action:hover {
  opacity: 0.9;
}

/* Signing out is not a destination the organizer came here for. It was a black slab the size of
   Markets and Organizations, which put "leave" beside the only two places to go. */
.button-small {
  width: auto;
  height: auto;
  padding: 6px 12px;
  background: none;
  box-shadow: none;
  border-radius: var(--radius-control);
}

.button-small:hover {
  background: rgba(39, 35, 35, 0.06);
  opacity: 1;
}

.button-small h4 {
  color: var(--mm-text-muted);
  text-decoration: underline;
}

h3 {
  font-family: 'Merge One';
  font-style: normal;
  font-weight: 400;
  font-size: var(--text-lg);
  color: white;
  margin: 0;
}

h4 {
  font-style: normal;
  font-weight: 400;
  font-size: var(--text-md);
  color: white;
  margin: 0;
}

.secondary-buttons {
  display: flex;
  flex-direction: row;
  gap: 24px;
  align-items: center;
  justify-content: center;
  width: 716px;
}
</style>
