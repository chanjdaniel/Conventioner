<script setup lang="ts">
/**
 * The dialog (T200, T217): `AppDialog` in its three widths, the whole-window scroll beside the body
 * scroll on the same 150-person list, the body scroll with a tray, the footer without a form, a
 * read-only list the keys scroll, and the dialogs that prove every behaviour is kept, each on the
 * fixture's people and applicants. Daniel's choices on it are made, so it asks none.
 *
 * Every dialog here is the real `AppDialog`, opened from a button the way a screen opens one; the
 * line under each button reads out how it last closed, so a save is seen to land and a close is
 * seen to save nothing.
 */
import { computed, reactive, ref } from 'vue';
import { MarketRole } from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import { OFFLINE_MESSAGE } from '@/utils/api';
import { getRoleDisplayName } from '@/utils/permissions';
import LibrarySection from '../parts/LibrarySection.vue';
import LibraryPanel from '../parts/LibraryPanel.vue';
import TodayAndProposed from '../parts/TodayAndProposed.vue';
import PeopleChecklist from '../parts/PeopleChecklist.vue';
import ReadOut from '../parts/ReadOut.vue';
import { fixture } from '../fixture';

const { applications, people, reviewers, export: offered } = fixture;

type DialogId =
  | 'narrow'
  | 'wide'
  | 'broad'
  | 'window'
  | 'body'
  | 'tray'
  | 'actions'
  | 'read'
  | 'destructive'
  | 'error'
  | 'anchored'
  | 'inFlight'
  | 'several';

/** The one dialog open, if any, and how each last closed. */
const opened = ref<DialogId | null>(null);
const outcome = reactive<Partial<Record<DialogId, string>>>({});

function open(id: DialogId) {
  if (id === 'error') failure.value = '';
  opened.value = id;
}

/** Every close but a save: the close control, Cancel, Escape or the scrim. */
function closed(id: DialogId) {
  outcome[id] = 'Closed, nothing saved';
  opened.value = null;
}

function saved(id: DialogId, what: string) {
  outcome[id] = what;
  opened.value = null;
}

/** "1 person", "150 people". */
const peopleCount = (count: number) => `${count} ${count === 1 ? 'person' : 'people'}`;

// The sizes: two controls, a list, and a list of columns beside each other.
const vendorName = ref(applications[0]!.name);
const vendorEmail = ref(applications[0]!.email);
const reviewerPeople = reviewers.map((id) => people.find((person) => person.id === id)!);
const chosenReviewers = ref<string[]>([...reviewers]);
const groups = offered.groups.map((group) => ({
  ...group,
  columns: offered.columns.filter((column) => column.group === group.id),
}));
const chosenColumns = ref<string[]>(offered.columns.slice(0, 6).map((column) => column.id));

// The same 150 people, the window scrolling whole and the body alone.
const chosenInWindow = ref<string[]>([...reviewers]);
const chosenInBody = ref<string[]>([...reviewers]);

// The tray: whom the dialog has chosen so far, pinned above its actions.
const chosenInTray = ref<string[]>([...reviewers]);
const trayNames = computed(() =>
  people.filter((person) => chosenInTray.value.includes(person.id)).map((person) => person.name),
);

// A dialog of several actions, its own pinned at its foot, with no form to be one action.
const nameInActions = ref(applications[0]!.name);
function act(what: string) {
  outcome.actions = what;
}

// Every behaviour kept, in either scroll.
const SCROLLS = [
  { id: 'window', label: 'The window scrolls' },
  { id: 'body', label: 'The body scrolls' },
] as const;
const keptScroll = ref<'window' | 'body'>('body');

const removing = people[5]!;

// A save in flight, which lands only when asked, so the hold can be looked at for as long as it takes.
const inFlight = ref(false);
function letTheSaveLand() {
  inFlight.value = false;
  saved('inFlight', 'Saved');
}

const owed = ref('120');
const failure = ref('');
/** A save the server never heard: the error is about the whole submission, and the dialog stays. */
function failToSave() {
  failure.value = OFFLINE_MESSAGE;
  outcome.error = 'Failed, and the dialog stayed open';
}

const address = ref('');
const WHOLE_ADDRESS = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const applicantByEmail = new Map(applications.map((a) => [a.email.toLowerCase(), a]));
const addressError = computed(() => {
  const typed = address.value.trim();
  if (typed === '') return '';
  if (!WHOLE_ADDRESS.test(typed)) return 'Enter a whole address, like name@example.com.';
  const applicant = applicantByEmail.get(typed.toLowerCase());
  return applicant ? `${applicant.name} has applied with this address already.` : '';
});
const addressOk = computed(() => address.value.trim() !== '' && addressError.value === '');

/** Every role a row offers: who may change which is the market's actions' business, not this demo's. */
const ROLES = Object.values(MarketRole);
const roles = reactive<Record<string, MarketRole>>(
  Object.fromEntries(people.map((person) => [person.id, person.role])),
);
const added = ref('');
function changeRole(id: string, role: MarketRole) {
  roles[id] = role;
  const person = people.find((candidate) => candidate.id === id)!;
  outcome.several = `Changed ${person.name} to ${getRoleDisplayName(role)}`;
}
function addUser() {
  if (added.value.trim() === '') return;
  outcome.several = `Added ${added.value.trim()}`;
  added.value = '';
}
</script>

<template>
  <LibrarySection
    title="Sizes"
    about="Serves: every dialog, each one of three widths, never wider than the window less a gutter"
  >
    <LibraryPanel label="Narrow, 26rem: two controls (Add a vendor, every confirmation)">
      <button type="button" class="btn btn--secondary" @click="open('narrow')">
        Open the narrow dialog
      </button>
      <ReadOut label="Last" :value="outcome.narrow ?? null" />
    </LibraryPanel>
    <LibraryPanel label="Wide, 38rem: a list (the reviewers, Manage market)">
      <button type="button" class="btn btn--secondary" @click="open('wide')">
        Open the wide dialog
      </button>
      <ReadOut label="Last" :value="outcome.wide ?? null" />
    </LibraryPanel>
    <LibraryPanel label="Broad, 60rem: a list beside what it gathers (Export vendors)">
      <button type="button" class="btn btn--secondary" @click="open('broad')">
        Open the broad dialog
      </button>
      <ReadOut label="Last" :value="outcome.broad ?? null" />
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="The window scrolls, or only the body"
    about="Serves: the short dialogs scroll whole; every dialog whose body can outgrow a laptop window scrolls only that: Export vendors (F03), Manage market, Manage organization, Change reviewers (C5), Fix the form, Open applications, the assignment history"
  >
    <TodayAndProposed
      today="A short dialog: the whole window scrolls"
      proposed="A long dialog: only the body"
    >
      <template #today>
        <div class="library-stack">
          <button type="button" class="btn btn--secondary" @click="open('window')">
            Choose among {{ people.length }} people
          </button>
          <ReadOut label="Last" :value="outcome.window ?? null" />
        </div>
      </template>
      <template #proposed>
        <div class="library-stack">
          <button type="button" class="btn btn--secondary" @click="open('body')">
            Choose among {{ people.length }} people
          </button>
          <ReadOut label="Last" :value="outcome.body ?? null" />
        </div>
      </template>
    </TodayAndProposed>
  </LibrarySection>

  <LibrarySection
    title="The body scrolls, with a tray"
    about="Serves: Export vendors' chosen columns and preview, the cart; Change reviewers' chosen (C5)"
  >
    <LibraryPanel label="The chosen, pinned above the actions">
      <button type="button" class="btn btn--secondary" @click="open('tray')">
        Choose reviewers, with a tray
      </button>
      <ReadOut label="Last" :value="outcome.tray ?? null" />
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="The body scrolls, with nothing else to focus or no form"
    about="Serves: Permissions, the organization's Default permissions, and the other sections that open as dialogs"
  >
    <LibraryPanel label="Buttons of its own, pinned at its foot, and no form">
      <button type="button" class="btn btn--secondary" @click="open('actions')">
        Rename and reset
      </button>
      <ReadOut label="Last" :value="outcome.actions ?? null" />
    </LibraryPanel>
    <LibraryPanel label="Nothing to focus: it opens on the body, and the arrow keys scroll it">
      <button type="button" class="btn btn--secondary" @click="open('read')">
        Read who has access
      </button>
      <ReadOut label="Last" :value="outcome.read ?? null" />
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="Every behaviour kept"
    about="Serves: the 9 destructive confirmations, the 6 anchored dialogs, the 7 of several actions, and every form's error"
  >
    <LibraryPanel label="Each dialog below, opened as" class="library-wide">
      <div class="library-row" role="group" aria-label="Scroll">
        <button
          v-for="scroll in SCROLLS"
          :key="scroll.id"
          type="button"
          class="btn btn--secondary"
          :aria-pressed="keptScroll === scroll.id"
          @click="keptScroll = scroll.id"
        >
          {{ scroll.label }}
        </button>
      </div>
    </LibraryPanel>
    <LibraryPanel label="Destructive: opens on Cancel">
      <button type="button" class="btn btn--secondary" @click="open('destructive')">
        Remove {{ removing.name }}
      </button>
      <ReadOut label="Last" :value="outcome.destructive ?? null" />
    </LibraryPanel>
    <LibraryPanel label="With an error about the whole submission">
      <button type="button" class="btn btn--secondary" @click="open('error')">
        Change the amount owed
      </button>
      <ReadOut label="Last" :value="outcome.error ?? null" />
    </LibraryPanel>
    <LibraryPanel label="Anchored: its top holds as an error appears">
      <button type="button" class="btn btn--secondary" @click="open('anchored')">
        Add an address
      </button>
      <ReadOut label="Last" :value="outcome.anchored ?? null" />
    </LibraryPanel>
    <LibraryPanel label="A save in flight: nothing closes it until it answers">
      <button type="button" class="btn btn--secondary" @click="open('inFlight')">
        Name the template
      </button>
      <ReadOut label="Last" :value="outcome.inFlight ?? null" />
    </LibraryPanel>
    <LibraryPanel label="Several actions, no footer">
      <button type="button" class="btn btn--secondary" @click="open('several')">
        Manage market
      </button>
      <ReadOut label="Last" :value="outcome.several ?? null" />
    </LibraryPanel>
  </LibrarySection>

  <!-- The footer alone: its inner form's submit is its own, and its buttons never submit. -->
  <AppDialog
    :open="opened === 'actions'"
    title="Rename and reset"
    testid="library-actions"
    size="wide"
    scroll="body"
    @close="closed('actions')"
  >
    <form class="library-add" data-testid="library-actions-rename" @submit.prevent="act('Renamed')">
      <label class="library-field library-add__field">
        <span class="field-label">A vendor's name</span>
        <input v-model="nameInActions" class="field" />
      </label>
      <button type="submit" class="btn btn--secondary">Rename</button>
    </form>
    <p v-for="person in people" :key="person.id" class="library-text">{{ person.name }}</p>
    <template #actions>
      <button
        type="button"
        class="btn btn--secondary"
        data-testid="library-actions-reset"
        @click="act('Reset')"
      >
        Reset all
      </button>
      <button
        type="button"
        class="btn btn--primary"
        data-testid="library-actions-done"
        @click="closed('actions')"
      >
        Done
      </button>
    </template>
  </AppDialog>

  <!-- Nothing to focus, as for someone who may only read a table. -->
  <AppDialog
    :open="opened === 'read'"
    title="Who has access"
    testid="library-read"
    size="wide"
    scroll="body"
    @close="closed('read')"
  >
    <p v-for="person in people" :key="person.id" class="library-text">{{ person.name }}</p>
  </AppDialog>

  <!-- The sizes. -->
  <AppDialog
    :open="opened === 'narrow'"
    title="Add a vendor"
    testid="library-narrow"
    size="narrow"
    confirm-label="Add"
    @close="closed('narrow')"
    @submit="saved('narrow', `Added ${vendorName}`)"
  >
    <label class="library-field">
      <span class="field-label">Name</span>
      <input v-model="vendorName" class="field" />
    </label>
    <label class="library-field">
      <span class="field-label">Email address</span>
      <input v-model="vendorEmail" class="field" type="email" />
    </label>
  </AppDialog>

  <AppDialog
    :open="opened === 'wide'"
    title="Change reviewers"
    testid="library-wide"
    size="wide"
    confirm-label="Save"
    @close="closed('wide')"
    @submit="saved('wide', `Saved ${peopleCount(chosenReviewers.length)}`)"
  >
    <PeopleChecklist
      v-model="chosenReviewers"
      :people="reviewerPeople"
      legend="Reviewers"
      testid="library-wide-people"
    />
  </AppDialog>

  <AppDialog
    :open="opened === 'broad'"
    title="Columns in the file"
    testid="library-broad"
    size="broad"
    scroll="body"
    confirm-label="Save"
    @close="closed('broad')"
    @submit="saved('broad', `Saved ${chosenColumns.length} columns`)"
  >
    <div class="library-columns">
      <fieldset v-for="group in groups" :key="group.id" class="library-group">
        <legend class="field-label">{{ group.label }}</legend>
        <label v-for="column in group.columns" :key="column.id" class="library-check">
          <input v-model="chosenColumns" type="checkbox" :value="column.id" />
          <span>{{ column.label }}</span>
        </label>
      </fieldset>
    </div>
  </AppDialog>

  <!-- The same long list, the window scrolling whole and only the body. -->
  <AppDialog
    :open="opened === 'window'"
    title="Change reviewers"
    testid="library-window"
    size="wide"
    confirm-label="Save"
    @close="closed('window')"
    @submit="saved('window', `Saved ${peopleCount(chosenInWindow.length)}`)"
  >
    <p class="library-text">Each application is dealt to one of the people you choose.</p>
    <PeopleChecklist
      v-model="chosenInWindow"
      :people="people"
      legend="People with access"
      testid="library-window-people"
    />
  </AppDialog>

  <AppDialog
    :open="opened === 'body'"
    title="Change reviewers"
    testid="library-body"
    size="wide"
    scroll="body"
    confirm-label="Save"
    @close="closed('body')"
    @submit="saved('body', `Saved ${peopleCount(chosenInBody.length)}`)"
  >
    <p class="library-text">Each application is dealt to one of the people you choose.</p>
    <PeopleChecklist
      v-model="chosenInBody"
      :people="people"
      legend="People with access"
      testid="library-body-people"
    />
  </AppDialog>

  <!-- The body scrolling, with what it has chosen in the tray. -->
  <AppDialog
    :open="opened === 'tray'"
    title="Change reviewers"
    testid="library-tray"
    size="wide"
    scroll="body"
    confirm-label="Save"
    @close="closed('tray')"
    @submit="saved('tray', `Saved ${peopleCount(chosenInTray.length)}`)"
  >
    <div class="library-row">
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        @click="chosenInTray = people.map((person) => person.id)"
      >
        Choose everyone
      </button>
      <button type="button" class="btn btn--secondary btn--compact" @click="chosenInTray = []">
        Choose no one
      </button>
    </div>
    <PeopleChecklist
      v-model="chosenInTray"
      :people="people"
      legend="People with access"
      testid="library-tray-people"
    />
    <template #tray>
      <p class="library-tray-title" data-testid="library-tray-count">
        Chosen: {{ peopleCount(chosenInTray.length) }} of {{ people.length }}
      </p>
      <ul v-if="trayNames.length" class="library-chips">
        <li v-for="name in trayNames" :key="name" class="chip chip--neutral">{{ name }}</li>
      </ul>
      <p v-else class="library-quiet">No one yet: choose people above.</p>
    </template>
  </AppDialog>

  <!-- Every behaviour kept. -->
  <AppDialog
    :open="opened === 'destructive'"
    :title="`Remove ${removing.name}?`"
    testid="library-destructive"
    :scroll="keptScroll"
    confirm-label="Remove"
    destructive
    @close="closed('destructive')"
    @submit="saved('destructive', `Removed ${removing.name}`)"
  >
    <p class="library-text">
      {{ removing.email }} loses access to this market at once; what they did here stays.
    </p>
  </AppDialog>

  <AppDialog
    :open="opened === 'error'"
    title="Change the amount owed"
    testid="library-error"
    :scroll="keptScroll"
    confirm-label="Save"
    :error="failure"
    @close="closed('error')"
    @submit="failToSave"
  >
    <label class="library-field">
      <span class="field-label">Amount owed</span>
      <input v-model="owed" class="field" inputmode="decimal" />
    </label>
  </AppDialog>

  <AppDialog
    :open="opened === 'inFlight'"
    title="Name the template"
    testid="library-in-flight"
    :scroll="keptScroll"
    :confirm-label="inFlight ? 'Saving…' : 'Save'"
    :confirm-disabled="inFlight"
    :close-disabled="inFlight"
    @close="closed('inFlight')"
    @submit="inFlight = true"
  >
    <p class="library-text">Save, then let it land when you have looked at the hold.</p>
    <button
      type="button"
      class="btn btn--secondary"
      :disabled="!inFlight"
      data-testid="library-in-flight-land"
      @click="letTheSaveLand"
    >
      Let the save land
    </button>
  </AppDialog>

  <AppDialog
    :open="opened === 'anchored'"
    title="Add an address"
    testid="library-anchored"
    :scroll="keptScroll"
    anchored
    confirm-label="Add"
    :confirm-disabled="!addressOk"
    @close="closed('anchored')"
    @submit="saved('anchored', `Added ${address.trim()}`)"
  >
    <label class="library-field">
      <span class="field-label">Email address</span>
      <input v-model="address" class="field" type="email" data-testid="library-anchored-address" />
    </label>
    <p v-if="addressError" class="library-field-error" data-testid="library-anchored-field-error">
      {{ addressError }}
    </p>
  </AppDialog>

  <AppDialog
    :open="opened === 'several'"
    title="Manage market"
    testid="library-several"
    :scroll="keptScroll"
    size="wide"
    @close="closed('several')"
  >
    <form class="library-add" @submit.prevent="addUser">
      <label class="library-field library-add__field">
        <span class="field-label">Add a user by email address</span>
        <input v-model="added" class="field" type="email" />
      </label>
      <button type="submit" class="btn btn--primary">Add user</button>
    </form>
    <ul class="library-people" aria-label="People with access">
      <li v-for="person in people" :key="person.id" class="library-person">
        <span class="library-person__words">
          <span>{{ person.name }}</span>
          <span class="library-quiet">{{ person.email }}</span>
        </span>
        <select
          class="field field--select library-person__role"
          :aria-label="`${person.name}'s role`"
          :value="roles[person.id]"
          @change="changeRole(person.id, ($event.target as HTMLSelectElement).value as MarketRole)"
        >
          <option v-for="role in ROLES" :key="role" :value="role">
            {{ getRoleDisplayName(role) }}
          </option>
        </select>
      </li>
    </ul>
  </AppDialog>
</template>

<style scoped>
.library-wide {
  grid-column: 1 / -1;
}

.library-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}

.library-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.library-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.library-quiet {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

.library-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.library-field-error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}

/* The broad dialog's groups of columns, side by side where they fit. */
.library-columns {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
  gap: var(--space-4);
}

.library-group {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.library-group legend {
  padding: 0;
}

.library-check {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: max(2rem, var(--target-min));
  font-size: var(--text-sm);
  color: var(--mm-black);
  cursor: pointer;
}

.library-tray-title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
}

.library-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.library-add {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-2);
}

.library-add__field {
  flex: 1 1 14rem;
}

.library-people {
  display: flex;
  flex-direction: column;
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
}

.library-person__role {
  width: auto;
  flex: none;
}
</style>
