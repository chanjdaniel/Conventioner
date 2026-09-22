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
import { useRouter } from 'vue-router';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import type { Market } from '@/assets/types/datatypes';

defineProps<{
  market: Market | null;
  visible: boolean;
  formEditable: boolean;
  importRefusalReason: string | null;
}>();

const router = useRouter();
</script>

<template>
  <!-- `settings-body` lays its children out in a row, which is right for the two-card tabs
       but put the import button in a dead column beside the list. This one stacks. -->
  <div class="settings-body settings-body-stacked">
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
    <ApplicationMonitor :market="market" :visible="visible" :formEditable="formEditable" />
  </div>
</template>

<style scoped>
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
