<script setup lang="ts">
/**
 * The way between entries: a side index of every entry at a desk, a native select of the built
 * ones on a phone (a fixed short set, so a select is right there). An entry not yet built is
 * listed as coming, without a link.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { ENTRIES, isBuilt, LIBRARY_PATH } from './catalog';

const props = defineProps<{ current: string }>();
const router = useRouter();

const built = computed(() => ENTRIES.filter((entry) => isBuilt(entry.id)));

function go(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  router.push(id ? `${LIBRARY_PATH}/${id}` : LIBRARY_PATH);
}
</script>

<template>
  <nav class="library-nav" aria-label="Component library" data-testid="library-nav">
    <ul class="library-nav__list" data-testid="library-side-index">
      <li>
        <RouterLink class="library-nav__link" :to="LIBRARY_PATH">All components</RouterLink>
      </li>
      <li v-for="entry in ENTRIES" :key="entry.id">
        <RouterLink
          v-if="isBuilt(entry.id)"
          class="library-nav__link"
          :to="`${LIBRARY_PATH}/${entry.id}`"
          :aria-current="entry.id === props.current ? 'page' : undefined"
          >{{ entry.title }}</RouterLink
        >
        <span v-else class="library-nav__coming">{{ entry.title }} (coming)</span>
      </li>
    </ul>
    <label class="library-nav__pick">
      <span class="field-label">Go to</span>
      <select
        name="entry"
        class="field field--select"
        data-testid="library-entry-select"
        :value="props.current"
        @change="go"
      >
        <option value="">All components</option>
        <option v-for="entry in built" :key="entry.id" :value="entry.id">
          {{ entry.title }}
        </option>
      </select>
    </label>
  </nav>
</template>

<style scoped>
.library-nav__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.library-nav__link,
.library-nav__coming {
  display: flex;
  align-items: center;
  min-height: var(--control-height-compact);
  padding: 0 var(--space-2);
  font-size: var(--text-sm);
}

.library-nav__link {
  color: var(--mm-text-link);
  text-decoration: none;
}

.library-nav__link:hover {
  text-decoration: underline;
}

.library-nav__link[aria-current='page'] {
  background: var(--mm-beige);
  border-radius: var(--radius-control);
  color: var(--mm-black);
  font-weight: 600;
}

.library-nav__coming {
  color: var(--mm-text-muted);
}

.library-nav__pick {
  display: none;
}

@media (width <= 640px) {
  .library-nav__list {
    display: none;
  }

  .library-nav__pick {
    display: block;
  }
}
</style>
