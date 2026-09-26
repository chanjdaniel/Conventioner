<script setup lang="ts">
/**
 * The top of the Result page: what the assignment came to, in one strip (E22/F04/S04).
 *
 * It replaced the old results page, which was a second screen's worth of cards under the rules -
 * a summary, quick links to three other screens, per-date/section/tier counts and lists of the
 * unassigned. The result is the tables grid below this now; the strip says how it came out, and
 * the unassigned vendors are a link to the Vendors page rather than a list of their own. The
 * unassigned TABLES need no list at all: the grid's "empty" filter shows them on the grid.
 *
 * Before the first run it says there is no assignment yet, and where to run one - or, where the
 * phase refuses a run, why, in the words `assign_phase_refusal` uses on the server.
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ResultStatistics from '@/components/ResultStatistics.vue';
import type { AssignmentStatistics, Market } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { marketPath } from '@/utils/market';
import { assignRefusal } from '@/utils/assignPhase';
import { outOfDateLine } from '@/utils/assignmentOutOfDate';
import { hasAssignment } from '@/utils/marketPage';
import { withoutQueryKey } from '@/utils/routeQuery';

const props = defineProps<{ market: Market }>();

const assigned = computed(() => hasAssignment(props.market));
const refusal = computed(() => assignRefusal(props.market.phase));
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
 */
const satisfaction = computed(() => {
  const score = statistics.value?.satisfactionScore;
  return score === null || score === undefined ? 'Not applicable' : `${Math.round(score * 100)}%`;
});

const unassignedCount = computed(() => statistics.value?.unassignedVendors?.length ?? 0);

const downloadError = ref('');
const isDownloading = ref(false);

function filenameFrom(header: string | undefined, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

/** The error the server gave, whether it came back as JSON or inside the blob asked for. */
async function errorFrom(err: unknown): Promise<string> {
  const data =
    err && typeof err === 'object' && 'response' in err
      ? (err as { response?: { data?: unknown } }).response?.data
      : undefined;
  try {
    const parsed = data instanceof Blob ? JSON.parse(await data.text()) : data;
    const message = (parsed as { error?: unknown } | undefined)?.error;
    if (typeof message === 'string' && message) return message;
  } catch {
    // Not JSON: fall through to the plain message.
  }
  return 'Failed to download CSV.';
}

async function downloadCsv(): Promise<void> {
  downloadError.value = '';
  isDownloading.value = true;
  try {
    const response = await api.get(
      `/markets/${encodeURIComponent(props.market.id)}/assignment-csv`,
      { responseType: 'blob' },
    );
    const filename = filenameFrom(
      (response.headers as Record<string, string | undefined>)['content-disposition'],
      `${props.market.name || 'market'}_assigned.csv`,
    );
    const url = URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err: unknown) {
    downloadError.value = await errorFrom(err);
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
      <RouterLink :to="marketPath(market.id, 'assignment')">Run it again</RouterLink>
      to bring it up to date.
    </p>

    <p v-if="!assigned" class="note" data-testid="result-empty">
      No assignment yet.
      <template v-if="refusal">{{ refusal }}</template>
      <RouterLink :to="marketPath(market.id, 'assignment')">
        {{ refusal ? 'Set the rules' : 'Set the rules and run it' }}
      </RouterLink>
    </p>

    <div v-else class="result-strip" data-testid="result-strip">
      <span class="result-figure" data-testid="result-vendors-placed">
        <strong>{{ statistics?.totalAssignedVendors ?? '…' }}</strong> of
        {{ statistics?.totalVendors ?? '…' }} vendors placed
      </span>
      <span class="result-figure" data-testid="result-tables-used">
        <strong>{{ statistics?.totalAssignedTables ?? '…' }}</strong> of
        {{ statistics?.totalTables ?? '…' }} tables used
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
          :disabled="isDownloading"
          data-testid="result-download-csv-button"
          @click="downloadCsv"
        >
          {{ isDownloading ? 'Downloading…' : 'Download CSV' }}
        </button>
      </span>
    </div>

    <!-- Named and defined where it is shown: it was once a bare "Satisfaction Score" (E12). -->
    <p v-if="assigned" class="result-definition">
      Satisfaction is the share of the dates vendors asked for, and could have had, that they got.
    </p>
    <ResultStatistics v-if="assigned && statisticsOpen && statistics" :statistics="statistics" />
    <p v-if="downloadError" class="result-error" data-testid="result-download-error">
      {{ downloadError }}
    </p>
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
