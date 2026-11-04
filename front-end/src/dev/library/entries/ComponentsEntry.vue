<script setup lang="ts">
/**
 * The reusable components that exist today and mount from their props alone, each in the variants
 * and states its props allow, on the library's fixture: what is shared already, beside what the
 * later entries propose.
 *
 * Every component here is the real one from `src/components/`, mounted as its screens mount it:
 * nothing is copied or restyled. A section names the component and the screens that use it; a
 * panel names the variant, and says so when the variant is a state (failed, empty, disabled,
 * waiting). Where a component answers a press with an event, the line under it reads out what
 * it did.
 */
import { computed, ref } from 'vue';
import { IntakeMode, MarketPhase } from '@/assets/types/datatypes';
import AnswerValue from '@/components/AnswerValue.vue';
import BarLedger from '@/components/BarLedger.vue';
import EmailAddress from '@/components/EmailAddress.vue';
import PhaseBadge from '@/components/PhaseBadge.vue';
import ReadFailed from '@/components/ReadFailed.vue';
import RowMenu from '@/components/RowMenu.vue';
import SignInMessage from '@/components/SignInMessage.vue';
import StepHeader from '@/components/StepHeader.vue';
import SummaryCard from '@/components/SummaryCard.vue';
import VendorNameButton from '@/components/VendorNameButton.vue';
import { OFFLINE_MESSAGE, SERVER_FAULT_MESSAGE, SESSION_ENDED_MESSAGE } from '@/utils/api';
import { ledgerRows } from '@/utils/barLedger';
import { formSteps, type FormStepId } from '@/utils/marketGuide';
import { getRoleDisplayName } from '@/utils/permissions';
import { LINK_RESENT, type SignInNotice } from '@/utils/signInNotice';
import type { SummaryFact } from '@/utils/summary';
import { getDateRange } from '@/utils/utils';
import { statusLabel } from '@/utils/verdicts';
import { vendorHeadline, type VendorNames } from '@/utils/vendorIdentity';
import LibrarySection from '../parts/LibrarySection.vue';
import LibraryPanel from '../parts/LibraryPanel.vue';
import ChoicesForYou from '../parts/ChoicesForYou.vue';
import ReadOut from '../parts/ReadOut.vue';
import { LIBRARY_PATH } from '../catalog';
import { fixture } from '../fixture';

const { applications, people, question, seats } = fixture;
const first = applications[0]!;
const second = applications[1]!;
const third = applications[2]!;
const owner = people.find((person) => person.role === 'owner') ?? people[0]!;

/** The longest of the fixture's addresses: the widest an address line has to hold. */
const longestEmail = applications.reduce(
  (widest, application) => (application.email.length > widest.length ? application.email : widest),
  '',
);

/** The names a screen hands `VendorNameButton`: every applicant's, by address. */
const names: VendorNames = Object.fromEntries(
  applications.map((application) => [application.email.toLowerCase(), application.name]),
);

// ReadFailed: the three things `getApiErrorMessage` says of a read that failed.
const FAILURES = [
  { label: 'Failed: offline', message: OFFLINE_MESSAGE },
  { label: "Failed: the server's fault", message: SERVER_FAULT_MESSAGE },
  { label: 'Failed: the session ended', message: SESSION_ENDED_MESSAGE },
];
const retries = ref(0);

// PhaseBadge: each phase on each intake path, then the two a build can be handed that it lacks.
const PHASES = Object.values(MarketPhase);
const PATHS = [
  { label: 'On our page', mode: IntakeMode.Form },
  { label: 'From a Google Form', mode: IntakeMode.Csv },
];

// SummaryCard: a market's row and an organization's, as their lists build them.
const dates = getDateRange([...new Set(seats.map((seat) => seat.date))]);
const marketFacts: SummaryFact[] = [
  { label: 'Dates', value: dates },
  { label: 'Organization', value: third.business },
];
const marketFactsMissing: SummaryFact[] = [
  { label: 'Dates', value: dates },
  { label: 'Organization', value: 'No longer available', missing: true },
];
const organizationFacts: SummaryFact[] = [
  { label: 'Markets', value: '1' },
  { label: 'Owner', value: owner.email },
];
/** A count of presses, as a person says it. */
const times = (count: number) => `${count} ${count === 1 ? 'time' : 'times'}`;

const cardOpened = ref<string | null>(null);
const cardManaged = ref<string | null>(null);

// EmailAddress: an address alone, the longest, and one in a sentence as the history writes it.
const sentence = `${owner.email} changed ${people[1]!.email}'s role to ${getRoleDisplayName(people[1]!.role)}.`;

// VendorNameButton: a named vendor, and one whose application stored no name.
const opened = ref<string | null>(null);
const unnamed: VendorNames = {};

// RowMenu: the two menus the Payments tab gives a line and an entry, and the app bar's account menu.
const LINE_ITEMS = [
  { id: 'owed', label: 'Change the amount owed' },
  { id: 'calculated', label: 'Use the calculated price' },
];
const ENTRY_ITEMS = [
  { id: 'edit', label: 'Edit' },
  { id: 'remove', label: 'Remove', destructive: true },
];
const ACCOUNT_ITEMS = [{ id: 'sign-out', label: 'Sign out' }];
const chosenItem = ref<string | null>(null);
const dayLabel = new Date(`${seats[0]!.date}T00:00:00`).toLocaleDateString('en-US', {
  weekday: 'long',
});

// StepHeader: the form tab's steps on each path, and a live one.
const formPathSteps = formSteps(IntakeMode.Form);
const csvPathSteps = formSteps(IntakeMode.Csv);
const step = ref<FormStepId>('essentials');
const stepLabel = computed(
  () => formPathSteps.find((candidate) => candidate.id === step.value)?.label ?? null,
);

// AnswerValue: the fixture's answers have no web address, so one is made from a business's name
// on the reserved example.com, as a portfolio link sits in an answer.
const slug = first.business
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
const portfolio = `https://example.com/${slug}`;

// SignInMessage: each notice the sign-in forms hold, in the forms' own words.
const NOTICES: { label: string; notice: SignInNotice | null; sending?: boolean }[] = [
  { label: 'Empty: no notice', notice: null },
  { label: 'Error', notice: { tone: 'error', text: 'That code is not right.' } },
  {
    label: 'Error, offering a reset',
    notice: { tone: 'error', text: 'That email and password do not match.', next: 'reset' },
  },
  {
    label: 'Error, offering the link again',
    notice: {
      tone: 'error',
      text: 'Verify your email address first: we sent you a link when you registered.',
      next: 'resend',
    },
  },
  {
    label: 'Waiting: the link is on its way (disabled)',
    notice: {
      tone: 'error',
      text: 'Verify your email address first: we sent you a link when you registered.',
      next: 'resend',
    },
    sending: true,
  },
  { label: 'Success', notice: { tone: 'success', text: LINK_RESENT } },
];
const resent = ref(0);

// BarLedger: the applications by status, each row leading to them, and the question's answers.
const statusCounts = new Map<string, number>();
for (const application of applications) {
  statusCounts.set(application.status, (statusCounts.get(application.status) ?? 0) + 1);
}
const byStatus = ledgerRows(
  [...statusCounts].map(([status, count]) => ({
    label: statusLabel(status),
    value: status,
    count,
    to: { path: `${LIBRARY_PATH}/components`, query: { status } },
  })),
  applications.length,
);
const byAnswer = ledgerRows(
  question.options.map((option) => ({
    label: option.label,
    value: option.label,
    count: option.count,
  })),
  applications.length,
);
const answerCount = question.options.length;
</script>

<template>
  <LibrarySection
    title="ReadFailed"
    about="Used on: every page's own read, Markets, Organizations, Applications (all and the monitor), the Assignments page, Attendance"
  >
    <LibraryPanel v-for="failure in FAILURES" :key="failure.label" :label="failure.label">
      <ReadFailed name="library" :message="failure.message" @retry="retries++" />
    </LibraryPanel>
    <LibraryPanel label="Try again, pressed">
      <ReadOut label="Read again" :value="times(retries)" />
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="PhaseBadge"
    about="Used on: Markets and the market chooser, on each market's row"
  >
    <LibraryPanel v-for="path in PATHS" :key="path.mode" :label="`Each phase: ${path.label}`">
      <PhaseBadge v-for="phase in PHASES" :key="phase" :phase="phase" :intake-mode="path.mode" />
    </LibraryPanel>
    <LibraryPanel label="No phase stored (read as draft), and one this build does not know">
      <PhaseBadge :phase="null" />
      <PhaseBadge phase="paused" />
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="SummaryCard"
    about="Used on: Markets and the market chooser (each market's row), Organizations"
  >
    <LibraryPanel label="A market's row: opens, with a badge and Manage" class="library-wide">
      <SummaryCard :facts="marketFacts" selectable @select="cardOpened = first.business">
        <template #name>
          <h3 :title="first.business">
            <button type="button" class="summary-card-open">{{ first.business }}</button>
          </h3>
        </template>
        <template #badge>
          <PhaseBadge :phase="MarketPhase.Applications" :intake-mode="IntakeMode.Csv" />
        </template>
        <template #actions>
          <button type="button" class="btn btn--secondary" @click="cardManaged = first.business">
            Manage
          </button>
        </template>
      </SummaryCard>
      <ReadOut label="Opened" :value="cardOpened" />
      <ReadOut label="Manage pressed" :value="cardManaged" />
    </LibraryPanel>
    <LibraryPanel label="A market's row: a missing fact, and no action" class="library-wide">
      <SummaryCard :facts="marketFactsMissing" selectable @select="cardOpened = third.business">
        <template #name>
          <h3 :title="third.business">
            <button type="button" class="summary-card-open">{{ third.business }}</button>
          </h3>
        </template>
        <template #badge>
          <PhaseBadge :phase="MarketPhase.MarketDays" :intake-mode="IntakeMode.Form" />
        </template>
      </SummaryCard>
    </LibraryPanel>
    <LibraryPanel label="An organization's row: not a click target" class="library-wide">
      <SummaryCard :facts="organizationFacts">
        <template #name>
          <h3 :title="second.business">{{ second.business }}</h3>
        </template>
        <template #actions>
          <button type="button" class="btn btn--secondary" @click="cardManaged = second.business">
            Manage
          </button>
        </template>
      </SummaryCard>
    </LibraryPanel>
    <LibraryPanel label="Narrow, as the market chooser's dialog holds it: the facts go under">
      <SummaryCard :facts="marketFacts" selectable @select="cardOpened = second.business">
        <template #name>
          <h3 :title="second.business">
            <button type="button" class="summary-card-open">{{ second.business }}</button>
          </h3>
        </template>
        <template #badge>
          <PhaseBadge :phase="MarketPhase.Draft" />
        </template>
      </SummaryCard>
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="EmailAddress"
    about="Used on: the market's and the organization's history, the review's warnings and reviewer lines"
  >
    <LibraryPanel label="An address">
      <p class="library-text"><EmailAddress :words="first.email" /></p>
    </LibraryPanel>
    <LibraryPanel label="The fixture's longest address, in a narrow column">
      <p class="library-text library-narrow"><EmailAddress :words="longestEmail" /></p>
    </LibraryPanel>
    <LibraryPanel label="Addresses in a sentence">
      <p class="library-text"><EmailAddress :words="sentence" /></p>
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="VendorNameButton"
    about="Used on: the Assignments page's seats, Attendance (the door); it opens the vendor's drawer"
  >
    <LibraryPanel label="A named vendor">
      <VendorNameButton
        :email="first.email"
        :names="names"
        testid="library-vendor-named"
        @open="opened = vendorHeadline(first.email, names)"
      />
    </LibraryPanel>
    <LibraryPanel label="No name stored: the address leads">
      <VendorNameButton
        :email="second.email"
        :names="unnamed"
        testid="library-vendor-unnamed"
        @open="opened = second.email"
      />
    </LibraryPanel>
    <LibraryPanel label="Pressed">
      <ReadOut label="Opened the drawer of" :value="opened" />
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="RowMenu"
    about="Used on: the vendor drawer's Payments tab, on each line, and the app bar's account menu"
  >
    <LibraryPanel label="A day's line: what it owes">
      <div class="library-line">
        <span>{{ dayLabel }}</span>
        <RowMenu
          :label="`Change what ${dayLabel} owes`"
          :items="LINE_ITEMS"
          testid="library-line-menu"
          @select="chosenItem = $event"
        />
      </div>
    </LibraryPanel>
    <LibraryPanel label="A payment: with a destructive item">
      <div class="library-line">
        <span>A payment</span>
        <RowMenu
          label="Change the payment"
          :items="ENTRY_ITEMS"
          testid="library-entry-menu"
          @select="chosenItem = $event"
        />
      </div>
    </LibraryPanel>
    <LibraryPanel label="With words on its button: the app bar's account menu">
      <div class="library-line">
        <span>An account</span>
        <RowMenu
          label="Account"
          :items="ACCOUNT_ITEMS"
          testid="library-account-menu"
          @select="chosenItem = $event"
        >
          <template #trigger>organizer@example.com</template>
        </RowMenu>
      </div>
    </LibraryPanel>
    <LibraryPanel label="Chosen">
      <ReadOut label="Chose" :value="chosenItem" />
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="StepHeader"
    about="Used on: Application form setup and Questions setup (the form tab)"
  >
    <LibraryPanel label="On our page: four steps, live" class="library-wide">
      <StepHeader
        :steps="formPathSteps"
        :current="step"
        label="Application form setup"
        testid="library-steps"
        step-testid="library-step"
        @select="step = $event"
      />
      <ReadOut label="Current step" :value="stepLabel" />
    </LibraryPanel>
    <LibraryPanel label="From a Google Form: three steps, the last current" class="library-wide">
      <StepHeader
        :steps="csvPathSteps"
        current="review"
        label="Questions setup"
        testid="library-csv-steps"
        step-testid="library-csv-step"
      />
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="AnswerValue"
    about="Used on: the review card's answers, the vendor drawer, the applicant's dashboard, the Discord offer"
  >
    <LibraryPanel label="Plain text">
      <p class="library-text"><AnswerValue :value="first.sells" /></p>
    </LibraryPanel>
    <LibraryPanel label="An address in a sentence">
      <p class="library-text">
        <AnswerValue :value="`My work is at ${portfolio}, and at the fair.`" />
      </p>
    </LibraryPanel>
    <LibraryPanel label="Only an address: its own line, a thumb's target on a phone">
      <p class="library-text"><AnswerValue :value="portfolio" /></p>
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="SignInMessage"
    about="Used on: Sign in, its password form and its code form"
  >
    <LibraryPanel v-for="item in NOTICES" :key="item.label" :label="item.label">
      <div class="library-stack">
        <p v-if="!item.notice" class="library-quiet">Nothing is drawn: both lines wait, hidden.</p>
        <SignInMessage
          :notice="item.notice"
          testid-prefix="library-sign-in"
          :sending="item.sending"
          @resend="resent++"
        />
      </div>
    </LibraryPanel>
    <LibraryPanel label="Send the link again, pressed">
      <ReadOut label="Sent again" :value="times(resent)" />
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="BarLedger"
    about="Used on: the Stats tab, the Assignments page's statistics"
  >
    <LibraryPanel label="Rows that lead somewhere: the applications by status">
      <BarLedger
        class="library-full"
        title="By status"
        :rows="byStatus"
        testid="library-status"
        whole="applications"
        action="Show these applications"
      />
    </LibraryPanel>
    <LibraryPanel label="Empty: nothing counted">
      <BarLedger
        class="library-full"
        title="Applied per day"
        :rows="[]"
        testid="library-day"
        whole="those who applied"
      />
    </LibraryPanel>
    <LibraryPanel
      :label="`Read only, unfolded as today: all ${answerCount} answers to one question`"
      class="library-wide"
    >
      <BarLedger
        class="library-full"
        :title="question.label"
        :rows="byAnswer"
        testid="library-answer"
        whole="applications"
      />
    </LibraryPanel>
  </LibrarySection>

  <ChoicesForYou>
    <li>
      <code>ReadFailed</code> and <code>SignInMessage</code> each draw a red line of their own: keep
      both, or make one "a line that went wrong" component the sign-in forms use too?
    </li>
    <li>
      <code>VendorNameButton</code> and <code>AnswerValue</code>'s links each draw the link ink and
      underline themselves: fold them into the primitives' <code>.link-alone</code>, or keep them?
    </li>
    <li>
      <code>StepHeader</code>'s step is a 32px target: give it a thumb's 44px, or keep the form tab
      a desk screen?
    </li>
    <li>
      <code>BarLedger</code> shows all {{ answerCount }} answers unfolded: fold it past 10 (the
      Folds entry), or keep it whole on Stats?
    </li>
    <li>
      <code>PhaseBadge</code> uses three tones for six phases: keep that, or give each phase its own
      tone?
    </li>
    <li>
      <code>SummaryCard</code>'s row, the organizations' role badge and the market's
      <code>PhaseBadge</code> sit in one slot: merge the role badge onto <code>.chip</code> too?
    </li>
  </ChoicesForYou>
</template>

<style scoped>
.library-wide {
  grid-column: 1 / -1;
}

.library-full {
  width: 100%;
}

.library-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

/* Narrower than the fixture's longest address, so the address must break. */
.library-narrow {
  width: 8rem;
}

.library-stack {
  display: flex;
  flex-direction: column;
  width: 100%;
}

/* A line of the Payments tab: its words, and its menu at the line's end. */
.library-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

/* What the library says of a panel, apart from what the component draws. */
.library-quiet {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
