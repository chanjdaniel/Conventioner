<script setup lang="ts">
/**
 * Adding a vendor who never applied (E36/F03/S01): a walk-in, or a late arrangement.
 *
 * A name and an address, and the market records an application saying who added it and when. They
 * are then seated by hand on the Result page, like anyone; the run never places them.
 */
import { ref, watch } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import { api, getApiErrorMessage } from '@/utils/api';

const props = defineProps<{ open: boolean; marketId: string }>();
const emit = defineEmits<{ close: []; added: [email: string] }>();

const name = ref('');
const email = ref('');
const error = ref('');
const busy = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = '';
    email.value = '';
    error.value = '';
  },
);

async function add(): Promise<void> {
  if (busy.value || !name.value.trim() || !email.value.trim()) return;
  busy.value = true;
  error.value = '';
  try {
    const response = await api.post<{ application: { applicantEmail: string } }>(
      `/markets/${encodeURIComponent(props.marketId)}/vendors`,
      { name: name.value, email: email.value },
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
    :confirm-disabled="busy || !name.trim() || !email.trim()"
    :error="error"
    @close="emit('close')"
    @submit="add"
  >
    <p class="add-vendor-note">
      For someone who never applied. They are added as approved, and you seat them on the Result
      page.
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
</style>
