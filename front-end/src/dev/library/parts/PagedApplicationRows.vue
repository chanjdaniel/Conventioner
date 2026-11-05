<script setup lang="ts">
/**
 * The rows the `list-frame` entry's `PagedList` demos page through: who applied, unfolding to what
 * they sell. A native `details` keeps its own fold, so a row left open is seen to stay open as a page
 * lands beneath it, and each heading is a Tab stop, as a history entry's control is.
 */
import IconExpandDown from '@/components/icons/IconExpandDown.vue';
import type { LibraryFixture } from '../fixture';

defineProps<{ applications: readonly LibraryFixture['applications'][number][] }>();
</script>

<template>
  <ul class="paged-rows">
    <li v-for="application in applications" :key="application.id">
      <details class="paged-row" data-testid="library-paged-row">
        <summary class="paged-row__heading">
          <IconExpandDown class="paged-row__caret" aria-hidden="true" />
          <span class="paged-row__who">
            <span class="paged-row__name">{{ application.name }}</span>
            <span class="paged-row__email">{{ application.email }}</span>
          </span>
        </summary>
        <p class="paged-row__body">{{ application.business }} · {{ application.sells }}</p>
      </details>
    </li>
  </ul>
</template>

<style scoped>
.paged-rows {
  margin: 0;
  padding: 0;
  list-style: none;
}

.paged-rows li + li {
  border-top: 1px solid var(--mm-border);
}

.paged-row__heading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--target-min);
  padding: var(--space-1) 0;
  list-style: none;
  cursor: pointer;
}

.paged-row__heading::-webkit-details-marker {
  display: none;
}

.paged-row__heading:hover {
  background: var(--mm-beige);
}

.paged-row__caret {
  flex: none;
  width: var(--space-4);
  height: var(--space-4);
  color: var(--mm-text-muted-on-beige);
  transform: rotate(-90deg);
  transition: transform 0.12s ease;
}

.paged-row[open] .paged-row__caret {
  transform: none;
}

.paged-row__who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.paged-row__name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.paged-row__email {
  font-size: var(--text-xs);
  color: var(--mm-text-muted-on-beige);
  overflow-wrap: anywhere;
}

.paged-row__body {
  margin: 0;
  padding: 0 0 var(--space-2) calc(var(--space-4) + var(--space-2));
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}
</style>
