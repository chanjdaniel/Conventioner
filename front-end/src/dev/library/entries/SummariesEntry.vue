<script setup lang="ts">
/**
 * The summaries (T200): what stands in for a list that unfolds above the work. L4's reviewers, one
 * line whose "and 9 more" opens the rest, are on their screen, so the real panel is drawn here; and
 * L3's "Show N reviewed" as a dialog holding the frame over every reviewed application, whose body
 * scrolls and needs nothing else for the frame. The frame keeps no words in the address, since they
 * would outlive the dialog. L9, the Discord report's "Show who", is the real report on the fixture's
 * approved vendors, its groups standing over the frame's rows (T223).
 */
import { ref } from 'vue';
import { MarketPhase, type DiscordRoleRun, type Market } from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import DiscordRoleReport from '@/components/DiscordRoleReport.vue';
import ListFrame from '@/components/ListFrame.vue';
import NameList from '@/components/NameList.vue';
import ReviewersPanel from '@/components/market/ReviewersPanel.vue';
import type { DiscordShown } from '@/utils/discordCheck';
import type { RoleOutcome } from '@/utils/discordRoles';
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

/** L3: today's own list, in the order they arrived, since the fixture keeps no verdict's time. */
const reviewedApplications = reviewed(applications);
const reviewedOpen = ref(false);
const findsApplication = (item: { name: string; email: string }, words: string) =>
  holds(item.name, words) || holds(item.email, words);
const idKey = (item: { id: string }) => item.id;

/**
 * L9: a run over the approved vendors, each outcome as their Discord state on the fixture would leave
 * it, and one vendor since removed. A possible match was not found, and is offered now.
 */
const HELD =
  'Conventioner ran out of its time with Discord before it reached these vendors. Run it again ' +
  'to give them the role.';
const OUTCOME_OF: Record<DiscordShown, RoleOutcome> = {
  has_role: 'already_had',
  in_server: 'given',
  not_found: 'not_found',
  possible_match: 'not_found',
  no_username: 'no_username',
  check_again: 'not_yet',
};
const approved = applications.filter(({ status }) => status === 'reviewer_approved');
const RAN_AT = '2026-10-31T12:00:00+00:00';
const NOW = Date.parse('2026-10-31T12:05:00+00:00');
function runOver(vendors: typeof applications): DiscordRoleRun {
  return {
    ranAt: RAN_AT,
    roleName: 'Vendor Nov 2026',
    outcomes: [
      ...vendors.map(({ id, export: { discordState } }) => {
        const outcome = OUTCOME_OF[discordState];
        return { applicationId: id, outcome, reason: outcome === 'not_yet' ? HELD : null };
      }),
      { applicationId: 'an-application-since-removed', outcome: 'given', reason: null },
    ],
  };
}
const reportAddresses = new Map(applications.map(({ id, email }) => [id, email]));
const reportNames = Object.fromEntries(applications.map(({ email, name }) => [email, name]));
const reportOffered = new Set(
  approved.filter(({ export: e }) => e.discordState === 'possible_match').map(({ id }) => id),
);
const wholeRun = runOver(approved);
const shortRun = runOver(approved.slice(0, 8));

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
    :about="`Every verdict given unfolds above the card today, ${reviewedApplications.length} rows here. In a dialog the card stays where it is, and the frame finds one.`"
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
    title='L9: The Discord report&apos;s "Show who", on Vendors'
    :about="`The real report. Its dialog is the frame over one row per vendor, ${wholeRun.outcomes.length} here: past 12 it finds one by name or address and draws 50 at a time, each group's outcome, whole count and reason standing over its first drawn row, and a group with none drawn not at all. A vendor the page no longer lists is drawn with no words typed, and no words find them. At 12 or fewer it reads with no field and no count.`"
  >
    <LibraryPanel label="A run over every approved vendor" class="library-wide">
      <DiscordRoleReport
        :run="wholeRun"
        :addresses="reportAddresses"
        :names="reportNames"
        :now="NOW"
        :offered="reportOffered"
      />
    </LibraryPanel>
    <LibraryPanel label="A run over 8: no field" class="library-wide">
      <DiscordRoleReport
        :run="shortRun"
        :addresses="reportAddresses"
        :names="reportNames"
        :now="NOW"
        :offered="reportOffered"
      />
    </LibraryPanel>
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
