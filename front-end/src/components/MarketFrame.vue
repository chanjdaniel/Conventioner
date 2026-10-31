<script setup lang="ts">
/**
 * The frame around a market screen (E21/F04, variant A of the-market-frame ticket 01).
 *
 * A card whose top - the market's bar (its name and its tabs, `MarketBar`, the same on every market
 * page since E22/F04/S02) and the whole phase rail - sticks directly under the app banner while the
 * PAGE scrolls, on a desk. Everything the rail grows (a refused transition's blockers, an error, the
 * archived note) is inside the pinned block, under the button that caused it. Condensing on scroll
 * hid "where the market is"; floating the growth covered what it asked the organizer to fix; both
 * were tried and rejected.
 *
 * On a phone only the bar pins (T142): with the banner, the whole block took 280 to 442px of a
 * 844px window, 409 at the door, so the check-in list scrolled in the lower half of the screen. The
 * rail, the page row and the `pinned` slot stand at the top of the page and scroll away with it; the
 * bar's dot still says where the market is worked on, and the rail is one scroll up.
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { storeToRefs } from 'pinia';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import MarketArrival from '@/components/MarketArrival.vue';
import MarketBar from '@/components/MarketBar.vue';
import MarketPages from '@/components/MarketPages.vue';
import PhaseRail from '@/components/PhaseRail.vue';
import { useMarketStore } from '@/stores/market';
import { tabNote } from '@/utils/marketGuide';
import { MARKET_PAGES, pageOfRoute, tabOf, type MarketPage } from '@/utils/marketPage';

const props = defineProps<{
  market: Market | null;
  /** Awaited before any transition is posted: the plan flushes its pending edits here. */
  beforeTransition?: () => Promise<void> | void;
}>();

/** After the market is asked for again: a screen that loads data of its own asks for that too. */
const emit = defineEmits<{ retry: [] }>();

const store = useMarketStore();
const { status } = storeToRefs(store);

/**
 * What the open tab says while its work is not here yet, or is over (E31/F03/S02). Every tab
 * stays on the bar for the market's whole life; one out of its phase shows this line in place of a
 * page that could only say "nothing yet". On a tab's pages only, never a flow it holds: a Google
 * Form market's first import is the work its draft Applications tab is waiting on (E38/F04/S01).
 */
const route = useRoute();
const note = computed(() => {
  const where = pageOfRoute(route.name, route.params);
  if (!props.market || !where || !MARKET_PAGES.includes(where as MarketPage)) return null;
  return tabNote(props.market, tabOf(where));
});

/**
 * Why the person looking may change nothing here, said once for every page of the market (T15):
 * the server sets `readOnlyReason` when none of the table's changing actions is theirs, or the
 * market is archived. Each screen drops a control on the answer of its own action
 * (`utils/marketActions.ts`, E39/F01/S02), and only Market Setup said why, so a Viewer met an
 * Assignments page whose seats were plain text and took it for broken. An archived market is said
 * by the rail, and a tab's note in place of its page says the one thing that page says.
 */
const readOnlyNote = computed(() =>
  props.market && props.market.phase !== MarketPhase.Archived && !note.value
    ? (props.market.readOnlyReason ?? null)
    : null,
);

function retry(): void {
  void store.refresh();
  emit('retry');
}

/*
 * The pinned block's height, measured rather than guessed, as `--market-frame-h` on the card: a
 * screen's own sticky column sits under the frame at `top: calc(var(--banner-h) +
 * var(--market-frame-h))`. The rail grows (blockers, errors), so a fixed number would be wrong. On a
 * phone the frame gives up its box and only the bar is pinned, so the bar's height is measured.
 */
const card = ref<HTMLElement | null>(null);
const frame = ref<HTMLElement | null>(null);
const bar = ref<InstanceType<typeof MarketBar> | null>(null);
const barEl = computed(() => (bar.value?.$el as HTMLElement | undefined) ?? null);
let observer: ResizeObserver | null = null;
function measure(): void {
  const pinned = frame.value?.offsetHeight || barEl.value?.offsetHeight || 0;
  card.value?.style.setProperty('--market-frame-h', `${pinned}px`);
}
onMounted(() => {
  if (!frame.value || typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(measure);
  observer.observe(frame.value);
  if (barEl.value) observer.observe(barEl.value);
});
// The bar comes and goes with the market's arrival; a box-less frame never says so.
watch(barEl, (el, was) => {
  if (!observer) return;
  if (was) observer.unobserve(was);
  if (el) observer.observe(el);
  measure();
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div class="market-frame-page">
    <div ref="card" class="market-frame-card" data-testid="market-frame-card">
      <div ref="frame" class="market-frame" data-testid="market-frame">
        <!-- The market's name and its tabs, the same on every market page (E22/F04/S02). While the
             market is on its way the bar holds its place; a market that is missing has none. -->
        <MarketBar
          v-if="market || status === 'loading' || status === 'idle'"
          ref="bar"
          :market="market"
        />
        <template v-if="market">
          <PhaseRail :market="market" :beforeTransition="beforeTransition" />
          <!-- The open tab's pages, when it has more than one: Settings, Assignments, Vendors
               (E22/F04/S03). -->
          <MarketPages :market="market" />
          <!-- A screen's own control that must stay in view too, such as the vendor search. Pinned
               with the frame rather than sticking on its own, because it could only guess the
               frame's height; on a phone it scrolls with the rail. -->
          <slot name="pinned" />
        </template>
      </div>
      <p v-if="market && note" class="market-tab-note" data-testid="market-tab-note">
        {{ note }}
      </p>
      <template v-else-if="market">
        <p v-if="readOnlyNote" class="note market-read-only" data-testid="market-read-only">
          {{ readOnlyNote }}
        </p>
        <slot />
      </template>
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

/* The open tab's line, where its page would be: said plainly, in the page's own gutter. */
.market-tab-note {
  margin: 0;
  padding: var(--space-8) var(--space-6);
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

/* Inset as a page insets its content, so the note lines up with what it explains. */
.market-read-only {
  margin: var(--space-6) var(--space-6) 0;
}

@media (width <= 640px) {
  .market-read-only {
    margin: var(--space-4) var(--space-4) 0;
  }
}

.market-frame {
  position: sticky;
  top: var(--banner-h);
  /* Above the surface it pins over; below the banner (30), the nav scrim and the drawer. */
  z-index: 20;
  background-color: white;
}

/*
 * On a phone only the bar pins (T142). A sticky element sticks only inside its parent, so the frame
 * gives up its box and the bar sticks against the card; the rail, the page row and the `pinned`
 * slot are the card's own children, in the page's flow, and scroll away with it.
 */
@media (width <= 640px) {
  .market-frame {
    display: contents;
  }

  .market-frame > .market-bar {
    position: sticky;
    top: var(--banner-h);
    /* The frame's layer, and over the rail's menu (20), which scrolls under the bar here. */
    z-index: 21;
  }
}
</style>
