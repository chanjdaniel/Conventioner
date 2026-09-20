<script setup lang="ts">
import { inject, ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { type Market } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { openMarket, parseMarketFromApi } from '@/utils/market';
import MarketSummaryCard from '@/components/MarketSummaryCard.vue';

const setUser: (user: unknown) => void = inject('setUser')!;
const hostname = import.meta.env.VITE_FLASK_HOST;
const router = useRouter();

/**
 * The account's markets, or null while that is still unknown.
 *
 * Whether the account has any market is a fact about the ACCOUNT, and only the server holds it.
 * This screen used to answer it from `localStorage`, which holds a fact about the BROWSER - the
 * market last opened here - so a fresh sign-in, a second device or cleared site data all produced
 * "You have not set up a market yet" for an organizer who owned several, over a button that makes
 * a duplicate rather than opening what they have (E14/F01/S02).
 *
 * Null is a third state on purpose, and the template renders no claim while it holds: a failed
 * request must not be able to say "you have none" either, which is the same falsehood arriving by
 * a different road.
 */
const markets = ref<Market[] | null>(null);

/**
 * What this browser remembers, which is still the only place the LAST market opened is recorded.
 * The id alone: the market itself is taken from the server's answer below, so the card cannot show
 * a stale name for a market that has since been renamed.
 */
const rememberedMarketId = ref<string | null>(null);
/** Whether this browser ever opened one - true even if what it stored can no longer be read. */
const everOpenedOne = ref(false);

/** The remembered market as the server has it now, or null if it is gone or was never there. */
const lastMarket = computed(
  () => markets.value?.find((m) => m.id === rememberedMarketId.value) ?? null,
);
const hasAnyMarket = computed(() => (markets.value?.length ?? 0) > 0);
/**
 * Distinct from having none, and still worth saying: an organizer whose remembered market has been
 * deleted is not a first-time organizer, and telling them to set up their first market would be
 * the same kind of falsehood this story exists to remove.
 */
const lastMarketIsGone = computed(() => everOpenedOne.value && lastMarket.value === null);

function readRememberedMarket() {
  const stored = localStorage.getItem('market');
  if (!stored) return;
  everOpenedOne.value = true;
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (parsed && typeof parsed === 'object') {
      const id = (parsed as Record<string, unknown>).id;
      if (typeof id === 'string') rememberedMarketId.value = id;
    }
  } catch {
    // Unreadable: this browser opened something, but cannot say what. `lastMarketIsGone` covers it.
  }
}

onMounted(async () => {
  readRememberedMarket();
  try {
    const response = await api.get('/markets');
    markets.value = (response.data.markets || []).map(parseMarketFromApi);
  } catch {
    // Leave it unknown rather than guessing at zero; the template says nothing either way.
    markets.value = null;
  }
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
    setUser(null);
    router.push('/login');
  }
};
</script>

<template>
  <div class="dashboard-view">
    <div class="main-buttons">
      <!-- Nothing is claimed until the server has answered: every branch below is a statement
           about the account, and this screen cannot make one from what the browser remembers. -->
      <div class="last-market-section" v-if="markets !== null">
        <span v-if="lastMarket" class="last-market-label">Previously opened</span>
        <MarketSummaryCard
          v-if="lastMarket"
          class="last-market-row"
          :market="lastMarket"
          data-testid="dashboard-last-market-card"
          @open="handleLoadLastMarket"
        />
        <div
          v-else-if="lastMarketIsGone && hasAnyMarket"
          class="last-market-card last-market-card--welcome"
          data-testid="dashboard-last-market-unavailable"
        >
          <span class="welcome-text">
            The market you last opened is no longer available. Your other markets are still here.
          </span>
          <button
            class="welcome-action"
            @click="handleMarkets"
            data-testid="dashboard-open-market-button"
          >
            Open a market
          </button>
        </div>
        <!-- They own markets; this browser just has not opened one. The old screen said they had
             none, which was false, and offered to make another. -->
        <div
          v-else-if="hasAnyMarket"
          class="last-market-card last-market-card--welcome"
          data-testid="dashboard-has-markets"
        >
          <span class="welcome-text">
            {{
              markets.length === 1 ? 'You have one market.' : `You have ${markets.length} markets.`
            }}
            This browser has not opened one yet.
          </span>
          <button
            class="welcome-action"
            @click="handleMarkets"
            data-testid="dashboard-open-market-button"
          >
            Open a market
          </button>
        </div>
        <!-- First sign-in. It used to read "Open a market to get started" on a page offering no
             way to make one, which is an instruction the organizer cannot follow: there is no
             market to open yet. Say what is true and hand them the step that starts it. -->
        <div
          v-else
          class="last-market-card last-market-card--welcome"
          data-testid="dashboard-no-market-yet"
        >
          <span class="welcome-text">
            You have not set up a market yet. A market belongs to an organization, and the next
            screen will make one with you as its owner if you have none.
          </span>
          <button
            class="welcome-action"
            @click="handleMarkets"
            data-testid="dashboard-create-market-button"
          >
            Set up your first market
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
  gap: 8px;
}

.last-market-label {
  width: 716px;
  font-size: 14px;
  font-weight: 500;
  color: #666;
  font-family: 'Outfit Regular', sans-serif;
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
  box-shadow: 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
  border-radius: 10px;
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
  border-radius: 10px;
  background: white;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 24px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.last-market-card:hover {
  border-color: var(--mm-green);
  box-shadow: 0 4px 12px rgba(73, 176, 150, 0.15);
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
  border-radius: 5px;
  padding: 10px 20px;
  cursor: pointer;
  font-family: 'Merge One', sans-serif;
  font-size: 15px;
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
  border-radius: 5px;
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
  font-weight: 100;
  font-size: 20px;
  color: #ffffff;
  margin: 0;
}

h4 {
  font-family: 'Outfit Regular';
  font-style: normal;
  font-weight: 400;
  font-size: 16px;
  color: #ffffff;
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
