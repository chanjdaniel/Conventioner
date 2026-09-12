<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Market, PreconditionResult } from '@/assets/types/datatypes';
import { MarketPhase } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { parseMarketFromApi } from '@/utils/market';
import BlockerPanel from '@/components/BlockerPanel.vue';

const props = defineProps<{
  market: Market | null;
}>();

const emit = defineEmits<{
  phaseAdvanced: [market: Market];
}>();

const showingArchiveConfirm = ref(false);
const archiveTargetPhase = ref('');
const showingSweepConfirm = ref(false);
const sweepPendingCount = ref(0);
const sweepCountUnknown = ref(false);
const sweepConfirmLoading = ref(false);
const transitionError = ref('');
const transitionBlockers = ref<PreconditionResult[]>([]);
const transitioning = ref(false);

const PHASE_LABELS: Record<string, string> = {
  [MarketPhase.Draft]: 'Draft',
  [MarketPhase.ApplicationsOpen]: 'Applications Open',
  [MarketPhase.ApplicationsClosed]: 'Applications Closed',
  [MarketPhase.Review]: 'Review',
  [MarketPhase.Assignment]: 'Assignment',
  [MarketPhase.Offers]: 'Offers',
  [MarketPhase.MarketDays]: 'Market Days',
  [MarketPhase.Archived]: 'Archived',
};

const TRANSITION_LABELS: Record<string, string> = {
  [MarketPhase.ApplicationsOpen]: 'Open Applications',
  [MarketPhase.ApplicationsClosed]: 'Close Applications',
  [MarketPhase.Review]: 'Begin Review',
  [MarketPhase.Assignment]: 'Begin Assignment',
  [MarketPhase.Offers]: 'Send Offers',
  [MarketPhase.MarketDays]: 'Begin Market Days',
  [MarketPhase.Archived]: 'Archive Market',
};

/** Frontend mirror of guards.py VALID_TRANSITIONS -- single source of truth for UI routing. */
const VALID_TRANSITIONS: Array<[string, string]> = [
  ['draft', 'applications_open'],
  ['draft', 'archived'],
  ['applications_open', 'applications_closed'],
  ['applications_open', 'archived'],
  ['applications_closed', 'applications_open'],
  ['applications_closed', 'review'],
  ['applications_closed', 'archived'],
  ['review', 'applications_closed'],
  ['review', 'assignment'],
  ['review', 'archived'],
  ['assignment', 'offers'],
  ['assignment', 'archived'],
  ['offers', 'market_days'],
  ['offers', 'archived'],
  ['market_days', 'archived'],
];

const currentPhase = computed(() => props.market?.phase ?? MarketPhase.Draft);

const phaseLabel = computed(() => PHASE_LABELS[currentPhase.value] ?? currentPhase.value);

const availableTransitions = computed(() => {
  if (!props.market) return [];
  const fromPhase = currentPhase.value;
  return VALID_TRANSITIONS.filter(([from]) => from === fromPhase).map(([, to]) => to);
});

const isTerminal = computed(() => currentPhase.value === MarketPhase.Archived);

function transitionLabel(toPhase: string): string {
  if (toPhase === MarketPhase.Archived) return 'Archive Market';

  if (toPhase === MarketPhase.ApplicationsOpen) {
    return currentPhase.value === MarketPhase.Draft ? 'Open Applications' : 'Reopen Applications';
  }
  if (toPhase === MarketPhase.ApplicationsClosed) {
    return currentPhase.value === MarketPhase.ApplicationsOpen
      ? 'Close Applications'
      : 'Return to Applications Closed';
  }
  return TRANSITION_LABELS[toPhase] ?? `Move to ${PHASE_LABELS[toPhase] ?? toPhase}`;
}

function transitionVariant(toPhase: string): string {
  if (toPhase === MarketPhase.Archived) return 'danger';

  if (toPhase === MarketPhase.ApplicationsOpen) {
    return currentPhase.value === MarketPhase.Draft ? 'advance' : 'back';
  }
  if (toPhase === MarketPhase.ApplicationsClosed) {
    return currentPhase.value === MarketPhase.ApplicationsOpen ? 'advance' : 'back';
  }
  return 'advance';
}

async function doTransition(toPhase: string) {
  if (!props.market) return;
  transitioning.value = true;
  transitionError.value = '';
  transitionBlockers.value = [];

  try {
    const response = await api.post(`/markets/${encodeURIComponent(props.market.id)}/transition`, {
      toPhase,
    });
    const updatedMarket = {
      ...props.market,
      phase: response.data.phase,
      isDraft: response.data.phase === MarketPhase.Draft,
    };

    try {
      const full = await api.get(`/markets/${encodeURIComponent(props.market.id)}`);
      const fresh = parseMarketFromApi(full.data.market);
      localStorage.setItem('market', JSON.stringify(fresh));
      emit('phaseAdvanced', fresh);
    } catch {
      localStorage.setItem('market', JSON.stringify(updatedMarket));
      emit('phaseAdvanced', updatedMarket);
    }
  } catch (err: unknown) {
    const response =
      err && typeof err === 'object' && 'response' in err
        ? (
            err as {
              response?: {
                status?: number;
                data?: { error?: string; blockers?: PreconditionResult[] };
              };
            }
          ).response
        : undefined;

    if (response?.status === 409 && response.data?.blockers) {
      transitionBlockers.value = response.data.blockers;
    } else {
      const msg = response?.data?.error;
      transitionError.value = msg || 'Failed to advance market phase.';
    }
  } finally {
    transitioning.value = false;
  }
}

function handleTransitionClick(toPhase: string) {
  if (toPhase === MarketPhase.Archived) {
    archiveTargetPhase.value = toPhase;
    showingArchiveConfirm.value = true;
  } else if (toPhase === MarketPhase.MarketDays) {
    openSweepConfirm();
  } else {
    doTransition(toPhase);
  }
}

async function openSweepConfirm() {
  if (!props.market) return;
  sweepConfirmLoading.value = true;
  sweepCountUnknown.value = false;
  showingSweepConfirm.value = true;
  try {
    const res = await api.get(
      `/markets/${encodeURIComponent(props.market.id)}/pending-offers-count`,
    );
    sweepPendingCount.value = res.data.count ?? 0;
  } catch {
    sweepPendingCount.value = 0;
    sweepCountUnknown.value = true;
  } finally {
    sweepConfirmLoading.value = false;
  }
}

function confirmSweep() {
  showingSweepConfirm.value = false;
  doTransition(MarketPhase.MarketDays);
}

function cancelSweep() {
  showingSweepConfirm.value = false;
  sweepPendingCount.value = 0;
  sweepCountUnknown.value = false;
}

function confirmArchive() {
  showingArchiveConfirm.value = false;
  doTransition(archiveTargetPhase.value);
}

function cancelArchive() {
  showingArchiveConfirm.value = false;
  archiveTargetPhase.value = '';
}
</script>

<template>
  <div v-if="market" class="phase-control-panel" data-testid="phase-control-panel">
    <div class="phase-control-row">
      <div class="phase-info">
        <span class="phase-label-text">Current Phase:</span>
        <span
          class="phase-badge"
          :class="`phase-${currentPhase}`"
          data-testid="phase-control-current-phase"
        >
          {{ phaseLabel }}
        </span>
      </div>

      <div v-if="!isTerminal && availableTransitions.length > 0" class="phase-actions">
        <div class="phase-buttons">
          <button
            v-for="toPhase in availableTransitions"
            :key="toPhase"
            class="phase-transition-button"
            :class="`variant-${transitionVariant(toPhase)}`"
            :disabled="transitioning"
            :data-testid="`phase-transition-${toPhase}`"
            @click="handleTransitionClick(toPhase)"
          >
            {{ transitionLabel(toPhase) }}
          </button>
        </div>
      </div>

      <p v-if="isTerminal" class="terminal-note" data-testid="phase-control-terminal">
        This market is archived.
      </p>
    </div>

    <p v-if="transitionError" class="transition-error" data-testid="phase-control-error">
      {{ transitionError }}
    </p>

    <BlockerPanel
      v-if="transitionBlockers.length"
      :blockers="transitionBlockers"
      data-testid="phase-control-blockers"
    />
  </div>

  <!-- Sweep confirmation dialog -->
  <Teleport to="body">
    <div
      v-if="showingSweepConfirm"
      class="archive-confirm-overlay"
      data-testid="sweep-confirm-overlay"
    >
      <div class="archive-confirm-dialog" data-testid="sweep-confirm-dialog">
        <h3>Begin Market Days?</h3>
        <p v-if="sweepConfirmLoading">Checking pending offers...</p>
        <p v-else>
          <template v-if="sweepCountUnknown">
            Could not determine how many offers are still pending. Any pending offers will be marked
            as refused. This cannot be undone.
          </template>
          <template v-else-if="sweepPendingCount === 0">
            No offers are pending — no vendors will be marked refused.
          </template>
          <template v-else>
            {{ sweepPendingCount }} offer{{ sweepPendingCount === 1 ? '' : 's' }}
            will be marked as refused. This cannot be undone.
          </template>
        </p>
        <div class="archive-confirm-buttons">
          <button
            class="confirm-archive-button"
            :disabled="transitioning || sweepConfirmLoading"
            data-testid="sweep-confirm-confirm"
            @click="confirmSweep"
          >
            Begin Market Days
          </button>
          <button
            class="cancel-archive-button"
            :disabled="transitioning"
            data-testid="sweep-confirm-cancel"
            @click="cancelSweep"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>

    <!-- Archive confirmation dialog -->
    <div
      v-if="showingArchiveConfirm"
      class="archive-confirm-overlay"
      data-testid="archive-confirm-overlay"
    >
      <div class="archive-confirm-dialog" data-testid="archive-confirm-dialog">
        <h3>Archive this market?</h3>
        <p>
          Archiving is permanent. Once archived, a market cannot be returned to an active phase.
          This action cannot be undone.
        </p>
        <div class="archive-confirm-buttons">
          <button
            class="confirm-archive-button"
            :disabled="transitioning"
            data-testid="archive-confirm-confirm"
            @click="confirmArchive"
          >
            Archive
          </button>
          <button
            class="cancel-archive-button"
            :disabled="transitioning"
            data-testid="archive-confirm-cancel"
            @click="cancelArchive"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.phase-control-panel {
  width: 100%;
  padding: 10px 40px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.phase-control-row {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
  min-height: 36px;
}

.phase-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.phase-label-text {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
}

.phase-badge {
  padding: 4px 14px;
  border-radius: 20px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: white;
  text-transform: capitalize;
}

.phase-draft {
  background: #6b7280;
}
.phase-applications_open {
  background: #3b82f6;
}
.phase-applications_closed {
  background: #f59e0b;
}
.phase-review {
  background: #8b5cf6;
}
.phase-assignment {
  background: #06b6d4;
}
.phase-offers {
  background: #ec4899;
}
.phase-market_days {
  background: #10b981;
}
.phase-archived {
  background: #374151;
}

.phase-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.phase-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.phase-transition-button {
  padding: 5px 14px;
  border-radius: 6px;
  border: none;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  color: white;
}

.phase-transition-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.variant-advance {
  background: var(--mm-green, #48ab91);
}
.variant-advance:hover:not(:disabled) {
  background: #3a9a82;
}

.variant-back {
  background: #6b7280;
}
.variant-back:hover:not(:disabled) {
  background: #4b5563;
}

.variant-danger {
  background: #dc2626;
}
.variant-danger:hover:not(:disabled) {
  background: #b91c1c;
}

.terminal-note {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.5);
  margin: 0;
}

.transition-error {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: #fca5a5;
  margin: 0;
  padding: 0 2px;
}

/* Archive confirmation overlay */
.archive-confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.archive-confirm-dialog {
  background: white;
  border-radius: 12px;
  padding: 32px;
  max-width: 440px;
  width: 90%;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
}

.archive-confirm-dialog h3 {
  margin: 0 0 12px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 20px;
  font-weight: 600;
  color: var(--mm-black, #1a1a1a);
}

.archive-confirm-dialog p {
  margin: 0 0 24px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: #4b5563;
}

.archive-confirm-buttons {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.confirm-archive-button {
  padding: 8px 20px;
  font-size: 14px;
  background: #dc2626;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Outfit Regular', sans-serif;
  font-weight: 500;
}

.confirm-archive-button:hover:not(:disabled) {
  background: #b91c1c;
}

.confirm-archive-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.cancel-archive-button {
  padding: 8px 20px;
  font-size: 14px;
  background: #e5e7eb;
  color: #374151;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Outfit Regular', sans-serif;
  font-weight: 500;
}

.cancel-archive-button:hover:not(:disabled) {
  background: #d1d5db;
}

.cancel-archive-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
