<script setup lang="ts">
import { onMounted, ref, toRef, nextTick, computed, watch } from 'vue';
import draggable from 'vuedraggable';
import {
  ALL_OTHERS,
  type FormField,
  type PriorityObject,
  type SetupObject,
} from '@/assets/types/datatypes';
import IconAddRound from '../icons/IconAddRound.vue';
import IconClickDrag from '../icons/IconClickDrag.vue';
import IconClickDragSmall from '../icons/IconClickDragSmall.vue';
import IconCloseRound from '../icons/IconCloseRound.vue';

/**
 * The ordered rules that decide who is placed first when demand exceeds tables.
 *
 * A rule names one of the organizer's own form questions and arranges its answers, best first.
 * Priority is exactly where markets differ from one another, so the targets have to be the
 * organizer's own questions rather than a vocabulary we chose for them.
 *
 * There is deliberately no data-type dropdown. The one that used to sit here offered five types
 * the solver read nothing from, so a rule marked as a number in ascending order scored every
 * vendor identically and did nothing, with no error and no warning. How to order a target
 * follows from the target's own type, which makes that state unrepresentable rather than merely
 * discouraged.
 */
const props = defineProps<{ setupObject: SetupObject; formFields?: FormField[] }>();
const emit = defineEmits(['update:setupObject']);

const setupObject = toRef(props, 'setupObject');
const priorityObjects = toRef(setupObject.value, 'priority');

watch(
  () => setupObject.value.priority,
  () => {
    emit('update:setupObject', setupObject.value);
  },
  { deep: true },
);

/**
 * The questions a rule may target: those whose answers form a fixed, orderable set.
 *
 * A free-text question has no arrangement to make, so offering it would only let an organizer
 * build a rule that cannot do anything.
 */
const ORDERABLE_FIELD_TYPES = ['select', 'multi_select'];

const targetableFields = computed<FormField[]>(() =>
  (props.formFields ?? []).filter((field) => ORDERABLE_FIELD_TYPES.includes(field.type)),
);

const fieldFor = (target: string | null): FormField | undefined =>
  targetableFields.value.find((field) => field.key === target);

const labelFor = (target: string | null): string => fieldFor(target)?.label ?? '';

/** Answers this rule's target offers that the organizer has not placed yet. */
const unplacedOptions = (rule: PriorityObject): string[] => {
  const field = fieldFor(rule.target);
  if (!field) return [];
  const remaining = field.options.filter((option) => !rule.ordering.includes(option));
  if (!rule.ordering.includes(ALL_OTHERS)) remaining.push(ALL_OTHERS);
  return remaining;
};

const rowsMaxHeight = ref<string | null>(null);
const container = ref<HTMLElement | null>(null);
const rows = ref<HTMLElement | null>(null);
const columnTitles = ref<HTMLElement | null>(null);
const setHeight = () => {
  rowsMaxHeight.value = '0px';
  nextTick(() => {
    if (container.value && columnTitles.value && rows.value) {
      rowsMaxHeight.value = `${container.value.clientHeight - columnTitles.value.clientHeight - 15}px`;
    }
  });
};

const targetDefault = 'Select a question';
const optionDefault = 'Add an answer';

onMounted(() => {
  setHeight();
});

const nextRuleId = () =>
  priorityObjects.value.reduce((highest, rule) => Math.max(highest, rule.id), 0) + 1;

const addPriorityRow = () => {
  priorityObjects.value.push({ id: nextRuleId(), target: null, ordering: [] });
};

const removePriorityRow = (index: number) => {
  priorityObjects.value.splice(index, 1);
};

/** Retargeting a rule discards an ordering that belonged to a different question's answers. */
const handleTargetChange = (index: number) => {
  priorityObjects.value[index].ordering = [];
};

const addOrderingItem = (index: number, value: string) => {
  if (!value) return;
  priorityObjects.value[index].ordering.push(value);
};

const removeOrderingItem = (parentIndex: number, childIndex: number) => {
  priorityObjects.value[parentIndex].ordering.splice(childIndex, 1);
};

const hoverParentIndex = ref(null);
const hoverChildIndex = ref(null);

const dragOptions = computed(() => ({
  group: 'rows',
  disabled: false,
  ghostClass: 'sortable-chosen',
  chosenClass: 'sortable-ghost',
  dragClass: 'sortable-ghost',
  handle: '.drag-item',
  forceFallback: false,
  fallbackOnBody: false,
}));
</script>

<template>
  <div class="container" ref="container">
    <div class="column-titles row-container" ref="columnTitles">
      <h3>Priority</h3>
      <h3>Question</h3>
      <h3>Answers, best first</h3>
      <h3></h3>
    </div>
    <div class="rows" ref="rows">
      <p v-if="targetableFields.length === 0" class="empty-hint">
        Priority rules order vendors by an answer on your application form. Add a question with a
        fixed set of answers, such as a dropdown or a multi-select, and it will appear here.
      </p>
      <draggable class="priority-rows" v-model="priorityObjects" item-key="id" v-bind="dragOptions">
        <template #item="{ element, index: parentIndex }">
          <div
            class="priority-row row-container"
            :key="element.id"
            data-testid="priority-rule-row"
            @mouseover="hoverParentIndex = parentIndex"
            @mouseleave="hoverParentIndex = null"
          >
            <div class="row-item drag-item">
              <IconClickDrag class="click-drag" />
              <h3>{{ parentIndex + 1 }}</h3>
            </div>
            <div class="row-item click-item">
              <select
                class="dropdown"
                data-testid="priority-target-select"
                v-model="priorityObjects[parentIndex].target"
                @change="handleTargetChange(parentIndex)"
              >
                <option disabled :value="null">{{ targetDefault }}</option>
                <option
                  class="display-list"
                  v-for="field in targetableFields"
                  :key="field.key"
                  :value="field.key"
                >
                  {{ field.label }}
                </option>
              </select>
            </div>
            <div class="row-item">
              <div class="sorting-order-container" v-if="priorityObjects[parentIndex].target">
                <draggable
                  class="sorting-rows"
                  v-model="priorityObjects[parentIndex].ordering"
                  item-key="element"
                  :options="{
                    handle: '.sorting-index-drag',
                    filter: '.click-item',
                    forceFallback: true,
                    fallbackOnBody: true,
                  }"
                  :group="`sorting-${parentIndex}`"
                  :disabled="false"
                  :ghostClass="'sortable-chosen'"
                  :chosenClass="'sorting-ghost'"
                  :dragClass="'sorting-ghost'"
                >
                  <template #item="{ element: answer, index: childIndex }">
                    <div
                      class="sorting-order-row"
                      data-testid="priority-ordering-row"
                      @mouseover="hoverChildIndex = childIndex"
                      @mouseleave="hoverChildIndex = null"
                    >
                      <div class="sorting-index-drag" @mousedown.stop>
                        <IconClickDragSmall class="sorting-click-drag" />
                        <h3>{{ childIndex + 1 }}</h3>
                      </div>
                      <h3 class="sorting-answer">{{ answer }}</h3>
                      <IconCloseRound
                        class="close-round"
                        data-testid="priority-ordering-remove"
                        @click="removeOrderingItem(parentIndex, childIndex)"
                      />
                    </div>
                  </template>
                </draggable>
                <select
                  class="dropdown add-answer"
                  data-testid="priority-ordering-add"
                  :value="''"
                  @change="
                    addOrderingItem(parentIndex, ($event.target as HTMLSelectElement).value);
                    ($event.target as HTMLSelectElement).value = '';
                  "
                >
                  <option value="">{{ optionDefault }}</option>
                  <option
                    v-for="option in unplacedOptions(priorityObjects[parentIndex])"
                    :key="option"
                    :value="option"
                  >
                    {{ option }}
                  </option>
                </select>
                <p class="ordering-hint" v-if="priorityObjects[parentIndex].ordering.length === 0">
                  Add the answers to &ldquo;{{
                    labelFor(priorityObjects[parentIndex].target)
                  }}&rdquo; in the order you want them placed. Anything you leave out sorts last, or
                  where you put &ldquo;{{ ALL_OTHERS }}&rdquo;.
                </p>
              </div>
            </div>
            <div class="row-item">
              <IconCloseRound
                class="close-round"
                data-testid="priority-rule-remove"
                @click="removePriorityRow(parentIndex)"
              />
            </div>
          </div>
        </template>
      </draggable>
      <div class="add-row" data-testid="priority-add-rule" @click="addPriorityRow">
        <IconAddRound class="add-round" />
        <h3>Add a rule</h3>
      </div>
    </div>
  </div>
</template>

<style scoped>
h4 {
  height: auto;
  text-align: center;
  text-justify: center;
  min-height: 30px;
  max-height: 200px;
  max-width: 400px;
  overflow-y: scroll;
  scrollbar-width: none;
}

h3 {
  padding-left: 5px;
  padding-right: 5px;
}

.container {
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;
  align-items: center;

  padding-left: 5px;
  padding-right: 5px;
  gap: 15px;
}

.input-container {
  width: 80%;
  height: 100%;
  box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
  border-radius: 8px;
}

.column-titles {
  display: grid;
  grid-template-columns: 10% 30% 15% 40% 5%;
}

.priority-row {
  display: grid;
  grid-template-columns: 10% 30% 15% 40% 5%;
  padding-top: 5px;
  padding-bottom: 5px;
  min-height: 48px;
  overflow: visible;
}

.sortable-ghost {
  box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
  opacity: 0.7;
}

.sorting-ghost {
  opacity: 0.8;
}

.sortable-chosen {
  visibility: hidden;
}

.row-item {
  display: flex;
  flex-direction: row;

  padding-left: 5px;
  padding-right: 5px;
  justify-content: space-between;
  align-items: center;

  position: relative;

  border-right: 3px solid var(--mm-grey);
}

.row-item:last-of-type {
  border: none;
}

.priority-rows {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  overflow: visible;
}

.sorting-rows {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0px;
  overflow: visible;
}

.rows {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: v-bind(rowsMaxHeight);

  align-items: center;

  gap: 8px;
  padding-top: 4px;
  padding-bottom: 8px;

  overflow: auto;
  scrollbar-width: none;
}

.icon-add-round {
  width: 40px;
  height: 40px;
  cursor: pointer;
}

.dropdown {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  border: none;
  outline: none;
  cursor: pointer;
  font-size: 14px;
  padding-right: 5px;
  background-color: white;
}

.click-item {
  cursor: pointer;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
}

.drag-item {
  cursor: grab;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.drag-item:active {
  cursor: grabbing;
}

.click-drag {
  width: 16px;
  height: 56px;
  position: absolute;
  left: 0;
}

.icon-close-round {
  width: 20px;
  height: 20px;
  cursor: pointer;
}

.sorting-order-container {
  width: 100%;
  max-height: 200px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-top: 10px;
  gap: 0px;
}

.sorting-order-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  height: auto;
  width: 100%;
  cursor: grab;
  padding: 4px;
}

.sorting-index-drag {
  min-width: 40px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: left;
}

.sorting-text {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 5px;
  margin-right: 5px;
  padding-left: 5px;
  padding-right: 5px;
}

.sorting-click-drag {
  width: 16px;
  height: 30px;
}

.hidden-icon {
  visibility: hidden;
}
</style>
