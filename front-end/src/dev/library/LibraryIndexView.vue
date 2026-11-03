<script setup lang="ts">
/**
 * The component library's index, at `/dev/components` in a development build only (T200): every
 * reusable component, existing and proposed, in the review's groups, each with what it serves.
 * `docs/implementation/modules/component-library.md` says how it works and how to add an entry.
 */
import { LIBRARY_MARKER, LIBRARY_PATH } from './marker';
import { ENTRIES, isBuilt } from './catalog';
</script>

<template>
  <div class="library-index" data-testid="library-index" :data-library="LIBRARY_MARKER">
    <header class="library-index__header">
      <h1 class="library-index__title">Component library</h1>
      <p class="library-index__about">
        Every reusable component in its variants and states, on synthetic data the size of a real
        market. This page is in development builds only.
      </p>
    </header>
    <ol class="library-index__groups">
      <li
        v-for="entry in ENTRIES"
        :key="entry.id"
        class="library-index__group"
        :data-testid="`library-index-${entry.id}`"
      >
        <h2 class="library-index__name">
          <RouterLink
            v-if="isBuilt(entry.id)"
            class="library-index__link"
            :to="`${LIBRARY_PATH}/${entry.id}`"
            >{{ entry.title }}</RouterLink
          >
          <template v-else>
            {{ entry.title }} <span class="chip chip--neutral">Coming</span>
          </template>
        </h2>
        <p class="library-index__summary">{{ entry.summary }}</p>
        <p class="library-index__serves">
          <span class="library-index__serves-label">Serves:</span> {{ entry.serves }}
        </p>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.library-index {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  width: 100%;
  max-width: var(--list-max);
  margin: 0 auto;
  padding: var(--space-6);
}

.library-index__header {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.library-index__title {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--mm-black);
}

.library-index__about {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.library-index__groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
  gap: var(--space-3);
  align-items: start;
  margin: 0;
  padding: 0;
  list-style: none;
}

.library-index__group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-4) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
}

.library-index__name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  /* Every title the height of a link's target, built or coming, so the cards' lines agree. */
  min-height: var(--target-min);
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--mm-black);
}

.library-index__link {
  display: inline-flex;
  align-items: center;
  min-height: var(--target-min);
  color: var(--mm-text-link);
  text-decoration: none;
}

.library-index__link:hover {
  text-decoration: underline;
}

.library-index__summary,
.library-index__serves {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.library-index__summary {
  color: var(--mm-text-muted);
}

.library-index__serves-label {
  font-weight: 600;
}

@media (width <= 640px) {
  .library-index {
    padding: var(--space-4);
  }
}
</style>
