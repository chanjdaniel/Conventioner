<script setup lang="ts">
import { inject, ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { type Market } from '@/assets/types/datatypes';
import { openMarket } from '@/utils/market';
import MarketSummaryCard from '@/components/MarketSummaryCard.vue';

const setUser: (user: unknown) => void = inject('setUser')!;
const hostname = import.meta.env.VITE_FLASK_HOST;
const router = useRouter();

const lastMarket = ref<Market | null>(null);
/**
 * Whether a market was ever opened in this browser.
 *
 * Two very different situations used to render the same greyed "Last market not found" card: an
 * organizer who has never opened one, and an organizer whose remembered market can no longer be
 * read. Only the second is a failure, and the first is what EVERY organizer sees on their first
 * sign-in - so the product's opening words were a report that something was missing.
 */
const everOpenedOne = ref(false);

function isValidMarket(obj: unknown): obj is Market {
  if (!obj || typeof obj !== 'object') return false;
  const m = obj as Record<string, unknown>;
  return typeof m.id === 'string' && typeof m.name === 'string';
}

onMounted(() => {
  try {
    const stored = localStorage.getItem('market');
    if (!stored) return;
    everOpenedOne.value = true;
    const parsed = JSON.parse(stored) as unknown;
    if (isValidMarket(parsed)) {
      lastMarket.value = parsed;
    }
  } catch {
    lastMarket.value = null;
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
      <div class="last-market-section">
        <span v-if="lastMarket || everOpenedOne" class="last-market-label">Previously opened</span>
        <MarketSummaryCard
          v-if="lastMarket"
          class="last-market-row"
          :market="lastMarket"
          data-testid="dashboard-last-market-card"
          @open="handleLoadLastMarket"
        />
        <div
          v-else-if="everOpenedOne"
          class="last-market-card last-market-card--disabled"
          data-testid="dashboard-last-market-unavailable"
        >
          <span class="disabled-text">The market you last opened is no longer available</span>
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

.last-market-card--disabled {
  cursor: default;
  opacity: 0.6;
  background: #f5f5f5;
  justify-content: center;
  min-height: 95px;
}

.last-market-card--disabled:hover {
  border-color: var(--mm-border);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  transform: none;
}

.disabled-text {
  color: var(--mm-text-muted);
  font-size: 16px;
  font-family: 'Outfit Regular', sans-serif;
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
