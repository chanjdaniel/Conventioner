<script setup lang="ts">
/**
 * "Export PNG" (T257): what the layout's PNG carries, the venue's floorplan under the tables
 * (unticked) and the tables' numbers (ticked), then "Export", which the page answers by making and
 * saving the PNG (`exportLayoutPng.ts`). Anyone who can read the market may export, in any phase.
 */
import { ref, watch } from 'vue';
import AppDialog from '@/components/AppDialog.vue';

const props = defineProps<{
  open: boolean;
  /** The location exported, as the dialog's note names it. */
  locationName: string;
  busy?: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  close: [];
  export: [choice: { withImage: boolean; withNumbers: boolean }];
}>();

const withImage = ref(false);
const withNumbers = ref(true);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    withImage.value = false;
    withNumbers.value = true;
  },
);

function submit() {
  if (props.busy) return;
  emit('export', { withImage: withImage.value, withNumbers: withNumbers.value });
}
</script>

<template>
  <AppDialog
    :open="open"
    title="Export PNG"
    testid="layout-export"
    :confirm-label="busy ? 'Exporting…' : 'Export'"
    :confirm-disabled="busy"
    :close-disabled="busy"
    :error="error"
    @close="emit('close')"
    @submit="submit"
  >
    <div class="export-fields">
      <p class="export-note">
        {{ locationName }}'s layout as a picture to print or send, with the market's name, its dates
        and a legend of the sections.
      </p>
      <label class="export-tick">
        <input
          v-model="withImage"
          type="checkbox"
          :disabled="busy"
          data-testid="layout-export-image"
        />
        <span>Include the venue's floorplan</span>
      </label>
      <label class="export-tick">
        <input
          v-model="withNumbers"
          type="checkbox"
          :disabled="busy"
          data-testid="layout-export-numbers"
        />
        <span>Show table numbers</span>
      </label>
    </div>
  </AppDialog>
</template>

<style scoped>
.export-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.export-note {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.export-tick {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--target-min);
  font-size: var(--text-sm);
  color: var(--mm-black);
}
</style>
