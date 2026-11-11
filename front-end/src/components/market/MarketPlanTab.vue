<script setup lang="ts">
/**
 * The market plan's body (E18/F02/S01).
 *
 * Extracted from `MarketSetupView`, which held all four tab bodies inline across 1300 lines. The
 * DOM and every `data-testid` are unchanged - this is the prefactor that makes `S02`'s shell
 * change a shell change rather than a whole-file rewrite carrying a fifteen-spec migration.
 *
 * The plan object arrives as a prop and every edit is emitted rather than mutated in place, so a
 * later story can mount this under a different parent without rewriting it. The plan's ACTIONS row
 * is deliberately not here: it is a sibling of the settings panel rather than part of any tab body.
 *
 * ONE SCROLLING PAGE OF ORDERED SECTIONS (E18/F01/S01), laid out by the card grid (E23/F01/S01):
 * Market Dates, Section Setup and Pricing are wide, Tier Setup sits beside Location Setup, and How
 * vendors apply beside Application form. Pricing follows the sections because its columns are the
 * tiers they give tables (E43/F01/S01). The grid's rule is in `primitives.css` and `docs/design-system.md`.
 *
 * Not a step wizard. The surface must be resumable, and it must never force a walk-through to
 * change one value later, so the order is communicated by POSITION rather than enforced by
 * navigation. The same layout survives into later phases, where the plan stays editable and the
 * form section simply stops being gated - there is one layout for this data, not two.
 *
 * Section Setup stays wide for a reason with history: equal thirds once gave it - which needs 654px
 * - the same 460 as Location Setup, which needs 278, and the tier select came out too narrow to show
 * any of its own values on the field that sets a vendor's price.
 */
import { computed } from 'vue';
import ElementSettingContainer from '@/components/elements/ElementSettingContainer.vue';
import ElementMarketDates from '@/components/elements/ElementMarketDates.vue';
import ElementTierSetup from '@/components/elements/ElementTierSetup.vue';
import ElementLocationSetup from '@/components/elements/ElementLocationSetup.vue';
import ElementSectionSetup from '@/components/elements/ElementSectionSetup.vue';
import ElementIntakeMode from '@/components/elements/ElementIntakeMode.vue';
import ElementPricing from '@/components/elements/ElementPricing.vue';
import { essentialOptionsFromSetup } from '@/utils/essentialFields';
import { planGateReason } from '@/utils/planGate';
import { layoutPath } from '@/utils/market';
import { IntakeMode } from '@/assets/types/datatypes';
import type { RejectionQuestion, SetupObject } from '@/assets/types/datatypes';

const props = defineProps<{
  /** The market the plan is of, for the links to its locations' layouts. */
  marketId: string;
  setupObject: SetupObject;
  /** The plan's working copy of how vendors reach this market, not the stored value. */
  intakeMode: IntakeMode | undefined;
  intakeEditable: boolean;
  /** Why starting from a Google Form's responses cannot, as the server serves it on the market;
   * null when it can (E24/F04/S02). */
  csvStartRefusal: string | null;
  /** This person may not change the setup, the table's Market Setup row (E39/F01/S02). */
  readOnly: boolean;
  /** Why the setup has settled, as the server serves it; null while it can change (E31/F01/S02). */
  setupLockReason: string | null;
  /** How many questions of its own the market's form asks: the card says what the form IS. */
  formQuestions: number;
  /** Why the form can no longer change, as the server serves it; null while it can. */
  formLockReason: string | null;
  /** The form's questions with answers to choose, which a price group's condition may name. */
  choiceQuestions: RejectionQuestion[];
}>();

/** What the start drafts, and that it imports no one, worded for the intake chosen above it: the
 * plan's working copy, absent read as `csv` as the server reads it (T205/F20). */
const startFromCsvHelp = computed(() =>
  (props.intakeMode ?? IntakeMode.Csv) === IntakeMode.Form
    ? "Drafts this market's dates, tiers and questions from a past Google Form's responses. " +
      "It imports no one: vendors apply on the market's page once applications open."
    : "Drafts this market's dates, tiers and questions from your Google Form's responses. " +
      'It imports no one yet: once the market is ready, import the responses with Import responses, ' +
      "the next step at the top of the market's pages.",
);

const emit = defineEmits<{
  (event: 'update:setupObject', value: SetupObject): void;
  (event: 'update:intakeMode', value: IntakeMode): void;
  /** A card's field shows text that is not a value: the plan waits rather than saving. */
  (event: 'held', value: boolean): void;
  /** Open a location's layout, once the plan's pending edits have landed (T257). */
  (event: 'openLayout', locationId: string): void;
  (event: 'openForm'): void;
  /** Open the flow that starts this draft from its Google Form's responses. */
  (event: 'startFromCsv'): void;
}>();

/** What the plan is still missing before the form can ask anything, or null when it is ready. */
const formGateReason = computed(() => planGateReason(essentialOptionsFromSetup(props.setupObject)));

/** The plan cannot change, for either reason (bug 30). */
const locked = computed(() => props.readOnly || Boolean(props.setupLockReason));

/**
 * Each named location's layout, offered under Section Setup's rows (T257): "Lay out Upper Hall",
 * or "Open Upper Hall's layout · 49 tables" once it has one. A location with no name, or no id (a
 * market stored before ids, until its next write), offers nothing. A plan that cannot change offers
 * only the layouts it has, to read.
 */
const layoutEntries = computed(() =>
  props.setupObject.locations
    .filter((location) => location.id && location.name.trim() !== '')
    .map((location) => {
      const layout = (props.setupObject.floorplans ?? []).find(
        (floorplan) => floorplan.locationId === location.id,
      );
      return {
        id: location.id as string,
        name: location.name,
        tables: layout ? layout.tables.length : null,
      };
    })
    .filter((entry) => entry.tables !== null || !locked.value),
);

function layoutLabel(entry: { name: string; tables: number | null }): string {
  if (entry.tables === null) return `Lay out ${entry.name}`;
  return `Open ${entry.name}'s layout · ${entry.tables} ${entry.tables === 1 ? 'table' : 'tables'}`;
}

const setupObject = computed(() => props.setupObject);
const intakeEditable = computed(() => props.intakeEditable);
</script>

<template>
  <!-- The whole plan, one page.
       It was three wizard pages, which implied an ordering the data does not have. The only
       dependency worth respecting - tiers and locations before a section can reference one -
       lives entirely within Tier, Location and Section Setup, and the only other one is that the market's
       dates bound the max-assignments clamp, which the organizer can now see move. Paging it
       was the same mistake as the wizard pretending to be the lifecycle, one level down. -->
  <!-- A fieldset, so a plan that cannot change disables every control in it at once (bug 30): one
       attribute rather than one prop per card, and a card added later is covered without asking.
       It says only the plan's own lock: why this person may change nothing is the frame's to say,
       once for every page of the market (T15). -->
  <fieldset class="plan-body card-grid" :disabled="locked">
    <p v-if="setupLockReason" class="note card-grid__wide" data-testid="plan-setup-settled">
      {{ setupLockReason }}
    </p>
    <ElementSettingContainer class="card-grid__wide" data-testid="plan-card-dates">
      <template #setting-title>
        <h2>Market Dates</h2>
      </template>
      <template #setting-content>
        <ElementMarketDates
          :setupObject="setupObject"
          @update:setupObject="(value) => emit('update:setupObject', value)"
        />
      </template>
    </ElementSettingContainer>

    <ElementSettingContainer data-testid="plan-card-tiers">
      <template #setting-title>
        <h2>Tier Setup</h2>
      </template>
      <template #setting-content>
        <ElementTierSetup
          :setupObject="setupObject"
          :readonly="locked"
          @update:setupObject="(value) => emit('update:setupObject', value)"
        />
      </template>
    </ElementSettingContainer>
    <ElementSettingContainer data-testid="plan-card-locations">
      <template #setting-title>
        <h2>Location Setup</h2>
      </template>
      <template #setting-content>
        <ElementLocationSetup
          :setupObject="setupObject"
          @update:setupObject="(value) => emit('update:setupObject', value)"
        />
      </template>
    </ElementSettingContainer>
    <ElementSettingContainer class="card-grid__wide" data-testid="plan-card-sections">
      <template #setting-title>
        <h2>Section Setup</h2>
      </template>
      <template #setting-content>
        <ElementSectionSetup
          :setupObject="setupObject"
          @update:setupObject="(value) => emit('update:setupObject', value)"
        />
        <!-- Each location's layout, under the rows that name its sections (T257). Opening one is a
             link, which a plan that cannot change still offers; starting one waits for the plan's
             pending edits, so the location is the server's when its layout begins. -->
        <ul v-if="layoutEntries.length" class="layout-entries" data-testid="plan-layouts">
          <li v-for="entry in layoutEntries" :key="entry.id">
            <RouterLink
              v-if="locked"
              :to="layoutPath(marketId, entry.id)"
              class="btn btn--secondary"
              :data-testid="`plan-layout-open-${entry.id}`"
            >
              {{ layoutLabel(entry) }}
            </RouterLink>
            <button
              v-else
              type="button"
              class="btn btn--secondary"
              :data-testid="`plan-layout-${entry.tables === null ? 'start' : 'open'}-${entry.id}`"
              @click="emit('openLayout', entry.id)"
            >
              {{ layoutLabel(entry) }}
            </button>
          </li>
        </ul>
      </template>
    </ElementSettingContainer>

    <ElementSettingContainer class="card-grid__wide" data-testid="plan-card-pricing">
      <template #setting-title>
        <h2>Pricing</h2>
      </template>
      <template #setting-content>
        <ElementPricing
          :setupObject="setupObject"
          :questions="choiceQuestions"
          :fixed="locked"
          @update:setupObject="(value) => emit('update:setupObject', value)"
          @held="(held) => emit('held', held)"
        />
      </template>
    </ElementSettingContainer>

    <ElementSettingContainer data-testid="plan-card-intake">
      <template #setting-title>
        <h2>How vendors apply</h2>
      </template>
      <template #setting-content>
        <ElementIntakeMode
          :intakeMode="props.intakeMode"
          :editable="intakeEditable"
          @update:intakeMode="(value) => emit('update:intakeMode', value)"
        />
        <!-- Seeding this market's form from last year's responses works for either intake, so it
             leaves the choice above as it is (E24/F04/S02). -->
        <div v-if="!locked" class="csv-start" data-testid="plan-start-from-csv">
          <button
            v-if="!csvStartRefusal"
            type="button"
            class="btn btn--secondary"
            aria-describedby="plan-start-from-csv-help"
            data-testid="plan-start-from-csv-link"
            @click="emit('startFromCsv')"
          >
            Draft from a Google Form's responses
          </button>
          <button
            v-else
            type="button"
            class="btn btn--secondary"
            disabled
            aria-describedby="plan-start-from-csv-help plan-start-from-csv-reason"
            data-testid="plan-start-from-csv-disabled"
          >
            Draft from a Google Form's responses
          </button>
          <!-- It drafts and imports no one (T205/F20): said by the intake chosen above, as it is
               clicked, so it never describes the other path. -->
          <p
            id="plan-start-from-csv-help"
            class="csv-start-help"
            data-testid="plan-start-from-csv-help"
          >
            {{ startFromCsvHelp }}
          </p>
          <p
            v-if="csvStartRefusal"
            id="plan-start-from-csv-reason"
            class="csv-start-reason"
            data-testid="plan-start-from-csv-reason"
          >
            {{ csvStartRefusal }}
          </p>
        </div>
      </template>
    </ElementSettingContainer>

    <!--
      The form is built FROM the plan, so it comes after it and is gated on the plan offering
      something (E18/F01/S01).

      The gate reads the same rule the transition guard reads - what the plan OFFERS - and never a
      count of custom fields. A form is its custom fields PLUS the essential questions the plan
      asks, and a layer that counted only the former is what once let a market open applications
      and then refuse every application it received.

      It names what is missing rather than merely being disabled. That is the difference between a
      guided page and a broken one.
    -->
    <!-- Guidance for building a form, which a record has no use for. -->
    <ElementSettingContainer v-if="!locked" data-testid="plan-card-form">
      <template #setting-title>
        <h2>Application form</h2>
      </template>
      <template #setting-content>
        <p v-if="formGateReason" class="plan-form-gate" data-testid="plan-form-gate">
          {{ formGateReason }}
        </p>
        <!-- What the form is now, not only what it could be (bug 16): this said "Build the
             application form" over a form that was locked, and over one with 21 questions. -->
        <p v-else-if="formLockReason" class="plan-form-ready" data-testid="plan-form-locked">
          {{ formLockReason }}
          <button type="button" class="plan-form-link" @click="emit('openForm')">
            See the application form
          </button>
        </p>
        <p v-else-if="formQuestions" class="plan-form-ready" data-testid="plan-form-built">
          Your application form asks {{ formQuestions }} question{{
            formQuestions === 1 ? '' : 's'
          }}
          of your own, beside the essential ones.
          <button type="button" class="plan-form-link" @click="emit('openForm')">
            Open the application form
          </button>
        </p>
        <p v-else class="plan-form-ready" data-testid="plan-form-ready">
          Your plan offers something to apply for, so the form can ask about it.
          <button type="button" class="plan-form-link" @click="emit('openForm')">
            Build the application form
          </button>
        </p>
      </template>
    </ElementSettingContainer>
  </fieldset>
</template>

<style scoped>
.csv-start {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
  margin-top: var(--space-3);
}

.csv-start-help {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  line-height: 1.4;
}

.csv-start-reason {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.plan-form-gate,
.plan-form-ready {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
  line-height: 1.5;
}

.plan-form-link {
  --focus-border-offset: var(--focus-border-width);
  margin-left: var(--space-2);
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: var(--mm-text-link);
  text-decoration: underline;
  cursor: pointer;
}

/* Its own name, not `.settings-body`: the parent view styles that class as a flex row, and a
   parent's scoped rule reaches a child's root - which silently outranked the card grid. */
.plan-body {
  align-self: stretch;
  /* The frame's gutter, as on every market page: in line with the rail and the frame's own note. */
  padding: var(--space-6);
  /* A fieldset's own defaults: a border and margin nobody chose, and a min-content minimum width
     that would hold the grid wider than its card. */
  margin: 0;
  border: 0;
  min-inline-size: 0;
}

/* A record's plan (bug 30) draws nothing that edits it. The add and remove controls and the drag
   handles go, rather than sitting there disabled and looking pressable; the chosen days stay,
   because they are the record, but no longer answer the pointer. */
.plan-body:disabled :deep(:is(.add-row, .row-remove-button, .dates-remove, .drag-handle)) {
  display: none;
}

.plan-body:disabled :deep(.calendar-day) {
  cursor: default;
}

.plan-body:disabled :deep(.calendar-day:not(.chosen):hover) {
  border-color: transparent;
}

/* Each location's layout, a line of its own under the rows, on their left edge. */
.layout-entries {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  margin: var(--space-4) 0 0 var(--space-2);
  padding: 0;
  list-style: none;
}
</style>
