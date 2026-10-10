<script setup lang="ts">
import { toRef, computed, watch } from 'vue';
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
const props = defineProps<{
  setupObject: SetupObject;
  formFields?: FormField[];
  /**
   * The rules as they were run, with nothing offering to change them (E22/F02/S02): once the
   * market can no longer run its assignment, a changed rule would change nothing. Mirrors the plan
   * write's refusal; the server is the rule.
   */
  readonly?: boolean;
}>();
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

const targetDefault = 'Select a question';
const optionDefault = 'Add an answer';

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

const dragOptions = computed(() => ({
  group: 'rows',
  disabled: props.readonly,
  ghostClass: 'sortable-chosen',
  chosenClass: 'sortable-ghost',
  dragClass: 'sortable-ghost',
  handle: '.rule-handle',
  forceFallback: false,
  fallbackOnBody: false,
}));
</script>

<template>
  <!-- The rules table (E28/F03/S01): a ranked list of rules, each a question and its answers in
       order, drawn from the product's field, button and drag-handle primitives. -->
  <div class="priority">
    <div class="column-titles row-container">
      <h3>Priority</h3>
      <h3>Question</h3>
      <h3>Answers, best first</h3>
      <h3 aria-hidden="true"></h3>
    </div>
    <div class="rows">
      <p
        v-if="readonly && priorityObjects.length === 0"
        class="empty-hint"
        data-testid="priority-none-set"
      >
        No priority rules were set for this assignment.
      </p>
      <p v-else-if="!readonly && fieldTargets.length === 0" class="empty-hint">
        Priority rules order vendors by an answer on your application form. Add a question with a
        fixed set of answers, such as a dropdown or a multi-select, and it will appear here. You can
        always order by when the application arrived.
      </p>
      <draggable class="priority-rows" v-model="priorityObjects" item-key="id" v-bind="dragOptions">
        <template #item="{ element, index: parentIndex }">
          <div class="priority-row row-container" :key="element.id" data-testid="priority-rule-row">
            <div class="cell cell--rank">
              <span v-if="!readonly" class="drag-handle rule-handle" aria-hidden="true"
                ><IconClickDrag class="drag-handle__icon"
              /></span>
              <span class="rank">{{ parentIndex + 1 }}</span>
            </div>
            <div class="cell">
              <select
                class="field field--select"
                :aria-label="`Rule ${parentIndex + 1}: what it orders by`"
                data-testid="priority-target-select"
                :disabled="readonly"
                v-model="priorityObjects[parentIndex].target"
                @change="handleTargetChange(parentIndex)"
              >
                <option disabled :value="null">{{ targetDefault }}</option>
                <optgroup v-if="fieldTargets.length" label="Your questions">
                  <option v-for="field in fieldTargets" :key="field.key" :value="field.key">
                    {{ field.label }}
                  </option>
                </optgroup>
                <optgroup label="About the application">
                  <option v-for="field in builtInTargets" :key="field.key" :value="field.key">
                    {{ field.label }}
                  </option>
                </optgroup>
              </select>
            </div>
            <div class="cell cell--answers">
              <select
                v-if="isMagnitude(priorityObjects[parentIndex])"
                class="field field--select"
                :aria-label="`Rule ${parentIndex + 1}: which end comes first`"
                data-testid="priority-direction-select"
                :disabled="readonly"
                v-model="priorityObjects[parentIndex].direction"
              >
                <option :value="PriorityDirection.Ascending">
                  {{ fieldFor(priorityObjects[parentIndex].target)?.ascendingLabel }}
                </option>
                <option :value="PriorityDirection.Descending">
                  {{ fieldFor(priorityObjects[parentIndex].target)?.descendingLabel }}
                </option>
              </select>
              <template v-else-if="isArranged(priorityObjects[parentIndex])">
                <draggable
                  v-if="priorityObjects[parentIndex].ordering.length"
                  tag="ol"
                  class="answers"
                  v-model="priorityObjects[parentIndex].ordering"
                  item-key="element"
                  handle=".answer-handle"
                  :group="`sorting-${parentIndex}`"
                  :disabled="readonly"
                  ghostClass="sortable-chosen"
                  chosenClass="sorting-ghost"
                  dragClass="sorting-ghost"
                >
                  <template #item="{ element: answer, index: childIndex }">
                    <li class="answer" data-testid="priority-ordering-row">
                      <span v-if="!readonly" class="drag-handle answer-handle" aria-hidden="true"
                        ><IconClickDrag class="drag-handle__icon"
                      /></span>
                      <span class="answer-rank">{{ childIndex + 1 }}</span>
                      <span class="answer-text">{{ answer }}</span>
                      <button
                        v-if="!readonly"
                        type="button"
                        class="remove-button remove-button--answer"
                        :aria-label="`Remove ${answer} from rule ${parentIndex + 1}`"
                        data-testid="priority-ordering-remove"
                        @click="removeOrderingItem(parentIndex, childIndex)"
                      >
                        <IconCloseRound />
                      </button>
                    </li>
                  </template>
                </draggable>
                <select
                  v-if="!readonly && unplacedOptions(priorityObjects[parentIndex]).length"
                  class="field field--select"
                  :aria-label="`Rule ${parentIndex + 1}: add an answer`"
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
                <p
                  class="ordering-hint"
                  v-if="!readonly && priorityObjects[parentIndex].ordering.length === 0"
                >
                  Add the answers to &ldquo;{{
                    labelFor(priorityObjects[parentIndex].target)
                  }}&rdquo; in the order you want them placed. Anything you leave out sorts last, or
                  where you put &ldquo;{{ ALL_OTHERS }}&rdquo;.
                </p>
              </template>
            </div>
            <div class="cell cell--remove">
              <button
                v-if="!readonly"
                type="button"
                class="remove-button"
                :aria-label="`Remove rule ${parentIndex + 1}`"
                data-testid="priority-rule-remove"
                @click="removePriorityRow(parentIndex)"
              >
                <IconCloseRound />
              </button>
            </div>
          </div>
        </template>
      </draggable>
      <button
        v-if="!readonly"
        type="button"
        class="add-row"
        data-testid="priority-add-rule"
        @click="addPriorityRow"
      >
        <IconAddRound class="add-row__icon" />
        Add a rule
      </button>
    </div>
  </div>
</template>

<style scoped>
.priority {
  /* Four columns, one per control in a rule row: rank, question, its answers in order, remove.
     The question and the answers hold sentences and take the width; the rank and the remove need
     only their own content. Headings and rows share the one template, so each heading stands over
     its column. */
  --priority-columns: 4rem minmax(0, 1fr) minmax(0, 1fr) 3rem;
  --priority-cell: var(--space-3);
  display: flex;
  flex-direction: column;
  width: 100%;
}

.column-titles {
  display: grid;
  grid-template-columns: var(--priority-columns);
}

/* Left-aligned over the content beneath, by the same inset a cell has. The shared container
   centres a row's text, which centred each heading in its column. */
.column-titles h3 {
  margin: 0;
  padding: 0 var(--priority-cell);
  text-align: left;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
}

.priority-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.priority-row {
  display: grid;
  grid-template-columns: var(--priority-columns);
  text-align: left;
}

/* A cell's content starts at its top: a rule with five answers leaves its question and its remove
   control beside the first, not floating in the middle of the row. */
.cell {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--priority-cell);
  border-right: 1px solid var(--mm-border);
}

.cell:last-child {
  border-right: none;
}

/* The rank and the remove control are each one control tall, level with the question beside them. */
.cell--rank,
.cell--remove {
  flex-direction: row;
  align-items: flex-start;
}

.cell--remove {
  justify-content: center;
  /* The column is the remove control's width; a full cell inset squeezed the 36px button to 24. */
  padding-inline: var(--space-1);
}

.rank {
  display: inline-flex;
  align-items: center;
  height: 36px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
  font-variant-numeric: tabular-nums;
}

.rule-handle,
.answer-handle {
  align-self: stretch;
  max-height: 36px;
}

.answers {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Handle, rank, answer, remove: a left edge, so the ranks and the removes form columns whatever
   each answer's length. */
.answer {
  display: grid;
  grid-template-columns: var(--space-6) 1.5rem minmax(0, 1fr) var(--space-6);
  align-items: center;
  min-height: 32px;
  border-radius: var(--radius-control);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.answer:hover {
  background: var(--mm-beige);
}

.answer-rank {
  color: var(--mm-text-muted);
  font-variant-numeric: tabular-nums;
}

.answer-text {
  overflow-wrap: anywhere;
}

.ordering-hint,
.empty-hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.add-row {
  align-self: flex-start;
}

/* Buttons, not icons with a click handler: a keyboard could not remove a rule or an answer, and
   nothing named either (bug 44, found again on the E26 re-walk). */
.remove-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: var(--radius-control);
  background: none;
  color: var(--mm-black);
  cursor: pointer;
}

.remove-button svg {
  width: 20px;
  height: 20px;
}

/* An answer's remove is quieter than the rule's: taking one answer out is not taking the rule. */
.remove-button--answer {
  width: var(--space-6);
  height: var(--space-6);
  color: var(--mm-text-muted);
}

.remove-button--answer svg {
  width: 14px;
  height: 14px;
}

.remove-button:hover {
  color: var(--mm-black);
  background: var(--mm-beige);
}

.remove-button:focus-visible {
  outline: 2px solid var(--mm-black);
  outline-offset: 2px;
}

.sortable-ghost {
  opacity: 0.7;
}

.sorting-ghost {
  opacity: 0.8;
}

.sortable-chosen {
  visibility: hidden;
}
</style>
