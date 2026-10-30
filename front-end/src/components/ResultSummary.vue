<script setup lang="ts">
/**
 * The top of the Assignments page: what the assignment came to, in one strip (E22/F04/S04).
 *
 * It replaced the old results page, which was a second screen's worth of cards under the rules -
 * a summary, quick links to three other screens, per-date/section/tier counts and lists of the
 * unassigned. The result is the tables grid below this now; the strip says how it came out, and
 * the unassigned vendors are a link to the Vendors page rather than a list of their own. The
 * unassigned TABLES need no list at all: the grid's "empty" filter shows them on the grid.
 *
 * Before the first run it says nothing is assigned yet (`NothingAssigned`).
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ResultStatistics from '@/components/ResultStatistics.vue';
import NothingAssigned from '@/components/NothingAssigned.vue';
import PlacementHistoryDialog from '@/components/PlacementHistoryDialog.vue';
import type { AssignmentStatistics, Market } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { downloadErrorMessage, saveCsv } from '@/utils/download';
import { MarketAction, mayTake } from '@/utils/marketActions';
import { marketPath } from '@/utils/market';
import { outOfDateLine } from '@/utils/assignmentOutOfDate';
import { hasAssignment } from '@/utils/marketPage';
import { canAssignIn } from '@/utils/assignPhase';
import { withoutQueryKey } from '@/utils/routeQuery';
import { satisfactionPercent } from '@/utils/satisfactionPercent';

const props = defineProps<{ market: Market }>();

const assigned = computed(() => hasAssignment(props.market));
const outOfDate = computed(() =>
  outOfDateLine(props.market.assignmentOutOfDate, props.market.phase),
);

const statistics = ref<AssignmentStatistics | null>(null);

/** Whether the counts are open under the strip: part of the address, so a refresh keeps it. */
const route = useRoute();
const router = useRouter();
const statisticsOpen = computed(() => route.query.stats === 'open');

function toggleStatistics(): void {
  const query = statisticsOpen.value
    ? withoutQueryKey(route.query, 'stats')
    : { ...route.query, stats: 'open' };
  void router.replace({ query });
}

/**
 * Read the statistics for what the market STORES: its assignment and the plan it was made against.
 *
 * Keyed on those, not on the market object, which the store replaces on every re-read - a plan
 * autosave would otherwise refetch and repaint the strip. A seat change or a run changes the stored
 * assignment, so the store re-reading the market afterwards is all it takes for this to follow.
 */
const basis = computed(() =>
  assigned.value
    ? JSON.stringify([
        props.market.id,
        props.market.assignmentObject ?? null,
        props.market.setupObject ?? null,
      ])
    : null,
);

watch(
  basis,
  (now) => {
    const id = props.market.id;
    if (!now) {
      statistics.value = null;
      return;
    }
    api
      .get(`/markets/${encodeURIComponent(id)}/assignment-statistics`)
      .then((response) => {
        if (props.market.id === id) statistics.value = response.data as AssignmentStatistics;
      })
      .catch(() => (statistics.value = null));
  },
  { immediate: true },
);

/**
 * The satisfaction score, or a statement that there was nothing to score: `null` from the server
 * means no vendor could be scored, which "0%" would misreport as a run that satisfied nobody.
 *
 * Before the statistics arrive it is "…", as every other figure in the strip is. It said "Not
 * applicable" while loading, and "0 unassigned" beside it - both answers, neither of them known.
 */
const satisfaction = computed(() => {
  if (!statistics.value) return '…';
  return satisfactionPercent(statistics.value.satisfactionScore);
});

const unassignedCount = computed(() =>
  statistics.value ? (statistics.value.unassignedVendors?.length ?? 0) : '…',
);

/**
 * The placement trail opens from the action row, before and after a run alike (E35/F03/S03): a
 * hand placement made before the first run is history too, and reading it changes nothing.
 */
const historyOpen = ref(false);

/** Download CSV is the table's Export CSV row (E39/F01/S02). */
const mayExport = computed(() => mayTake(props.market, MarketAction.ExportCsv));
const downloadError = ref('');
const isDownloading = ref(false);

async function downloadCsv(): Promise<void> {
  downloadError.value = '';
  isDownloading.value = true;
  try {
    const response = await api.get(
      `/markets/${encodeURIComponent(props.market.id)}/assignment-csv`,
      { responseType: 'blob' },
    );
    saveCsv(response, `${props.market.name || 'market'}_assigned.csv`);
  } catch (err: unknown) {
    downloadError.value = await downloadErrorMessage(err, 'Failed to download CSV.');
  } finally {
    isDownloading.value = false;
  }
}
</script>

<template>
  <div class="result-summary">
    <!-- A fact, not an error: no dismiss, and running again is what clears it (E22/F03/S02). -->
    <p v-if="outOfDate" class="note" data-testid="assignment-out-of-date">
      {{ outOfDate }}
      <RouterLink :to="marketPath(market.id, 'settings')">Allocate tables again</RouterLink>
      to bring the result up to date.
    </p>

    <template v-if="!assigned">
      <NothingAssigned :market="market" testid="result-empty">
        <!-- Where a run can happen the tables are drawn below, for pinning before it (E11/F02/S01). -->
        <span v-if="canAssignIn(market.phase)" data-testid="result-pin-before-run">
          Anyone you assign below first keeps their table: allocating tables assigns everyone else
          around them.
        </span>
      </NothingAssigned>
      <span class="result-actions">
        <button
          type="button"
          class="btn btn--secondary"
          data-testid="result-history-button"
          @click="historyOpen = true"
        >
          Assignment history
        </button>
      </span>
    </template>
    <div v-else class="result-strip" data-testid="result-strip">
      <span class="result-figure" data-testid="result-approved-assigned">
        <strong>{{ statistics?.totalAssignedVendors ?? '…' }}</strong> of
        {{ statistics?.totalVendors ?? '…' }} approved applicants assigned
      </span>
      <span class="result-figure" data-testid="result-tables-used">
        <strong>{{ statistics?.totalAssignedTables ?? '…' }}</strong> of
        {{ statistics?.totalTables ?? '…' }} table-days used
      </span>
      <RouterLink
        class="result-figure result-link"
        :to="{ path: marketPath(market.id, 'vendors'), query: { show: 'unassigned' } }"
        data-testid="result-unassigned-link"
      >
        <strong>{{ unassignedCount }}</strong> unassigned
      </RouterLink>
      <span class="result-figure">
        <strong data-testid="assignment-satisfaction-score">{{ satisfaction }}</strong>
        satisfaction
      </span>
      <span class="result-actions">
        <button
          type="button"
          class="btn btn--secondary"
          :aria-expanded="statisticsOpen"
          data-testid="result-statistics-button"
          @click="toggleStatistics"
        >
          Statistics
        </button>
        <button
          type="button"
          class="btn btn--secondary"
          data-testid="result-history-button"
          @click="historyOpen = true"
        >
          Assignment history
        </button>
        <button
          v-if="mayExport"
          type="button"
          class="btn btn--secondary"
          :disabled="isDownloading"
          data-testid="result-download-csv-button"
          @click="downloadCsv"
        >
          {{ isDownloading ? 'Downloading…' : 'Download CSV' }}
        </button>
      </span>
    </div>

    <!-- Named and defined where it is shown: it was once a bare "Satisfaction Score" (E12). -->
    <p v-if="assigned" class="result-definition" data-testid="result-definition">
      A table-day is one table on one market date. Satisfaction is the share of the dates vendors
      asked for, and could have had, that they got.
    </p>
    <ResultStatistics v-if="assigned && statisticsOpen && statistics" :statistics="statistics" />
    <p v-if="downloadError" class="result-error" data-testid="result-download-error">
      {{ downloadError }}
    </p>
    <PlacementHistoryDialog
      :open="historyOpen"
      :marketId="market.id"
      @close="historyOpen = false"
    />
  </div>
</template>

<style scoped>
.result-summary {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.result-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-6);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-card);
  background: var(--mm-beige);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.result-figure strong {
  font-size: var(--text-lg);
  font-weight: 600;
}

.result-link {
  color: var(--mm-black);
  text-decoration: underline;
  text-underline-offset: var(--space-hairline);
}

.result-actions {
  margin-left: auto;
  display: flex;
  gap: var(--space-2);
}

.result-definition {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.result-error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}
</style>
