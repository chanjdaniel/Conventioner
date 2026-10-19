<script setup lang="ts">
/**
 * Every application at once (E34/F04/S01), beside the one-by-one review.
 *
 * A row is an application: who, the answers a reviewer reads first, its status, who gave it, and who
 * holds it open. Filtered by status - follow-ups among them - and by Mine, the follow-ups the viewer
 * owns, all in the address. A row opens the vendor drawer, which carries Approve, Reject and Needs
 * follow-up while the market is still deciding, each written only on what the reviewer saw.
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import {
  ApplicationStatus,
  MarketPhase,
  type Application,
  type Market,
} from '@/assets/types/datatypes';
import { changedSinceSeen, fetchMarketApplications, reviewApplication } from '@/utils/applicantApi';
import { getApiErrorMessage } from '@/utils/api';
import { FULL_NAME_KEY, PREFERRED_NAME_KEY } from '@/utils/essentialFields';
import {
  ALL_VIEW_FILTERS,
  allViewApplications,
  allViewFilter,
  reviewAnswers,
  reviewQueue,
} from '@/utils/reviewQueue';
import { signedInEmail } from '@/utils/signedIn';
import { useVendorDetails } from '@/utils/vendorDetails';
import { useVendorDrawer } from '@/utils/vendorDrawer';
import { saveVendorNote } from '@/utils/vendorNotes';
import { statusLabel, verdictGiverLine } from '@/utils/verdicts';
import FollowUpDialog from '@/components/application/FollowUpDialog.vue';
import VendorDrawer from '@/components/VendorDrawer.vue';

const props = defineProps<{ market: Market | null }>();
/** What is still to decide, follow-ups included, for the page's own line about it. */
const emit = defineEmits<{ 'update:undecidedCount': [count: number] }>();

const route = useRoute();
const router = useRouter();
const marketId = computed(() => props.market?.id ?? '');

const applications = ref<Application[]>([]);
const loading = ref(false);
const errorMessage = ref('');

async function load() {
  if (!marketId.value) return;
  loading.value = true;
  errorMessage.value = '';
  try {
    applications.value = await fetchMarketApplications(marketId.value);
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to load applications');
  } finally {
    loading.value = false;
  }
}
watch(marketId, () => void load(), { immediate: true });

/** The status filter and Mine, in the address beside the view itself. */
const filter = computed(() => allViewFilter(route.query.status));
const mine = computed(() => route.query.mine === '1');
const me = computed(() => signedInEmail() ?? '');

function setQuery(change: Record<string, string | null>) {
  const query: LocationQuery = { ...route.query };
  for (const [key, value] of Object.entries(change)) {
    if (value === null) delete query[key];
    else query[key] = value;
  }
  void router.replace({ query });
}

watch(
  () => reviewQueue(applications.value, true).length,
  (count) => emit('update:undecidedCount', count),
);

const shown = computed(() =>
  allViewApplications(applications.value, filter.value, mine.value, me.value),
);

function nameOf(app: Application): string {
  const answers = app.formData ?? {};
  return String(answers[PREFERRED_NAME_KEY] || answers[FULL_NAME_KEY] || '').trim();
}

/** The answers a reviewer reads first (E19/F03), as one line per row. */
function leading(app: Application): string {
  return reviewAnswers(app, props.market?.applicationForm, props.market?.reviewHighlights ?? [])
    .leading.map((row) => row.value)
    .filter(Boolean)
    .join(' · ');
}

function holderOf(app: Application): string | null {
  const holder = app.heldBy?.email;
  if (!holder) return null;
  return holder.toLowerCase() === me.value.toLowerCase()
    ? 'You have this open'
    : `${holder} is looking at this`;
}

const statusTone: Record<string, string> = {
  [ApplicationStatus.Open]: 'informational',
  [ApplicationStatus.UnderReview]: 'attention',
  [ApplicationStatus.NeedsFollowUp]: 'attention',
  [ApplicationStatus.ReviewerApproved]: 'positive',
  [ApplicationStatus.ReviewerRejected]: 'destructive',
};
const chip = (status: string) => `chip chip--${statusTone[status] ?? 'neutral'}`;

// --- The drawer, and the verdicts it carries during review -----------------------------------

const details = useVendorDetails(
  marketId,
  computed(() => props.market),
);
const drawer = useVendorDrawer();
const opened = computed(() =>
  drawer.email.value
    ? (applications.value.find((a) => a.applicantEmail.toLowerCase() === drawer.email.value) ??
      null)
    : null,
);

/** While the market is still deciding, and for someone who may: the verdicts are in the drawer. */
const DECIDING_PHASES: readonly string[] = [
  MarketPhase.ApplicationsOpen,
  MarketPhase.ApplicationsClosed,
  MarketPhase.Review,
];
const decides = computed(
  () =>
    !props.market?.readOnlyReason && DECIDING_PHASES.includes(String(props.market?.phase ?? '')),
);

const saving = ref(false);
const verdictMessage = ref('');
const followUpOpen = ref(false);
const people = computed(() =>
  Object.keys(props.market?.roles ?? {})
    .map((id) => props.market?.roleEmails?.[id])
    .filter((email): email is string => Boolean(email)),
);

function adopt(app: Application) {
  const index = applications.value.findIndex((a) => a.id === app.id);
  if (index !== -1) applications.value[index] = { ...applications.value[index], ...app };
}

async function give(status: ApplicationStatus, ownerEmail?: string) {
  const app = opened.value;
  if (!app || !props.market || saving.value) return;
  saving.value = true;
  verdictMessage.value = '';
  try {
    adopt(await reviewApplication(props.market.id, app, status, ownerEmail));
    void details.load();
  } catch (err) {
    const changed = changedSinceSeen(err);
    if (changed) {
      // Someone decided it first (E34/F03/S01): show what is really there, and who.
      adopt(changed.application);
      verdictMessage.value = changed.message;
    } else {
      verdictMessage.value = getApiErrorMessage(err, 'Failed to update application');
    }
  } finally {
    saving.value = false;
  }
}

async function markFollowUp({ ownerEmail, note }: { ownerEmail: string; note: string }) {
  const app = opened.value;
  if (!app || !props.market) return;
  if (note) await saveVendorNote(props.market.id, app.applicantEmail, note);
  await give(ApplicationStatus.NeedsFollowUp, ownerEmail === me.value ? undefined : ownerEmail);
  followUpOpen.value = false;
}

watch(
  () => drawer.email.value,
  () => (verdictMessage.value = ''),
);
</script>

<template>
  <div class="all-view" data-testid="applications-all">
    <div class="all-filters">
      <div class="all-status" role="group" aria-label="Show applications">
        <button
          v-for="option in ALL_VIEW_FILTERS"
          :key="option.id"
          type="button"
          class="btn btn--compact"
          :class="option.id === filter ? 'btn--primary' : 'btn--secondary'"
          :aria-pressed="option.id === filter"
          :data-testid="`applications-all-filter-${option.id}`"
          @click="setQuery({ status: option.id === 'all' ? null : option.id })"
        >
          {{ option.label }}
        </button>
      </div>
      <label class="all-mine">
        <input
          type="checkbox"
          :checked="mine"
          data-testid="applications-all-mine"
          @change="setQuery({ mine: ($event.target as HTMLInputElement).checked ? '1' : null })"
        />
        Mine: the follow-ups I own
      </label>
      <span class="all-count" data-testid="applications-all-count">
        {{ shown.length }} of {{ applications.length }}
      </span>
    </div>

    <p v-if="errorMessage" class="all-error">{{ errorMessage }}</p>
    <p v-else-if="loading && !applications.length" class="all-empty">Loading applications…</p>
    <p v-else-if="!shown.length" class="all-empty" data-testid="applications-all-empty">
      No application matches.
    </p>

    <ul v-else class="all-list">
      <li v-for="app in shown" :key="app.id" class="all-row" data-testid="applications-all-row">
        <button
          type="button"
          class="all-row-button"
          :data-application-id="app.id"
          @click="drawer.open(app.applicantEmail)"
        >
          <span class="all-who">
            <span class="all-name">{{ nameOf(app) || app.applicantEmail }}</span>
            <span v-if="nameOf(app)" class="all-email">{{ app.applicantEmail }}</span>
          </span>
          <span class="all-leading">{{ leading(app) }}</span>
          <span class="all-state">
            <span :class="chip(app.status)" data-testid="applications-all-status">
              {{ statusLabel(app.status) }}
            </span>
            <span
              v-if="verdictGiverLine(app)"
              class="all-meta"
              data-testid="applications-all-giver"
              >{{ verdictGiverLine(app) }}</span
            >
            <span v-if="app.followUpOwner" class="all-meta" data-testid="applications-all-owner"
              >Followed up by {{ app.followUpOwner.email }}</span
            >
            <span v-if="holderOf(app)" class="all-meta" data-testid="applications-all-holder">{{
              holderOf(app)
            }}</span>
          </span>
        </button>
      </li>
    </ul>

    <VendorDrawer
      :market="market"
      :details="details"
      :email="drawer.email.value"
      :tab="drawer.tab.value"
      @close="drawer.close()"
      @update:tab="drawer.setTab"
    >
      <template v-if="opened" #actions>
        <div class="drawer-verdict" data-testid="applications-all-drawer-verdict">
          <p class="drawer-status">
            <span :class="chip(opened.status)">{{ statusLabel(opened.status) }}</span>
            <span v-if="verdictGiverLine(opened)" class="all-meta">{{
              verdictGiverLine(opened)
            }}</span>
          </p>
          <p v-if="verdictMessage" class="drawer-message" role="alert">{{ verdictMessage }}</p>
          <div v-if="decides" class="drawer-buttons">
            <button
              type="button"
              class="btn btn--destructive btn--compact"
              :disabled="saving"
              data-testid="applications-all-reject"
              @click="give(ApplicationStatus.ReviewerRejected)"
            >
              Reject
            </button>
            <button
              type="button"
              class="btn btn--secondary btn--compact"
              :disabled="saving || opened.status === ApplicationStatus.NeedsFollowUp"
              data-testid="applications-all-follow-up"
              @click="followUpOpen = true"
            >
              Needs follow-up
            </button>
            <button
              type="button"
              class="btn btn--primary btn--compact"
              :disabled="saving"
              data-testid="applications-all-approve"
              @click="give(ApplicationStatus.ReviewerApproved)"
            >
              Approve
            </button>
          </div>
        </div>
      </template>
    </VendorDrawer>

    <FollowUpDialog
      :open="followUpOpen"
      :applicantEmail="opened?.applicantEmail ?? ''"
      :people="people"
      :me="me"
      :error="verdictMessage"
      @close="followUpOpen = false"
      @confirm="markFollowUp"
    />
  </div>
</template>

<style scoped>
.all-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.all-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.all-status {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.all-mine {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.all-count {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.all-error,
.all-empty {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.all-error {
  color: var(--mm-red);
}

.all-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.all-row-button {
  display: grid;
  grid-template-columns: minmax(0, 14rem) minmax(0, 1fr) minmax(0, 18rem);
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
  text-align: left;
  cursor: pointer;
}

.all-row-button:hover {
  border-color: var(--mm-green);
}

.all-row-button:focus-visible {
  outline: 2px solid var(--mm-black);
  outline-offset: 2px;
}

.all-who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.all-name {
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.all-email,
.all-meta {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

.all-leading {
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.all-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
}

.drawer-verdict {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4) 22px;
  border-bottom: 1px solid var(--mm-border);
}

.drawer-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
}

.drawer-message {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-yellow);
  border-radius: var(--radius-control);
  background: var(--mm-chip-attention);
  font-size: var(--text-sm);
  color: var(--mm-text-yellow-on-tint);
}

.drawer-buttons {
  display: flex;
  gap: var(--space-2);
}
</style>
