<script setup lang="ts">
/**
 * The list frame (T200): `ListFrame` on the survey's two worst lists. L2, Applications All, on every
 * fixture application, with its status toggles and an "Assigned to" combobox (C6), and a switch to
 * today's every-row list on the same filters; L1, the 150 people with access, a role select per row;
 * then a panel per state. Only the chosen view of L2 is mounted, so the first paint draws the frame's
 * first page and never today's every row. Nothing here is a read: the failed and loading panels are
 * the frame told so.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { MarketRole } from '@/assets/types/datatypes';
import FilterToggles, { type FilterToggle } from '@/components/FilterToggles.vue';
import ListFrame from '@/components/ListFrame.vue';
import SearchPicker, { type PickerGroup, type PickerOption } from '@/components/SearchPicker.vue';
import { OFFLINE_MESSAGE } from '@/utils/api';
import { getRoleDisplayName } from '@/utils/permissions';
import { ALL_VIEW_FILTERS, allViewLists, type AllViewFilter } from '@/utils/reviewQueue';
import ApplicationRow from '../parts/ApplicationRow.vue';
import ChoicesForYou from '../parts/ChoicesForYou.vue';
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
const keyOf = (item: { id: string }) => item.id;

/** The reader is the first reviewer, so "Me" means something; they open on everyone's, to see 359. */
const ME = reviewers[0]!;
const ANYONE = 'anyone';
const assignedOptions: PickerOption[] = [
  { value: ME, label: 'Me', detail: personById.get(ME)!.name },
  { value: ANYONE, label: 'Anyone' },
  ...reviewers
    .filter((id) => id !== ME)
    .map((id) => {
      const { name, email } = personById.get(id)!;
      return { value: id, label: name, detail: email };
    }),
];
const assignedGroups: PickerGroup[] = [{ options: assignedOptions }];
const findsReviewer = (option: PickerOption, words: string) =>
  holds(option.label, words) || holds(option.detail ?? '', words);

const view = ref('proposed');
const viewOptions: FilterToggle[] = [
  { id: 'proposed', label: 'Proposed: the frame' },
  { id: 'today', label: 'Today: every row' },
];

/** The filters, shared by both views, so a switch shows the same rows drawn two ways. */
const status = ref<string>('all');
const assigned = ref(ANYONE);
/** The picker lets go of its choice as its field is typed in: that is everyone's until one is taken. */
const assignedId = computed(() => assigned.value || ANYONE);
const assignedLabel = computed(
  () => assignedOptions.find(({ value }) => value === assignedId.value)!.label,
);

const inShare = computed(() =>
  assignedId.value === ANYONE
    ? applications
    : applications.filter(({ reviewer }) => reviewer === assignedId.value),
);
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
const reviewerOf = (application: LibraryApplication) =>
  personById.get(application.reviewer)?.email ?? '';

/** The role each person holds here: the demo's own, so a change is seen to land. */
const ROLES = Object.values(MarketRole);
const roles = reactive<Record<string, MarketRole>>(
  Object.fromEntries(people.map((person) => [person.id, person.role])),
);
const lastRoleChange = ref<string | null>(null);
function changeRole(person: LibraryPerson, role: MarketRole): void {
  roles[person.id] = role;
  lastRoleChange.value = `${person.name} is now ${getRoleDisplayName(role)}`;
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
                :groups="assignedGroups"
                :finds="findsReviewer"
                label="Assigned to"
                placeholder="Type a name or address…"
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
              :reviewer="reviewerOf(item)"
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
            <label class="library-today-assigned">
              <span>Assigned to</span>
              <select
                class="field field--select library-today-select"
                name="library-l2-today-assigned"
                :value="assignedId"
                @change="assigned = ($event.target as HTMLSelectElement).value"
              >
                <option v-for="option in assignedOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <span class="library-today-count" data-testid="library-l2-today-count">
              {{ filtered.length }} of {{ applications.length }}
            </span>
          </div>
          <ul class="library-today-rows">
            <li v-for="application in filtered" :key="application.id">
              <ApplicationRow
                :application="application"
                :reviewer="reviewerOf(application)"
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
    :about="`All ${people.length} people, as Manage market and Manage organization list them; a role is a fixed short set, so a row keeps a native select.`"
  >
    <LibraryPanel label="People with access" class="library-wide">
      <div class="library-demo">
        <ListFrame
          :items="people"
          :finds="findsByNameOrAddress"
          :itemKey="keyOf"
          :noun="PERSON"
          findKey="person"
          :findLabel="NAME_OR_ADDRESS"
          testid="library-l1"
        >
          <template #row="{ item }">
            <div class="library-person">
              <span class="library-person__words">
                <span data-testid="library-l1-name">{{ item.name }}</span>
                <span class="library-quiet">{{ item.email }}</span>
              </span>
              <select
                class="field field--select library-person__role"
                :name="`role-${item.id}`"
                :aria-label="`${item.name}'s role`"
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

  <ChoicesForYou>
    <li><strong>Page size:</strong> 50 rows, or another number.</li>
    <li>
      <strong>Find threshold:</strong> the field shows past 12 rows. It counts what the filters
      leave, so a narrow filter takes the field away and the filters move left: count the whole list
      instead?
    </li>
    <li>
      <strong>The count line's wording:</strong> "Showing 50 of 359", "9 of 359 match "Singh"",
      "Nothing matches "Singh"". With words and more matches than a page, it says how many match and
      not how many are drawn.
    </li>
    <li><strong>"Show N more" or "Show all":</strong> a page at a time, or everything at once.</li>
    <li>
      <strong>The words in the address:</strong> always, as here, or only on some screens. Inside a
      dialog they would outlive the dialog.
    </li>
    <li>
      <strong>When the list folds back:</strong> changing the rows folds to 50, as a filter must. A
      read again that brings a new application, or a verdict that takes a row out of a filtered
      list, changes the rows too. Fold there as well, or hold the count?
    </li>
    <li>
      <strong>Select all under a cap:</strong> today it ticks the rows shown. With 50 of 359 drawn,
      does it tick the 50, or all 359?
    </li>
  </ChoicesForYou>
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

.library-today-assigned {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.library-today-select {
  height: var(--control-height-compact);
  min-width: var(--target-min);
  field-sizing: content;
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
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
}

.library-person__role {
  flex: none;
  width: auto;
}

.library-quiet {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
