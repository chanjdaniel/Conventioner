<script setup lang="ts">
/**
 * A dialog's History section: its heading opens and closes it, and it is closed until opened, so
 * the sections after it stay in reach (Daniel, on T110's review). Its body is drawn on the first
 * opening, and kept with whatever it read and was set to through later closes, until the dialog
 * that holds it is closed. Manage market's History (E40/F01/S03) and Manage organization's
 * (E40/F02/S01) open alike through it.
 */
import { ref } from 'vue';
import IconExpandDown from '@/components/icons/IconExpandDown.vue';
import IconExpandUp from '@/components/icons/IconExpandUp.vue';

defineProps<{
  /** The section's test id; its toggle's is `<testid>-toggle` and its body's id `<testid>-body`. */
  testid: string;
}>();

const open = ref(false);
const read = ref(false);

function toggle() {
  open.value = !open.value;
  if (open.value) read.value = true;
}
</script>

<template>
  <section class="section" :data-testid="testid">
    <h3 :class="{ 'section-heading--closed': !open }">
      <button
        type="button"
        class="section-toggle"
        :aria-expanded="open"
        :aria-controls="`${testid}-body`"
        :data-testid="`${testid}-toggle`"
        @click="toggle"
      >
        History
        <IconExpandUp v-if="open" class="section-toggle-icon" aria-hidden="true" />
        <IconExpandDown v-else class="section-toggle-icon" aria-hidden="true" />
      </button>
    </h3>
    <div v-show="open" :id="`${testid}-body`">
      <slot v-if="read" />
    </div>
  </section>
</template>

<style scoped>
.section h3 {
  margin: 0 0 var(--space-3);
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--mm-black);
}

/* A closed section is its heading alone, so nothing beneath it to hold apart. */
.section h3.section-heading--closed {
  margin-bottom: 0;
}

/* The heading's words, with a chevron saying whether the section is open. */
.section-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--target-min);
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.section-toggle-icon {
  width: var(--space-4);
  height: var(--space-4);
}
</style>
