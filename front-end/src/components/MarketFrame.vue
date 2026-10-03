<script setup lang="ts">
/**
 * The frame around a market screen (E21/F04, variant A of the-market-frame ticket 01).
 *
 * A card whose top - the market's bar (its name and its tabs, `MarketBar`, the same on every market
 * page since E22/F04/S02) and the whole phase rail - sticks directly under the app banner while the
 * PAGE scrolls. Everything the
 * rail grows (a refused transition's blockers, an error, the archived note) is inside the pinned
 * block, under the button that caused it. Condensing on scroll hid "where the market is"; floating
 * the growth covered what it asked the organizer to fix; both were tried and rejected.
 *
 * Sticky, never a viewport-height shell: the banner is sticky on the same principle (`App.vue`), and
 * a sticky element inside an `overflow` ancestor silently stops sticking - so no screen that uses
 * this may scroll inside its card. The card is at least the height of the window under the banner,
 * so a short surface fills it rather than ending mid-screen.
 *
 * The frame places itself, and says what is shown until the market arrives (E26/F10/S01). Each
 * screen used to do both: the gutter was its own padding, so the frame sat at x 16 on most pages,
 * x 0 on two and x 32 on the import, and each screen had its own answer for a market not yet here -
 * mostly an empty black bar. A screen's content is rendered only once its market is in hand.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { Market } from '@/assets/types/datatypes';
import MarketArrival from '@/components/MarketArrival.vue';
import MarketBar from '@/components/MarketBar.vue';
import MarketPages from '@/components/MarketPages.vue';
import PhaseRail from '@/components/PhaseRail.vue';
import { useMarketStore } from '@/stores/market';

defineProps<{
  market: Market | null;
  /** Awaited before any transition is posted: the plan flushes its pending edits here. */
  beforeTransition?: () => Promise<void> | void;
}>();

/** After the market is asked for again: a screen that loads data of its own asks for that too. */
const emit = defineEmits<{ retry: [] }>();

const store = useMarketStore();
const { status } = storeToRefs(store);

function retry(): void {
  void store.refresh();
  emit('retry');
}

/*
 * The pinned block's height, measured rather than guessed, as `--market-frame-h` on the card: a
 * screen's own sticky column sits under the frame at `top: calc(var(--banner-h) +
 * var(--market-frame-h))`. The rail grows (blockers, errors), so a fixed number would be wrong.
 */
const card = ref<HTMLElement | null>(null);
const frame = ref<HTMLElement | null>(null);
let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!frame.value || typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(() => {
    card.value?.style.setProperty('--market-frame-h', `${frame.value?.offsetHeight ?? 0}px`);
  });
  observer.observe(frame.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div class="market-frame-page">
    <div ref="card" class="market-frame-card" data-testid="market-frame-card">
      <div ref="frame" class="market-frame" data-testid="market-frame">
        <!-- The market's name and its tabs, the same on every market page (E22/F04/S02). While the
             market is on its way the bar holds its place; a market that is missing has none. -->
        <MarketBar v-if="market || status === 'loading' || status === 'idle'" :market="market" />
        <template v-if="market">
          <PhaseRail :market="market" :beforeTransition="beforeTransition" />
          <!-- The open tab's pages, when it has more than one: Assignment, Result, Vendors
               (E22/F04/S03). -->
          <MarketPages :market="market" />
          <!-- A screen's own control that must stay in view too, such as the vendor search. Pinned
               with the frame rather than sticking on its own, because it could only guess the
               frame's height. -->
          <slot name="pinned" />
        </template>
      </div>
      <slot v-if="market" />
      <MarketArrival v-else :status="status" @retry="retry" />
    </div>
  </div>
</template>

<style scoped>
/*
 * A gutter on three sides, so the card reads as sitting on the page rather than being it (E17/F02/
 * S02). Top is deliberately absent: the card hangs from the banner. Here rather than in each screen,
 * which is how one market's pages came to put it in three different places.
 */
.market-frame-page {
  width: 100%;
  padding: 0 var(--space-4) var(--space-4);
}

/*
 * Every market screen is one width, and the frame says which (E22/F04/S01). Tables, Vendors and
 * Attendance were `--list-max` while the tabs were `--workspace-max`, so moving between a market's
 * screens made the frame jump 340px and cut the market's name on the narrow ones. A screen that
 * stands in the frame sets no width of its own.
 */
.market-frame-card {
  width: 100%;
  max-width: var(--workspace-max);
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  background-color: white;
  box-shadow: var(--shadow-card);
  /* Square where it meets the banner, rounded where it ends on the page. */
  border-radius: 0 0 var(--radius-card) var(--radius-card);
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
