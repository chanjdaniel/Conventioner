<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { PreconditionResult } from '@/assets/types/datatypes';

const props = defineProps<{
  blockers: PreconditionResult[];
  /** The market the blockers are about; a resolution link names a screen of THIS market. */
  marketId: string;
}>();

const route = useRoute();
const router = useRouter();

/**
 * Each blocker with its resolution link kept only where following it would go somewhere.
 *
 * The rail carries this panel onto every organizer screen, so the same blocker is read from four
 * different places and a link is only useful from three of them. "Fix this" on the page holding
 * the fix looks like a control and does nothing when clicked, which is worse than no link at all:
 * the organizer concludes the panel is broken rather than that they are already where they need
 * to be (E14/F01/S03).
 *
 * The comparison is `router.resolve(...).fullPath` against the current one, so a link is a link to
 * a place rather than a string: `/markets/<id>/setup?tab=applications` and the same route reached by
 * clicking that tab match. It is NOT normalisation - a different query order or an extra parameter
 * reads as a different place - so a guard's link must be spelled as the route it lands on, and must
 * not be a redirect, which `resolve` does not follow.
 */
const rows = computed(() =>
  props.blockers.map((blocker) => {
    const link = blocker.resolutionLink ? marketLink(blocker.resolutionLink) : null;
    return {
      blocker,
      fixLink: link && router.resolve(link).fullPath !== route.fullPath ? link : null,
    };
  }),
);

/**
 * A resolution link is relative to the market's own screens - `setup?tab=applications` - and this
 * is where it becomes the market's address (E21/F02/S02). The server names the screen and the tab
 * that hold the remedy; which market that is, the panel already knows, so the guards never build
 * per-market URLs and every link stays a literal their test can read.
 */
function marketLink(relative: string): string {
  return `/markets/${encodeURIComponent(props.marketId)}/${relative.replace(/^\/+/, '')}`;
}
</script>

<template>
  <div v-if="blockers.length" class="blocker-panel">
    <p class="blocker-heading">Cannot proceed:</p>
    <ul class="blocker-list">
      <li v-for="row in rows" :key="row.blocker.id" class="blocker-item">
        <span class="blocker-message">{{ row.blocker.message }}</span>
        <router-link
          v-if="row.fixLink"
          :to="row.fixLink"
          class="blocker-link"
          data-testid="blocker-resolution-link"
        >
          Fix this &rarr;
        </router-link>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.blocker-panel {
  padding: 1rem;
  border-radius: var(--radius-control);
  background: var(--p-red-50, rgba(192, 57, 43, 0.14));
  border: 1px solid var(--p-red-200, rgba(192, 57, 43, 0.14));
}

.blocker-heading {
  margin: 0 0 0.5rem 0;
  font-weight: 600;
  color: var(--p-red-700, var(--mm-red));
}

.blocker-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.blocker-item {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.25rem 0;
  color: var(--p-red-600, var(--mm-red));
}

.blocker-item + .blocker-item {
  border-top: 1px solid var(--p-red-200, rgba(192, 57, 43, 0.14));
}

.blocker-message {
  flex: 1;
}

.blocker-link {
  flex-shrink: 0;
  font-weight: 400;
  color: var(--p-red-700, var(--mm-red));
  text-decoration: underline;
}
</style>
