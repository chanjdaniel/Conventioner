<script setup lang="ts">
/**
 * How a place looks today beside how it would look, on the same data: two columns at a desk,
 * stacked on a phone, today first.
 */
import LibraryPanel from './LibraryPanel.vue';

withDefaults(defineProps<{ today?: string; proposed?: string }>(), {
  today: 'Today',
  proposed: 'Proposed',
});
</script>

<template>
  <div class="today-and-proposed" data-testid="today-and-proposed">
    <LibraryPanel :label="today">
      <div class="today-and-proposed__content"><slot name="today" /></div>
    </LibraryPanel>
    <LibraryPanel :label="proposed">
      <div class="today-and-proposed__content"><slot name="proposed" /></div>
    </LibraryPanel>
  </div>
</template>

<style scoped>
.today-and-proposed {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr));
  gap: var(--space-3);
  align-items: start;
  grid-column: 1 / -1;
}

.today-and-proposed__content {
  width: 100%;
  min-width: 0;
}
</style>
