<script setup lang="ts">
/**
 * The choice of a market's reviewers (E38/F07/S02, T204): a `SearchPicker` of several, the chosen as
 * chips above a field that finds a person by their address, the reader's own marked "(you)". One
 * picker for every place that offers the choice: the Reviewers panel, and where the stage begins
 * (phase 2).
 *
 * The current reviewers are offered and chosen even when the reader is not offered them, so saving
 * without touching one keeps them. Nothing is chosen by default otherwise. An address compares
 * case-folded: a chosen one is shown and offered in the one spelling the choices hold, so one person
 * never stands twice.
 */
import { computed, useId } from 'vue';
import SearchPicker from '@/components/SearchPicker.vue';
import { PEOPLE_CAP, findsPerson, personOption } from '@/utils/personChoice';
import { PICKER_HINT, pickerChoices } from '@/utils/reviewTeam';

const props = defineProps<{
  /** Whom the reader may choose: the market read's `reviewerCandidates`. */
  candidates: readonly string[];
  /** The market's reviewers now, offered whether or not the reader is offered them. */
  current: readonly string[];
  disabled?: boolean;
}>();

/** The addresses chosen. */
const chosen = defineModel<string[]>({ required: true });

const hintId = useId();
const choices = computed(() => pickerChoices(props.candidates, props.current));
const groups = computed(() => [{ options: choices.value.map(personOption) }]);

const spellings = computed(
  () => new Map(choices.value.map((address) => [address.toLowerCase(), address])),
);
const chosenAsOffered = computed(() => [
  ...new Set(chosen.value.map((address) => spellings.value.get(address.toLowerCase()) ?? address)),
]);
</script>

<template>
  <div class="reviewer-picker">
    <SearchPicker
      multiple
      :model-value="chosenAsOffered"
      :groups="groups"
      :finds="findsPerson"
      :cap="PEOPLE_CAP"
      :disabled="disabled"
      :described-by="hintId"
      label="Reviewers"
      placeholder="Type an address…"
      testid="reviewer-picker"
      @update:model-value="chosen = $event as string[]"
    />
    <p :id="hintId" class="reviewer-picker-hint">{{ PICKER_HINT }}</p>
  </div>
</template>

<style scoped>
.reviewer-picker {
  min-width: 0;
}

.reviewer-picker-hint {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
