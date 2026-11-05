<script setup lang="ts">
/**
 * The list frame (T200): `ListFrame` on the survey's two worst lists. L2, Applications All, on every
 * fixture application, with its status toggles and an "Assigned to" combobox (C6), its own rows in
 * the `rows` slot and Select all in `aboveRows`, on the rows `drawn` says are on screen, as the screen
 * does (T223), and a switch to today's every-row list on the same filters; L1, the 150 people with
 * access, a role select per row in the `row` slot; then a panel per state, L10's list read whole by
 * asking, the import's real refused rows, among them. Only the chosen view of L2
 * is mounted, so the first paint draws the frame's first page and never today's every row. L2's
 * reviewers read as they do on the screen, by address, through the real filter's choices and row words
 * (`utils/reviewers.ts`). Nothing here is a read: the failed and loading panels are the frame told so.
 *
 * Then `PagedList` (T224), the list the server pages, in a box of its own, with a page that fails, and
 * in a dialog's body: each pages the fixture's applications through `pagedRead`, a short timer in
 * place of a request, so a page is seen to land and no endpoint or store is touched.
 */
import { computed, onMounted, reactive, ref, shallowRef } from 'vue';
import { MarketRole } from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import FilterToggles, { type FilterToggle } from '@/components/FilterToggles.vue';
import ImportRefusedRows from '@/components/csvImport/ImportRefusedRows.vue';
import ListFrame from '@/components/ListFrame.vue';
import PagedList from '@/components/PagedList.vue';
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
import PagedApplicationRows from '../parts/PagedApplicationRows.vue';
import ReadOut from '../parts/ReadOut.vue';
import { fixture, type LibraryFixture } from '../fixture';

type LibraryApplication = LibraryFixture['applications'][number];
type LibraryPerson = LibraryFixture['people'][number];

const { applications, people, reviewers } = fixture;

/** A bad file's refused rows, in the import's words: a row it refuses has an address or is blank. */
const refused = applications
  .slice(0, 30)
  .map((application, at) =>
    at % 10 === 9
      ? { row: at + 2, email: '', error: 'Every column this import reads is empty.' }
      : { row: at + 2, email: application.email, error: "'Full name' is required." },
  );

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
/** The rows on screen, as the frame says, and whether the cap leaves any off. */
const onScreen = shallowRef<LibraryApplication[]>([]);
const capped = ref(false);
/** The rows ticked, each leaving with its row, as the screen's selection does. */
const ticked = reactive(new Set<string>());
function tick(id: string, on: boolean): void {
  if (on) ticked.add(id);
  else ticked.delete(id);
}
function rowsDrawn(rows: LibraryApplication[], left: number): void {
  onScreen.value = rows;
  capped.value = left > 0;
  const drawn = new Set(rows.map(({ id }) => id));
  for (const id of [...ticked]) if (!drawn.has(id)) ticked.delete(id);
}
function selectAllShown(): void {
  for (const { id } of onScreen.value) ticked.add(id);
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

/** As the history's pages are: long enough that "Loading…" is read, short enough to scroll on. */
const PAGE_SIZE = 25;
const READ_TAKES_MS = 400;

/** The next page after a wait, as a screen's read gives it; `failsOnce` loses the second page once. */
function pagedRead({ failsOnce = false } = {}) {
  const count = ref(PAGE_SIZE);
  const loading = ref(false);
  const error = ref('');
  let fails = failsOnce;

  function more(): void {
    loading.value = true;
    error.value = '';
    window.setTimeout(() => {
      loading.value = false;
      if (fails) error.value = OFFLINE_MESSAGE;
      else count.value += PAGE_SIZE;
      fails = false;
    }, READ_TAKES_MS);
  }

  return {
    loading,
    error,
    more,
    shown: computed(() => applications.slice(0, count.value)),
    hasMore: computed(() => count.value < applications.length),
    readOut: computed(
      () => `${Math.min(count.value, applications.length)} of ${applications.length}`,
    ),
  };
}

const ownBox = reactive(pagedRead());
const failing = reactive(pagedRead({ failsOnce: true }));
const inDialog = reactive(pagedRead());
const dialogOpen = ref(false);

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

/** Vendors' and Payments' way: the search stands elsewhere, so the frame gets its rows found. */
const PINNED_PAGE = 5;
const pinnedWords = ref('');
const pinnedFound = computed(() => {
  const words = pinnedWords.value.trim();
  return words
    ? pastThreshold.filter((person) => findsByNameOrAddress(person, words))
    : pastThreshold;
});

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
          rest="proposed"
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
          findKey="search"
          :findLabel="NAME_OR_ADDRESS"
          testid="library-l2"
          @drawn="rowsDrawn"
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
              rest="all"
              label="Status"
              testid="library-l2-status"
            />
          </template>
          <template #aboveRows>
            <div v-if="onScreen.length">
              <button
                type="button"
                class="btn btn--secondary btn--compact"
                data-testid="library-l2-select-all"
                @click="selectAllShown"
              >
                {{ capped ? `Select all ${onScreen.length} shown` : 'Select all' }}
              </button>
            </div>
          </template>
          <template #rows="{ rows }">
            <ul class="library-today-rows">
              <li
                v-for="item in rows"
                :key="item.id"
                data-list-row
                tabindex="-1"
                data-testid="library-l2-row"
              >
                <ApplicationRow
                  :application="item"
                  :reviewer="reviewerWords(item)"
                  :ticked="ticked.has(item.id)"
                  @open="opened = item.name"
                  @tick="tick(item.id, $event)"
                />
              </li>
            </ul>
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
              list-over
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
    title="F18, F27: A list the server pages"
    about="A list is PagedList when the server pages it, as the history is, since it knows no total and cannot find among rows it has not read; it is ListFrame when its rows are already read whole. Each demo here reads 25 more of the fixture's applications as its end comes into view."
  >
    <LibraryPanel label="A box of its own">
      <div class="library-demo" data-testid="library-paged-own">
        <PagedList
          :hasMore="ownBox.hasMore"
          :loading="ownBox.loading"
          :error="ownBox.error"
          label="Applications"
          testid="library-paged-own"
          @more="ownBox.more"
        >
          <PagedApplicationRows :applications="ownBox.shown" />
        </PagedList>
        <ReadOut label="Read" :value="ownBox.readOut" />
      </div>
    </LibraryPanel>
    <LibraryPanel label="A page that fails">
      <div class="library-demo" data-testid="library-paged-failing">
        <PagedList
          :hasMore="failing.hasMore"
          :loading="failing.loading"
          :error="failing.error"
          label="Applications, the second page failing"
          testid="library-paged-failing"
          @more="failing.more"
        >
          <PagedApplicationRows :applications="failing.shown" />
        </PagedList>
        <ReadOut label="Read" :value="failing.readOut" />
      </div>
    </LibraryPanel>
    <LibraryPanel label="In a dialog's body, which is the box">
      <div class="library-demo library-demo--start" data-testid="library-paged-dialog">
        <button
          type="button"
          class="btn btn--secondary"
          data-testid="library-paged-dialog-open"
          @click="dialogOpen = true"
        >
          Open the applications
        </button>
        <ReadOut label="Read" :value="inDialog.readOut" />
      </div>
    </LibraryPanel>
  </LibrarySection>

  <AppDialog
    :open="dialogOpen"
    title="Applications"
    testid="library-paged-dialog"
    size="wide"
    scroll="body"
    @close="dialogOpen = false"
  >
    <PagedList
      box="parent"
      :hasMore="inDialog.hasMore"
      :loading="inDialog.loading"
      :error="inDialog.error"
      testid="library-paged-dialog-list"
      @more="inDialog.more"
    >
      <PagedApplicationRows :applications="inDialog.shown" />
    </PagedList>
    <template #tray>
      <ReadOut label="Read" :value="inDialog.readOut" />
    </template>
  </AppDialog>

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
    <LibraryPanel label="No field of its own: the search stands elsewhere">
      <div class="library-pinned-search">
        <label class="field-label" for="library-state-pinned-words">Search, pinned elsewhere</label>
        <input
          id="library-state-pinned-words"
          v-model="pinnedWords"
          type="search"
          autocomplete="off"
          class="field"
          name="library-state-pinned-words"
          data-testid="library-state-pinned-words"
        />
      </div>
      <ListFrame
        :items="pinnedFound"
        :filter-key="pinnedWords.trim()"
        :item-key="keyOf"
        :noun="PERSON"
        :page-size="PINNED_PAGE"
        testid="library-state-pinned"
      >
        <template #row="{ item }">{{ item.name }}</template>
      </ListFrame>
    </LibraryPanel>
    <LibraryPanel :label="`${refused.length} refused rows: the first 20, then Show all`">
      <ImportRefusedRows
        :rows="refused"
        testid="library-state-refused"
        row-testid="library-state-refused-row"
      />
    </LibraryPanel>
  </LibrarySection>
</template>

<style scoped>
.library-wide {
  grid-column: 1 / -1;
}

.library-pinned-search {
  margin-bottom: var(--space-3);
}

.library-demo {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
}

/* A button at its own width, as the dialog entry's are, with its read-out under it. */
.library-demo--start {
  align-items: flex-start;
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
