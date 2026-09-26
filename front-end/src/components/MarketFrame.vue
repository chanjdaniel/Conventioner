<script setup lang="ts">
/**
 * The frame around a market screen (E21/F04, variant A of the-market-frame ticket 01).
 *
 * A card whose top - the screen's own bar (the market's name, its tabs, or a screen title) and the
 * whole phase rail - sticks directly under the app banner while the PAGE scrolls. Everything the
 * rail grows (a refused transition's blockers, an error, the archived note) is inside the pinned
 * block, under the button that caused it. Condensing on scroll hid "where the market is"; floating
 * the growth covered what it asked the organizer to fix; both were tried and rejected.
 *
 * Sticky, never a viewport-height shell: the banner is sticky on the same principle (`App.vue`), and
 * a sticky element inside an `overflow` ancestor silently stops sticking - so no screen that uses
 * this may scroll inside its card. The card is at least the height of the window under the banner,
 * so a short surface fills it rather than ending mid-screen.
 */
import type { Market } from '@/assets/types/datatypes';
import PhaseRail from '@/components/PhaseRail.vue';

defineProps<{
  market: Market | null;
  /** Awaited before any transition is posted: the plan flushes its pending edits here. */
  beforeTransition?: () => Promise<void> | void;
}>();
</script>

<template>
  <div class="market-frame-card" data-testid="market-frame-card">
    <div class="market-frame" data-testid="market-frame">
      <slot name="bar" />
      <PhaseRail :market="market" :beforeTransition="beforeTransition" />
      <!-- A screen's own control that must stay in view too, such as the vendor search. Pinned with
           the frame rather than sticking on its own, because it could only guess the frame's height. -->
      <slot name="pinned" />
    </div>
    <slot />
  </div>
</template>

<style scoped>
.market-frame-card {
  display: flex;
  flex-direction: column;
  background-color: white;
  box-shadow: var(--shadow-card);
  /* The window under the banner, less the page's bottom gutter. */
  min-height: calc(100vh - var(--banner-h) - var(--space-4));
}

.market-frame {
  position: sticky;
  top: var(--banner-h);
  /* Above the surface it pins over; below the banner (30), the nav scrim and the drawer. */
  z-index: 20;
  background-color: white;
}
</style>
