<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import type { PreconditionResult } from '@/assets/types/datatypes';

defineProps<{
  blockers: PreconditionResult[];
}>();

const route = useRoute();
const router = useRouter();

/**
 * Whether a blocker's resolution link actually goes somewhere.
 *
 * The rail carries this panel onto every organizer screen, so the same blocker is read from four
 * different places and a link is only useful from three of them. "Fix this" on the page holding
 * the fix looks like a control and does nothing when clicked, which is worse than no link at all:
 * the organizer concludes the panel is broken rather than that they are already where they need
 * to be (E14/F01/S03).
 *
 * Resolved through the router rather than string-compared, so `/market-setup?tab=applications`
 * and the same route reached by clicking that tab are recognised as one place. A guard's link must
 * therefore name a real route and not a redirect, since `resolve` does not follow one.
 */
function leadsElsewhere(link: string | null | undefined): boolean {
  if (!link) return false;
  return router.resolve(link).fullPath !== route.fullPath;
}
</script>

<template>
  <div v-if="blockers.length" class="blocker-panel">
    <p class="blocker-heading">Cannot proceed:</p>
    <ul class="blocker-list">
      <li v-for="blocker in blockers" :key="blocker.id" class="blocker-item">
        <span class="blocker-message">{{ blocker.message }}</span>
        <router-link
          v-if="leadsElsewhere(blocker.resolutionLink)"
          :to="blocker.resolutionLink!"
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
  border-radius: 0.5rem;
  background: var(--p-red-50, #fef2f2);
  border: 1px solid var(--p-red-200, #fecaca);
}

.blocker-heading {
  margin: 0 0 0.5rem 0;
  font-weight: 600;
  color: var(--p-red-700, #b91c1c);
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
  color: var(--p-red-600, #dc2626);
}

.blocker-item + .blocker-item {
  border-top: 1px solid var(--p-red-200, #fecaca);
}

.blocker-message {
  flex: 1;
}

.blocker-link {
  flex-shrink: 0;
  font-weight: 500;
  color: var(--p-red-700, #b91c1c);
  text-decoration: underline;
}
</style>
