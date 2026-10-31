<script setup lang="ts">
/**
 * Adding a vendor who never applied (E36/F03/S01): a walk-in, or a late arrangement.
 *
 * A name and an address, and the market records an application saying who added it and when. They
 * are then seated by hand on the Assignments page, like anyone; the run never places them.
 *
 * They are asked every question of the form's own that a price group reads, each required though the
 * form may leave it optional, so they are priced like any other (E43/F01/S03); a market whose card
 * has no group asks nothing more.
 */
import { computed, ref, watch } from 'vue';
import type { ApplicationForm, FormField } from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import ApplicationFormFields from '@/components/application/ApplicationFormFields.vue';
import { api, getApiErrorMessage } from '@/utils/api';
import { sortedFormFields } from '@/utils/applicationForm';

const props = defineProps<{
  open: boolean;
  marketId: string;
  form: ApplicationForm | null | undefined;
  /** The questions the price groups read (`priceReads` on the market). */
  priceReads: readonly string[];
}>();
const emit = defineEmits<{ close: []; added: [email: string] }>();

const name = ref('');
const email = ref('');
const answers = ref<Record<string, unknown>>({});
const error = ref('');
const busy = ref(false);

/** The form's own questions a price group reads, in the form's order; a checkbox left unticked
 *  is its "not ticked" answer, so only it is not required. */
const asked = computed<FormField[]>(() =>
  sortedFormFields(props.form?.fields ?? [])
    .filter((field) => props.priceReads.includes(field.key))
    .map((field) => ({ ...field, required: field.type !== 'checkbox' })),
);

function answered(field: FormField): boolean {
  const value = answers.value[field.key];
  if (!field.required) return true;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'string' ? value.trim() !== '' : value != null;
}

const ready = computed(
  () => !!name.value.trim() && !!email.value.trim() && asked.value.every(answered),
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = '';
    email.value = '';
    answers.value = {};
    error.value = '';
  },
);

async function add(): Promise<void> {
  if (busy.value || !ready.value) return;
  busy.value = true;
  error.value = '';
  try {
    const response = await api.post<{ application: { applicantEmail: string } }>(
      `/markets/${encodeURIComponent(props.marketId)}/vendors`,
      {
        name: name.value,
        email: email.value,
        answers: Object.fromEntries(
          asked.value.map((field) => [
            field.key,
            answers.value[field.key] ?? (field.type === 'checkbox' ? false : undefined),
          ]),
        ),
      },
    );
    emit('added', response.data.application.applicantEmail);
  } catch (err: unknown) {
    error.value = getApiErrorMessage(err, 'The vendor could not be added.');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog
    :open="open"
    title="Add a vendor"
    testid="add-vendor"
    :confirm-label="busy ? 'Adding…' : 'Add vendor'"
    :confirm-disabled="busy || !ready"
    :error="error"
    @close="emit('close')"
    @submit="add"
  >
    <p class="add-vendor-note">
      For someone who never applied. They are added as approved, and you assign them on the
      Assignments page.
    </p>
    <label class="field-label" for="add-vendor-name">Name</label>
    <input
      id="add-vendor-name"
      v-model="name"
      type="text"
      autocomplete="off"
      class="field"
      data-testid="add-vendor-name-input"
    />
    <label class="field-label" for="add-vendor-email">Email</label>
    <input
      id="add-vendor-email"
      v-model="email"
      type="email"
      autocomplete="off"
      class="field"
      data-testid="add-vendor-email-input"
    />
    <template v-if="asked.length">
      <p class="add-vendor-note" data-testid="add-vendor-price-note">
        Their price is set by these answers.
      </p>
      <div class="add-vendor-answers">
        <ApplicationFormFields v-model="answers" :fields="asked" prefix="add-vendor" />
      </div>
    </template>
  </AppDialog>
</template>

<style scoped>
.add-vendor-note {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.field-label + .field {
  margin-bottom: var(--space-3);
}

.add-vendor-answers {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>
