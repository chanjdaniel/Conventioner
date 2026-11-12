<script setup lang="ts">
/**
 * A table type, added or edited (T257): its name, its width and its depth, typed in centimetres
 * unless another unit is chosen. Each field says beneath it what it is refused for, and a refusal
 * of the write as a whole (`error`) stands over the actions; the dialog holds still while the
 * write is out (`busy`).
 */
import { computed, ref, watch } from 'vue';
import type { TableTypeObject } from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import { lengthMm, type LengthUnit } from './calibration';
import { SIDE_UNITS, sideIn, typeOf, typedTypeErrors, type TypedType } from './layoutTypes';

const props = defineProps<{
  open: boolean;
  /** The type edited; null to add one. */
  type: TableTypeObject | null;
  /** The market's other types, whose names a type may not share. */
  others: readonly TableTypeObject[];
  busy?: boolean;
  error?: string;
}>();

const emit = defineEmits<{ close: []; submit: [type: TableTypeObject] }>();

const typed = ref<TypedType>({ name: '', width: '', depth: '', unit: 'cm' });
/** Whether a submit was tried, after which each field says what it lacks. */
const tried = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    tried.value = false;
    const type = props.type;
    typed.value = type
      ? {
          name: type.name,
          width: sideIn(type.widthMm, 'cm'),
          depth: sideIn(type.depthMm, 'cm'),
          unit: 'cm',
        }
      : { name: '', width: '', depth: '', unit: 'cm' };
  },
  { immediate: true },
);

/** A change of unit carries the sides typed into it, so 183 cm reads 1.83 m. */
function changeUnit(unit: LengthUnit) {
  const was = typed.value;
  const carried = (value: string) => {
    const mm = lengthMm(value, was.unit);
    return mm === null ? value : sideIn(mm, unit);
  };
  typed.value = { ...was, width: carried(was.width), depth: carried(was.depth), unit };
}

const errors = computed(() => typedTypeErrors(typed.value, props.others));
const shown = computed(() => (tried.value ? errors.value : {}));

function submit() {
  tried.value = true;
  if (props.busy || Object.keys(errors.value).length) return;
  emit('submit', typeOf(typed.value, props.type?.id ?? crypto.randomUUID()));
}
</script>

<template>
  <AppDialog
    :open="open"
    :title="type ? `Edit ${type.name}` : 'Add a table type'"
    testid="layout-type"
    :confirm-label="busy ? 'Saving…' : type ? 'Save type' : 'Add type'"
    :confirm-disabled="busy"
    :close-disabled="busy"
    :error="error"
    anchored
    @close="emit('close')"
    @submit="submit"
  >
    <div class="type-fields">
      <label class="type-field">
        <span class="field-label">Name</span>
        <input
          v-model="typed.name"
          class="field"
          type="text"
          autocomplete="off"
          maxlength="100"
          :disabled="busy"
          :aria-invalid="!!shown.name"
          :aria-describedby="shown.name ? 'layout-type-name-error' : undefined"
          data-testid="layout-type-name"
        />
        <span
          v-if="shown.name"
          id="layout-type-name-error"
          class="type-error"
          data-testid="layout-type-name-error"
          >{{ shown.name }}</span
        >
      </label>
      <div class="type-sides">
        <label class="type-field">
          <span class="field-label">Width</span>
          <input
            v-model="typed.width"
            class="field"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            :disabled="busy"
            :aria-invalid="!!shown.width"
            :aria-describedby="shown.width ? 'layout-type-width-error' : undefined"
            data-testid="layout-type-width"
          />
        </label>
        <label class="type-field">
          <span class="field-label">Depth</span>
          <input
            v-model="typed.depth"
            class="field"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            :disabled="busy"
            :aria-invalid="!!shown.depth"
            :aria-describedby="shown.depth ? 'layout-type-depth-error' : undefined"
            data-testid="layout-type-depth"
          />
        </label>
        <label class="type-field">
          <span class="field-label">Unit</span>
          <select
            :value="typed.unit"
            class="field field--select"
            :disabled="busy"
            data-testid="layout-type-unit"
            @change="changeUnit(($event.target as HTMLSelectElement).value as LengthUnit)"
          >
            <option v-for="one in SIDE_UNITS" :key="one.unit" :value="one.unit">
              {{ one.label }}
            </option>
          </select>
        </label>
      </div>
      <span
        v-if="shown.width"
        id="layout-type-width-error"
        class="type-error"
        data-testid="layout-type-width-error"
        >{{ shown.width }}</span
      >
      <span
        v-if="shown.depth"
        id="layout-type-depth-error"
        class="type-error"
        data-testid="layout-type-depth-error"
        >{{ shown.depth }}</span
      >
    </div>
  </AppDialog>
</template>

<style scoped>
.type-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.type-field {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* Width, depth and the unit they are typed in, on one line. */
.type-sides {
  display: grid;
  grid-template-columns: 1fr 1fr 5.5rem;
  gap: var(--space-3);
}

.type-error {
  margin-top: calc(-1 * var(--space-3));
  font-size: var(--text-xs);
  color: var(--mm-red);
}

.type-field .type-error {
  margin-top: var(--space-1);
}
</style>
