<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Market, PreconditionResult } from '@/assets/types/datatypes';
import { MarketPhase } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { parseMarketFromApi } from '@/utils/market';
import BlockerPanel from '@/components/BlockerPanel.vue';
import PhaseBadge from '@/components/PhaseBadge.vue';
import { VALID_TRANSITIONS, phaseLabel, transitionNeedsConfirmation } from '@/utils/phase';

const props = defineProps<{
  market: Market | null;
  /**
   * Run before any transition is posted, and awaited.
   *
   * Every guard reads the market as the SERVER holds it. The plan editor saves itself on a
   * debounce (E10/F02/S01), so an organizer who types a date and immediately presses Open
   * Applications would be refused by `FormHasFieldsGuard` reading a plan that has not landed yet
   * - blocked by their own unsaved work.
   */
  beforeTransition?: () => Promise<void> | void;
}>();

const emit = defineEmits<{
  phaseAdvanced: [market: Market];
}>();

const showingArchiveConfirm = ref(false);
const archiveTargetPhase = ref('');
const showingPublishConfirm = ref(false);
const publishTargetPhase = ref('');
const transitionError = ref('');
const transitionBlockers = ref<PreconditionResult[]>([]);
const transitioning = ref(false);

const TRANSITION_LABELS: Record<string, string> = {
  [MarketPhase.Draft]: 'Reopen for Editing',
  [MarketPhase.ApplicationsOpen]: 'Open Applications',
  [MarketPhase.ApplicationsClosed]: 'Close Applications',
  [MarketPhase.Review]: 'Begin Review',
  [MarketPhase.Assignment]: 'Begin Assignment',
  [MarketPhase.Offers]: 'Send Offers',
  [MarketPhase.MarketDays]: 'Publish Market',
  [MarketPhase.Archived]: 'Archive Market',
};

const currentPhase = computed(() => props.market?.phase ?? MarketPhase.Draft);

const availableTransitions = computed(() => {
  if (!props.market) return [];
  const fromPhase = currentPhase.value;
  return VALID_TRANSITIONS.filter(([from]) => from === fromPhase).map(([, to]) => to);
});

const isTerminal = computed(() => currentPhase.value === MarketPhase.Archived);

function transitionLabel(toPhase: string): string {
  if (toPhase === MarketPhase.Archived) return 'Archive Market';
  // Named for what the organizer wants to do, not for the phase. Going back to draft exists so
  // the application form becomes editable again.
  if (toPhase === MarketPhase.Draft) return 'Reopen for Editing';

  if (toPhase === MarketPhase.ApplicationsOpen) {
    return currentPhase.value === MarketPhase.Draft ? 'Open Applications' : 'Reopen Applications';
  }
  if (toPhase === MarketPhase.ApplicationsClosed) {
    return currentPhase.value === MarketPhase.ApplicationsOpen
      ? 'Close Applications'
      : 'Return to Applications Closed';
  }
  return TRANSITION_LABELS[toPhase] ?? `Move to ${phaseLabel(toPhase)}`;
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
    await props.beforeTransition?.();
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
  if (!transitionNeedsConfirmation(toPhase)) {
    doTransition(toPhase);
    return;
  }
  if (toPhase === MarketPhase.Archived) {
    archiveTargetPhase.value = toPhase;
    showingArchiveConfirm.value = true;
    return;
  }
  publishTargetPhase.value = toPhase;
  showingPublishConfirm.value = true;
}

function confirmPublish() {
  showingPublishConfirm.value = false;
  doTransition(publishTargetPhase.value);
}

function cancelPublish() {
  showingPublishConfirm.value = false;
  publishTargetPhase.value = '';
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
        <PhaseBadge :phase="currentPhase" data-testid="phase-control-current-phase" />
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

  <!-- Publishing. It asked "Begin Market Days? No offers are pending - no vendors will be marked
       refused", counted from an endpoint whose answer is always 0 because offers are out of MVP
       scope: a dialog answering a question the organizer has never asked, about a feature the
       product does not have. It says what publishing actually does, and what cannot be taken
       back. One verb across the button that opens it, the title, and the button that confirms it;
       and the confirm is not styled as destructive, because publishing is a forward step. -->
  <Teleport to="body">
    <div
      v-if="showingPublishConfirm"
      class="archive-confirm-overlay"
      data-testid="sweep-confirm-overlay"
    >
      <div class="archive-confirm-dialog" data-testid="sweep-confirm-dialog">
        <h3>Publish Market?</h3>
        <p>
          Publishing puts this market's check-in page on the air: every vendor you placed can look
          themselves up and check in on the day. The assignment they see is the one you have now.
        </p>
        <p>A published market cannot be returned to an earlier phase.</p>
        <div class="archive-confirm-buttons">
          <button
            class="confirm-publish-button"
            :disabled="transitioning"
            data-testid="sweep-confirm-confirm"
            @click="confirmPublish"
          >
            Publish Market
          </button>
          <button
            class="cancel-archive-button"
            :disabled="transitioning"
            data-testid="sweep-confirm-cancel"
            @click="cancelPublish"
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

/* This was rgba(255, 255, 255, 0.7) on a transparent panel over a white page: rendered,
   positioned, 93x22px, and invisible. The panel was styled for a dark surface and is drawn on a
   light one, which is why the strip read as unlabelled pills. */
.phase-label-text {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-text-muted);
}

/* These fills carry white text. Six of the eight were Tailwind 500 shades and did not reach AA
   against white: applications_open 3.68, applications_closed 2.15, review 4.23, assignment 2.43,
   offers 3.53, market_days 2.54. Darkened to the lightest shade of the same hue that passes, so
   each phase still reads as its own colour. draft (4.83) and archived (10.31) are unchanged. */
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
  background: var(--mm-green);
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

/* Same mistake as .phase-label-text: white on a white page. */
.terminal-note {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-text-muted);
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
  color: var(--mm-black);
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

/* Green, not the archive dialog's red: publishing cannot be undone, but it is the step the
   organizer has been working towards, not a destruction. */
.confirm-publish-button {
  padding: 8px 20px;
  font-size: 14px;
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Outfit Regular', sans-serif;
  font-weight: 500;
}

.confirm-publish-button:hover:not(:disabled) {
  opacity: 0.9;
}

.confirm-publish-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
