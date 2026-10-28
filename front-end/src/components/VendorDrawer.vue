<script setup lang="ts">
/**
 * One vendor, wherever a vendor appears (E35/F01/S01): the Vendors list, a seat in the results, an
 * attendance entry, the bulk review.
 *
 * Their notes are pinned at the top - what the organizer knows and did about them reads on every
 * tab - and below them three tabs: Application (the submission), Assignments (their seats, each one
 * click from changing) and History (who moved them, when). The drawer used to stack all of it on the
 * Vendors page alone, with the assignments and the history at the bottom where nobody found them.
 *
 * The screen that opens it holds which vendor and which tab - in the address, so a link, a refresh
 * or Back returns to the same panel - and hands it the market's vendors (`useVendorDetails`).
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { Market } from '@/assets/types/datatypes';
import { marketPath } from '@/utils/market';
import { TABLE_SHARE_ANSWER_KEY } from '@/utils/essentialFields';
import { dateLabel, type VendorDetails } from '@/utils/vendorDetails';
import { vendorHeadline, vendorName } from '@/utils/vendorIdentity';
import type { VendorTab } from '@/utils/vendorDrawer';
import { hasNotes, useVendorNotes } from '@/utils/vendorNotes';
import { useEscapeToClose } from '@/utils/useEscapeToClose';
import { useInertBehind } from '@/utils/useInertBehind';
import AnswerValue from '@/components/AnswerValue.vue';
import PlacementHistory from '@/components/PlacementHistory.vue';
import TableShareNotice from '@/components/TableShareNotice.vue';
import VendorDateCard from '@/components/VendorDateCard.vue';
import VendorNotes from '@/components/VendorNotes.vue';

const TABS: readonly { id: VendorTab; label: string }[] = [
  { id: 'application', label: 'Application' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'history', label: 'History' },
];

const props = defineProps<{
  market: Market | null | undefined;
  details: VendorDetails;
  /** The vendor shown, or null while the drawer is closed. */
  email: string | null;
  tab: VendorTab;
}>();

const emit = defineEmits<{
  close: [];
  'update:tab': [tab: VendorTab];
  /** Their notes were written: a screen that shows notes reads them again. */
  notesChanged: [];
}>();

const router = useRouter();
const marketId = computed(() => props.market?.id ?? '');
const open = computed(() => props.email !== null);
const vendor = computed(() => (props.email ? props.details.rowFor(props.email) : null));
const names = computed(() => props.details.vendorNames.value);
const submission = computed(() => (vendor.value ? props.details.submission(vendor.value) : []));

const { load: loadNotes, entryFor } = useVendorNotes(marketId);
const writesNotes = computed(() => !!props.market && !props.market.readOnlyReason);
const showNotes = computed(
  () => !!props.email && (writesNotes.value || hasNotes(entryFor(props.email))),
);

// The market's vendors and notes are read the first time the drawer opens on a screen that had no
// call for them before.
watch(
  open,
  (opened) => {
    if (!opened) return;
    if (!props.details.loaded.value && !props.details.isLoading.value) void props.details.load();
    void loadNotes();
  },
  { immediate: true },
);

function notesChanged() {
  void loadNotes();
  emit('notesChanged');
}

/** The notes as the drawer holds them, for a screen that writes one from beside it (E34/F02/S01). */
defineExpose({ entryFor, loadNotes });

/**
 * Where to change this vendor's seat on a date; null where nothing can be changed (bug 30). The
 * results open searched to them on that date, so their table is the one shown (E35/F02/S02).
 */
function resultLinkFor(date: string): string | null {
  const id = props.market?.id;
  if (!id || !props.email || props.market?.readOnlyReason) return null;
  const query = new URLSearchParams({ date, search: props.email });
  return `${marketPath(id, 'result')}?${query.toString()}`;
}

function goToResult(date: string): void {
  const href = resultLinkFor(date);
  if (href) void router.push(href);
}

/** The tab list moves with the arrow keys, as a tab list does. */
const tabButtons = ref<HTMLButtonElement[]>([]);
function onTabKey(event: KeyboardEvent) {
  const at = TABS.findIndex((t) => t.id === props.tab);
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (!step) return;
  event.preventDefault();
  const next = TABS[(at + step + TABS.length) % TABS.length];
  emit('update:tab', next.id);
  void nextTick(() => tabButtons.value[TABS.indexOf(next)]?.focus());
}

useEscapeToClose(
  () => open.value,
  () => emit('close'),
);

/**
 * The drawer is modal, so the rest of the page is out of play while it is open - to the keyboard as
 * well as to the mouse. The scrim only ever stopped the mouse (E14/F02/S02).
 */
const overlay = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
useInertBehind(
  () => open.value,
  () => [overlay.value, panel.value],
);
</script>

<template>
  <div
    ref="overlay"
    class="detail-overlay"
    data-testid="vendors-detail-overlay"
    :class="{ 'detail-overlay--open': open }"
    @click="emit('close')"
  />

  <aside
    ref="panel"
    class="detail-panel"
    data-testid="vendors-detail-panel"
    :class="{ 'detail-panel--open': open }"
    role="dialog"
    aria-modal="true"
    aria-labelledby="vendor-drawer-title"
    :aria-hidden="!open"
    @click.stop
  >
    <div v-if="open && email" class="detail-content">
      <div class="detail-header">
        <div class="detail-title-wrap">
          <span class="detail-eyebrow">Vendor detail</span>
          <h2 id="vendor-drawer-title" class="detail-title">{{ vendorHeadline(email, names) }}</h2>
          <!-- The address always, beneath the name: it is what ties this panel to a check-in,
               a CSV row and an application, and two vendors can share a name. -->
          <p
            v-if="vendorName(email, names)"
            class="detail-subtitle"
            data-testid="vendors-detail-email"
          >
            {{ vendor?.displayEmail ?? email }}
          </p>
          <p v-if="vendor?.verdict" class="detail-subtitle" data-testid="vendors-detail-giver">
            {{ vendor.verdict }}
          </p>
        </div>
        <button
          type="button"
          class="detail-close"
          aria-label="Close vendor detail"
          @click="emit('close')"
          data-testid="vendors-detail-close"
        >
          &times;
        </button>
      </div>

      <!-- What the screen that opened it offers here: the review's verdicts (E34/F04/S01). -->
      <slot name="actions" />

      <!-- Pinned above the tabs: what the organizer knows reads on every tab. A reader with nothing
           noted sees no empty band for it. -->
      <section v-if="showNotes" class="detail-section">
        <VendorNotes
          :marketId="marketId"
          :email="email"
          :entry="entryFor(email)"
          :canWrite="writesNotes"
          open
          testid="vendors-detail-notes"
          @changed="notesChanged"
        />
      </section>

      <div class="detail-tabs" role="tablist" aria-label="Vendor detail" @keydown="onTabKey">
        <button
          v-for="t in TABS"
          :id="`vendor-drawer-tab-${t.id}`"
          :key="t.id"
          ref="tabButtons"
          type="button"
          role="tab"
          class="detail-tab"
          :class="{ 'detail-tab--current': t.id === tab }"
          :aria-selected="t.id === tab"
          :aria-controls="`vendor-drawer-panel-${t.id}`"
          :tabindex="t.id === tab ? 0 : -1"
          :data-testid="`vendor-drawer-tab-${t.id}`"
          @click="emit('update:tab', t.id)"
        >
          {{ t.label }}
        </button>
      </div>

      <section
        :id="`vendor-drawer-panel-${tab}`"
        role="tabpanel"
        :aria-labelledby="`vendor-drawer-tab-${tab}`"
        class="detail-panel-body"
        :data-testid="`vendor-drawer-panel-${tab}`"
      >
        <p v-if="details.isLoading.value && !vendor" class="detail-empty">Loading…</p>

        <template v-else-if="tab === 'application'">
          <div v-if="vendor?.tableShareNotice" class="detail-section">
            <TableShareNotice
              :notice="vendor.tableShareNotice"
              :words="String(vendor.answers[TABLE_SHARE_ANSWER_KEY] ?? '')"
              testid="vendors-detail-table-share-notice"
            />
          </div>
          <div class="detail-section">
            <h3 class="detail-section-title">Submission</h3>
            <dl v-if="submission.length" class="detail-grid">
              <template v-for="field in submission" :key="field.label">
                <dt>{{ field.label }}</dt>
                <!-- Through AnswerValue, as every answer is, so an address is a link (E28/F04/S03). -->
                <dd><AnswerValue :value="field.value" /></dd>
              </template>
            </dl>
            <p v-else class="detail-empty">This market asks no questions of its own.</p>
          </div>
        </template>

        <div v-else-if="tab === 'assignments'" class="detail-section">
          <div v-if="details.marketDates.value.length === 0" class="detail-empty">
            No market dates configured.
          </div>
          <ul v-else-if="vendor" class="assignment-list">
            <VendorDateCard
              v-for="date in details.marketDates.value"
              :key="date.date"
              :data-date="date.date"
              :label="dateLabel(date.date)"
              :placement="details.placementOn(vendor, date.date)"
              :reason="details.reasonFor(email, date.date)"
              :overrides="details.overridesFor(email, date.date)"
              :placeHref="resultLinkFor(date.date)"
              :orphaned="details.isOrphaned(email, date.date)"
              @place="goToResult(date.date)"
            />
          </ul>
        </div>

        <!-- Who moved this vendor, and when. A placement that differs from what the solver
             produced is a fact someone will later ask about (E11/F04/S01). -->
        <div v-else class="detail-section">
          <PlacementHistory v-if="market?.id" :marketId="market.id" :vendor="email" />
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.detail-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  opacity: 0;
  visibility: hidden;
  z-index: 50;
  transition:
    opacity 0.2s ease-in-out,
    visibility 0.2s ease-in-out;
}

.detail-overlay--open {
  opacity: 1;
  visibility: visible;
}

.detail-panel {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: min(480px, 92vw);
  background: white;
  box-shadow: var(--shadow-card);
  transform: translateX(100%);
  transition: transform 0.25s ease-in-out;
  z-index: 60;
  display: flex;
  flex-direction: column;
}

.detail-panel--open {
  transform: translateX(0);
}

.detail-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.detail-header {
  position: sticky;
  top: 0;
  background: var(--mm-black);
  color: white;
  padding: var(--space-4) var(--space-6);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  z-index: 1;
}

.detail-title-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.detail-eyebrow {
  font-size: var(--text-xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.7;
}

.detail-title {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  color: white;
  overflow-wrap: anywhere;
}

/* The panel head is dark, so the muted-on-dark token rather than the on-white one. */
.detail-subtitle {
  margin: var(--space-hairline) 0 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted-on-dark);
  overflow-wrap: anywhere;
}

.detail-close {
  flex-shrink: 0;
  min-width: var(--target-min);
  min-height: var(--target-min);
  background: transparent;
  border: none;
  color: white;
  font-size: var(--text-2xl);
  line-height: 1;
  cursor: pointer;
  padding: 0 var(--space-1);
  border-radius: var(--radius-control);
  transition: background-color 0.15s ease-in-out;
}

.detail-close:hover {
  background: rgba(255, 255, 255, 0.12);
}

.detail-section {
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--mm-border);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.detail-panel-body .detail-section:last-child {
  border-bottom: none;
}

/* The tabs sit under the pinned notes, a row of their own across the panel. */
.detail-tabs {
  display: flex;
  gap: var(--space-1);
  padding: 0 var(--space-6);
  border-bottom: 1px solid var(--mm-border);
}

.detail-tab {
  padding: var(--space-3) var(--space-2);
  border: none;
  border-bottom: 2px solid transparent;
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- a border's width, not spacing: the underline lies over the strip's rule */
  margin-bottom: -1px;
  background: none;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
  cursor: pointer;
}

.detail-tab:hover {
  color: var(--mm-black);
}

.detail-tab:focus-visible {
  outline: 2px solid var(--mm-black);
  outline-offset: -2px;
}

.detail-tab--current {
  border-bottom-color: var(--mm-green);
  color: var(--mm-black);
  font-weight: 600;
}

.detail-section-title {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-md);
  color: var(--mm-black);
  padding-bottom: var(--space-2);
  border-bottom: 2px solid var(--mm-border);
}

.detail-grid {
  margin: 0;
  display: grid;
  grid-template-columns: minmax(120px, 0.6fr) 1fr;
  gap: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.detail-grid dt {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-xs);
  color: var(--mm-black);
  opacity: 0.75;
  align-self: start;
  padding-top: var(--space-hairline);
}

.detail-grid dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.detail-empty {
  margin: 0;
  padding: var(--space-4) var(--space-6);
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.detail-section .detail-empty {
  padding: 0;
}

.assignment-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
