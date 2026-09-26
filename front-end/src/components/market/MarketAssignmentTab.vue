<script setup lang="ts">
/**
 * The assignment surface (E18/F02/S04).
 *
 * Assignment Priority, Assignment Options and Assign used to live in the PLAN - the earliest
 * stage, and the furthest possible point from where they belong. A priority rule names a form
 * field key, so it cannot be written before the form exists, and it is most meaningful once
 * applications are in hand.
 *
 * Assign was worse: the back end already refuses it outside the assignment phase, so a permanently
 * visible, permanently disabled button on the plan explained a rule on every screen instead of
 * applying it on one. The refusal below is still the front end MIRRORING the server, never the
 * rule itself - a hidden button is not a rule.
 */
import ElementSettingContainer from '@/components/elements/ElementSettingContainer.vue';
import ElementAssignmentPriority from '@/components/elements/ElementAssignmentPriority.vue';
import ElementAssignmentOptions from '@/components/elements/ElementAssignmentOptions.vue';
import AssignmentResults from '@/components/AssignmentResults.vue';
import type { FormField, SetupObject } from '@/assets/types/datatypes';

defineProps<{
  setupObject: SetupObject;
  formFields: FormField[];
  assignmentOptionsComplete: boolean;
  assignRefusalReason: string | null;
  assignError: string;
  /** Why the rules can no longer change, from the market (E22/F02/S02); null while they can. */
  rulesLockReason: string | null;
  /** What changed since the stored assignment ran, worded; null when nothing has (E22/F03/S02). */
  outOfDate: string | null;
}>();

const emit = defineEmits<{
  (event: 'update:setupObject', value: SetupObject): void;
  (event: 'assign'): void;
}>();
</script>

<template>
  <div class="settings-body settings-body-stacked">
    <!-- The rules as they were run, and why nothing offers to change them (E22/F02/S02). -->
    <p v-if="rulesLockReason" class="rules-settled" data-testid="assignment-rules-settled">
      {{ rulesLockReason }}
    </p>
    <section class="plan-row plan-row--asymmetric">
      <ElementSettingContainer>
        <template #setting-title>
          <h2>Assignment Priority</h2>
        </template>
        <template #setting-content>
          <ElementAssignmentPriority
            :setupObject="setupObject"
            :formFields="formFields"
            :readonly="!!rulesLockReason"
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
            :readonly="!!rulesLockReason"
            @update:setupObject="(value) => emit('update:setupObject', value)"
          />
        </template>
      </ElementSettingContainer>
    </section>

    <!-- Nothing can run once the rules are settled, so there is no button to explain. -->
    <div v-if="!rulesLockReason" class="assign-actions">
      <button
        type="button"
        class="btn btn--primary done-button"
        :disabled="!assignmentOptionsComplete || !!assignRefusalReason"
        @click="emit('assign')"
        data-testid="market-setup-assign-button"
      >
        Assign
      </button>
      <!-- The phase comes first: a market that may not be assigned at all is not waiting on
           two numbers, and saying so would send the organizer to fix the wrong thing. -->
      <!-- Said once: when the rules are settled, the line above already says why nothing runs. -->
      <p
        v-if="assignRefusalReason && !rulesLockReason"
        class="assign-disabled-hint"
        data-testid="market-setup-assign-phase-hint"
      >
        {{ assignRefusalReason }}
      </p>
      <p
        v-else-if="!assignmentOptionsComplete"
        class="assign-disabled-hint"
        data-testid="market-setup-assign-hint"
      >
        Set both assignment options above to run the assignment.
      </p>
      <div v-if="assignError" class="assign-error-banner" data-testid="market-setup-assign-error">
        <span>{{ assignError }}</span>
      </div>
    </div>

    <!-- A fact, not an error: no dismiss, and running again is what clears it (E22/F03/S02). -->
    <p v-if="outOfDate" class="out-of-date" data-testid="assignment-out-of-date">
      {{ outOfDate }} Run the assignment again to bring it up to date.
    </p>

    <AssignmentResults />
  </div>
</template>

<style scoped>
.settings-body {
  align-self: stretch;
  display: flex;
  gap: 30px;
  padding: 40px;
}

.settings-body-stacked {
  flex-direction: column;
  gap: 30px;
  overflow-y: auto;
}

.plan-row {
  display: grid;
  gap: 30px;
  align-items: stretch;
}

.plan-row--asymmetric {
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
}

.out-of-date {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--mm-green);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.rules-settled {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--mm-green);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.assign-actions {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.assign-disabled-hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  text-align: right;
  max-width: 60ch;
}

.assign-error-banner {
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-control);
  border: 1px solid var(--mm-red);
  background: rgba(192, 57, 43, 0.08);
  color: var(--mm-red);
  font-size: var(--text-xs);
  line-height: 1.4;
}
</style>
