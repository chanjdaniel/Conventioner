<script setup lang="ts">
/**
 * How vendors reach this market (E18/F04/S01).
 *
 * The phase cannot express this. Application submission is already gated to `applications_open`,
 * but a CSV market passes through that phase too - that is where the import happens - so during
 * that window its public application form would be live and taking applications from strangers the
 * organizer has no way to answer.
 *
 * Settable while the market is a DRAFT and frozen afterwards, which is the rule the back end
 * already enforces in `_intake_mode_for_update`: switching mid-lifecycle strands whatever the
 * previous mode produced. A hidden control is not a rule, so the server is the authority and this
 * only stops an organizer reaching for something that would be refused.
 *
 * Absence still means CSV. Wrongly hiding an application surface is visible and gets complained
 * about; wrongly exposing one is silent until a stranger applies.
 */
import { computed } from 'vue';
import { IntakeMode } from '@/assets/types/datatypes';

const props = defineProps<{
  intakeMode?: IntakeMode;
  editable: boolean;
}>();

const emit = defineEmits<{ (event: 'update:intakeMode', value: IntakeMode): void }>();

/** Absent means CSV, the same way the back end reads it. */
const chosen = computed(() => props.intakeMode ?? IntakeMode.Csv);

const CHOICES: Array<{ value: IntakeMode; label: string; help: string }> = [
  {
    value: IntakeMode.Csv,
    label: 'I collect applications elsewhere',
    help: 'You import a spreadsheet of the responses you already have.',
  },
  {
    value: IntakeMode.Form,
    label: 'Vendors apply on this market’s page',
    help: 'Your application form goes live at the market’s own address while applications are open.',
  },
];

function choose(value: IntakeMode) {
  if (!props.editable || value === chosen.value) return;
  emit('update:intakeMode', value);
}
</script>

<template>
  <div class="intake-mode" data-testid="setup-intake-mode">
    <label
      v-for="choice in CHOICES"
      :key="choice.value"
      class="intake-choice"
      :class="{ chosen: chosen === choice.value, disabled: !editable }"
      :data-testid="`setup-intake-mode-${choice.value}`"
    >
      <input
        type="radio"
        name="intake-mode"
        :value="choice.value"
        :checked="chosen === choice.value"
        :disabled="!editable"
        @change="choose(choice.value)"
      />
      <span class="intake-choice-text">
        <span class="intake-choice-label">{{ choice.label }}</span>
        <span class="intake-choice-help">{{ choice.help }}</span>
      </span>
    </label>

    <!-- Frozen, not broken: say which it is and why, rather than leaving a dead control. -->
    <p v-if="!editable" class="intake-frozen" data-testid="setup-intake-mode-frozen">
      This is fixed once a market leaves draft, because changing it would strand whatever the
      previous choice produced.
    </p>
  </div>
</template>

<style scoped>
.intake-mode {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
}

.intake-choice {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: var(--space-2);

  padding: var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
  cursor: pointer;
  text-align: left;
}

.intake-choice.chosen {
  border-color: var(--mm-green);
}

.intake-choice.disabled {
  cursor: not-allowed;
  background: var(--mm-beige);
}

.intake-choice input {
  margin-top: var(--space-hairline);
  flex: 0 0 auto;
}

.intake-choice-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-hairline);
}

.intake-choice-label {
  font-size: var(--text-sm);
  color: var(--mm-black);
}

/* The beige-safe muted ink, because the chosen-and-frozen card's ground IS beige: `--mm-text-muted`
   is 4.63 on white and 4.23 on beige, and this help text sits on both. */
.intake-choice-help {
  font-size: var(--text-xs);
  color: var(--mm-text-muted-on-beige);
  line-height: 1.4;
}

.intake-frozen {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  line-height: 1.4;
}
</style>
