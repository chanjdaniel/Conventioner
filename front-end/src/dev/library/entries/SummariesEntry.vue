<script setup lang="ts">
/**
 * The summaries (T200): what stands in for a list that today unfolds above the work. L4's reviewers
 * as one line beside the real panel that lists them all, whose "and 9 more" opens Change reviewers,
 * with the chooser and the chosen in a frame; and L3's "Show N reviewed" as a dialog holding the
 * frame over every reviewed application. Both dialogs scroll their body and need nothing else for
 * the frame. Neither frame keeps its words in the address, since they would outlive the dialog.
 */
import { computed, nextTick, ref } from 'vue';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import ListFrame from '@/components/ListFrame.vue';
import NameList from '@/components/NameList.vue';
import SearchPicker, { type PickerGroup, type PickerOption } from '@/components/SearchPicker.vue';
import ReviewersPanel from '@/components/market/ReviewersPanel.vue';
import { NONE_CHOSEN, RESHUFFLE } from '@/utils/reviewTeam';
import { reviewed } from '@/utils/reviewQueue';
import { statusChip, statusLabel } from '@/utils/verdicts';
import ChoicesForYou from '../parts/ChoicesForYou.vue';
import LibraryPanel from '../parts/LibraryPanel.vue';
import LibrarySection from '../parts/LibrarySection.vue';
import ReadOut from '../parts/ReadOut.vue';
import TodayAndProposed from '../parts/TodayAndProposed.vue';
import { fixture } from '../fixture';

const { applications, people, reviewers } = fixture;

const REVIEWER = { one: 'reviewer', many: 'reviewers' };
const APPLICATION = { one: 'application', many: 'applications' };
/** How many the line names; past it the line has a button. */
const NAMED = 3;
/** What the chooser draws of what the words find, as the combobox entry's C5 does. */
const CAP = 50;

const holds = (text: string, words: string) => text.toLowerCase().includes(words.toLowerCase());
const findsByLabel = (option: PickerOption, words: string) => holds(option.label, words);

/** An account holds an address and no name, so a reviewer is their address, as today's panel has. */
const firstReviewers = reviewers.map((id) => people.find((person) => person.id === id)!.email);
const accountGroups: PickerGroup[] = [
  { options: people.map(({ email }) => ({ value: email, label: email, address: true })) },
];

const l4About = `Every reviewer is listed above the work today, and that can be everyone with access. Today's panel is drawn here for someone who may not change them; someone who may has "Change reviewers" as well. The line names ${NAMED} and opens the rest.`;

/** Today's real panel, read by someone who may not change them, so it only lists. */
const todayMarket = {
  phase: MarketPhase.Applications,
  reviewTeam: { reviewers: firstReviewers.map((email) => ({ email, able: true })) },
} as Market;

const chosen = ref([...firstReviewers]);
/** What the dialog holds until Save, as today's does. */
const held = ref<string[]>([]);
const changing = ref(false);
const action = computed(() => (chosen.value.length ? 'Change reviewers' : 'Choose reviewers'));
const changeButton = ref<HTMLButtonElement>();

function startChanging(): void {
  held.value = [...chosen.value];
  changing.value = true;
}

async function save(): Promise<void> {
  chosen.value = [...held.value];
  changing.value = false;
  await nextTick();
  // "and N more" may have opened this and gone with the save, and the page is live again by now.
  if (chosen.value.length <= NAMED) changeButton.value?.focus();
}

const findsReviewer = (address: string, words: string) => holds(address, words);
const addressKey = (address: string) => address;

/** L3: today's own list, in the order they arrived, since the fixture keeps no verdict's time. */
const reviewedApplications = reviewed(applications);
const reviewedOpen = ref(false);
const findsApplication = (item: { name: string; email: string }, words: string) =>
  holds(item.name, words) || holds(item.email, words);
const idKey = (item: { id: string }) => item.id;

/** The states of the line itself, on people's names, as it reads once an account holds one. */
const names = people.map(({ name }) => name);
const presses = ref(0);
</script>

<template>
  <LibrarySection title="L4: The reviewers, on the Applications tab" :about="l4About">
    <TodayAndProposed
      today="Today: every reviewer listed"
      proposed="Proposed: one line, the rest in the dialog"
    >
      <template #today>
        <ReviewersPanel :market="todayMarket" />
      </template>
      <template #proposed>
        <div class="library-demo">
          <div class="library-reviewers-head">
            <h2 class="field-label library-reviewers-title">Reviewers</h2>
            <button
              ref="changeButton"
              type="button"
              class="btn btn--secondary btn--compact"
              data-testid="library-l4-change"
              @click="startChanging"
            >
              {{ action }}
            </button>
          </div>
          <NameList
            v-if="chosen.length"
            :names="chosen"
            :noun="REVIEWER"
            :named="NAMED"
            testid="library-l4-line"
            @more="startChanging"
          />
          <p v-else class="library-quiet" data-testid="library-l4-none">{{ NONE_CHOSEN }}</p>
          <ReadOut label="Saved" :value="`${chosen.length} chosen`" />
        </div>
      </template>
    </TodayAndProposed>

    <AppDialog
      :open="changing"
      :title="action"
      testid="library-l4-dialog"
      size="wide"
      scroll="body"
      anchored
      confirm-label="Save reviewers"
      @close="changing = false"
      @submit="save"
    >
      <div class="library-demo">
        <p class="library-reshuffle">{{ RESHUFFLE }}</p>
        <SearchPicker
          v-model="held"
          multiple
          :groups="accountGroups"
          :finds="findsByLabel"
          :cap="CAP"
          label="Reviewers"
          placeholder="Type an address…"
          testid="library-l4-picker"
        />
        <ListFrame
          :items="held"
          :finds="findsReviewer"
          :itemKey="addressKey"
          :noun="REVIEWER"
          findLabel="Find a chosen reviewer"
          testid="library-l4-chosen"
        >
          <template #row="{ item }">
            <span class="library-reviewer" data-testid="library-l4-reviewer">{{ item }}</span>
          </template>
          <template #empty>
            <p>{{ NONE_CHOSEN }}</p>
          </template>
        </ListFrame>
      </div>
    </AppDialog>
  </LibrarySection>

  <LibrarySection
    title='L3: "Show N reviewed", on Applications One by one'
    :about="`Every verdict given unfolds above the card today, ${reviewedApplications.length} rows here. In a dialog the card stays where it is, and the frame finds one. L9, the Discord report's &quot;Show who&quot;, unfolds its vendors the same way and would take the same dialog.`"
  >
    <LibraryPanel label="The reviewed list in a dialog" class="library-wide">
      <div class="library-demo">
        <button
          type="button"
          class="library-reviewed-toggle"
          data-testid="library-l3-open"
          @click="reviewedOpen = true"
        >
          Show {{ reviewedApplications.length }} reviewed
        </button>
        <p class="library-quiet">
          Rows as today's, without who gave the verdict, which the fixture does not hold, and
          without "Approve instead" and "Reject instead", which only someone who may change a
          verdict sees.
        </p>
      </div>
    </LibraryPanel>

    <AppDialog
      :open="reviewedOpen"
      title="Reviewed applications"
      testid="library-l3-dialog"
      size="wide"
      scroll="body"
      @close="reviewedOpen = false"
    >
      <ListFrame
        :items="reviewedApplications"
        :finds="findsApplication"
        :itemKey="idKey"
        :noun="APPLICATION"
        findLabel="Find by name or address"
        testid="library-l3"
      >
        <template #row="{ item }">
          <div class="library-reviewed">
            <span class="library-reviewed__who">
              <span data-testid="library-l3-name">{{ item.name }}</span>
              <span class="library-reviewed__address">{{ item.email }}</span>
            </span>
            <span :class="statusChip(item.status)">{{ statusLabel(item.status) }}</span>
          </div>
        </template>
      </ListFrame>
    </AppDialog>
  </LibrarySection>

  <LibrarySection
    title="The names line"
    about="NameList on people's names, each count it can be given. Past what it names, its button is the way to the whole list; at or under it, the sentence has said everyone."
  >
    <LibraryPanel label="No names">
      <NameList :names="[]" :noun="REVIEWER" testid="library-names-0" />
    </LibraryPanel>
    <LibraryPanel label="One name">
      <NameList :names="names.slice(0, 1)" :noun="REVIEWER" testid="library-names-1" />
    </LibraryPanel>
    <LibraryPanel label="Three names: all said, no button">
      <NameList :names="names.slice(0, 3)" :noun="REVIEWER" testid="library-names-3" />
    </LibraryPanel>
    <LibraryPanel label="Four names: one more">
      <NameList :names="names.slice(0, 4)" :noun="REVIEWER" testid="library-names-4" />
    </LibraryPanel>
    <LibraryPanel label="Twelve names">
      <div class="library-demo">
        <NameList
          :names="names.slice(0, 12)"
          :noun="REVIEWER"
          testid="library-names-12"
          @more="presses += 1"
        />
        <ReadOut label="More pressed" :value="String(presses)" />
      </div>
    </LibraryPanel>
    <LibraryPanel :label="`Everyone with access: ${names.length} names`">
      <NameList :names="names" :noun="REVIEWER" testid="library-names-all" />
    </LibraryPanel>
    <LibraryPanel label="Naming one before the rest">
      <NameList :names="names.slice(0, 12)" :noun="REVIEWER" :named="1" testid="library-named-1" />
    </LibraryPanel>
    <LibraryPanel label="Naming five before the rest">
      <NameList :names="names.slice(0, 12)" :noun="REVIEWER" :named="5" testid="library-named-5" />
    </LibraryPanel>
  </LibrarySection>

  <ChoicesForYou>
    <li>
      <strong>Names named before "and N more":</strong> 3, or another number. L4's are addresses,
      since an account holds no name, so on a phone three of them take several lines.
    </li>
    <li>
      <strong>Chips and the frame together:</strong> the dialog shows who is chosen twice, as the
      chooser's chips and as the frame. Keep both, or only one? The chips remove a person; the frame
      finds one once there are more than 12.
    </li>
    <li>
      <strong>The frame's find field in Change reviewers:</strong> it comes when the 13th person is
      added, which moves the rows down, by the frame's threshold of 12. Keep that, or always show it
      here?
    </li>
    <li>
      <strong>A reviewer who can no longer review:</strong> today's panel marks them, and "(you)",
      on their row. The line says only addresses, so one could sit unseen inside "and 9 more", and
      the frame's rows here do not mark them either. Should the line say how many cannot, and the
      frame mark them?
    </li>
    <li>
      <strong>The words in a dialog:</strong> both dialogs forget them on closing and keep nothing
      in the address. The same for every dialog, or should a reviewed list's words come back?
    </li>
    <li>
      <strong
        >Bars before the fold, unfolding them in place or in a dialog, and rows before a group
        folds:</strong
      >
      10 and 20 to start, asked on the Folds entry with what they fold.
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
  align-items: flex-start;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
}

.library-demo > * {
  max-width: 100%;
}

.library-reviewers-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.library-reviewers-title {
  margin: 0;
}

.library-quiet,
.library-reshuffle {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.4;
}

.library-quiet {
  color: var(--mm-text-muted);
}

.library-reshuffle {
  color: var(--mm-black);
}

.library-reviewer {
  display: block;
  padding: var(--space-1) 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
  border-bottom: 1px solid var(--mm-border);
  overflow-wrap: anywhere;
}

/* Today's toggle, as `ApplicationMonitor.vue` draws it, opening a dialog here. */
.library-reviewed-toggle {
  min-height: var(--target-min);
  padding: 0;
  border: none;
  background: none;
  font-size: var(--text-xs);
  color: var(--mm-green);
  text-decoration: underline;
  cursor: pointer;
}

/* Today's reviewed row: who, then the verdict, wrapping under on a phone. */
.library-reviewed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  color: var(--mm-black);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
}

.library-reviewed__who {
  flex: 1 1 12rem;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 var(--space-2);
  min-width: 0;
  overflow-wrap: anywhere;
}

.library-reviewed__address {
  color: var(--mm-text-muted);
}
</style>
