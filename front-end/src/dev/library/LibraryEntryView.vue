<script setup lang="ts">
/**
 * One entry of the component library, at `/dev/components/<id>`: its title, what it serves, and
 * its own file under `entries/`, beside the way to the others. An address the library has no entry
 * for is "page not found", as any unknown address is.
 */
import { computed, defineAsyncComponent } from 'vue';
import { useRoute } from 'vue-router';
import PageNotFound from '@/components/PageNotFound.vue';
import LibraryNav from './LibraryNav.vue';
import { entryById, entryFile } from './catalog';

const route = useRoute();

const id = computed(() => String(route.params.entry ?? ''));
const entry = computed(() => entryById(id.value));
const body = computed(() => {
  const file = entryFile(id.value);
  return file ? defineAsyncComponent(file) : undefined;
});
</script>

<template>
  <PageNotFound v-if="!entry || !body" />
  <div v-else class="library" :data-testid="`library-entry-${entry.id}`">
    <LibraryNav class="library__nav" :current="entry.id" />
    <article class="library__entry">
      <header class="library__header">
        <h1 class="library__title">{{ entry.title }}</h1>
        <p class="library__serves" data-testid="library-serves">
          <span class="library__serves-label">Serves:</span> {{ entry.serves }}
        </p>
      </header>
      <component :is="body" :key="entry.id" />
    </article>
  </div>
</template>

<style scoped>
.library {
  display: grid;
  grid-template-columns: 14rem minmax(0, 1fr);
  gap: var(--space-8);
  width: 100%;
  max-width: var(--workspace-max);
  margin: 0 auto;
  padding: var(--space-6);
}

.library__nav {
  position: sticky;
  top: calc(var(--banner-h) + var(--space-6));
  align-self: start;
}

.library__entry {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  min-width: 0;
}

.library__header {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.library__title {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--mm-black);
}

.library__serves {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.library__serves-label {
  font-weight: 600;
}

@media (width <= 640px) {
  .library {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .library__nav {
    position: static;
  }
}

/* The side list has no use on paper, and would take a third of the page from what prints. */
@media print {
  .library {
    grid-template-columns: minmax(0, 1fr);
    padding: 0;
  }

  .library__nav {
    display: none;
  }
}
</style>
