<script setup lang="ts">
/**
 * The later targets, as proposals (T200's `component-review.md`, sections 6, 8 and 9): the chip's
 * five tones with a small step beside the one-off badges each would replace, a `.data-table` on
 * fixture rows, and the `SidePanel` shell on a fixture application. No screen changes: the one-offs,
 * the six tables and the two drawers stay as they are, and are listed here rather than copied.
 */
import { computed, ref } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import FilterToggles from '@/components/FilterToggles.vue';
import PhaseBadge from '@/components/PhaseBadge.vue';
import ScrollBox from '@/components/ScrollBox.vue';
import SidePanel from '@/components/SidePanel.vue';
import { MarketPhase } from '@/assets/types/datatypes';
import { statusChip, statusLabel } from '@/utils/verdicts';
import ChoicesForYou from '../parts/ChoicesForYou.vue';
import LibraryPanel from '../parts/LibraryPanel.vue';
import LibrarySection from '../parts/LibrarySection.vue';
import ReadOut from '../parts/ReadOut.vue';
import { fixture } from '../fixture';

const { applications, people } = fixture;

/** One badge a screen draws for itself, the file it is in, and how it differs from the chip. */
interface OneOff {
  badge: string;
  file: string;
  today: string;
}

const ROLES_IN = 'views/OrganizationsView.vue, ManageMarketOverlay.vue, ManageOrgOverlay.vue';
const ALREADY = 'Already a chip';

/** Beside each tone, what the review would fold into it. */
const TONES: readonly { tone: string; label: string; oneOffs: readonly OneOff[] }[] = [
  {
    tone: 'neutral',
    label: 'Neutral',
    oneOffs: [
      {
        badge: 'field-type-badge',
        file: 'components/application/FormBuilder.vue',
        today: 'Beige, as this tone is, with 6px corners',
      },
      {
        badge: 'essential-type-badge',
        file: 'components/application/EssentialFieldsPanel.vue',
        today: 'Beige, as this tone is, with 6px corners',
      },
      {
        badge: 'count-badge--empty, --none',
        file: 'views/ResultView.vue',
        today: 'A pressable pill, bordered, which the filter toggles would take too',
      },
      {
        badge: 'phase-badge, draft and archived',
        file: 'components/PhaseBadge.vue',
        today: `${ALREADY}; only its weight is its own`,
      },
    ],
  },
  {
    tone: 'positive',
    label: 'Positive',
    oneOffs: [
      {
        badge: 'role-badge, every role but owner',
        file: ROLES_IN,
        today: 'This tone with 6px corners, written three times',
      },
      {
        badge: 'vendor-badge--assigned',
        file: 'views/VendorsView.vue',
        today: 'This tone in Merge One, taller',
      },
      {
        badge: 'essential-badge',
        file: 'components/application/EssentialFieldsPanel.vue',
        today: 'Solid green, white words',
      },
      {
        badge: 'ranked-first-badge',
        file: 'components/application/RankedChoiceInput.vue',
        today: 'A green outline, and a grey one once locked',
      },
      {
        badge: 'count-badge--assigned',
        file: 'views/ResultView.vue',
        today: 'A pressable pill, solid green, which the filter toggles would take too',
      },
      {
        badge: 'ledger-badge',
        file: 'views/CsvImportView.vue',
        today: 'A raw tint of its own',
      },
      {
        badge: 'phase-badge, market days',
        file: 'components/PhaseBadge.vue',
        today: `${ALREADY}; only its weight is its own`,
      },
      {
        badge: 'path-badge, "Recommended"',
        file: 'components/floorplan/ChoosePathOverlay.vue',
        today: `${ALREADY}; only its place on the card is its own`,
      },
    ],
  },
  {
    tone: 'attention',
    label: 'Attention',
    oneOffs: [
      {
        badge: 'vendor-badge--unassigned',
        file: 'views/VendorsView.vue',
        today: 'This tone in Merge One, taller',
      },
      {
        badge: 'preview-badge',
        file: 'components/application/FormPreview.vue',
        today: 'Solid yellow, bold, with 6px corners',
      },
      {
        badge: 'count-badge--partial',
        file: 'views/ResultView.vue',
        today: 'A pressable pill, solid yellow, which the filter toggles would take too',
      },
      {
        badge: 'ledger-badge.new',
        file: 'views/CsvImportView.vue',
        today: 'A raw tint of its own',
      },
      {
        badge: 'phase-badge, the working phases',
        file: 'components/PhaseBadge.vue',
        today: `${ALREADY}; only its weight is its own`,
      },
      {
        badge: 'path-badge, "Beta"',
        file: 'components/floorplan/ChoosePathOverlay.vue',
        today: `${ALREADY}; only its place on the card is its own`,
      },
    ],
  },
  {
    tone: 'informational',
    label: 'Informational',
    oneOffs: [
      {
        badge: 'role-badge, owner',
        file: ROLES_IN,
        today: 'This tone with 6px corners, written three times',
      },
    ],
  },
  {
    tone: 'destructive',
    label: 'Destructive',
    oneOffs: [
      {
        badge: 'required-badge',
        file: 'components/application/FormBuilder.vue',
        today: 'Solid red, white words, with 6px corners',
      },
    ],
  },
];

const PHASES = [MarketPhase.Draft, MarketPhase.Applications, MarketPhase.MarketDays];

/** The six tables the primitive would serve, and what each draws its own way. */
const TABLES = [
  {
    file: 'components/HistoryEntries.vue',
    differs: 'Boxed cells, every side ruled, in small type; fixed columns',
  },
  {
    file: 'components/ExportVendorsDialog.vue',
    differs: 'The preview: a beige header, one line a cell, cut at 16rem; has its own scroller',
  },
  {
    file: 'components/csvProposal/ProposalLedger.vue',
    differs: "The start's ledger: fixed columns, with a band of the essential questions",
  },
  {
    file: 'views/CsvImportView.vue',
    differs: "The import's ledger: an uppercase header, wider tracking",
  },
  {
    file: 'views/PaymentsView.vue',
    differs: 'A muted header and row rules, as proposed; its figures to the right, and fixed-width',
  },
  {
    file: 'components/elements/ElementPricing.vue',
    differs: 'Column rules rather than row rules, a caption, tighter cells',
  },
];

/** What the review asks for: 30 applications, wide enough to scroll sideways. */
const ROWS_SHOWN = 30;
const SHORT_ROWS_SHOWN = 5;

const reviewerAddress = new Map(people.map(({ id, email }) => [id, email]));
const addressOf = (personId: string) => reviewerAddress.get(personId) ?? personId;

const rows = applications.slice(0, ROWS_SHOWN);
const shortRows = applications.slice(0, SHORT_ROWS_SHOWN);

// The side panel, on the first application, its reviewer's others making the body scroll.
const application = applications[0]!;
const sameReviewer = applications
  .filter(({ id, reviewer }) => reviewer === application.reviewer && id !== application.id)
  .map(({ id, name }) => ({ id, name }));

const SIDES = [
  { id: 'right', label: 'Right' },
  { id: 'left', label: 'Left' },
];
const WIDTHS = [
  { id: 'narrow', label: 'Narrow' },
  { id: 'wide', label: 'Wide' },
];

const side = ref<string>('right');
const width = ref<string>('wide');
const panelOpen = ref(false);
const asking = ref(false);

const panelSide = computed(() => (side.value === 'left' ? 'left' : 'right'));
const panelWidth = computed(() => (width.value === 'narrow' ? 'narrow' : 'wide'));
const panelReadOut = computed(
  () => `${panelOpen.value ? 'open' : 'closed'}, ${panelSide.value}, ${panelWidth.value}`,
);
</script>

<template>
  <LibrarySection
    title="Badges"
    about="The chip's five tones at both sizes, under each the review's 15 one-off badge classes that would take it: a class with several looks is under each of its tones, and two already wear the chip. The one-offs stay in their screens' markup."
  >
    <LibraryPanel v-for="{ tone, label, oneOffs } in TONES" :key="tone" :label="label">
      <div class="library-demo" :data-testid="`library-tone-${tone}`">
        <p class="library-chips">
          <span class="chip" :class="`chip--${tone}`" data-testid="library-chip">{{ label }}</span>
          <span class="chip chip--small" :class="`chip--${tone}`" data-testid="library-chip-small"
            >{{ label }}, small</span
          >
        </p>
        <ul class="library-places">
          <li v-for="{ badge, file, today } in oneOffs" :key="badge" data-testid="library-one-off">
            <code class="library-name">{{ badge }}</code>
            <span class="library-file">{{ file }}</span>
            <span class="library-quiet">{{ today }}</span>
          </li>
        </ul>
      </div>
    </LibraryPanel>
    <LibraryPanel label="PhaseBadge, as it is today">
      <p class="library-chips">
        <PhaseBadge v-for="phase in PHASES" :key="phase" :phase="phase" />
      </p>
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="Data table"
    about="A primitive rather than a component, since each table's columns are its own: the header's ink and weight, a rule between rows, the cells' padding, and a scroller that keeps the corners."
  >
    <LibraryPanel class="library-wide" :label="`${rows.length} applications, one line a cell`">
      <ScrollBox
        class="data-table-scroll"
        axis="x"
        :label="`${rows.length} applications`"
        testid="library-table-scroll"
      >
        <table class="data-table data-table--one-line">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Address</th>
              <th scope="col">Business</th>
              <th scope="col">Sells</th>
              <th scope="col">Status</th>
              <th scope="col">Reviewer</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" data-testid="library-table-row">
              <th scope="row">{{ row.name }}</th>
              <td>{{ row.email }}</td>
              <td>{{ row.business }}</td>
              <td>{{ row.sells }}</td>
              <td>
                <span class="chip--small" :class="statusChip(row.status)">{{
                  statusLabel(row.status)
                }}</span>
              </td>
              <td>{{ addressOf(row.reviewer) }}</td>
            </tr>
          </tbody>
        </table>
      </ScrollBox>
    </LibraryPanel>
    <LibraryPanel class="library-wide" label="Fewer columns: the cells wrap, and nothing scrolls">
      <ScrollBox
        class="data-table-scroll"
        axis="x"
        label="Fewer columns"
        testid="library-table-wrapped-scroll"
      >
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Business</th>
              <th scope="col">Sells</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in shortRows" :key="row.id">
              <th scope="row">{{ row.name }}</th>
              <td>{{ row.business }}</td>
              <td>{{ row.sells }}</td>
            </tr>
          </tbody>
        </table>
      </ScrollBox>
    </LibraryPanel>
    <LibraryPanel class="library-wide" label="The six tables today">
      <ul class="library-places">
        <li v-for="{ file, differs } in TABLES" :key="file">
          <code class="library-name">{{ file }}</code>
          <span class="library-quiet">{{ differs }}</span>
        </li>
      </ul>
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="Side panel"
    about="A shell for the vendor drawer and the navigation drawer, each of which draws its own scrim and holds the page itself. Modal as a dialog is: Escape, the scrim, focus in and back, the page inert."
  >
    <LibraryPanel class="library-wide" label="One application's details">
      <div class="library-demo" data-testid="library-panel-demo">
        <div class="library-chips">
          <FilterToggles v-model="side" :options="SIDES" label="Side" testid="library-panel-side" />
          <FilterToggles
            v-model="width"
            :options="WIDTHS"
            label="Width"
            testid="library-panel-width"
          />
        </div>
        <p class="library-open">
          <button
            type="button"
            class="btn btn--secondary"
            data-testid="library-panel-open"
            @click="panelOpen = true"
          >
            Open {{ application.name }}
          </button>
        </p>
        <ReadOut label="The panel" :value="panelReadOut" />
      </div>
    </LibraryPanel>
  </LibrarySection>

  <SidePanel
    :open="panelOpen"
    :title="application.name"
    :side="panelSide"
    :width="panelWidth"
    testid="library-side-panel"
    @close="panelOpen = false"
  >
    <div class="library-details">
      <dl class="library-facts">
        <dt>Address</dt>
        <dd>{{ application.email }}</dd>
        <dt>Business</dt>
        <dd>{{ application.business }}</dd>
        <dt>Sells</dt>
        <dd>{{ application.sells }}</dd>
        <dt>Status</dt>
        <dd>
          <span :class="statusChip(application.status)">{{ statusLabel(application.status) }}</span>
        </dd>
        <dt>Reviewer</dt>
        <dd>{{ addressOf(application.reviewer) }}</dd>
      </dl>
      <p>
        <button
          type="button"
          class="btn btn--secondary"
          data-testid="library-panel-ask"
          @click="asking = true"
        >
          Update info
        </button>
      </p>
      <h3 class="library-subtitle">Their reviewer's other applications</h3>
      <ul class="library-others" data-testid="library-panel-others">
        <li v-for="other in sameReviewer" :key="other.id" data-testid="library-panel-other">
          {{ other.name }}
        </li>
      </ul>
    </div>
  </SidePanel>

  <!-- Beside the panel, never inside it, as the vendor drawer mounts its Update info. -->
  <AppDialog
    :open="asking"
    title="Update info"
    testid="library-panel-dialog"
    confirmLabel="Done"
    @close="asking = false"
    @submit="asking = false"
  >
    <p class="library-quiet">
      A dialog opened from the panel lies over it and the whole window, as Update info does over the
      vendor drawer, and takes Escape first.
    </p>
  </AppDialog>

  <ChoicesForYou>
    <li>
      <strong>Which one-off badges become which tone:</strong> as listed above, to start. Some read
      differently once folded: "required" as a red tint, though a required field is no fault;
      "Always included" and "PREVIEW" from solid fills to tints; and the roles from 6px corners to
      the pill's.
    </li>
    <li>
      <strong>The small step:</strong> no one-off is smaller than the chip today: at a desk each is
      12px, the type scale's floor, so the step only takes the padding in, and takes the 6px corners
      the radius scale gives a small chip, where the chip is a pill. The table's Status column wears
      it. Is it worth having, or is one size and one shape enough, as the chip's rule says?
    </li>
    <li>
      <strong>The table's look:</strong> a muted header on white with a rule between rows, as
      Payments has. The export's beige header and History's boxed cells would go. Should a table
      that holds figures, as Payments does, get a figures step as well?
    </li>
    <li>
      <strong>One line a cell, or wrapping:</strong> both are here: one line for a table read
      across, as the export's preview is; wrapping otherwise. Which is the default?
    </li>
    <li>
      <strong>The side panel's width:</strong> narrow is 20rem, near the navigation drawer's 250 to
      300px; wide is 30rem, the vendor drawer's 480px. Each leaves at least 32px of scrim beside it,
      on a phone too.
    </li>
    <li>
      <strong>The side panel's head:</strong> white, with the dialog's title and close, here. The
      vendor drawer's is dark, with an eyebrow and the address under the name: keep that, for every
      panel or as a slot?
    </li>
    <li>
      <strong>The navigation drawer:</strong> it is links rather than a task, so should it move onto
      this shell at all, given that only two places would use it?
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

.library-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
}

.library-open {
  margin: 0;
}

.library-places {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.library-places li {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.library-name {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.library-file,
.library-quiet {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

.library-details {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.library-details p {
  margin: 0;
}

.library-facts {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  font-size: var(--text-sm);
}

.library-facts dt {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-text-muted);
}

.library-facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.library-subtitle {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
}

.library-others {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--text-sm);
}
</style>
