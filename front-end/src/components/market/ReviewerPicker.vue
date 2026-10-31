<script setup lang="ts">
/**
 * The choice of a market's reviewers (E38/F07/S02): a checkbox per person the reader may choose,
 * their own address marked "(you)". One picker for every place that offers the choice: the
 * Reviewers panel, and where the stage begins (phase 2).
 *
 * The current reviewers are listed and ticked even when the reader is not offered them, so saving
 * without touching one keeps them. Nothing is ticked by default otherwise.
 */
import { computed, useId } from 'vue';
import { signedInEmail } from '@/utils/signedIn';
import { PICKER_HINT, pickerChoices } from '@/utils/reviewTeam';

const props = defineProps<{
  /** Whom the reader may choose: the market read's `reviewerCandidates`. */
  candidates: readonly string[];
  /** The market's reviewers now, listed whether or not the reader is offered them. */
  current: readonly string[];
  disabled?: boolean;
}>();

/** The addresses ticked. */
const ticked = defineModel<string[]>({ required: true });

const hintId = useId();
const me = computed(() => (signedInEmail() ?? '').toLowerCase());
const choices = computed(() => pickerChoices(props.candidates, props.current));

function isTicked(address: string): boolean {
  const key = address.toLowerCase();
  return ticked.value.some((chosen) => chosen.toLowerCase() === key);
}

function toggle(address: string, on: boolean) {
  const key = address.toLowerCase();
  const others = ticked.value.filter((chosen) => chosen.toLowerCase() !== key);
  ticked.value = on ? [...others, address] : others;
}
</script>

<template>
  <fieldset class="reviewer-picker" :aria-describedby="hintId" data-testid="reviewer-picker">
    <legend class="field-label">Reviewers</legend>
    <ul class="reviewer-picker-list">
      <li v-for="address in choices" :key="address">
        <label class="reviewer-picker-choice">
          <input
            type="checkbox"
            :checked="isTicked(address)"
            :disabled="disabled"
            :data-testid="`reviewer-picker-${address}`"
            @change="toggle(address, ($event.target as HTMLInputElement).checked)"
          />
          <span class="reviewer-picker-address">{{ address }}</span>
          <span v-if="address.toLowerCase() === me" class="reviewer-picker-you">(you)</span>
        </label>
      </li>
    </ul>
    <p :id="hintId" class="reviewer-picker-hint">{{ PICKER_HINT }}</p>
  </fieldset>
</template>

<style scoped>
.reviewer-picker {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

/* A market's organization can name dozens of people: the list scrolls inside the dialog. */
.reviewer-picker-list {
  max-height: 16rem;
  margin: var(--space-1) 0 0;
  padding: var(--space-1) 0;
  overflow-y: auto;
  list-style: none;
}

.reviewer-picker-choice {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 2rem;
  font-size: var(--text-sm);
  color: var(--mm-black);
  cursor: pointer;
}

.reviewer-picker-address {
  min-width: 0;
  overflow-wrap: anywhere;
}

.reviewer-picker-you {
  flex-shrink: 0;
  color: var(--mm-text-muted);
}

.reviewer-picker-hint {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
