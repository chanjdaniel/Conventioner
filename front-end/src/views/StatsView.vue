<script setup lang="ts">
/**
 * The Stats tab (E45/F01/S01): the market's figures, from its first application to its archive,
 * open in every phase and to anyone who reads the market.
 *
 * Its top line is a strip of three or four tiles chosen by the market's phase (T201,
 * `utils/statsHeadlines.ts`), none in draft: each a figure drawn large over its words, the whole
 * tile a link to where that figure is worked on, with that page's filter, or to the Room section
 * below; a zero whose link would list nothing is told but not linked. A row at a desk, two to a row
 * on a phone.
 *
 * Every figure is counted on the server and read in one small answer (`utils/marketStats.ts`),
 * so the page never downloads the applications to count them. It starts with who applied: how many,
 * a column per day (or week) from the day applications opened to today or their close
 * (`ColumnChart`, `utils/appliedOverTime.ts`), and the review's state as one split bar, each status
 * counted as the Applications tab's All view filters it and linked to that filter (`SplitBar`,
 * `utils/applicantStats.ts`). Then the room, in every phase: whether the plan has room for those
 * asking, each market day's tables asked against its tables and, with two tiers or more, each
 * tier's table-days the same way (`MeterBar`, `utils/roomRows.ts`); before anyone applies, the
 * tables alone, so a draft shows its capacity. Then, once an assignment is stored, how full each
 * section is on each market day, a table of its tables used shaded by how full, with a total row
 * (`FillGrid`, `utils/fillGrid.ts`). Then the money, where the market sets prices and the Payments
 * page has someone to count: owed, paid and still owed, that page's figures, and one bar of paid
 * against owed (`MeterBar`, `utils/moneyCard.ts`). Then, from Market Days on, who has come: a row
 * per market day of its vendors checked in of those expected, as the door counts its day, and
 * beside it how many are not yet in, a link to Attendance on that day (`MeterBar`,
 * `utils/checkInRows.ts`). Then what they answered: a card per choice question of the form
 * (`utils/answerCounts.ts`), its answers most chosen first and folded past `ANSWERS_SHOWN` (T201),
 * narrowed by a switch, kept in the address as `among`, to the approved or the assigned
 * (E45/F01/S02). Stats reads; it changes nothing, so a Viewer sees all of it and nothing here is
 * disabled.
 *
 * Its sections keep one order, the market's life's (T201): who applied, the room, how full, the
 * money, check-in, then what they answered.
 * Their cards stand two to a row while the page's content is 48rem wide or more, one below it; a
 * chart that reads as one line of a whole, over time or across the review, and the How full table
 * span the row.
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import { getApiErrorMessage } from '@/utils/api';
import { applicantStats } from '@/utils/applicantStats';
import { appliedOverTime } from '@/utils/appliedOverTime';
import { ANSWER_GROUPS, answerGroup, questionLedgers } from '@/utils/answerCounts';
import { fetchMarketStats, type MarketStats } from '@/utils/marketStats';
import { checkInRows } from '@/utils/checkInRows';
import { fillGrid } from '@/utils/fillGrid';
import { moneyCard } from '@/utils/moneyCard';
import { roomCards } from '@/utils/roomRows';
import { statsHeadlines } from '@/utils/statsHeadlines';
import { useOpenMarket } from '@/utils/openMarket';
import BarLedger from '@/components/BarLedger.vue';
import ColumnChart from '@/components/charts/ColumnChart.vue';
import FillGrid from '@/components/charts/FillGrid.vue';
import MeterBar from '@/components/charts/MeterBar.vue';
import SplitBar from '@/components/charts/SplitBar.vue';
import MarketFrame from '@/components/MarketFrame.vue';

const route = useRoute();
const router = useRouter();
const marketId = computed(() => String(route.params.marketId ?? ''));
const { market } = useOpenMarket(marketId);

const figures = ref<MarketStats | null>(null);
const errorMessage = ref('');

/** Reads the figures of the market on screen; an earlier market's answer, landing late, is dropped. */
async function load(): Promise<void> {
  const id = marketId.value;
  if (!id) return;
  errorMessage.value = '';
  try {
    const read = await fetchMarketStats(id);
    if (marketId.value === id) figures.value = read;
  } catch (err: unknown) {
    if (marketId.value === id) {
      errorMessage.value = getApiErrorMessage(err, 'The figures could not be counted.');
    }
  }
}
// A jump through history to another market's Stats keeps this page: the last market's figures go
// at once, so none of them is drawn under the next market's name while it counts, or if it fails.
watch(
  marketId,
  () => {
    figures.value = null;
    void load();
  },
  { immediate: true },
);

const stats = computed(() =>
  figures.value ? applicantStats(figures.value.applicants, marketId.value) : null,
);
/** Applications over time; none until someone applied with a time, or before the market is read. */
const overTime = computed(() =>
  figures.value && market.value
    ? appliedOverTime(figures.value.applicants, market.value.phase ?? '')
    : null,
);
const overTimeColumns = computed(() =>
  (overTime.value?.buckets ?? []).map((bucket) => ({ ...bucket, key: bucket.start })),
);
/** The room's cards, the tables alone before anyone applies; none where the plan has no dates. */
const room = computed(() =>
  figures.value ? roomCards(figures.value.room, figures.value.applicants.total > 0) : [],
);
/** How full each section is each day; none until an assignment is stored. */
const fill = computed(() => (figures.value ? fillGrid(figures.value.fill) : null));
/** Where the money stands; none where the market sets no prices or nobody is counted. */
const moneyFigures = computed(() =>
  figures.value ? moneyCard(figures.value.headlines.money, marketId.value) : null,
);
/** Who has come each day; none before Market Days. */
const checkIn = computed(() =>
  figures.value && market.value
    ? checkInRows(figures.value.checkIn, marketId.value, market.value.phase ?? '')
    : null,
);
const answers = computed(() => figures.value?.answers ?? null);
/** The strip's tiles, chosen by the phase; none in draft or before the market is read. */
const headlines = computed(() =>
  figures.value && market.value
    ? statsHeadlines(market.value.phase ?? '', figures.value, marketId.value)
    : [],
);

/** The tiles whose figure is an amount, which a phone gives a row of its own. */
const AMOUNTS = new Set(['stillOwed', 'paid']);

/** A tile that leads to a section of this page brings it under the pinned bar, and reads from it. */
function toSection(id: string): void {
  const section = document.getElementById(id);
  if (!section) return;
  section.scrollIntoView({ block: 'start' });
  section.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

/** Who the charts count, in the address beside the page. */
const among = computed(() => answerGroup(route.query.among));
const amongGroup = computed(() => ANSWER_GROUPS.find((group) => group.id === among.value)!);
function narrowTo(group: string) {
  const query: LocationQuery = { ...route.query };
  if (group === 'all') delete query.among;
  else query.among = group;
  void router.replace({ query });
}
const ledgers = computed(() => (answers.value ? questionLedgers(answers.value, among.value) : []));
/** How many of a question's answers show before "N more answers" (Daniel, T201). */
const ANSWERS_SHOWN = 8;
/** Nobody in the group yet, said instead of charts of noughts. */
const NOBODY: Record<string, string> = {
  approved: 'Nobody is approved yet.',
  assigned: 'Nobody is assigned yet.',
};
</script>

<template>
  <MarketFrame :market="market" @retry="load">
    <div class="stats">
      <!-- A draft, or a phase whose figures are not counted yet: there is nothing to headline. -->
      <ul
        v-if="headlines.length"
        class="stats-strip"
        aria-label="The market at a glance"
        data-testid="stats-headlines"
      >
        <li
          v-for="tile in headlines"
          :key="tile.id"
          :class="{ 'stats-strip-amount': AMOUNTS.has(tile.id) }"
          :data-testid="`stats-headline-${tile.id}`"
        >
          <RouterLink
            v-if="tile.link && 'route' in tile.link"
            :to="tile.link.route"
            class="stats-tile stats-tile--link"
          >
            <strong class="stats-tile-figure" data-testid="stats-headline-figure">{{
              tile.figure
            }}</strong>
            {{ ' ' }}<span class="stats-tile-words">{{ tile.words }}</span>
          </RouterLink>
          <a
            v-else-if="tile.link"
            :href="`#${tile.link.section}`"
            class="stats-tile stats-tile--link"
            @click.prevent="toSection(tile.link.section)"
          >
            <strong class="stats-tile-figure" data-testid="stats-headline-figure">{{
              tile.figure
            }}</strong>
            {{ ' ' }}<span class="stats-tile-words">{{ tile.words }}</span>
          </a>
          <div v-else class="stats-tile">
            <strong class="stats-tile-figure" data-testid="stats-headline-figure">{{
              tile.figure
            }}</strong>
            {{ ' ' }}<span class="stats-tile-words">{{ tile.words }}</span>
          </div>
        </li>
      </ul>
      <section class="stats-section" aria-labelledby="stats-applicants-title">
        <h2 id="stats-applicants-title" class="stats-title">Who applied</h2>
        <p v-if="errorMessage" class="stats-error" role="alert" data-testid="stats-error">
          {{ errorMessage }}
        </p>
        <p v-else-if="!stats" class="stats-note" data-testid="stats-counting">Counting…</p>
        <p v-else-if="!stats.total" class="stats-note" data-testid="stats-applicants-none">
          Nobody has applied yet.
        </p>
        <template v-else>
          <p class="stats-total" data-testid="stats-applicants-total">
            <strong>{{ stats.total }}</strong>
            {{ stats.total === 1 ? 'application' : 'applications' }} in all<template
              v-if="stats.addedByHand"
              >, {{ stats.addedByHand }} of them added by hand</template
            >
          </p>
          <div class="stats-ledgers">
            <ColumnChart
              v-if="overTime"
              class="stats-wide"
              title="When they applied"
              :columns="overTimeColumns"
              :summary="overTime.summary"
              :numbers="overTime.unit === 'day' ? 'Numbers by day' : 'Numbers by week'"
              :key-head="overTime.unit === 'day' ? 'Day' : 'Week'"
              count-head="Applications"
              testid="stats-over-time"
              data-testid="stats-over-time"
            />
            <SplitBar
              class="stats-wide"
              title="Where the review stands"
              :parts="stats.byStatus"
              whole="applications"
              testid="stats-status"
              data-testid="stats-by-status"
            />
          </div>
        </template>
      </section>
      <section
        v-if="room.length"
        id="stats-room"
        class="stats-section"
        aria-labelledby="stats-room-title"
        data-testid="stats-room"
      >
        <h2 id="stats-room-title" class="stats-title" tabindex="-1">Room</h2>
        <div class="stats-ledgers">
          <div
            v-for="card in room"
            :key="card.id"
            class="stats-card"
            :data-testid="`stats-room-${card.id}`"
          >
            <h3>{{ card.title }}</h3>
            <ul class="stats-meters">
              <li v-for="row in card.rows" :key="row.key">
                <MeterBar
                  :label="row.label"
                  :words="row.words"
                  :value="row.asked"
                  :mark="row.tables"
                  :scale="card.scale"
                  testid="stats-room-row"
                  data-testid="stats-room-row"
                  :data-key="row.key"
                />
              </li>
            </ul>
            <p v-if="card.note" class="stats-card-note">{{ card.note }}</p>
          </div>
        </div>
      </section>
      <section
        v-if="fill"
        class="stats-section"
        aria-labelledby="stats-fill-title"
        data-testid="stats-fill"
      >
        <h2 id="stats-fill-title" class="stats-title">How full</h2>
        <FillGrid
          title="Tables used of each section's tables, each day"
          :grid="fill"
          testid="stats-fill"
        />
      </section>
      <section
        v-if="moneyFigures"
        class="stats-section"
        aria-labelledby="stats-money-title"
        data-testid="stats-money"
      >
        <h2 id="stats-money-title" class="stats-title">Money</h2>
        <div class="stats-ledgers">
          <div class="stats-card stats-money-card" data-testid="stats-money-card">
            <h3>Owed and paid</h3>
            <dl class="stats-money">
              <div
                v-for="figure in moneyFigures.figures"
                :key="figure.id"
                class="stats-money-figure"
                :data-testid="`stats-money-${figure.id}`"
              >
                <dt>{{ figure.label }}</dt>
                <dd>
                  <RouterLink v-if="figure.to" :to="figure.to" class="stats-money-link">{{
                    figure.amount
                  }}</RouterLink>
                  <template v-else>{{ figure.amount }}</template>
                </dd>
              </div>
            </dl>
            <MeterBar
              label="Collected"
              :words="moneyFigures.bar.words"
              :value="moneyFigures.bar.value"
              :mark="moneyFigures.bar.mark"
              :scale="moneyFigures.bar.scale"
              testid="stats-money-bar"
            />
          </div>
        </div>
      </section>
      <section
        v-if="checkIn"
        class="stats-section"
        aria-labelledby="stats-check-in-title"
        data-testid="stats-check-in"
      >
        <h2 id="stats-check-in-title" class="stats-title">Check-in</h2>
        <div class="stats-ledgers">
          <div class="stats-card" data-testid="stats-check-in-card">
            <h3>Checked in each day</h3>
            <ul class="stats-meters">
              <li v-for="row in checkIn.rows" :key="row.key">
                <MeterBar
                  :label="row.label"
                  :words="row.words"
                  :value="row.checkedIn"
                  :mark="row.expected"
                  :scale="checkIn.scale"
                  testid="stats-check-in-row"
                  data-testid="stats-check-in-row"
                  :data-key="row.key"
                >
                  <template v-if="row.missing" #default>
                    <RouterLink
                      v-if="row.missing.to"
                      :to="row.missing.to"
                      class="link-alone stats-missing"
                      data-testid="stats-check-in-missing"
                      >{{ row.missing.words }}</RouterLink
                    >
                    <span v-else class="stats-missing" data-testid="stats-check-in-missing">{{
                      row.missing.words
                    }}</span>
                  </template>
                </MeterBar>
              </li>
            </ul>
          </div>
        </div>
      </section>
      <!-- Nobody applied: the section above says so, and a chart of noughts says nothing more. -->
      <section
        v-if="answers?.groups.all"
        class="stats-section"
        aria-labelledby="stats-answers-title"
        data-testid="stats-answers"
      >
        <h2 id="stats-answers-title" class="stats-title">What they answered</h2>
        <p v-if="!answers.questions.length" class="stats-note" data-testid="stats-answers-none">
          The form asks no question with choices to count.
        </p>
        <template v-else>
          <div class="stats-among">
            <div class="stats-among-switch" role="group" aria-label="Count the answers of">
              <button
                v-for="group in ANSWER_GROUPS"
                :key="group.id"
                type="button"
                class="btn btn--compact"
                :class="group.id === among ? 'btn--primary' : 'btn--secondary'"
                :aria-pressed="group.id === among"
                :data-testid="`stats-among-${group.id}`"
                @click="narrowTo(group.id)"
              >
                {{ group.label }}
              </button>
            </div>
            <span class="stats-among-count" data-testid="stats-among-count">
              {{ answers.groups[among] }} of {{ answers.groups.all }}
            </span>
          </div>
          <p v-if="!answers.groups[among]" class="stats-note" data-testid="stats-among-nobody">
            {{ NOBODY[among] }}
          </p>
          <div v-else class="stats-ledgers">
            <BarLedger
              v-for="ledger in ledgers"
              :key="ledger.key"
              :title="ledger.title"
              :rows="ledger.rows"
              testid="stats-answer"
              :whole="amongGroup.whole"
              :fold="ANSWERS_SHOWN"
              data-testid="stats-question"
              :data-key="ledger.key"
            />
          </div>
        </template>
      </section>
    </div>
  </MarketFrame>
</template>

<style scoped>
.stats {
  container: stats / inline-size;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-6);
  color: var(--mm-black);
}

/* The strip (T201): a row of tiles at a desk, each one equal share of it, and two to a row on a
   phone, so three or four figures take two rows rather than a line each. */
.stats-strip {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* A figure drawn large over the words that say what it counts, in the charts' card; the whole tile
   is the link, so it fills its cell and the row's tiles stand as tall as the tallest. */
.stats-tile {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  height: 100%;
  min-height: var(--target-min);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
  color: var(--mm-black);
}

.stats-tile-figure {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-2xl);
  font-weight: 400;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.stats-tile-words {
  font-size: var(--text-sm);
}

/* A tile that leads somewhere: its figure in the link ink, no underline, the tile a step darker
   under the pointer, as a secondary button is. */
.stats-tile--link {
  text-decoration: none;
}

.stats-tile--link .stats-tile-figure {
  color: var(--mm-text-link);
}

.stats-tile--link:hover {
  background: var(--mm-white-hover);
}

.stats-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  /* A tile that leads here brings the section in under the pinned bar, not behind it. */
  scroll-margin-top: calc(var(--banner-h) + var(--market-frame-h) + var(--space-3));
}

.stats-title {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  font-weight: 400;
}

.stats-total {
  margin: 0;
  font-size: var(--text-sm);
}

.stats-total strong {
  font-size: var(--text-lg);
  font-variant-numeric: tabular-nums;
}

/* Two equal columns while the page's content is 48rem wide or more, one below it (T201), so a lone
   card stays half the page and no bar runs the frame's width, as one did at 1100px. The columns
   follow the content's width, not the window's, and a 320px phone narrows its one card to fit. */
.stats-ledgers {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: var(--space-4);
}

@container stats (width >= 48rem) {
  .stats-ledgers {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* A chart of one whole, over time or across the review, spans the row. */
.stats-wide {
  grid-column: 1 / -1;
}

/* A card of rows, in the charts' look: white, bordered, its title small over them. */
.stats-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
}

.stats-card h3 {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-text-muted);
}

.stats-meters {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* The money's three figures, the Payments page's, in its look: each small label over its amount,
   three side by side on a card wide enough for a large amount in each; on a narrower one, a phone's,
   one to a line, the label at its start and the amount at its end, rather than two and one. */
.stats-money-card {
  container: stats-money / inline-size;
}

.stats-money {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-1);
  margin: 0;
}

.stats-money-figure {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0 var(--space-3);
}

/* The label beside its amount on a line reads at the row's size; over it, small. */
.stats-money-figure dt {
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.stats-money-figure dd {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  font-variant-numeric: tabular-nums;
}

@container stats-money (width >= 24rem) {
  .stats-money {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .stats-money-figure {
    display: block;
  }

  .stats-money-figure dt {
    font-size: var(--text-xs);
  }
}

/* A figure on a line of its own is a target, in the link ink, underlined under the pointer. */
.stats-money-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--target-min);
  color: var(--mm-text-link);
  text-decoration: none;
}

.stats-money-link:hover {
  text-decoration: underline;
}

/* Who is missing, after the day's figures, in their weight, not the label's. */
.stats-missing {
  font-weight: 600;
}

.stats-card-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.stats-among {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.stats-among-switch {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

/* "All" is a word wide, so the switch's buttons keep a target's width too. */
.stats-among-switch .btn {
  min-width: var(--target-min);
}

/* Beside the switch, not at the frame's far edge: the cards under it may fill only its left. */
.stats-among-count {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  font-variant-numeric: tabular-nums;
}

.stats-note {
  margin: 0;
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.stats-error {
  margin: 0;
  color: var(--mm-red);
  font-size: var(--text-sm);
}

/*
 * A phone (T180): how the day stands is read at the market, so the page fits the phone it is read
 * on (`meta.fitsAPhone`). The gutter is the door's, and the strip's tiles stand two to a row, each
 * figure a step smaller (T201). An amount takes a row of its own, since "$3,565.00" broke over two
 * lines in half a 320px window, and so does a tile it would leave alone on its row.
 */
@media (width <= 640px) {
  .stats {
    padding: var(--space-4);
  }

  .stats-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-flow: row;
    gap: var(--space-2);
  }

  .stats-tile {
    padding: var(--space-2) var(--space-3);
  }

  .stats-tile-figure {
    font-size: var(--text-xl);
  }

  .stats-strip-amount,
  .stats-strip > li:last-child:nth-child(odd),
  .stats-strip > li:nth-child(odd):has(+ .stats-strip-amount) {
    grid-column: 1 / -1;
  }
}
</style>
