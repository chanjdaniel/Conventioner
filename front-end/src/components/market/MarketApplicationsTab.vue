<script setup lang="ts">
/**
 * The applications tab's body (E18/F02/S01).
 *
 * Extracted from `MarketSetupView`, which held all four tab bodies inline across 1300 lines. The
 * DOM and every `data-testid` are unchanged - this is the prefactor that makes `S02`'s shell
 * change a shell change rather than a whole-file rewrite carrying a fifteen-spec migration.
 *
 * State arrives as props rather than being reached for, so a later story can mount this under a
 * different parent without rewriting it.
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import { MarketPhase, type Market } from '@/assets/types/datatypes';

const props = defineProps<{
  market: Market | null;
  visible: boolean;
  formEditable: boolean;
  importRefusalReason: string | null;
}>();

const router = useRouter();

/** Published by the review queue, so this surface can lead with it while reviewing. */
const undecided = ref(0);

/**
 * Which of its three phases this surface is in, IN WORDS (E18/F02/S03).
 *
 * One surface serves applications-open, applications-closed and review, because ticket 11 measured
 * the difference and found it small: recording a verdict has no phase gate at all, importing spans
 * two of the three, and applications-closed changes nothing for a CSV market. Three screens would
 * have meant two near-identical ones on every market this product currently serves.
 *
 * The cost of that is the rail showing three steps over one place, and the mitigation is this
 * line. Hiding the Import button is NOT stating the condition: a surface whose only difference is
 * a missing control teaches an organizer that the phases are arbitrary, and this project has been
 * caught by exactly that before - a terminal state signalled only by strikethrough read as
 * "stopped" rather than "archived".
 */
const condition = computed(() => {
  const undecidedPhrase =
    undecided.value === 1 ? '1 application' : `${undecided.value} applications`;
  switch (props.market?.phase) {
    case MarketPhase.ApplicationsOpen:
      return 'This market is open for applications. New ones will keep arriving here.';
    case MarketPhase.ApplicationsClosed:
      return 'This market is no longer receiving applications. You can still import the ones you collected elsewhere.';
    case MarketPhase.Review:
      return undecided.value === 0
        ? 'Every application has been decided. This market is ready to assign.'
        : `${undecidedPhrase} still to decide. Every one must be decided before this market can assign.`;
    default:
      return '';
  }
});
</script>

<template>
  <!-- `settings-body` lays its children out in a row, which is right for the two-card tabs
       but put the import button in a dead column beside the list. This one stacks. -->
  <div class="settings-body settings-body-stacked">
    <!-- Which of the three phases this is, said rather than implied. -->
    <p
      v-if="condition"
      class="applications-condition"
      data-testid="market-setup-applications-condition"
    >
      {{ condition }}
    </p>
    <!-- The button used to be live in every phase and navigate to a page whose only
         content was the refusal. The gate is right; being told before the click is the
         part that was missing. -->
    <div class="applications-toolbar">
      <button
        class="import-entry-button"
        :disabled="importRefusalReason !== null"
        data-testid="market-setup-import-button"
        @click="router.push({ name: 'import-applications' })"
      >
        Import from CSV
      </button>
      <span
        v-if="importRefusalReason"
        class="import-entry-hint import-entry-hint--blocked"
        data-testid="market-setup-import-blocked-reason"
      >
        {{ importRefusalReason }}
      </span>
      <span v-else class="import-entry-hint">
        Bring in the responses you already collected, as a CSV from any form tool or spreadsheet.
      </span>
    </div>
    <ApplicationMonitor
      :market="market"
      :visible="visible"
      :formEditable="formEditable"
      @update:undecidedCount="undecided = $event"
    />
  </div>
</template>

<style scoped>
.applications-condition {
  margin: 0 0 var(--space-4);
  font-size: var(--text-sm);
  color: var(--mm-black);
  line-height: 1.4;
}

.settings-body {
  align-self: stretch;
  display: flex;
  gap: 30px;
  padding: 40px;
}

.settings-body-stacked {
  flex-direction: column;
  gap: 0;
  /* The review queue grows with the application in front of the organizer, and the reviewed list
     grows with the market. Without its own scroll the content spilled out past the white panel,
     where it was unreachable. The other tabs each scroll inside their own card; this one has no
     card to scroll inside. */
  overflow-y: auto;
}

.applications-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.import-entry-button {
  height: 36px;
  padding: 0 16px;
  border-radius: var(--radius-control);
  border: 1px solid var(--mm-green);
  background: var(--mm-green);
  color: white;
  font-size: var(--text-sm);
  cursor: pointer;
}

.import-entry-button:disabled {
  background: var(--mm-border);
  border-color: var(--mm-border);
  color: var(--mm-black);
  cursor: not-allowed;
}

.import-entry-hint {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.import-entry-hint--blocked {
  color: var(--mm-text-yellow);
  max-width: 60ch;
}
</style>
