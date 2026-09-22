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
 * is deliberately not here: it is a sibling of the settings panel rather than part of any tab body,
 * and moving it inside would be the DOM change this story must not make.
 */
import { computed } from 'vue';
import ElementSettingContainer from '@/components/elements/ElementSettingContainer.vue';
import ElementMarketDates from '@/components/elements/ElementMarketDates.vue';
import ElementTierSetup from '@/components/elements/ElementTierSetup.vue';
import ElementLocationSetup from '@/components/elements/ElementLocationSetup.vue';
import ElementSectionSetup from '@/components/elements/ElementSectionSetup.vue';
import ElementAssignmentPriority from '@/components/elements/ElementAssignmentPriority.vue';
import ElementAssignmentOptions from '@/components/elements/ElementAssignmentOptions.vue';
import ElementIntakeMode from '@/components/elements/ElementIntakeMode.vue';
import type { FormField, IntakeMode, Market, SetupObject } from '@/assets/types/datatypes';

const props = defineProps<{
  setupObject: SetupObject;
  market: Market | null;
  formFields: FormField[];
  intakeEditable: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:setupObject', value: SetupObject): void;
  (event: 'update:intakeMode', value: IntakeMode): void;
  (event: 'choosePath'): void;
}>();

/**
 * The floorplan route is offered from the Section Setup card - the place it is a question about -
 * rather than over the whole page, and only while there is nothing to describe sections with yet.
 */
const sectionsUndescribed = computed(
  () =>
    props.setupObject.sections.length === 0 &&
    !(props.setupObject.floorplans && props.setupObject.floorplans.length > 0),
);

const setupObject = computed(() => props.setupObject);
const market = computed(() => props.market);
const formFields = computed(() => props.formFields);
const intakeEditable = computed(() => props.intakeEditable);
</script>

<template>
  <!-- The whole plan, one page.
       It was three wizard pages, which implied an ordering the data does not have. The only
       dependency worth respecting - tiers and locations before a section can reference one -
       lives entirely within the second row, and the only cross-row one is that the market's
       dates bound the max-assignments clamp, which the organizer can now see move. Paging it
       was the same mistake as the wizard pretending to be the lifecycle, one level down. -->
  <div class="settings-body settings-body-plan">
    <section class="plan-row plan-row--single">
      <ElementSettingContainer>
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
    </section>

    <section class="plan-row plan-row--triple">
      <ElementSettingContainer>
        <template #setting-title>
          <h2>Tier Setup</h2>
        </template>
        <template #setting-content>
          <ElementTierSetup
            :setupObject="setupObject"
            @update:setupObject="(value) => emit('update:setupObject', value)"
          />
        </template>
      </ElementSettingContainer>
      <ElementSettingContainer>
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
      <ElementSettingContainer>
        <template #setting-title>
          <h2>Section Setup</h2>
        </template>
        <template #setting-content>
          <!-- The choice belongs here, where sections are described, rather than over the
               whole page - and it is offered rather than imposed. -->
          <button
            v-if="sectionsUndescribed"
            type="button"
            class="section-path-button"
            @click="emit('choosePath')"
            data-testid="market-setup-choose-path-button"
          >
            Set up sections from a floorplan instead
          </button>
          <ElementSectionSetup
            :setupObject="setupObject"
            @update:setupObject="(value) => emit('update:setupObject', value)"
          />
        </template>
      </ElementSettingContainer>
    </section>

    <section class="plan-row plan-row--single">
      <ElementSettingContainer>
        <template #setting-title>
          <h2>How vendors apply</h2>
        </template>
        <template #setting-content>
          <ElementIntakeMode
            :intakeMode="market?.intakeMode"
            :editable="intakeEditable"
            @update:intakeMode="(value) => emit('update:intakeMode', value)"
          />
        </template>
      </ElementSettingContainer>
    </section>

    <section class="plan-row plan-row--asymmetric">
      <ElementSettingContainer>
        <template #setting-title>
          <h2>Assignment Priority</h2>
        </template>
        <template #setting-content>
          <ElementAssignmentPriority
            :setupObject="setupObject"
            :formFields="formFields"
            @update:setupObject="(value) => emit('update:setupObject', value)"
          />
        </template>
      </ElementSettingContainer>
      <ElementSettingContainer>
        <template #setting-title>
          <h2>Assignment Options</h2>
        </template>
        <template #setting-content>
          <ElementAssignmentOptions
            :setupObject="setupObject"
            @update:setupObject="(value) => emit('update:setupObject', value)"
          />
        </template>
      </ElementSettingContainer>
    </section>
  </div>
</template>

<style scoped>
.settings-body {
  align-self: stretch;
  display: flex;
  gap: 30px;
  padding: 40px;
}

/* The plan is one scrolling page of rows rather than a row of cards, so it overrides
   `.settings-body`'s single-row flex. */
.settings-body-plan {
  flex-direction: column;
  gap: 30px;
}

.plan-row {
  display: grid;
  gap: 30px;
  align-items: stretch;
  /* Each row sizes to its own content; the page scrolls, not the rows. True now: the
     `min-height: 320px` that used to sit here made that comment false, and cost 268px of nothing
     on the emptiest possible market. It was never what kept a row even either - `align-items:
     stretch` is, so the floor only ever set the minimum of the TALLEST panel (E16/F03). */
  flex: 0 0 auto;
}

.plan-row--single {
  grid-template-columns: minmax(0, 1fr);
}

/*
 * Sized by need, not by count. Equal thirds gave Section Setup - which needs 654px for four columns
 * and a delete control - the same 460 as Location Setup, which needs 278. That is the sole cause of
 * the Tier select rendering 65px wide with 34px of text room, while "Premium" needs 56, "Standard"
 * 57 and "Community" 71: every tier read `Pr...`, `St...`, `Co...` on the field that sets a
 * vendor's price. Unequal columns were already accepted here - `--asymmetric` is `3fr 2fr`.
 */
.plan-row--triple {
  grid-template-columns: minmax(0, 0.78fr) minmax(0, 0.69fr) minmax(0, 1.53fr);
}

.plan-row--asymmetric {
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
}

.section-path-button {
  align-self: flex-start;
  margin-bottom: 8px;
  padding: 6px 12px;
  border-radius: var(--radius-control);
  border: 1px solid var(--mm-border);
  background: white;
  font-size: var(--text-xs);
  color: var(--mm-text-link);
  cursor: pointer;
}

.section-path-button:hover {
  border-color: var(--mm-text-link);
}
</style>
