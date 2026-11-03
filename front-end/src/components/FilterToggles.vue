<script setup lang="ts">
/**
 * One row of pressed buttons that filters a list or switches a view (T200): the row ten places
 * each draw their own way, drawn from the `.btn` primitive and its pressed look.
 *
 * With one choice `modelValue` is the chosen option's id: pressing a toggle chooses it, and pressing
 * the chosen one again keeps it. With `multiple` it is the chosen ids, in the options' order:
 * pressing a toggle takes it in or out, and an id no option offers goes with the next press, since
 * no toggle could let it go.
 *
 * A toggle is named by the words it shows, its label then its count. The row wraps and so does a
 * long label, so it never scrolls sideways; a phone's tokens make each toggle at least a 44px target.
 */
export interface FilterToggle {
  id: string;
  label: string;
  /** How many the toggle holds; a toggle without one draws none, and 0 reads as 0. */
  count?: number;
}

const props = defineProps<
  {
    options: FilterToggle[];
    /** The group's name, for a screen reader: what the row chooses. */
    label: string;
    testid: string;
  } & ({ multiple?: false; modelValue: string } | { multiple: true; modelValue: string[] })
>();

const emit = defineEmits<{ 'update:modelValue': [value: string | string[]] }>();

function isPressed(id: string): boolean {
  return props.multiple ? props.modelValue.includes(id) : props.modelValue === id;
}

function press(id: string): void {
  if (props.multiple) {
    const chosen = new Set(props.modelValue);
    if (!chosen.delete(id)) chosen.add(id);
    emit(
      'update:modelValue',
      props.options.map((option) => option.id).filter((optionId) => chosen.has(optionId)),
    );
  } else if (props.modelValue !== id) {
    emit('update:modelValue', id);
  }
}
</script>

<template>
  <div class="filter-toggles" role="group" :aria-label="label" :data-testid="testid">
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      class="btn btn--secondary btn--compact filter-toggles__toggle"
      :aria-pressed="isPressed(option.id)"
      :data-testid="`${testid}-${option.id}`"
      @click="press(option.id)"
    >
      <span class="filter-toggles__words" :data-testid="`${testid}-words`"
        >{{ option.label }}
        <span v-if="option.count !== undefined" class="filter-toggles__count">{{
          option.count
        }}</span></span
      >
    </button>
  </div>
</template>

<style scoped>
.filter-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}

/* `.btn` holds one line at one height; a label longer than the row wraps inside its toggle. */
.filter-toggles__toggle {
  height: auto;
  min-height: var(--control-height-compact);
  /* A short label, "All", is still a whole target: 44px on a phone. */
  min-width: var(--target-min);
  max-width: 100%;
  padding-block: var(--space-1);
  white-space: normal;
  overflow-wrap: anywhere;
}

/* `base.css` resets every element's weight; label and count take the button's, 600 when pressed. */
.filter-toggles__words,
.filter-toggles__count {
  font-weight: inherit;
}

.filter-toggles__count {
  /* Figures in a row of counts keep their width (E15/F01/S03). */
  font-variant-numeric: tabular-nums;
  color: var(--mm-text-muted);
}

.filter-toggles__toggle[aria-pressed='true'] .filter-toggles__count {
  color: inherit;
}
</style>
