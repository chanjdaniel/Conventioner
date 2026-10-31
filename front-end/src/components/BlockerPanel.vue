<script setup lang="ts">
import { computed } from 'vue';
import { resolutionPath } from '@/utils/market';
import { useRoute, useRouter } from 'vue-router';
import type { Market, PreconditionResult } from '@/assets/types/datatypes';
import { mayTake } from '@/utils/marketActions';

const props = defineProps<{
  blockers: PreconditionResult[];
  /**
   * The market the blockers are about: a resolution link names a screen of THIS market, and is
   * offered on the table's answer it serves for the person reading.
   */
  market: Pick<Market, 'id' | 'actionRefusals'>;
}>();

const route = useRoute();
const router = useRouter();

/**
 * Each blocker with its resolution link kept only where following it would go somewhere, and only
 * for someone the market's table lets take the action it leads to (T142): a link to work that is
 * not theirs sends them to a page that refuses it. A blocker that names no action, as from an
 * older server, offers no link. The blocker is said either way.
 *
 * The rail carries this panel onto every organizer screen, so the same blocker is read from four
 * different places and a link is only useful from three of them. A link to the page holding
 * the fix looks like a control and does nothing when clicked, which is worse than no link at all:
 * the organizer concludes the panel is broken rather than that they are already where they need
 * to be (E14/F01/S03).
 *
 * The comparison is `router.resolve(...).fullPath` against the current one, so a link is a link to
 * a place rather than a string: `/markets/<id>/applications` and the same page reached by clicking
 * its tab match. It is NOT normalisation - a different query order or an extra parameter
 * reads as a different place - so a guard's link must be spelled as the route it lands on, and must
 * not be a redirect, which `resolve` does not follow.
 */
const rows = computed(() =>
  props.blockers.map((blocker) => {
    const link =
      blocker.resolutionLink && mayTake(props.market, blocker.resolutionAction)
        ? resolutionPath(props.market.id, blocker.resolutionLink)
        : null;
    return {
      blocker,
      fixLink: link && router.resolve(link).fullPath !== route.fullPath ? link : null,
    };
  }),
);
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
          {{ row.blocker.resolutionLabel }} &rarr;
        </router-link>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.blocker-panel {
  padding: var(--space-4);
  border-radius: var(--radius-control);
  /* The destructive chip's ground: the 14% red the panel always drew, laid over the rail's white.
     Its ink is the chip's too, since --mm-red, which the panel used to read, is 4.41 on it. The
     lines are the same 14% over that ground, as they always were. */
  background: var(--mm-chip-destructive);
  border: 1px solid color-mix(in srgb, var(--mm-red) 14%, transparent);
}

.blocker-heading {
  margin: 0 0 var(--space-2) 0;
  font-weight: 600;
  color: var(--mm-text-red-on-tint);
}

.blocker-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.blocker-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  color: var(--mm-text-red-on-tint);
}

.blocker-item + .blocker-item {
  border-top: 1px solid color-mix(in srgb, var(--mm-red) 14%, transparent);
}

.blocker-message {
  flex: 1;
}

.blocker-link {
  flex-shrink: 0;
  font-weight: 400;
  color: var(--mm-text-red-on-tint);
  text-decoration: underline;
}
</style>
