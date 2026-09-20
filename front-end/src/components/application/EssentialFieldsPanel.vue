<script setup lang="ts">
/**
 * The always-present essential questions, as the form builder shows them to the organizer.
 *
 * These are purpose-built, not custom fields: an organizer cannot remove or reorder them, and
 * the only thing they customise is what the questions offer - which is the market plan itself
 * (dates, sections and tiers; table type is stubbed to one until the floorplan ships). This panel
 * therefore renders the current
 * offering read-only and points at where each list is edited, instead of offering a second
 * place to edit it.
 */
import type { EssentialFormOptions } from '@/assets/types/datatypes';
import {
  AVAILABLE_DATES_LABEL,
  MAX_DATES_LABEL,
  SECTION_RANKING_KEY,
  SECTION_RANKING_LABEL,
  TABLE_TYPE_RANKING_LABEL,
  TABLE_CHOICES,
  TABLE_CHOICE_LABEL,
  TABLE_SHARE_EMAIL_LABEL,
  TIER_PREFERENCE_LABEL,
  formattedEssentialDate,
} from '@/utils/essentialFields';

const props = defineProps<{
  options: EssentialFormOptions;
  /** True once the offering is frozen (an application exists); the hints change tense. */
  locked?: boolean;
  /** False while the form cannot be edited at all (wrong phase, or an applicant has answered). */
  editable?: boolean;
}>();

const emit = defineEmits<{ (e: 'toggleUnasked', key: string, unasked: boolean): void }>();

/**
 * Whether this market asks a given preference ordering (E01/F06).
 *
 * A ranking is the only kind of essential question a market may switch off, because the solver
 * never filters on one: every applicant getting the same answer changes nothing but the tie-break.
 * The rule itself lives in `UNASKABLE_ESSENTIAL_KEYS`; this is just the view of it.
 */
function asks(key: string): boolean {
  return !(props.options.unasked ?? []).includes(key);
}
</script>

<template>
  <div class="essential-panel" data-testid="essential-fields-panel">
    <div class="essential-panel-header">
      <h3>Essential questions</h3>
      <span class="essential-badge" data-testid="essential-fields-badge">Always included</span>
    </div>
    <p class="essential-panel-note">
      Every application form asks these - the table assignment reads them directly, so they cannot
      be removed. What they offer comes from your market plan{{
        locked ? ' and is frozen with the rest of the form' : ''
      }}.
    </p>

    <div class="essential-item" data-testid="essential-item-email">
      <div class="essential-item-header">
        <span class="essential-item-label">Email</span>
        <span class="essential-type-badge">sign-in</span>
      </div>
      <p class="essential-item-detail">
        Collected when the applicant signs in; every notification goes there.
      </p>
    </div>

    <div class="essential-item" data-testid="essential-item-available-dates">
      <div class="essential-item-header">
        <span class="essential-item-label">{{ AVAILABLE_DATES_LABEL }}</span>
        <span class="essential-type-badge">pick dates</span>
      </div>
      <div v-if="options.dates.length" class="essential-chips">
        <span
          v-for="date in options.dates"
          :key="date"
          class="essential-chip"
          data-testid="essential-date-chip"
        >
          {{ formattedEssentialDate(date) }}
        </span>
      </div>
      <p v-else class="essential-item-warning" data-testid="essential-dates-empty">
        No market dates yet - this question is hidden from applicants until you add dates under
        Market Setup.
      </p>
    </div>

    <div class="essential-item" data-testid="essential-item-max-dates">
      <div class="essential-item-header">
        <span class="essential-item-label">{{ MAX_DATES_LABEL }}</span>
        <span class="essential-type-badge">number</span>
      </div>
      <p class="essential-item-detail">
        {{
          options.dates.length
            ? `A number from 1 to ${options.dates.length} - how many of their available dates the
          applicant actually wants.`
            : 'Asked alongside the dates once your market has them.'
        }}
      </p>
    </div>

    <div class="essential-item" data-testid="essential-item-tier-preference">
      <div class="essential-item-header">
        <span class="essential-item-label">{{ TIER_PREFERENCE_LABEL }}</span>
        <span class="essential-type-badge">pick tiers</span>
      </div>
      <div v-if="options.tiers.length" class="essential-chips">
        <span
          v-for="tier in options.tiers"
          :key="tier"
          class="essential-chip"
          data-testid="essential-tier-chip"
        >
          {{ tier }}
        </span>
      </div>
      <p v-else class="essential-item-warning" data-testid="essential-tiers-empty">
        No tiers yet - this question is hidden from applicants until your market plan defines tiers
        under Market Setup.
      </p>
    </div>

    <div class="essential-item" data-testid="essential-item-table-choice">
      <div class="essential-item-header">
        <span class="essential-item-label">{{ TABLE_CHOICE_LABEL }}</span>
        <span class="essential-type-badge">choice</span>
      </div>
      <div class="essential-chips">
        <span
          v-for="choice in TABLE_CHOICES"
          :key="choice.value"
          class="essential-chip"
          data-testid="essential-table-choice-chip"
        >
          {{ choice.label }}
        </span>
      </div>
      <p class="essential-item-detail">
        Fixed options - a table seats two, so this is how it can be occupied, not something your
        plan configures.
      </p>
    </div>

    <div class="essential-item" data-testid="essential-item-table-share-email">
      <div class="essential-item-header">
        <span class="essential-item-label">{{ TABLE_SHARE_EMAIL_LABEL }}</span>
        <span class="essential-type-badge">optional</span>
      </div>
      <p class="essential-item-detail">
        The only optional essential question. An applicant who names a partner is seated with them
        when possible; one who leaves it blank may be paired with anyone else sharing.
      </p>
    </div>

    <div class="essential-item" data-testid="essential-item-section-ranking">
      <div class="essential-item-header">
        <span class="essential-item-label">{{ SECTION_RANKING_LABEL }}</span>
        <span class="essential-type-badge">ranking</span>
        <!-- Only a ranking gets this switch. Turning off a constraint - dates, tiers, table
             choice - would let a default answer for the applicant, so those have none. -->
        <label v-if="editable" class="essential-asks-toggle" data-testid="essential-asks-section">
          <input
            type="checkbox"
            :checked="asks(SECTION_RANKING_KEY)"
            @change="emit('toggleUnasked', SECTION_RANKING_KEY, asks(SECTION_RANKING_KEY))"
          />
          Ask this
        </label>
      </div>
      <p
        v-if="!asks(SECTION_RANKING_KEY)"
        class="essential-item-hint"
        data-testid="essential-section-not-asked"
      >
        This market does not ask applicants to rank sections, so every applicant is treated equally
        on it. Vendors are still placed in sections; nobody states a preference.
      </p>
      <div v-else-if="options.sections.length" class="essential-chips">
        <span
          v-for="(section, index) in options.sections"
          :key="section"
          class="essential-chip"
          data-testid="essential-section-chip"
        >
          <span class="essential-chip-rank">{{ index + 1 }}</span>
          {{ section }}
        </span>
      </div>
      <p
        v-else-if="asks(SECTION_RANKING_KEY)"
        class="essential-item-warning"
        data-testid="essential-sections-empty"
      >
        No sections yet - this question is hidden from applicants until your market plan defines
        sections (Market Setup or the floorplan editor).
      </p>
    </div>

    <div class="essential-item" data-testid="essential-item-table-type-ranking">
      <div class="essential-item-header">
        <span class="essential-item-label">{{ TABLE_TYPE_RANKING_LABEL }}</span>
        <span class="essential-type-badge">ranking</span>
      </div>
      <div v-if="options.tableTypes.length > 1" class="essential-chips">
        <span
          v-for="(tableType, index) in options.tableTypes"
          :key="tableType"
          class="essential-chip"
          data-testid="essential-table-type-chip"
        >
          <span class="essential-chip-rank">{{ index + 1 }}</span>
          {{ tableType }}
        </span>
      </div>
      <p v-else class="essential-item-warning" data-testid="essential-table-types-stubbed">
        Every table is the same type for now, so applicants are not asked to rank them. This
        question appears once a floorplan gives your market more than one table type.
      </p>
    </div>
  </div>
</template>

<style scoped>
.essential-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(54, 130, 111, 0.16);
  border-radius: var(--radius-card);
  background: rgba(54, 130, 111, 0.16);
}

.essential-panel-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.essential-panel-header h3 {
  font-family: 'Merge One';
  font-size: var(--text-sm);
  color: var(--mm-black);
  margin: 0;
}

.essential-badge {
  font-size: var(--text-xs);
  background: var(--mm-green);
  color: white;
  border-radius: var(--radius-control);
  padding: 2px 8px;
  white-space: nowrap;
}

.essential-panel-note {
  font-size: var(--text-xs);
  line-height: 1.4;
  color: var(--mm-text-green);
  margin: 0;
}

.essential-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px;
  border: 1px solid rgba(54, 130, 111, 0.16);
  border-radius: var(--radius-control);
  background: white;
}

.essential-item-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.essential-item-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
  flex: 1;
  min-width: 0;
}

.essential-type-badge {
  font-size: var(--text-xs);
  background: var(--mm-border);
  color: var(--mm-text-muted);
  border-radius: var(--radius-control);
  padding: 1px 6px;
  white-space: nowrap;
}

.essential-item-detail {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  margin: 0;
}

.essential-chips {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 6px;
}

.essential-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-xs);
  color: var(--mm-black);
  background: rgba(54, 130, 111, 0.16);
  border: 1px solid rgba(54, 130, 111, 0.16);
  border-radius: var(--radius-card);
  padding: 2px 10px;
}

.essential-chip-rank {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--mm-green);
  color: white;
  font-size: var(--text-xs);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.essential-item-warning {
  font-size: var(--text-xs);
  line-height: 1.4;
  color: var(--mm-text-yellow);
  background: rgba(228, 166, 41, 0.18);
  border: 1px solid var(--mm-yellow);
  border-radius: var(--radius-control);
  padding: 6px 9px;
  margin: 0;
}
.essential-asks-toggle {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-xs);
  color: rgba(39, 35, 35, 0.66);
}
</style>
