<script setup lang="ts">
/**
 * PROTOTYPE - THROWAWAY. Not production code.
 *
 * Three variants of the application review queue, switchable via `?variant=` on the existing
 * /market-setup Applications tab, answering ticket 04: "What must a reviewer see to decide on an
 * application?" (.scratch/wayfinding/real-market-readiness/issues/04-what-a-reviewer-needs-to-decide.md)
 *
 * Read-only: Approve/Reject mutate local state only, so flipping variants cannot damage data.
 *
 *   A - Ledger:  a dense table, checkbox selection, bulk action on the selection.
 *   B - Triage:  one application at a time, full answers, keyboard-driven.
 *   C - Sweep:   no selection model at all; narrow with filters, act on the whole filtered set.
 *
 * They disagree about the primary affordance on purpose: picking rows, deciding one case, or
 * narrowing a population.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Application, Market } from '@/assets/types/datatypes';
import { fetchMarketApplications } from '@/utils/applicantApi';

const props = defineProps<{ market: Market | null; visible: boolean }>();

/** Self-contained on purpose: the prototype must not perturb ApplicationMonitor's own state. */
const applications = ref<Application[]>([]);
const loading = ref(false);
watch(
  () => [props.visible, props.market] as const,
  async ([visible]) => {
    if (!visible || !props.market) return;
    loading.value = true;
    try {
      applications.value = await fetchMarketApplications(props.market.id);
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

const VARIANTS = [
  { key: 'A', name: 'Ledger - table + selection' },
  { key: 'B', name: 'Triage - one at a time' },
  { key: 'C', name: 'Sweep - filter, then act on all' },
];

function currentVariant(): string {
  const v = new URLSearchParams(window.location.search).get('variant')?.toUpperCase();
  return VARIANTS.some((x) => x.key === v) ? (v as string) : 'A';
}
const variant = ref(currentVariant());

function setVariant(key: string) {
  variant.value = key;
  const url = new URL(window.location.href);
  url.searchParams.set('variant', key);
  window.history.replaceState({}, '', url);
}
function cycle(step: number) {
  const i = VARIANTS.findIndex((v) => v.key === variant.value);
  setVariant(VARIANTS[(i + step + VARIANTS.length) % VARIANTS.length].key);
}
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
  if (e.key === 'ArrowLeft') cycle(-1);
  if (e.key === 'ArrowRight') cycle(1);
  if (variant.value === 'B') {
    if (e.key === 'a' || e.key === 'A') decideCurrent('reviewer_approved');
    if (e.key === 'r' || e.key === 'R') decideCurrent('reviewer_rejected');
    if (e.key === 's' || e.key === 'S')
      cursor.value = Math.min(cursor.value + 1, rows.value.length - 1);
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));

/** Local verdicts, so the prototype never writes. */
const verdicts = ref<Record<string, string>>({});
function statusOf(a: Application): string {
  return verdicts.value[a.id] ?? a.status ?? 'open';
}
function decide(a: Application, status: string) {
  verdicts.value = { ...verdicts.value, [a.id]: status };
}

/**
 * What the reviewer is actually deciding on. This is the finding the ticket exists for: the real
 * card shows only an email, so there is nothing here to judge. Essential answers come from the
 * market plan; custom answers are whatever the organizer asked.
 */
const ESSENTIAL_LABELS: Record<string, string> = {
  essential_available_dates: 'Available',
  essential_max_dates: 'Wants',
  essential_tier_preference: 'Tiers',
  essential_table_choice: 'Table',
  essential_section_ranking: 'Sections',
  essential_table_share_email: 'Shares with',
};

function answers(a: Application): Array<{ label: string; value: string; custom: boolean }> {
  const data = (a.formData ?? {}) as Record<string, unknown>;
  const out: Array<{ label: string; value: string; custom: boolean }> = [];
  for (const [key, value] of Object.entries(data)) {
    const custom = !key.startsWith('essential_');
    const label = custom ? key.replace(/_/g, ' ') : (ESSENTIAL_LABELS[key] ?? key);
    const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
    if (text.trim()) out.push({ label, value: text, custom });
  }
  return out.sort((x, y) => Number(y.custom) - Number(x.custom));
}

function shortDate(a: Application): string {
  const raw = String(a.submittedAt ?? '');
  return raw.split(' ')[0] || '-';
}

const rows = computed(() => applications.value);
const counts = computed(() => {
  const c: Record<string, number> = { open: 0, reviewer_approved: 0, reviewer_rejected: 0 };
  for (const a of rows.value) c[statusOf(a)] = (c[statusOf(a)] ?? 0) + 1;
  return c;
});

/* ── A: ledger ─────────────────────────────────────────────────────────── */
const selected = ref<Set<string>>(new Set());
const allSelected = computed(
  () => rows.value.length > 0 && selected.value.size === rows.value.length,
);
function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(rows.value.map((a) => a.id));
}
function toggleOne(id: string) {
  const next = new Set(selected.value);
  next.has(id) ? next.delete(id) : next.add(id);
  selected.value = next;
}
function bulkSelected(status: string) {
  const next = { ...verdicts.value };
  for (const id of selected.value) next[id] = status;
  verdicts.value = next;
  selected.value = new Set();
}

/* ── B: triage ─────────────────────────────────────────────────────────── */
const cursor = ref(0);
const undecided = computed(() => rows.value.filter((a) => statusOf(a) === 'open'));
const currentCard = computed(
  () => undecided.value[Math.min(cursor.value, undecided.value.length - 1)],
);
function decideCurrent(status: string) {
  if (currentCard.value) decide(currentCard.value, status);
}

/* ── C: sweep ──────────────────────────────────────────────────────────── */
const search = ref('');
const tierFilter = ref('');
const statusFilter = ref('open');
const tiers = computed(() => props.market?.setupObject?.tiers?.map((t) => t.name) ?? []);
const filtered = computed(() =>
  rows.value.filter((a) => {
    if (statusFilter.value && statusOf(a) !== statusFilter.value) return false;
    if (tierFilter.value) {
      const t = (a.formData as Record<string, unknown>)?.essential_tier_preference;
      if (!Array.isArray(t) || !t.includes(tierFilter.value)) return false;
    }
    if (search.value) {
      const hay = JSON.stringify(a).toLowerCase();
      if (!hay.includes(search.value.toLowerCase())) return false;
    }
    return true;
  }),
);
function sweep(status: string) {
  const next = { ...verdicts.value };
  for (const a of filtered.value) next[a.id] = status;
  verdicts.value = next;
}
</script>

<template>
  <div class="proto">
    <p class="proto-banner">
      PROTOTYPE - ticket 04. Verdicts are local only; nothing is written. Use ← → or the bar below
      to switch variants. <span v-if="loading">Loading…</span>
    </p>

    <!-- ── A: Ledger ─────────────────────────────────────────────────── -->
    <section v-if="variant === 'A'" class="v">
      <header class="v-head">
        <h3>{{ rows.length }} applications</h3>
        <span class="tally">
          {{ counts.open }} awaiting · {{ counts.reviewer_approved }} approved ·
          {{ counts.reviewer_rejected }} rejected
        </span>
      </header>
      <div class="bulkbar" :class="{ armed: selected.size > 0 }">
        <label
          ><input type="checkbox" :checked="allSelected" @change="toggleAll" /> Select all</label
        >
        <span>{{ selected.size }} selected</span>
        <button :disabled="!selected.size" @click="bulkSelected('reviewer_approved')">
          Approve {{ selected.size || '' }}
        </button>
        <button
          :disabled="!selected.size"
          class="danger"
          @click="bulkSelected('reviewer_rejected')"
        >
          Reject {{ selected.size || '' }}
        </button>
      </div>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Applicant</th>
              <th>What they answered</th>
              <th>Submitted</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in rows.slice(0, 60)" :key="a.id" :class="{ sel: selected.has(a.id) }">
              <td>
                <input type="checkbox" :checked="selected.has(a.id)" @change="toggleOne(a.id)" />
              </td>
              <td class="email">{{ a.applicantEmail }}</td>
              <td class="ans">
                <span v-for="f in answers(a).slice(0, 4)" :key="f.label" class="chip">
                  <b>{{ f.label }}:</b> {{ f.value.slice(0, 28) }}
                </span>
              </td>
              <td class="num">{{ shortDate(a) }}</td>
              <td>
                <span class="pill" :class="statusOf(a)">{{ statusOf(a) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="rows.length > 60" class="more">…{{ rows.length - 60 }} more (paging not built)</p>
      </div>
    </section>

    <!-- ── B: Triage ─────────────────────────────────────────────────── -->
    <section v-else-if="variant === 'B'" class="v">
      <header class="v-head">
        <h3>{{ Math.min(cursor + 1, undecided.length) }} of {{ undecided.length }} to review</h3>
        <span class="tally"
          >{{ counts.reviewer_approved }} approved · {{ counts.reviewer_rejected }} rejected</span
        >
      </header>
      <div v-if="currentCard" class="card">
        <div class="card-id">{{ currentCard.applicantEmail }}</div>
        <dl class="card-answers">
          <template v-for="f in answers(currentCard)" :key="f.label">
            <dt>{{ f.label }}</dt>
            <dd>{{ f.value }}</dd>
          </template>
        </dl>
        <p v-if="!answers(currentCard).length" class="nothing">
          This market's form asked nothing but an email, so there is nothing here to decide on.
        </p>
        <div class="card-actions">
          <button class="danger" @click="decideCurrent('reviewer_rejected')">
            Reject <kbd>R</kbd>
          </button>
          <button @click="cursor = Math.min(cursor + 1, undecided.length - 1)">
            Skip <kbd>S</kbd>
          </button>
          <button class="primary" @click="decideCurrent('reviewer_approved')">
            Approve <kbd>A</kbd>
          </button>
        </div>
      </div>
      <p v-else class="done">Nothing left to review.</p>
    </section>

    <!-- ── C: Sweep ──────────────────────────────────────────────────── -->
    <section v-else class="v">
      <header class="v-head">
        <h3>{{ filtered.length }} of {{ rows.length }} match</h3>
        <span class="tally">{{ counts.open }} awaiting review</span>
      </header>
      <div class="filters">
        <input v-model="search" placeholder="Search any answer…" />
        <select v-model="tierFilter">
          <option value="">Any tier</option>
          <option v-for="t in tiers" :key="t" :value="t">{{ t }}</option>
        </select>
        <select v-model="statusFilter">
          <option value="open">Awaiting review</option>
          <option value="reviewer_approved">Approved</option>
          <option value="reviewer_rejected">Rejected</option>
          <option value="">Any status</option>
        </select>
      </div>
      <div class="sweepbar">
        <span
          >Act on <b>all {{ filtered.length }}</b> matching:</span
        >
        <button :disabled="!filtered.length" @click="sweep('reviewer_approved')">
          Approve all {{ filtered.length }}
        </button>
        <button :disabled="!filtered.length" class="danger" @click="sweep('reviewer_rejected')">
          Reject all {{ filtered.length }}
        </button>
      </div>
      <ul class="sweeplist">
        <li v-for="a in filtered.slice(0, 40)" :key="a.id">
          <span class="email">{{ a.applicantEmail }}</span>
          <span v-for="f in answers(a).slice(0, 3)" :key="f.label" class="chip">
            <b>{{ f.label }}:</b> {{ f.value.slice(0, 24) }}
          </span>
          <span class="pill" :class="statusOf(a)">{{ statusOf(a) }}</span>
        </li>
      </ul>
      <p v-if="filtered.length > 40" class="more">…{{ filtered.length - 40 }} more</p>
    </section>

    <!-- Switcher: deliberately not in the app's design language. -->
    <div class="switcher">
      <button @click="cycle(-1)">←</button>
      <span>{{ variant }} — {{ VARIANTS.find((v) => v.key === variant)?.name }}</span>
      <button @click="cycle(1)">→</button>
    </div>
  </div>
</template>

<style scoped>
.proto {
  width: 100%;
  font-family: 'Outfit Regular', sans-serif;
}
.proto-banner {
  background: #fdf7ec;
  border: 1px solid var(--mm-yellow, #e4a629);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  margin: 0 0 16px;
}
.v-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.v-head h3 {
  font-family: 'Merge One', sans-serif;
  font-size: 20px;
  margin: 0;
}
.tally {
  font-size: 13px;
  color: rgba(39, 35, 35, 0.6);
}
button {
  border: none;
  border-radius: 6px;
  padding: 8px 14px;
  background: var(--mm-green, #49b096);
  color: #fff;
  font-family: inherit;
  font-size: 14px;
}
button:disabled {
  opacity: 0.45;
}
button.danger {
  background: #c0392b;
}
button.primary {
  background: var(--mm-green, #49b096);
}
.bulkbar,
.sweepbar,
.filters {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid rgba(39, 35, 35, 0.15);
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 14px;
}
.bulkbar.armed {
  background: #eef8f5;
  border-color: var(--mm-green, #49b096);
}
.filters input,
.filters select {
  padding: 7px 10px;
  border: 1px solid rgba(39, 35, 35, 0.25);
  border-radius: 6px;
  font-family: inherit;
  font-size: 14px;
}
.filters input {
  flex: 1;
  min-width: 180px;
}
.tablewrap {
  overflow-x: auto;
  border: 1px solid rgba(39, 35, 35, 0.15);
  border-radius: 8px;
}
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}
th,
td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid #eee;
  vertical-align: top;
}
th {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(39, 35, 35, 0.6);
  background: #faf9f8;
  white-space: nowrap;
}
tr.sel td {
  background: #eef8f5;
}
.email {
  font-weight: 500;
  white-space: nowrap;
}
.ans {
  min-width: 0;
}
.chip {
  display: inline-block;
  background: #f4f2f0;
  border-radius: 20px;
  padding: 2px 9px;
  margin: 0 4px 3px 0;
  font-size: 12px;
}
.chip b {
  font-weight: 600;
}
.num {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.pill {
  display: inline-block;
  border-radius: 20px;
  padding: 2px 9px;
  font-size: 11px;
  background: #e3e3e3;
  white-space: nowrap;
}
.pill.reviewer_approved {
  background: #d6f0e4;
  color: #1e7a4f;
}
.pill.reviewer_rejected {
  background: #fadbd6;
  color: #a3271a;
}
.card {
  border: 1px solid rgba(39, 35, 35, 0.15);
  border-radius: 12px;
  padding: 22px;
  max-width: 680px;
}
.card-id {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 14px;
}
.card-answers {
  display: grid;
  grid-template-columns: minmax(0, 160px) minmax(0, 1fr);
  gap: 6px 18px;
  margin: 0 0 20px;
  font-size: 14px;
}
.card-answers dt {
  color: rgba(39, 35, 35, 0.6);
}
.card-answers dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.nothing {
  background: #fdf1ef;
  border-left: 3px solid #c0392b;
  padding: 10px 14px;
  font-size: 14px;
}
.card-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
kbd {
  background: rgba(255, 255, 255, 0.25);
  border-radius: 4px;
  padding: 0 5px;
  font-size: 11px;
  margin-left: 5px;
}
.sweeplist {
  list-style: none;
  margin: 0;
  padding: 0;
}
.sweeplist li {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 7px 10px;
  border-bottom: 1px solid #f0eeec;
  font-size: 13px;
}
.more,
.done {
  font-size: 13px;
  color: rgba(39, 35, 35, 0.5);
  padding: 10px 2px;
}
.switcher {
  position: fixed;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 10px;
  background: #111;
  color: #fff;
  border-radius: 999px;
  padding: 8px 14px;
  font-size: 13px;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.35);
}
.switcher button {
  background: #333;
  padding: 3px 10px;
  border-radius: 999px;
}
</style>
