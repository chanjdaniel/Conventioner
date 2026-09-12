<script setup lang="ts">
/**
 * The always-present essential questions, as the form builder shows them to the organizer.
 *
 * These are purpose-built, not custom fields: an organizer cannot remove or reorder them, and
 * the only thing they customise is what the questions offer - which is the market plan itself
 * (dates, sections, and the floorplan's table types). This panel therefore renders the current
 * offering read-only and points at where each list is edited, instead of offering a second
 * place to edit it.
 */
import type { EssentialFormOptions } from '@/assets/types/datatypes';
import {
  AVAILABLE_DATES_LABEL,
  MAX_DATES_LABEL,
  SECTION_RANKING_LABEL,
  TABLE_TYPE_RANKING_LABEL,
  formattedEssentialDate,
} from '@/utils/essentialFields';

defineProps<{
  options: EssentialFormOptions;
  /** True once the offering is frozen (an application exists); the hints change tense. */
  locked?: boolean;
}>();
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

    <div class="essential-item" data-testid="essential-item-section-ranking">
      <div class="essential-item-header">
        <span class="essential-item-label">{{ SECTION_RANKING_LABEL }}</span>
        <span class="essential-type-badge">ranking</span>
      </div>
      <div v-if="options.sections.length" class="essential-chips">
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
      <p v-else class="essential-item-warning" data-testid="essential-sections-empty">
        No sections yet - this question is hidden from applicants until your market plan defines
        sections (Market Setup or the floorplan editor).
      </p>
    </div>

    <div class="essential-item" data-testid="essential-item-table-type-ranking">
      <div class="essential-item-header">
        <span class="essential-item-label">{{ TABLE_TYPE_RANKING_LABEL }}</span>
        <span class="essential-type-badge">ranking</span>
      </div>
      <div v-if="options.tableTypes.length" class="essential-chips">
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
      <p v-else class="essential-item-warning" data-testid="essential-table-types-empty">
        No table types yet - this question is hidden from applicants until your floorplan defines
        table types.
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
  border: 1px solid #cfe3d4;
  border-radius: 8px;
  background: #f4faf5;
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
  font-size: 15px;
  color: var(--mm-black);
  margin: 0;
}

.essential-badge {
  font-family: 'Outfit Regular';
  font-size: 11px;
  background: var(--mm-green);
  color: white;
  border-radius: 3px;
  padding: 2px 8px;
  white-space: nowrap;
}

.essential-panel-note {
  font-family: 'Outfit Regular';
  font-size: 12px;
  line-height: 1.4;
  color: #3c5a44;
  margin: 0;
}

.essential-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px;
  border: 1px solid #dbe8de;
  border-radius: 6px;
  background: white;
}

.essential-item-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.essential-item-label {
  font-family: 'Outfit Regular';
  font-size: 14px;
  font-weight: bold;
  color: var(--mm-black);
  flex: 1;
  min-width: 0;
}

.essential-type-badge {
  font-family: 'Outfit Regular';
  font-size: 11px;
  background: #e8e8e8;
  color: #555;
  border-radius: 3px;
  padding: 1px 6px;
  white-space: nowrap;
}

.essential-item-detail {
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: var(--mm-grey, #666);
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
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: var(--mm-black);
  background: #eef4ef;
  border: 1px solid #d5e3d8;
  border-radius: 12px;
  padding: 2px 10px;
}

.essential-chip-rank {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--mm-green);
  color: white;
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.essential-item-warning {
  font-family: 'Outfit Regular';
  font-size: 12px;
  line-height: 1.4;
  color: #7a5200;
  background: #fff6e0;
  border: 1px solid #f0d089;
  border-radius: 5px;
  padding: 6px 9px;
  margin: 0;
}
</style>
