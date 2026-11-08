<script setup lang="ts">
/**
 * The summaries (T200): what stands in for a list that unfolds above the work. L4's reviewers, one
 * line whose "and 9 more" opens the rest, are on their screen, so the real panel is drawn here; and
 * L3's "Show N reviewed", as One by one has it, a dialog holding the frame over every reviewed
 * application, whose body scrolls and needs nothing else for the frame. The frame keeps no words in
 * the address, since they would outlive the dialog.
 */
import { ref } from 'vue';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import EmailAddress from '@/components/EmailAddress.vue';
import ListFrame from '@/components/ListFrame.vue';
import NameList from '@/components/NameList.vue';
import ReviewersPanel from '@/components/market/ReviewersPanel.vue';
import { reviewed } from '@/utils/reviewQueue';
import { statusChip, statusLabel } from '@/utils/verdicts';
import ChoicesForYou from '../parts/ChoicesForYou.vue';
import LibraryPanel from '../parts/LibraryPanel.vue';
import LibrarySection from '../parts/LibrarySection.vue';
import ReadOut from '../parts/ReadOut.vue';
import { fixture } from '../fixture';

const { applications, people, reviewers } = fixture;

const REVIEWER = { one: 'reviewer', many: 'reviewers' };
const APPLICATION = { one: 'application', many: 'applications' };

const holds = (text: string, words: string) => text.toLowerCase().includes(words.toLowerCase());

/** An account holds an address and no name, so a reviewer is their address, as the panel has. */
const firstReviewers = reviewers.map((id) => people.find((person) => person.id === id)!.email);

const l4About =
  'On its screen, so this is the real panel, for someone who may not change the reviewers. It names 3, those who can no longer review here first, and "and 9 more" opens all of them. Someone who may has "Change reviewers" as well, and their "and 9 more" opens that dialog, whose chips are the list.';

/** The real panel on the first `count` reviewers, those at the `unable` places marked. */
const teamOf = (count: number, unable: readonly number[] = []) =>
  ({
    phase: MarketPhase.Applications,
    reviewTeam: {
      reviewers: firstReviewers
        .slice(0, count)
        .map((email, place) => ({ email, able: !unable.includes(place) })),
    },
  }) as Market;

/** L3: the reviewed list, in the order they arrived, since the fixture keeps no verdict's time. */
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
    <LibraryPanel label="Twelve reviewers">
      <ReviewersPanel :market="teamOf(12)" />
    </LibraryPanel>
    <LibraryPanel label="One can no longer review: named first">
      <ReviewersPanel :market="teamOf(12, [6])" />
    </LibraryPanel>
    <LibraryPanel label="Five can no longer review: two folded">
      <ReviewersPanel :market="teamOf(12, [1, 3, 5, 7, 9])" />
    </LibraryPanel>
    <LibraryPanel label="Three: all said, no button">
      <ReviewersPanel :market="teamOf(3)" />
    </LibraryPanel>
    <LibraryPanel label="None chosen">
      <ReviewersPanel :market="teamOf(0)" />
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title='L3: "Show N reviewed", on Applications One by one'
    :about="`Every verdict given, ${reviewedApplications.length} rows here, in a dialog: the card stays where it is, and the frame finds one. L9, the Discord report's &quot;Show who&quot;, opens a dialog too, its vendors in their groups with no frame yet.`"
  >
    <LibraryPanel label="The reviewed list in a dialog" class="library-wide">
      <div class="library-demo">
        <button
          type="button"
          class="library-reviewed-open"
          data-testid="library-l3-open"
          @click="reviewedOpen = true"
        >
          Show {{ reviewedApplications.length }} reviewed
        </button>
        <p class="library-quiet">
          Rows as One by one's, without who gave the verdict, which the fixture does not hold, and
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
      anchored
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
              <span class="library-reviewed__name" data-testid="library-l3-name">
                {{ item.name }}
              </span>
              <span data-testid="library-l3-email"><EmailAddress :words="item.email" /></span>
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

.library-quiet {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.4;
  color: var(--mm-text-muted);
}

/* The button, as `ApplicationMonitor.vue` draws it. */
.library-reviewed-open {
  min-height: var(--target-min);
  padding: 0;
  border: none;
  background: none;
  font-size: var(--text-xs);
  color: var(--mm-green);
  text-decoration: underline;
  cursor: pointer;
}

/* A reviewed row, as `ApplicationMonitor.vue` draws it: the verdict beside who, at every width. */
.library-reviewed {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  color: var(--mm-black);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
}

.library-reviewed__who {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 var(--space-2);
  min-width: 0;
}

.library-reviewed__name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.library-reviewed .chip {
  justify-self: end;
}
</style>
