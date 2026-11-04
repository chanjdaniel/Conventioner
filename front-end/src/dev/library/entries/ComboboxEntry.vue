<script setup lang="ts">
/**
 * The combobox (T200): `SearchPicker` grown, on the fixture's data at a real market's size. It
 * opens on C7, "Who will follow up", capped among 150 people as its dialog and card are, then the
 * cap on a long plain list and across groups, and the states the cap brings. Several choices follow:
 * C5, the reviewers as Choose reviewers draws them, and C10's answers.
 * Typed text ends it: C1, the import's value fixes, beside today's real row with its native select,
 * and C3's option input, which keeps a new answer as typed.
 *
 * Every picker here is the real `SearchPicker`; the line under each reads out what it holds, so a
 * choice is seen to land.
 */
import { computed, ref } from 'vue';
import SearchPicker, { type PickerGroup, type PickerOption } from '@/components/SearchPicker.vue';
import ValueFixes from '@/components/ValueFixes.vue';
import { IGNORE_VALUE } from '@/utils/valueFixes';
import LibrarySection from '../parts/LibrarySection.vue';
import LibraryPanel from '../parts/LibraryPanel.vue';
import TodayAndProposed from '../parts/TodayAndProposed.vue';
import ChoicesForYou from '../parts/ChoicesForYou.vue';
import ReadOut from '../parts/ReadOut.vue';
import { fixture } from '../fixture';

const { people, question, reviewers, valuesToFix, export: offered } = fixture;

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
    ],
  },
  {
    label: 'Reviewers',
    options: reviewers.map((id) => {
      const { email } = people.find((candidate) => candidate.id === id)!;
      return { value: email, label: email };
    }),
  },
];
const assignee = ref('');
const assigneeLabel = computed(
  () => assigneeGroups[0]!.options.find(({ value }) => value === assignee.value)?.label ?? '',
);

/** A choice the first 50 rows do not reach. */
const pastTheCap = ref(people[120]!.email);

/** A filter's choice, which words only search over. */
const heldChoice = ref(people[0]!.email);

const nobody = ref('');

/** C5 on both sides: the fixture's 12 reviewers already chosen, by address as the market keeps them. */
const reviewerAddresses = reviewers.map((id) => people.find((person) => person.id === id)!.email);
const allAddresses = people.map((person) => person.email);
const proposedReviewers = ref([...reviewerAddresses]);
/** An account holds an address and no name, so a reviewer's row and chip are the address. */
const accountGroups: PickerGroup[] = [
  { options: allAddresses.map((email) => ({ value: email, label: email })) },
];

/** C10's answers, none chosen yet. */
const rejected = ref<string[]>([]);

/** The first page's rows would hold neither: past the cap, both are drawn first. */
const pastTheCapSeveral = ref([people[120]!.email, people[140]!.email]);

/** The reader's own address: "You" beside it in the list, "(you)" on its chip. */
const withMeGroups: PickerGroup[] = [
  {
    options: allAddresses
      .slice(0, 10)
      .map((email) =>
        email === allAddresses[0]
          ? { value: email, label: email, detail: 'You', chip: `${email} (you)` }
          : { value: email, label: email },
      ),
  },
];
const withMe = ref([allAddresses[0]!, allAddresses[1]!]);

/** A reviewer the reader is no longer offered is still chosen: their chip is their address. */
const notOfferedGroups: PickerGroup[] = [{ options: personGroups[0]!.options.slice(0, 10) }];
const notOffered = ref([people[0]!.email, people[149]!.email]);

/** The longest answers the question holds, so a chip's words meet a phone's width. */
const longestAnswers = [...question.options]
  .map(({ label }) => label)
  .sort((a, b) => b.length - a.length)
  .slice(0, 3);
const longAnswers = ref([...longestAnswers]);

const IGNORE_LABEL = 'Ignore this value';
/** A value's fix is one of the question's answers, or ignoring it, which the cap must not hide. */
const fixGroups: PickerGroup[] = [
  {
    options: [{ value: IGNORE_VALUE, label: IGNORE_LABEL }, ...optionGroups[0]!.options],
  },
];
const offeredAnswers = question.options.map(({ label }) => label);

/** C1 today: the real control, on one row, since each row draws every option. */
const todayFixes = [{ target: question.label, value: valuesToFix[0]!, offered: offeredAnswers }];
const todayFix = ref('');

/** The rows shown before "Show all", as the start's set-aside values are today. */
const FIRST_FIXES = 6;
const allFixes = ref(false);
const shownFixes = computed(() =>
  allFixes.value ? valuesToFix : valuesToFix.slice(0, FIRST_FIXES),
);
const fixes = ref<Record<string, string>>({});
const fixedCount = computed(() => valuesToFix.filter((value) => fixes.value[value]).length);
function fixReadOut(fix: string | undefined): string {
  if (!fix) return '';
  if (fix === IGNORE_VALUE) return IGNORE_LABEL;
  return offeredAnswers.includes(fix) ? fix : `${fix}, as typed`;
}

/** C3: an option's input, which takes one of the answers already offered or a new one. */
const newAnswer = ref('');
const keptAnswer = ref('Hand-poured soap');
const firstAnswer = ref('');
const typedAnswers = ref<string[]>([]);
</script>

<template>
  <LibrarySection
    title="One choice from many"
    about="One choice serves C2, C6, C7, C8, C9, C13 and C14. C6 and C7 are on their screens; the others are the native selects and the datalist that hold a long list today."
  >
    <LibraryPanel :label="`Found by name or address, capped at ${CAP} (C7's shape)`">
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
    </LibraryPanel>

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
          placeholder="Type an address…"
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

    <LibraryPanel label="A choice that holds: words only search, for a filter or a card">
      <div class="library-demo">
        <SearchPicker
          v-model="heldChoice"
          holds-choice
          :groups="personGroups"
          :finds="findsPerson"
          :cap="CAP"
          label="Who will follow up"
          testid="library-holds"
        />
        <ReadOut label="Chosen" :value="nameOf(heldChoice)" />
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
    <LibraryPanel
      :label="`C5: the reviewers among ${people.length}, as Choose reviewers draws them`"
    >
      <div class="library-demo">
        <SearchPicker
          v-model="proposedReviewers"
          multiple
          :groups="accountGroups"
          :finds="findsByLabel"
          :cap="CAP"
          label="Reviewers"
          placeholder="Type an address…"
          testid="library-c5"
        />
        <ReadOut label="Chosen" :value="proposedReviewers" />
      </div>
    </LibraryPanel>

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

    <LibraryPanel
      label="Choices past the cap: drawn first, so every choice opens ticked at the top"
    >
      <div class="library-demo">
        <SearchPicker
          v-model="pastTheCapSeveral"
          multiple
          :groups="accountGroups"
          :finds="findsByLabel"
          :cap="CAP"
          label="Reviewers"
          placeholder="Type an address…"
          testid="library-several-past-cap"
        />
        <ReadOut label="Chosen" :value="pastTheCapSeveral" />
      </div>
    </LibraryPanel>

    <LibraryPanel label="A chip's own words: the reader's address reads (you)">
      <div class="library-demo">
        <SearchPicker
          v-model="withMe"
          multiple
          :groups="withMeGroups"
          :finds="findsByLabel"
          label="Reviewers"
          placeholder="Type an address…"
          testid="library-chip-words"
        />
        <ReadOut label="Chosen" :value="withMe" />
      </div>
    </LibraryPanel>

    <LibraryPanel label="Disabled: nothing is taken while the choice is being saved">
      <div class="library-demo">
        <SearchPicker
          :model-value="withMe"
          multiple
          disabled
          :groups="withMeGroups"
          :finds="findsByLabel"
          label="Reviewers"
          placeholder="Type an address…"
          testid="library-disabled"
        />
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

  <LibrarySection
    title="Typed text kept"
    about="Typed text serves C1, C3 and F08: a native select of every answer on each row of the import's value fixes, and a question's options, where a new answer is never lost."
  >
    <TodayAndProposed
      :today="`Today: a native select of ${question.options.length} answers on every row (C1)`"
      proposed="Proposed: found by typing, or kept as typed, the rows behind a cap"
    >
      <template #today>
        <div class="library-demo" data-testid="library-c1-today">
          <ValueFixes
            :entries="todayFixes"
            :resolution-for="() => todayFix"
            testid="library-c1-today"
            @resolve="(_target, _value, choice) => (todayFix = choice)"
          />
          <ReadOut label="Fix" :value="fixReadOut(todayFix)" />
        </div>
      </template>
      <template #proposed>
        <div class="library-fixes">
          <div
            v-for="(value, at) in shownFixes"
            :key="value"
            class="library-demo"
            role="group"
            :aria-labelledby="`library-c1-value-${at}`"
            data-testid="library-c1-value"
          >
            <code :id="`library-c1-value-${at}`" class="library-fix-value">{{ value }}</code>
            <SearchPicker
              :model-value="fixes[value] ?? ''"
              :groups="fixGroups"
              :finds="findsByLabel"
              :cap="CAP"
              accepts-typed
              label="What it means"
              placeholder="Type to find an answer…"
              none-word="Nothing"
              :testid="`library-c1-fix-${at}`"
              @update:model-value="fixes[value] = $event as string"
            />
            <ReadOut label="Fix" :value="fixReadOut(fixes[value])" />
          </div>
          <div class="library-fixes-foot">
            <button
              type="button"
              class="btn btn--compact btn--secondary"
              data-testid="library-c1-show-all"
              @click="allFixes = !allFixes"
            >
              {{ allFixes ? 'Show fewer' : `Show all ${valuesToFix.length}` }}
            </button>
            <div data-testid="library-c1-fixed">
              <ReadOut label="Fixed" :value="`${fixedCount} of ${valuesToFix.length}`" />
            </div>
          </div>
        </div>
      </template>
    </TodayAndProposed>

    <LibraryPanel label="A new answer, kept as typed (C3's shape)">
      <div class="library-demo">
        <SearchPicker
          v-model="newAnswer"
          :groups="optionGroups"
          :finds="findsByLabel"
          :cap="CAP"
          accepts-typed
          label="Option 1"
          placeholder="Type an answer…"
          none-word="Nothing"
          testid="library-c3"
        />
        <ReadOut label="Answer" :value="newAnswer" />
      </div>
    </LibraryPanel>

    <LibraryPanel label="An answer kept: Enter keeps it">
      <div class="library-demo">
        <SearchPicker
          v-model="keptAnswer"
          :groups="optionGroups"
          :finds="findsByLabel"
          :cap="CAP"
          accepts-typed
          label="Option 1"
          none-word="Nothing"
          testid="library-typed-kept"
        />
        <ReadOut label="Answer" :value="keptAnswer" />
      </div>
    </LibraryPanel>

    <LibraryPanel label="No options yet: the list opens for words">
      <div class="library-demo">
        <SearchPicker
          v-model="firstAnswer"
          :groups="[]"
          :finds="findsByLabel"
          accepts-typed
          label="Option 1"
          placeholder="Type an answer…"
          none-word="Nothing"
          testid="library-typed-first"
        />
        <ReadOut label="Answer" :value="firstAnswer" />
      </div>
    </LibraryPanel>

    <LibraryPanel label="Several: a typed answer is a chip of its own">
      <div class="library-demo">
        <SearchPicker
          v-model="typedAnswers"
          multiple
          :groups="optionGroups"
          :finds="findsByLabel"
          :cap="CAP"
          accepts-typed
          :label="question.label"
          placeholder="Type an answer…"
          none-word="Nothing"
          testid="library-typed-chips"
        />
        <ReadOut label="Chosen" :value="typedAnswers" />
      </div>
    </LibraryPanel>
  </LibrarySection>

  <ChoicesForYou>
    <li>
      The value fixes' rows: 6 and "Show all", as here, on values still waiting too; or every
      waiting value shown, as today, with the cap only on those already decided.
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

.library-fixes {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: 100%;
  min-width: 0;
}

/* The value as today's row draws it, so the two sides read alike. */
.library-fix-value {
  align-self: flex-start;
  overflow-wrap: anywhere;
  padding: var(--space-hairline) var(--space-1);
  border-radius: var(--radius-control);
  background: var(--mm-beige);
  font-size: var(--text-xs);
}

.library-fixes-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}
</style>
