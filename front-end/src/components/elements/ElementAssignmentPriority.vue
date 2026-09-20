<script setup lang="ts">
import { onMounted, ref, toRef, computed, watch } from 'vue';
import draggable from 'vuedraggable';
import {
  ALL_OTHERS,
  BUILT_IN_PRIORITY_TARGETS,
  PriorityDirection,
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
const ARRANGED_FIELD_TYPES = ['select', 'multi_select'];
const MAGNITUDE_FIELD_TYPES = ['number', 'date', 'checkbox'];

/**
 * A target, whichever kind it is, reduced to what this screen needs to draw it.
 *
 * `arranged` means the answers are a fixed set and the organizer puts them in order.
 * `magnitude` means the answer has size, earliness or truth, and the organizer picks an end.
 * Which one applies follows from the target's own type; there is nothing to declare.
 */
type PriorityTarget = {
  key: string;
  label: string;
  kind: 'arranged' | 'magnitude';
  options: string[];
  ascendingLabel: string;
  descendingLabel: string;
  group: string;
};

const DIRECTION_LABELS: Record<string, { ascending: string; descending: string }> = {
  number: { ascending: 'Lowest first', descending: 'Highest first' },
  date: { ascending: 'Earliest first', descending: 'Latest first' },
  checkbox: { ascending: 'Ticked first', descending: 'Unticked first' },
};

const fieldTargets = computed<PriorityTarget[]>(() =>
  (props.formFields ?? [])
    .filter(
      (field) =>
        ARRANGED_FIELD_TYPES.includes(field.type) || MAGNITUDE_FIELD_TYPES.includes(field.type),
    )
    .map((field) => ({
      key: field.key,
      label: field.label,
      kind: ARRANGED_FIELD_TYPES.includes(field.type) ? 'arranged' : 'magnitude',
      options: field.options ?? [],
      ascendingLabel: DIRECTION_LABELS[field.type]?.ascending ?? 'Ascending',
      descendingLabel: DIRECTION_LABELS[field.type]?.descending ?? 'Descending',
      group: 'Your questions',
    })),
);

const builtInTargets = computed<PriorityTarget[]>(() =>
  BUILT_IN_PRIORITY_TARGETS.map((target) => ({
    key: target.key,
    label: target.label,
    kind: target.kind,
    options: 'options' in target ? (target.options ?? []) : [],
    ascendingLabel: 'ascendingLabel' in target ? (target.ascendingLabel ?? '') : 'Ascending',
    descendingLabel: 'descendingLabel' in target ? (target.descendingLabel ?? '') : 'Descending',
    group: 'About the application',
  })),
);

const targetableFields = computed<PriorityTarget[]>(() => [
  ...fieldTargets.value,
  ...builtInTargets.value,
]);

const fieldFor = (target: string | null): PriorityTarget | undefined =>
  targetableFields.value.find((field) => field.key === target);

const labelFor = (target: string | null): string => fieldFor(target)?.label ?? '';

const isArranged = (rule: PriorityObject): boolean => fieldFor(rule.target)?.kind === 'arranged';
const isMagnitude = (rule: PriorityObject): boolean => fieldFor(rule.target)?.kind === 'magnitude';

/** Answers this rule's target offers that the organizer has not placed yet. */
const unplacedOptions = (rule: PriorityObject): string[] => {
  const field = fieldFor(rule.target);
  if (!field) return [];
  const remaining = field.options.filter((option) => !rule.ordering.includes(option));
  if (!rule.ordering.includes(ALL_OTHERS)) remaining.push(ALL_OTHERS);
  return remaining;
};

const container = ref<HTMLElement | null>(null);
const rows = ref<HTMLElement | null>(null);
const columnTitles = ref<HTMLElement | null>(null);

const targetDefault = 'Select a question';
const optionDefault = 'Add an answer';

onMounted(() => {});

const nextRuleId = () =>
  priorityObjects.value.reduce((highest, rule) => Math.max(highest, rule.id), 0) + 1;

const addPriorityRow = () => {
  priorityObjects.value.push({ id: nextRuleId(), target: null, ordering: [], direction: null });
};

const removePriorityRow = (index: number) => {
  priorityObjects.value.splice(index, 1);
};

/**
 * Retargeting a rule discards an ordering that belonged to a different question's answers, and
 * seeds a sensible direction when the new target is ordered by magnitude instead.
 */
const handleTargetChange = (index: number) => {
  const rule = priorityObjects.value[index];
  rule.ordering = [];
  rule.direction = isMagnitude(rule) ? PriorityDirection.Ascending : null;
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
      <p v-if="fieldTargets.length === 0" class="empty-hint">
        Priority rules order vendors by an answer on your application form. Add a question with a
        fixed set of answers, such as a dropdown or a multi-select, and it will appear here. You can
        always order by when the application arrived.
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
                <optgroup v-if="fieldTargets.length" label="Your questions">
                  <option
                    class="display-list"
                    v-for="field in fieldTargets"
                    :key="field.key"
                    :value="field.key"
                  >
                    {{ field.label }}
                  </option>
                </optgroup>
                <optgroup label="About the application">
                  <option
                    class="display-list"
                    v-for="field in builtInTargets"
                    :key="field.key"
                    :value="field.key"
                  >
                    {{ field.label }}
                  </option>
                </optgroup>
              </select>
            </div>
            <div class="row-item">
              <div
                class="direction-container"
                v-if="isMagnitude(priorityObjects[parentIndex])"
                data-testid="priority-direction"
              >
                <select
                  class="dropdown"
                  data-testid="priority-direction-select"
                  v-model="priorityObjects[parentIndex].direction"
                >
                  <option :value="PriorityDirection.Ascending">
                    {{ fieldFor(priorityObjects[parentIndex].target)?.ascendingLabel }}
                  </option>
                  <option :value="PriorityDirection.Descending">
                    {{ fieldFor(priorityObjects[parentIndex].target)?.descendingLabel }}
                  </option>
                </select>
              </div>
              <div
                class="sorting-order-container"
                v-else-if="isArranged(priorityObjects[parentIndex])"
              >
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
  /* Four columns, one per control in a rule row: rank, question, how to order it, remove. It used
     to declare five, so the headings sat one column left of what they named. The question and the
     ordering hold sentences and take the width; the other two need only their own content. */
  --priority-columns: 3rem minmax(0, 1.4fr) minmax(0, 1.6fr) 2rem;
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
  /* Was 80%. A priority rule names a question and how to order it, and both are sentences - at
     80% the question select clipped to "When the application" and the direction to "Earliest",
     which is the half of each that carries no meaning. */
  width: 100%;
  height: 100%;
  box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
  border-radius: 8px;
}

/* One template, shared, so a heading always sits over the control it names. */
.column-titles {
  display: grid;
  grid-template-columns: var(--priority-columns);
}

.priority-row {
  display: grid;
  grid-template-columns: var(--priority-columns);
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

  border-right: 3px solid var(--mm-border);
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
  /* A label that still will not fit says so, rather than stopping mid-word. */
  text-overflow: ellipsis;
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
</style>
