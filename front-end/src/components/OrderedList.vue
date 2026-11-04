<script setup lang="ts" generic="T">
/**
 * A list someone puts in order (T200): each row has the `.drag-handle` and its own move up and move
 * down buttons, so the order can be set with the mouse or the keyboard. Five places order a list
 * today and only the export dialog has the buttons.
 *
 * - The first row's up and the last row's down are disabled. A move keeps the focus on the moved
 *   row's button so it can be pressed again; one that reaches the end, and so is disabled, hands the
 *   focus to the row's other button rather than dropping it on the page.
 * - A row takes its container's width: its words wrap and its buttons never shrink, so nothing is
 *   clipped on the right inside a dialog's scrolling body or tray (T191's F03).
 * - It holds nothing itself: `modelValue` is the order, and each change is a new array.
 */
import { nextTick, ref } from 'vue';
import draggable from 'vuedraggable';
import IconClickDrag from '@/components/icons/IconClickDrag.vue';
import IconExpandDown from '@/components/icons/IconExpandDown.vue';
import IconExpandUp from '@/components/icons/IconExpandUp.vue';

const props = defineProps<{
  modelValue: T[];
  /** What tells a row from the others, across moves. */
  itemKey: (item: T) => string;
  /** What a row is called, by its move buttons and, without a `row` slot, on the row. */
  itemLabel: (item: T) => string;
  /** What the list is, for a screen reader. */
  label: string;
  /** Prefixes every test id; a move button's ends with its item's key. */
  testid: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: T[]] }>();

defineSlots<{ row?: (scope: { item: T; index: number }) => unknown }>();

const root = ref<HTMLElement | null>(null);

const buttonOf = (item: T, way: 'up' | 'down') =>
  root.value?.querySelector<HTMLButtonElement>(
    `[data-testid="${CSS.escape(`${props.testid}-${way}-${props.itemKey(item)}`)}"]`,
  );

async function move(index: number, by: -1 | 1): Promise<void> {
  const to = index + by;
  const item = props.modelValue[index]!;
  const next = props.modelValue.slice();
  next.splice(index, 1);
  next.splice(to, 0, item);
  emit('update:modelValue', next);
  await nextTick();
  const button = buttonOf(item, by < 0 ? 'up' : 'down');
  (button && !button.disabled ? button : buttonOf(item, by < 0 ? 'down' : 'up'))?.focus();
}
</script>

<template>
  <div ref="root" class="ordered-list-box">
    <draggable
      :model-value="modelValue"
      :item-key="itemKey"
      tag="ol"
      class="ordered-list"
      handle=".drag-handle"
      :animation="150"
      :aria-label="label"
      :data-testid="testid"
      @update:model-value="emit('update:modelValue', $event)"
    >
      <template #item="{ element, index }">
        <li class="ordered-list__row" :data-testid="`${testid}-row`">
          <span class="drag-handle ordered-list__handle" aria-hidden="true"
            ><IconClickDrag class="drag-handle__icon"
          /></span>
          <span class="ordered-list__words">
            <slot name="row" :item="element" :index="index">{{ itemLabel(element) }}</slot>
          </span>
          <button
            type="button"
            class="ordered-list__move"
            :aria-label="`Move ${itemLabel(element)} up`"
            :disabled="index === 0"
            :data-testid="`${testid}-up-${itemKey(element)}`"
            @click="move(index, -1)"
          >
            <IconExpandUp aria-hidden="true" />
          </button>
          <button
            type="button"
            class="ordered-list__move"
            :aria-label="`Move ${itemLabel(element)} down`"
            :disabled="index === modelValue.length - 1"
            :data-testid="`${testid}-down-${itemKey(element)}`"
            @click="move(index, 1)"
          >
            <IconExpandDown aria-hidden="true" />
          </button>
        </li>
      </template>
    </draggable>
  </div>
</template>

<style scoped>
.ordered-list-box {
  width: 100%;
  min-width: 0;
}

.ordered-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
}

/* An empty list has no box to show. */
.ordered-list:empty {
  display: none;
}

.ordered-list__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  background: white;
}

.ordered-list__row + .ordered-list__row {
  border-top: 1px solid var(--mm-border);
}

/* The row's first and last keep the list's corners while the row is white. */
.ordered-list__row:first-child {
  border-top-left-radius: inherit;
  border-top-right-radius: inherit;
}

.ordered-list__row:last-child {
  border-bottom-left-radius: inherit;
  border-bottom-right-radius: inherit;
}

.ordered-list__handle {
  flex: none;
  align-self: stretch;
}

.ordered-list__words {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

/* Drawn as the application form's order arrows are (`RankedChoiceInput.vue`), so the app has one
   order control, and its disabled beige is the primitives' one disabled state (`.btn:disabled`). */
.ordered-list__move {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: var(--target-min);
  min-height: var(--target-min);
  padding: var(--space-hairline);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
  color: var(--mm-black);
  cursor: pointer;
}

.ordered-list__move svg {
  width: var(--space-4);
  height: var(--space-4);
}

.ordered-list__move:hover:not(:disabled) {
  border-color: var(--mm-green);
  color: var(--mm-green);
}

.ordered-list__move:disabled {
  background: var(--mm-beige);
  color: var(--mm-text-muted-on-beige);
  cursor: not-allowed;
}
</style>
