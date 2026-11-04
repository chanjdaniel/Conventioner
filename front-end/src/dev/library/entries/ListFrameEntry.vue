<script setup lang="ts">
/**
 * The list frame (T200): `ListFrame` on the survey's two worst lists. L2, Applications All, on every
 * fixture application, with its status toggles and an "Assigned to" combobox (C6), and a switch to
 * today's every-row list on the same filters; L1, the 150 people with access, a role select per row;
 * then a panel per state. Only the chosen view of L2 is mounted, so the first paint draws the frame's
 * first page and never today's every row. L2's reviewers read as they do on the screen, by address,
 * through the real filter's choices and row words (`utils/reviewers.ts`). Nothing here is a read: the
 * failed and loading panels are the frame told so.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { MarketRole } from '@/assets/types/datatypes';
import FilterToggles, { type FilterToggle } from '@/components/FilterToggles.vue';
import ListFrame from '@/components/ListFrame.vue';
import SearchPicker, { type PickerGroup, type PickerOption } from '@/components/SearchPicker.vue';
import { OFFLINE_MESSAGE } from '@/utils/api';
import { getRoleDisplayName } from '@/utils/permissions';
import { ALL_VIEW_FILTERS, allViewLists, type AllViewFilter } from '@/utils/reviewQueue';
import { PEOPLE_CAP } from '@/utils/personChoice';
import {
  assignedAddress,
  assignedToGroups,
  assignedToOptions,
  findsAssignedTo,
  reviewerLine,
} from '@/utils/reviewers';
import ApplicationRow from '../parts/ApplicationRow.vue';
import LibraryPanel from '../parts/LibraryPanel.vue';
import LibrarySection from '../parts/LibrarySection.vue';
import ReadOut from '../parts/ReadOut.vue';
import { fixture, type LibraryFixture } from '../fixture';

type LibraryApplication = LibraryFixture['applications'][number];
type LibraryPerson = LibraryFixture['people'][number];

const { applications, people, reviewers } = fixture;

const APPLICATION = { one: 'application', many: 'applications' };
const PERSON = { one: 'person', many: 'people' };
const NAME_OR_ADDRESS = 'Find by name or address';

const personById = new Map(people.map((person) => [person.id, person]));
const holds = (text: string, words: string) => text.toLowerCase().includes(words.toLowerCase());
const findsByNameOrAddress = (item: { name: string; email: string }, words: string) =>
  holds(item.name, words) || holds(item.email, words);
const findsByAddress = (item: { email: string }, words: string) => holds(item.email, words);
const keyOf = (item: { id: string }) => item.id;

const addressOf = (id: string) => personById.get(id)?.email ?? '';

/** The reader is the first reviewer, so "Me" means something; they open on everyone's, to see 359. */
const READER = addressOf(reviewers[0]!);
const TEAM = {
  reviewTeam: { reviewers: reviewers.map((id) => ({ email: addressOf(id), able: true })) },
};
const ANYONE = 'anyone';
const assignedOptions: PickerOption[] = assignedToOptions(READER, TEAM);
const assignedGroups: PickerGroup[] = assignedToGroups(READER, TEAM);
const findsReviewer = findsAssignedTo(READER);

const view = ref('proposed');
const viewOptions: FilterToggle[] = [
  { id: 'proposed', label: 'Proposed: the frame' },
  { id: 'today', label: 'Today: every row' },
];

/** The filters, shared by both views, so a switch shows the same rows drawn two ways. */
const status = ref<string>('all');
const assigned = ref(ANYONE);
const assignedLabel = computed(
  () => assignedOptions.find(({ value }) => value === assigned.value)!.label,
);

const inShare = computed(() => {
  const address = assignedAddress(assigned.value, READER);
  return address
    ? applications.filter(({ reviewer }) => addressOf(reviewer) === address)
    : applications;
});
const statusOptions = computed<FilterToggle[]>(() =>
  ALL_VIEW_FILTERS.map(({ id, label }) => ({
    id,
    label,
    count: inShare.value.filter((application) => allViewLists(id, application.status)).length,
  })),
);
const statusLabelNow = computed(
  () => ALL_VIEW_FILTERS.find(({ id }) => id === status.value)!.label,
);
/** A change here is the reader's own choice of rows, so the list goes back to its first page. */
const filterKey = computed(() => `${status.value} ${assigned.value}`);
const filtered = computed(() =>
  inShare.value.filter((application) =>
    allViewLists(status.value as AllViewFilter, application.status),
  ),
);

const opened = ref<string | null>(null);
/** The rows ticked, which outlive a filter, the words and the fold, as today's selection does. */
const ticked = reactive(new Set<string>());
function tick(id: string, on: boolean): void {
  if (on) ticked.add(id);
  else ticked.delete(id);
}
/** "Reviewer: you" on the reader's own, as today's row says it. */
const reviewerWords = ({ status, reviewer }: LibraryApplication) =>
  reviewerLine({ status, reviewer: { email: addressOf(reviewer) } }, READER, TEAM) ?? [];

/** The role each person holds here: the demo's own, so a change is seen to land. */
const ROLES = Object.values(MarketRole);
const roles = reactive<Record<string, MarketRole>>(
  Object.fromEntries(people.map((person) => [person.id, person.role])),
);
const lastRoleChange = ref<string | null>(null);
function changeRole(person: LibraryPerson, role: MarketRole): void {
  roles[person.id] = role;
  lastRoleChange.value = `${person.email} is now ${getRoleDisplayName(role)}`;
}

/** What every state panel's frame is told alike. */
const stateFrame = {
  finds: findsByNameOrAddress,
  itemKey: keyOf,
  findLabel: NAME_OR_ADDRESS,
};

/** A few people, for the state panels. */
const atThreshold = people.slice(0, 12);
const pastThreshold = people.slice(0, 13);
const noRows: LibraryPerson[] = [];

const retries = ref(0);

/** The no-match panel opens as someone left it: the words go in through the field, as typed. */
const NO_MATCH_WORDS = 'Zanzibar';
const noMatch = ref<HTMLElement>();
onMounted(() => {
  const field = noMatch.value?.querySelector('input');
  if (!field) return;
  field.value = NO_MATCH_WORDS;
  field.dispatchEvent(new Event('input'));
});
</script>

<template>
  <LibrarySection
    title="L2: Applications, All"
    :about="`Every fixture application, ${applications.length} of them, which today draws every row with no way to find one.`"
  >
    <LibraryPanel label="Applications All" class="library-wide">
      <div class="library-demo">
        <FilterToggles
          v-model="view"
          :options="viewOptions"
          label="How the list is drawn"
          testid="library-l2-view"
        />

        <ListFrame
          v-if="view === 'proposed'"
          :items="filtered"
          :wholeCount="applications.length"
          :filterKey="filterKey"
          :finds="findsByNameOrAddress"
          :itemKey="keyOf"
          :noun="APPLICATION"
          findKey="find"
          :findLabel="NAME_OR_ADDRESS"
          testid="library-l2"
        >
          <template #filters>
            <div class="library-assigned">
              <SearchPicker
                v-model="assigned"
                holds-choice
                :groups="assignedGroups"
                :finds="findsReviewer"
                :cap="PEOPLE_CAP"
                label="Assigned to"
                placeholder="Type an address…"
                testid="library-l2-assigned"
              />
            </div>
            <FilterToggles
              v-model="status"
              class="library-status"
              :options="statusOptions"
              label="Status"
              testid="library-l2-status"
            />
          </template>
          <template #row="{ item }">
            <ApplicationRow
              :application="item"
              :reviewer="reviewerWords(item)"
              :ticked="ticked.has(item.id)"
              @open="opened = item.name"
              @tick="tick(item.id, $event)"
            />
          </template>
          <template #empty>
            <p>No application matches.</p>
          </template>
        </ListFrame>

        <div v-else class="library-demo" data-testid="library-l2-today">
          <div class="library-today-tools">
            <div class="library-today-status" role="group" aria-label="Status">
              <button
                v-for="option in ALL_VIEW_FILTERS"
                :key="option.id"
                type="button"
                class="btn btn--compact"
                :class="option.id === status ? 'btn--primary' : 'btn--secondary'"
                :aria-pressed="option.id === status"
                :data-testid="`library-l2-today-status-${option.id}`"
                @click="status = option.id"
              >
                {{ option.label }}
              </button>
            </div>
            <SearchPicker
              v-model="assigned"
              class="library-today-assigned"
              holds-choice
              :groups="assignedGroups"
              :finds="findsReviewer"
              :cap="PEOPLE_CAP"
              label="Assigned to"
              placeholder="Type an address…"
              testid="library-l2-today-assigned"
            />
            <span class="library-today-count" data-testid="library-l2-today-count">
              {{ filtered.length }} of {{ applications.length }}
            </span>
          </div>
          <ul class="library-today-rows">
            <li v-for="application in filtered" :key="application.id">
              <ApplicationRow
                :application="application"
                :reviewer="reviewerWords(application)"
                :ticked="ticked.has(application.id)"
                @open="opened = application.name"
                @tick="tick(application.id, $event)"
              />
            </li>
          </ul>
        </div>

        <ReadOut label="Filters" :value="`${statusLabelNow}, assigned to ${assignedLabel}`" />
        <ReadOut label="Opened" :value="opened" />
        <ReadOut label="Selected" :value="ticked.size ? String(ticked.size) : null" />
      </div>
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="L1: People with access"
    :about="`All ${people.length} people, as Manage market and Manage organization list them: an account holds an address and no name, so a row is its address. A role is a fixed short set, so a row keeps a native select. These lists stand in dialogs, so their words stay out of the address.`"
  >
    <LibraryPanel label="People with access" class="library-wide">
      <div class="library-demo">
        <ListFrame
          :items="people"
          :finds="findsByAddress"
          :itemKey="keyOf"
          :noun="PERSON"
          findLabel="Find by address"
          testid="library-l1"
        >
          <template #row="{ item }">
            <div class="library-person">
              <span class="library-person__words" data-testid="library-l1-address">{{
                item.email
              }}</span>
              <select
                class="field field--select library-person__role"
                :name="`role-${item.id}`"
                :aria-label="`${item.email}'s role`"
                :value="roles[item.id]"
                data-testid="library-l1-role"
                @change="changeRole(item, ($event.target as HTMLSelectElement).value as MarketRole)"
              >
                <option v-for="role in ROLES" :key="role" :value="role">
                  {{ getRoleDisplayName(role) }}
                </option>
              </select>
            </div>
          </template>
        </ListFrame>
        <ReadOut label="Last change" :value="lastRoleChange" />
      </div>
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="The states"
    about="What a list says when it has no rows to show; each frame here is told its state, and reads nothing."
  >
    <LibraryPanel label="Loading">
      <ListFrame
        :items="noRows"
        v-bind="stateFrame"
        :noun="APPLICATION"
        state="loading"
        testid="library-state-loading"
      >
        <template #row="{ item }">{{ item.name }}</template>
      </ListFrame>
    </LibraryPanel>
    <LibraryPanel label="Failed">
      <div class="library-demo">
        <ListFrame
          :items="noRows"
          v-bind="stateFrame"
          :noun="APPLICATION"
          state="failed"
          :failedMessage="OFFLINE_MESSAGE"
          testid="library-state-failed"
          @retry="retries += 1"
        >
          <template #row="{ item }">{{ item.name }}</template>
        </ListFrame>
        <ReadOut label="Try again pressed" :value="String(retries)" />
      </div>
    </LibraryPanel>
    <LibraryPanel label="Empty: nothing has come in">
      <ListFrame
        :items="noRows"
        v-bind="stateFrame"
        :noun="APPLICATION"
        testid="library-state-empty"
      >
        <template #row="{ item }">{{ item.name }}</template>
        <template #empty>
          <p>No applications received yet.</p>
        </template>
      </ListFrame>
    </LibraryPanel>
    <LibraryPanel label="No match: the words find nothing">
      <div ref="noMatch" class="library-demo">
        <ListFrame
          :items="people"
          v-bind="stateFrame"
          :noun="PERSON"
          testid="library-state-no-match"
        >
          <template #row="{ item }">{{ item.name }}</template>
        </ListFrame>
      </div>
    </LibraryPanel>
    <LibraryPanel :label="`${atThreshold.length} rows: no find field`">
      <ListFrame
        :items="atThreshold"
        v-bind="stateFrame"
        :noun="PERSON"
        testid="library-state-at-threshold"
      >
        <template #row="{ item }">{{ item.name }}</template>
      </ListFrame>
    </LibraryPanel>
    <LibraryPanel :label="`${pastThreshold.length} rows: the find field`">
      <ListFrame
        :items="pastThreshold"
        v-bind="stateFrame"
        :noun="PERSON"
        testid="library-state-past-threshold"
      >
        <template #row="{ item }">{{ item.name }}</template>
      </ListFrame>
    </LibraryPanel>
  </LibrarySection>
</template>

<style scoped>
.library-wide {
  grid-column: 1 / -1;
}

.library-demo {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
}

/* "Assigned to" stands beside the find field, one height with it; the status toggles have a row. */
.library-assigned {
  flex: 1 1 18rem;
  min-width: 0;
  max-width: 28rem;
}

.library-status {
  flex-basis: 100%;
}

@media (width <= 640px) {
  .library-assigned {
    flex-basis: 100%;
    max-width: none;
  }
}

.library-today-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.library-today-status {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

/* A target is never narrower than it is tall, as today's row has it. */
.library-today-status .btn {
  min-width: var(--target-min);
}

.library-today-tools .library-today-assigned {
  position: relative;
  flex: 1 1 22rem;
  flex-flow: row wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  min-width: 0;
  max-width: 28rem;
}

.library-today-assigned :deep(.field-label) {
  margin-bottom: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
  white-space: nowrap;
}

.library-today-assigned :deep(.field) {
  flex: 1 1 14rem;
  width: auto;
  min-width: 0;
  height: var(--control-height-compact);
}

.library-today-assigned :deep(.search-picker-list) {
  position: absolute;
  top: 100%;
  right: 0;
  left: 0;
  z-index: 1;
  box-shadow: var(--shadow-card);
}

.library-today-count {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.library-today-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* A person's line: their words, then their role at the line's end, wrapping under on a phone. */
.library-person {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
  border-bottom: 1px solid var(--mm-border);
}

.library-person__words {
  min-width: 0;
  overflow-wrap: anywhere;
}

.library-person__role {
  flex: none;
  width: auto;
}
</style>
