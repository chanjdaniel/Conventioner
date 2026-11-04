<script setup lang="ts">
/**
 * Every change on a market, newest first: Manage market's History section (E40/F01/S03), and one
 * vendor's in their drawer's History tab (E40/F01/S04).
 *
 * A page at a time - the newest entries, then older ones on "Load more" - inside the dialog's own
 * scrolling, so a market with thousands of changes opens as quickly as one with ten. Narrowed by
 * who, by kind (a group of the table's rows), by vendor and by date; the filters live as long as
 * the dialog holds this section, which is while it is open. Given a `vendor`, it is that vendor's
 * history alone, with no filters: the same entries in the same words, narrowed by the server.
 */
import { computed, ref, useId, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { FormField, IntakeMode, RejectionQuestion } from '@/assets/types/datatypes';
import HistoryEntries from '@/components/HistoryEntries.vue';
import SearchPicker, { type PickerGroup, type PickerOption } from '@/components/SearchPicker.vue';
import { api, getApiErrorMessage } from '@/utils/api';
import { marketPath } from '@/utils/market';
import { findsPerson, PEOPLE_CAP, personOption, vendorOption } from '@/utils/personChoice';
import { useVendorDrawer } from '@/utils/vendorDrawer';
import { vendorMatches, type VendorNames } from '@/utils/vendorIdentity';
import {
  dayEnds,
  dayStarts,
  type HistoryContext,
  type MarketHistoryEntry,
  type MarketHistoryGroup,
} from '@/utils/marketHistory';

const props = defineProps<{
  marketId: string;
  /** The market's own table's labels by row id, Reading rows included, for a change to a row. */
  rowLabels?: Readonly<Record<string, string>>;
  /** How the market's vendors arrive, so a phase reads as its other screens name it. */
  path: IntakeMode;
  /** The market's choice questions (`rejectionQuestions`), so a price group's conditions read in
   *  the card's words (E43/F01/S02). */
  questions?: readonly RejectionQuestion[];
  /** The market's form, whose questions name a vendor's answers in an entry's before and after. */
  fields?: readonly FormField[];
  /** Counts the changes the dialog holding it has made: each reads the first page again, under
   * the filters as they are, so the change shows without reopening the dialog. */
  changesMade?: number;
  /** Only this vendor's entries, for their drawer: the filters are not drawn, and the vendor is
   * named by name alone, as text rather than a link to the drawer that already shows them. */
  vendor?: string | null;
}>();

const ownVendor = computed(() => props.vendor?.trim().toLowerCase() ?? '');

interface HistoryPage {
  entries: MarketHistoryEntry[];
  next: string | null;
  vendorNames: VendorNames;
  actors?: string[];
  groups?: MarketHistoryGroup[];
}

const entries = ref<MarketHistoryEntry[]>([]);
const next = ref<string | null>(null);
const vendorNames = ref<VendorNames>({});
const actors = ref<string[]>([]);
const groups = ref<MarketHistoryGroup[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const loadError = ref('');
/** Counts the first pages read, so a new one draws its entries closed. */
const firstPages = ref(0);

const actor = ref('');
/** "Who": Anyone, the empty value, then everyone who changed something, found by address. */
const whoGroups = computed<PickerGroup[]>(() => [
  { options: [{ value: '', label: 'Anyone' }, ...actors.value.map((a) => personOption(a))] },
]);
const group = ref('');
const vendorText = ref('');
const from = ref('');
const to = ref('');

/**
 * Each row of the table by its label: for a change to a row, and for a change this screen has no
 * words for yet. The market's own table names the Reading rows too, which the groups leave out.
 */
const labels = computed(() => ({
  ...Object.fromEntries(groups.value.flatMap((g) => g.actions.map((a) => [a.id, a.label]))),
  ...props.rowLabels,
}));

/** What the entries' words are given, one input a line. */
const context = computed<HistoryContext>(() => ({
  names: vendorNames.value,
  labels: labels.value,
  path: props.path,
  own: ownVendor.value,
  questions: props.questions,
  fields: props.fields,
}));

/**
 * Every vendor the section knows: those who gave a name, and every address an entry it has loaded
 * names, so a vendor with no name is found by part of their address too.
 */
const seenVendors = ref<Set<string>>(new Set());
const knownVendors = computed(() => [
  ...new Set([...Object.keys(vendorNames.value), ...seenVendors.value]),
]);

function see(page: MarketHistoryEntry[]) {
  const seen = new Set(seenVendors.value);
  for (const entry of page) for (const email of entry.vendors) if (email) seen.add(email);
  seenVendors.value = seen;
}

/** "Vendor": everyone the section knows, each by name beside address, found by either. */
const vendorGroups = computed<PickerGroup[]>(() => [
  { options: knownVendors.value.map((email) => vendorOption(email, vendorNames.value)) },
]);
const findsVendor = (option: PickerOption, words: string): boolean =>
  vendorMatches(words, option.value, vendorNames.value);

/** The market's vendors who answer to what was typed in the vendor filter: name or address. */
const vendorCandidates = computed(() => {
  const typed = vendorText.value.trim();
  if (!typed) return [];
  const known = knownVendors.value;
  const exact = known.find((email) => email === typed.toLowerCase());
  if (exact) return [exact];
  return known.filter((email) => vendorMatches(typed, email, vendorNames.value));
});

/**
 * The vendor the history is narrowed to: the drawer's, the one the filter names, or an address
 * typed whole that no loaded entry names yet; none while it names several or nobody.
 */
const narrowedTo = computed(() => {
  if (ownVendor.value) return ownVendor.value;
  const typed = vendorText.value.trim();
  if (vendorCandidates.value.length === 1) return vendorCandidates.value[0];
  if (!vendorCandidates.value.length && typed.includes('@')) return typed.toLowerCase();
  return '';
});

/** Typed text that names no vendor at all: the filter matches nothing, and nothing is asked. */
const vendorMatchesNobody = computed(
  () => !!vendorText.value.trim() && !narrowedTo.value && !vendorCandidates.value.length,
);

const vendorHint = computed(() =>
  vendorCandidates.value.length > 1 && !narrowedTo.value
    ? `${vendorCandidates.value.length} vendors match. Keep typing, or choose one.`
    : '',
);

const vendorHintId = useId();

const filters = computed(() => ({
  actor: actor.value,
  group: group.value,
  vendor: narrowedTo.value,
  since: from.value ? dayStarts(from.value) : '',
  until: to.value ? dayEnds(to.value) : '',
}));

const filtered = computed(
  () => !!(actor.value || group.value || vendorText.value.trim() || from.value || to.value),
);

async function read(before: string | null): Promise<HistoryPage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters.value)) if (value) query.set(key, value);
  if (before) query.set('before', before);
  const asked = query.toString();
  const response = await api.get<HistoryPage>(
    `/markets/${encodeURIComponent(props.marketId)}/history${asked ? `?${asked}` : ''}`,
  );
  return response.data;
}

/** The first page, under the filters as they are; a page asked for before it is dropped. */
let asking = 0;
async function load(): Promise<void> {
  const mine = ++asking;
  loadError.value = '';
  if (vendorMatchesNobody.value) {
    entries.value = [];
    next.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const page = await read(null);
    // What the market's vendors and people are holds whatever the page was narrowed by, so a page
    // asked for before a filter changed still tells the filter who it may name: a vendor typed
    // while the first page was on its way is found once it lands.
    see(page.entries ?? []);
    vendorNames.value = page.vendorNames ?? {};
    actors.value = page.actors ?? [];
    groups.value = page.groups ?? [];
    if (mine !== asking) return;
    entries.value = page.entries ?? [];
    next.value = page.next ?? null;
    firstPages.value++;
  } catch (err) {
    if (mine !== asking) return;
    loadError.value = getApiErrorMessage(err, 'The history could not be loaded.');
    entries.value = [];
    next.value = null;
  } finally {
    if (mine === asking) loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  if (!next.value || loadingMore.value) return;
  const mine = asking;
  loadingMore.value = true;
  loadError.value = '';
  try {
    const page = await read(next.value);
    if (mine !== asking) return;
    entries.value = [...entries.value, ...(page.entries ?? [])];
    see(page.entries ?? []);
    next.value = page.next ?? null;
    vendorNames.value = { ...vendorNames.value, ...(page.vendorNames ?? {}) };
  } catch (err) {
    if (mine !== asking) return;
    loadError.value = getApiErrorMessage(err, 'Older changes could not be loaded.');
  } finally {
    loadingMore.value = false;
  }
}

watch(() => props.marketId, load, { immediate: true });
watch(() => props.changesMade, load);
watch(() => [JSON.stringify(filters.value), vendorMatchesNobody.value], load);

function clearFilters() {
  actor.value = '';
  group.value = '';
  vendorText.value = '';
  from.value = '';
  to.value = '';
}

function vendorLink(email: string) {
  return { path: marketPath(props.marketId, 'vendors'), query: { vendor: email.toLowerCase() } };
}

/**
 * In a vendor's drawer on the Vendors page, another vendor an entry names opens in the same drawer
 * (E38/F13/S01): following the link would push a step of its own, so one Back would no longer close
 * the drawer. On any other page the link leads to Vendors, a page of its own.
 */
const route = useRoute();
const router = useRouter();
const drawer = useVendorDrawer();
const openVendor = computed(() =>
  ownVendor.value && route?.path === router?.resolve(marketPath(props.marketId, 'vendors')).path
    ? (email: string) => drawer.open(email)
    : undefined,
);

const emptyText = computed(() => {
  if (ownVendor.value) return 'Nothing has been recorded about this vendor yet.';
  return filtered.value
    ? 'No change matches these filters.'
    : 'Nothing has changed on this market yet.';
});
</script>

<template>
  <div class="market-history" data-testid="market-history">
    <div v-if="!ownVendor" class="history-filters">
      <SearchPicker
        v-model="actor"
        class="history-filter history-who"
        :groups="whoGroups"
        :finds="findsPerson"
        :cap="PEOPLE_CAP"
        holds-choice
        list-over
        label="Who"
        placeholder="Type an address…"
        testid="market-history-who"
      />
      <label class="history-filter">
        <span class="field-label">Kind of change</span>
        <select v-model="group" class="field field--select" data-testid="market-history-kind">
          <option value="">Every kind</option>
          <option v-for="g in groups" :key="g.group" :value="g.group">{{ g.group }}</option>
        </select>
      </label>
      <SearchPicker
        v-model="vendorText"
        class="history-filter history-filter--vendor"
        :groups="vendorGroups"
        :finds="findsVendor"
        :cap="PEOPLE_CAP"
        :described-by="vendorHint ? vendorHintId : undefined"
        accepts-typed
        words-are-value
        list-over
        label="Vendor"
        placeholder="Name or email"
        testid="market-history-vendor"
      />
      <label class="history-filter">
        <span class="field-label">From</span>
        <input
          v-model="from"
          type="date"
          class="field"
          :max="to || undefined"
          data-testid="market-history-from"
        />
      </label>
      <label class="history-filter">
        <span class="field-label">To</span>
        <input
          v-model="to"
          type="date"
          class="field"
          :min="from || undefined"
          data-testid="market-history-to"
        />
      </label>
    </div>
    <div v-if="vendorHint || filtered" class="history-filter-notes">
      <p
        v-if="vendorHint"
        :id="vendorHintId"
        class="history-note"
        data-testid="market-history-vendor-hint"
      >
        {{ vendorHint }}
      </p>
      <button
        v-if="filtered"
        type="button"
        class="btn btn--secondary btn--compact"
        data-testid="market-history-clear"
        @click="clearFilters"
      >
        Clear filters
      </button>
    </div>

    <p v-if="loading" class="history-note">Loading…</p>
    <p
      v-else-if="loadError && !entries.length"
      class="form-error"
      data-testid="market-history-error"
    >
      {{ loadError }}
    </p>
    <p v-else-if="!entries.length" class="history-note" data-testid="market-history-empty">
      {{ emptyText }}
    </p>

    <HistoryEntries
      v-if="!loading && entries.length"
      :key="firstPages"
      :entries="entries"
      testid="market-history"
      :context="context"
      :vendor-link="vendorLink"
      :open-vendor="openVendor"
    />

    <p v-if="loadError && entries.length" class="form-error" data-testid="market-history-error">
      {{ loadError }}
    </p>
    <button
      v-if="!loading && next"
      type="button"
      class="btn btn--secondary history-more"
      :disabled="loadingMore"
      data-testid="market-history-load-more"
      @click="loadMore"
    >
      {{ loadingMore ? 'Loading…' : 'Load more' }}
    </button>
  </div>
</template>

<style scoped>
.market-history {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* Two columns: who and kind, the vendor across both, then the range's two ends side by side. */
.history-filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2) var(--space-3);
}

.history-filter {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.history-filter--vendor {
  grid-column: 1 / -1;
}

/* As wide as both columns, the gap between them included, so a phone reads an address on one line. */
.history-who :deep(.search-picker-list) {
  width: calc(200% + var(--space-3));
}

.history-filter-notes {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.history-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.form-error {
  margin: 0;
  color: var(--mm-red);
  font-size: var(--text-xs);
}

.history-more {
  align-self: flex-start;
}
</style>
