<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { type Organization } from '@/assets/types/datatypes';
import { getApiErrorMessage } from '@/utils/api';
import { fetchOrganizations } from '@/utils/organizations';

const props = defineProps<{ id?: string }>();
const model = defineModel<string>({ required: true });

const organizations = ref<Organization[]>([]);
const loading = ref(true);
const errorMessage = ref('');

/**
 * With exactly one organization, say which it is rather than ask a question with one answer
 * (E20/F01/S01).
 *
 * A select offering a single option is a control that looks like a decision and is not one, and it
 * still has to be operated before the dialog will submit. The organization is named instead, and
 * chosen below, so an organizer with one organization types a name and presses Enter.
 */
const onlyOrganization = computed(() =>
  organizations.value.length === 1 ? organizations.value[0] : null,
);

watch(onlyOrganization, (only) => {
  if (only) model.value = only.id;
});

async function loadOrganizations() {
  loading.value = true;
  errorMessage.value = '';
  try {
    organizations.value = await fetchOrganizations();
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to load organizations');
    organizations.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadOrganizations();
});
</script>

<template>
  <div class="org-select-wrapper">
    <p v-if="onlyOrganization" class="org-select-only" data-testid="org-select-only">
      {{ onlyOrganization.name }}
    </p>
    <select
      v-else
      :id="props.id"
      v-model="model"
      class="field field--select"
      :disabled="loading || organizations.length === 0"
      data-testid="org-select-dropdown"
    >
      <option value="" disabled>Select organization</option>
      <option v-for="org in organizations" :key="org.id" :value="org.id">
        {{ org.name }}
      </option>
    </select>
    <p v-if="loading" class="org-select-hint">Loading organizations...</p>
    <p v-else-if="errorMessage" class="org-select-error">{{ errorMessage }}</p>
    <p
      v-else-if="organizations.length === 0"
      class="org-select-hint"
      data-testid="org-select-empty-hint"
    >
      No organizations available.
      <RouterLink to="/organizations" class="org-select-link" data-testid="org-select-create-link"
        >Create an organization</RouterLink
      >
    </p>
  </div>
</template>

<style scoped>
.org-select-wrapper {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

/* Named, not offered. Reads as a value the dialog already knows, which is what it is. */
.org-select-only {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.org-select-hint {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  margin: 0;
}

.org-select-error {
  font-size: var(--text-xs);
  color: var(--mm-red);
  margin: 0;
}

.org-select-link {
  color: var(--mm-black);
  text-decoration: underline;
  font-weight: 600;
  white-space: nowrap;
}
</style>
