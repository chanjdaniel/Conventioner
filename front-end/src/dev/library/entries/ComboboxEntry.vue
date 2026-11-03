<script setup lang="ts">
/**
 * The combobox (T200): `SearchPicker` grown, on the fixture's data at a real market's size. It
 * opens on C7, "Who will follow up", beside today's native select of the same 150 people, then the
 * cap on a long plain list and across groups, and the states the cap brings. Several choices follow:
 * C5, the reviewers, beside today's real chooser with its checkbox per person, and C10's answers.
 *
 * Every picker here is the real `SearchPicker`; the line under each reads out what it holds, so a
 * choice is seen to land.
 */
import { computed, ref } from 'vue';
import SearchPicker, { type PickerGroup, type PickerOption } from '@/components/SearchPicker.vue';
import ReviewerPicker from '@/components/market/ReviewerPicker.vue';
import LibrarySection from '../parts/LibrarySection.vue';
import LibraryPanel from '../parts/LibraryPanel.vue';
import TodayAndProposed from '../parts/TodayAndProposed.vue';
import ChoicesForYou from '../parts/ChoicesForYou.vue';
import ReadOut from '../parts/ReadOut.vue';
import { fixture } from '../fixture';

const { people, question, reviewers, export: offered } = fixture;

/** What a screen would cap its match list at; the grouped demo's is smaller, to cross a group. */
const CAP = 50;
const GROUPED_CAP = 20;

const holds = (text: string, words: string) => text.toLowerCase().includes(words.toLowerCase());
const findsByLabel = (option: PickerOption, words: string) => holds(option.label, words);
/** By name or by address, as the survey asks of C7. */
const findsPerson = (option: PickerOption, words: string) =>
  holds(option.label, words) || holds(option.detail ?? '', words);

const personGroups: PickerGroup[] = [
  {
    options: people.map((person) => ({
      value: person.email,
      label: person.name,
      detail: person.email,
    })),
  },
];
const nameOf = (email: string) => people.find((person) => person.email === email)?.name ?? '';

/** C7 today: every address in a native select, on the reviewer themself until they choose. */
const me = people[0]!.email;
const todayOwner = ref(me);
const proposedOwner = ref('');

const optionGroups: PickerGroup[] = [
  { options: question.options.map(({ label }) => ({ value: label, label })) },
];
const answer = ref('');

/** C2's shape: a long list under headings, on the export's columns in the product's groups. */
const columnGroups: PickerGroup[] = offered.groups.map((group) => ({
  label: group.label,
  options: offered.columns
    .filter((column) => column.group === group.id)
    .map((column) => ({ value: column.id, label: column.label })),
}));
const column = ref('');
const columnLabel = computed(
  () => offered.columns.find(({ id }) => id === column.value)?.label ?? '',
);

/** C6's shape: Me, Anyone and every chosen reviewer, which the cap leaves whole. */
const assigneeGroups: PickerGroup[] = [
  {
    options: [
      { value: 'me', label: 'Me' },
      { value: 'anyone', label: 'Anyone' },
      ...reviewers.map((id) => {
        const person = people.find((candidate) => candidate.id === id)!;
        return { value: person.email, label: person.name };
      }),
    ],
  },
];
const assignee = ref('');
const assigneeLabel = computed(
  () => assigneeGroups[0]!.options.find(({ value }) => value === assignee.value)?.label ?? '',
);

/** A choice the first 50 rows do not reach. */
const pastTheCap = ref(people[120]!.email);

const nobody = ref('');

/** C5 on both sides: the fixture's 12 reviewers already chosen, by address as the market keeps them. */
const reviewerAddresses = reviewers.map((id) => people.find((person) => person.id === id)!.email);
const allAddresses = people.map((person) => person.email);
const todayReviewers = ref([...reviewerAddresses]);
const proposedReviewers = ref([...reviewerAddresses]);
const namesOf = (emails: string[]) => emails.map((email) => nameOf(email) || email);

/** C10's answers, none chosen yet. */
const rejected = ref<string[]>([]);

/** The first page's rows hold neither: both are found again only by the words. */
const pastTheCapSeveral = ref([people[120]!.email, people[140]!.email]);

/** A reviewer the reader is no longer offered is still chosen: their chip is their address. */
const notOfferedGroups: PickerGroup[] = [{ options: personGroups[0]!.options.slice(0, 10) }];
const notOffered = ref([people[0]!.email, people[149]!.email]);

/** The longest answers the question holds, so a chip's words meet a phone's width. */
const longestAnswers = [...question.options]
  .map(({ label }) => label)
  .sort((a, b) => b.length - a.length)
  .slice(0, 3);
const longAnswers = ref([...longestAnswers]);
</script>

<template>
  <LibrarySection
    title="One choice from many"
    about="One choice serves C2, C6, C7, C8, C9, C13 and C14: the native selects and the datalist that hold a long list today."
  >
    <TodayAndProposed
      :today="`Today: a native select of ${people.length} addresses (C7)`"
      :proposed="`Proposed: found by name or address, capped at ${CAP}`"
    >
      <template #today>
        <div class="library-demo" data-testid="library-c7-today">
          <div>
            <label class="field-label" for="library-c7-today-field">Who will follow up</label>
            <select id="library-c7-today-field" v-model="todayOwner" class="field field--select">
              <option v-for="person in people" :key="person.id" :value="person.email">
                {{ person.email === me ? `${person.email} (you)` : person.email }}
              </option>
            </select>
          </div>
          <ReadOut label="Chosen" :value="todayOwner" />
        </div>
      </template>
      <template #proposed>
        <div class="library-demo">
          <SearchPicker
            v-model="proposedOwner"
            :groups="personGroups"
            :finds="findsPerson"
            :cap="CAP"
            label="Who will follow up"
            placeholder="Type a name or address…"
            testid="library-c7"
          />
          <ReadOut label="Chosen" :value="nameOf(proposedOwner)" />
        </div>
      </template>
    </TodayAndProposed>

    <LibraryPanel :label="`${question.options.length} options, capped at ${CAP} (C13's shape)`">
      <div class="library-demo">
        <SearchPicker
          v-model="answer"
          :groups="optionGroups"
          :finds="findsByLabel"
          :cap="CAP"
          :label="question.label"
          placeholder="Type to find an answer…"
          none-word="Nothing"
          testid="library-options"
        />
        <ReadOut label="Chosen" :value="answer" />
      </div>
    </LibraryPanel>

    <LibraryPanel :label="`Grouped, capped at ${GROUPED_CAP} across the groups (C2's shape)`">
      <div class="library-demo">
        <SearchPicker
          v-model="column"
          :groups="columnGroups"
          :finds="findsByLabel"
          :cap="GROUPED_CAP"
          label="Maps to"
          placeholder="Type to find a column…"
          none-word="Nothing"
          testid="library-grouped"
        />
        <ReadOut label="Chosen" :value="columnLabel" />
      </div>
    </LibraryPanel>

    <LibraryPanel label="Under the cap: no line (C6's shape)">
      <div class="library-demo">
        <SearchPicker
          v-model="assignee"
          :groups="assigneeGroups"
          :finds="findsByLabel"
          :cap="CAP"
          label="Assigned to"
          placeholder="Type a name…"
          testid="library-under-cap"
        />
        <ReadOut label="Chosen" :value="assigneeLabel" />
      </div>
    </LibraryPanel>

    <LibraryPanel label="A choice past the cap: the field names it, Enter keeps it">
      <div class="library-demo">
        <SearchPicker
          v-model="pastTheCap"
          :groups="personGroups"
          :finds="findsPerson"
          :cap="CAP"
          label="Who will follow up"
          testid="library-past-cap"
        />
        <ReadOut label="Chosen" :value="nameOf(pastTheCap)" />
      </div>
    </LibraryPanel>

    <LibraryPanel label="No choices at all: the list never opens">
      <div class="library-demo">
        <SearchPicker
          v-model="nobody"
          :groups="[]"
          :finds="findsPerson"
          :cap="CAP"
          label="Who will follow up"
          placeholder="Nobody to choose yet"
          testid="library-no-choices"
        />
        <ReadOut label="Chosen" :value="nobody" />
      </div>
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="Several choices, as chips"
    about="Several choices serve C5, C10, C11 and C12: a checkbox per person or per answer today, up to 150 people and 230 answers, and the rule that ranks a field's options."
  >
    <TodayAndProposed
      :today="`Today: a checkbox per person, all ${people.length} drawn (C5)`"
      proposed="Proposed: the chosen as chips, the rest found by typing"
    >
      <template #today>
        <div class="library-demo" data-testid="library-c5-today">
          <ReviewerPicker
            v-model="todayReviewers"
            :candidates="allAddresses"
            :current="reviewerAddresses"
          />
          <ReadOut label="Ticked" :value="`${todayReviewers.length} of ${people.length}`" />
        </div>
      </template>
      <template #proposed>
        <div class="library-demo">
          <SearchPicker
            v-model="proposedReviewers"
            multiple
            :groups="personGroups"
            :finds="findsPerson"
            :cap="CAP"
            label="Reviewers"
            placeholder="Type a name or address…"
            testid="library-c5"
          />
          <ReadOut label="Chosen" :value="namesOf(proposedReviewers)" />
        </div>
      </template>
    </TodayAndProposed>

    <LibraryPanel
      :label="`${question.options.length} answers, capped at ${CAP}, none chosen yet (C10's shape)`"
    >
      <div class="library-demo">
        <SearchPicker
          v-model="rejected"
          multiple
          :groups="optionGroups"
          :finds="findsByLabel"
          :cap="CAP"
          :label="`Reject when “${question.label}” is`"
          placeholder="Type to find an answer…"
          none-word="Nothing"
          testid="library-c10"
        />
        <ReadOut label="Chosen" :value="rejected" />
      </div>
    </LibraryPanel>

    <LibraryPanel label="Choices past the cap: not in the list, still chips">
      <div class="library-demo">
        <SearchPicker
          v-model="pastTheCapSeveral"
          multiple
          :groups="personGroups"
          :finds="findsPerson"
          :cap="CAP"
          label="Reviewers"
          placeholder="Type a name or address…"
          testid="library-several-past-cap"
        />
        <ReadOut label="Chosen" :value="namesOf(pastTheCapSeveral)" />
      </div>
    </LibraryPanel>

    <LibraryPanel label="A choice no longer offered: its chip is its address">
      <div class="library-demo">
        <SearchPicker
          v-model="notOffered"
          multiple
          :groups="notOfferedGroups"
          :finds="findsPerson"
          label="Reviewers"
          placeholder="Type a name or address…"
          testid="library-not-offered"
        />
        <ReadOut label="Chosen" :value="notOffered" />
      </div>
    </LibraryPanel>

    <LibraryPanel label="The longest answers: a chip's words wrap inside it">
      <div class="library-demo">
        <SearchPicker
          v-model="longAnswers"
          multiple
          :groups="optionGroups"
          :finds="findsByLabel"
          :cap="CAP"
          :label="question.label"
          placeholder="Type to find an answer…"
          none-word="Nothing"
          testid="library-long-chips"
        />
        <ReadOut label="Chosen" :value="longAnswers" />
      </div>
    </LibraryPanel>
  </LibrarySection>

  <ChoicesForYou>
    <li>
      The threshold: past how many choices a native select becomes a combobox. About 12 to start.
    </li>
    <li>The cap: how many matches are drawn before "N more, type to narrow". 50, or fewer.</li>
    <li>
      The match order: matches in the option order, as here, or those starting with the words first.
    </li>
    <li>The chips: above the field, as here, or inside it.</li>
    <li>
      Chosen rows past the cap: left where they fall, as here, so 8 of C5's 12 are not drawn until
      typed for and each still has its chip; or drawn first, so every choice opens ticked at the top
      of the list.
    </li>
    <li>
      After a choice among several: the words stay, selected so the next word replaces them, as
      here, so more of what they found can be chosen in a row; or the field clears and the list
      starts again.
    </li>
    <li>
      The keyboard's way past the chips: each chip's button is a stop before the field, as here, or
      the chips are one stop, walked by the arrow keys.
    </li>
  </ChoicesForYou>
</template>

<style scoped>
.library-demo {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
}
</style>
