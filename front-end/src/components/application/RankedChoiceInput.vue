<script setup lang="ts">
/**
 * An ordered preference list the applicant ranks with explicit up/down controls.
 *
 * Buttons rather than drag on purpose: drag-to-reorder is invisible affordance on a phone and
 * undrivable in tests, while "1 is your first choice" plus arrows is self-explaining. The list
 * always contains every offered option (rankings are total - see essentialFields.ts), so the
 * applicant's only job is ordering, never remembering what exists.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string[];
    testid: string;
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void;
}>();

function move(index: number, delta: number) {
  if (props.disabled) return;
  const target = index + delta;
  if (target < 0 || target >= props.modelValue.length) return;
  const next = [...props.modelValue];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  emit('update:modelValue', next);
}
</script>

<template>
  <ol class="ranked-list" :data-testid="testid">
    <li
      v-for="(option, index) in modelValue"
      :key="option"
      class="ranked-item"
      :data-testid="`${testid}-item-${index}`"
    >
      <span class="ranked-position" aria-hidden="true">{{ index + 1 }}</span>
      <span class="ranked-name" :data-testid="`${testid}-name-${index}`">{{ option }}</span>
      <span v-if="index === 0" class="ranked-first-badge">1st choice</span>
      <span v-if="!disabled" class="ranked-controls">
        <button
          type="button"
          class="ranked-btn"
          :disabled="index === 0"
          :aria-label="`Move ${option} up to rank ${Math.max(index, 1)}`"
          :data-testid="`${testid}-up-${index}`"
          @click="move(index, -1)"
        >
          &#9650;
        </button>
        <button
          type="button"
          class="ranked-btn"
          :disabled="index === modelValue.length - 1"
          :aria-label="`Move ${option} down to rank ${Math.min(index + 2, modelValue.length)}`"
          :data-testid="`${testid}-down-${index}`"
          @click="move(index, 1)"
        >
          &#9660;
        </button>
      </span>
    </li>
  </ol>
</template>

<style scoped>
.ranked-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
}

.ranked-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--mm-grey, #ddd);
  border-radius: 6px;
  background: white;
}

.ranked-position {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--mm-green);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Merge One';
  font-size: 13px;
}

.ranked-name {
  flex: 1;
  min-width: 0;
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.ranked-first-badge {
  font-family: 'Outfit Regular';
  font-size: 11px;
  color: var(--mm-green);
  border: 1px solid var(--mm-green);
  border-radius: 10px;
  padding: 1px 8px;
  white-space: nowrap;
}

.ranked-controls {
  display: flex;
  flex-direction: row;
  gap: 4px;
}

.ranked-btn {
  width: 30px;
  height: 30px;
  border: 1px solid var(--mm-grey, #ccc);
  border-radius: 5px;
  background: white;
  color: var(--mm-black);
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ranked-btn:hover:not(:disabled) {
  border-color: var(--mm-green);
  color: var(--mm-green);
}

.ranked-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
