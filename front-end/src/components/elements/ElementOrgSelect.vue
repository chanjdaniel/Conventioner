<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { type Organization } from '@/assets/types/datatypes';
import { getApiErrorMessage } from '@/utils/api';
import { fetchOrganizations } from '@/utils/organizations';

const model = defineModel<string>({ required: true });

const organizations = ref<Organization[]>([]);
const loading = ref(true);
const errorMessage = ref('');

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
    <select
      v-model="model"
      class="org-select"
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
  align-items: center;
  gap: 6px;
}

.org-select {
  width: 100%;
  padding: 8px 12px;
  border: 1.5px solid var(--mm-grey);
  border-radius: 6px;
  font-size: 14px;
  font-family: 'Outfit Regular', sans-serif;
  background: white;
  text-align: center;
}

.org-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.org-select-hint {
  font-size: 12px;
  color: #666;
  margin: 0;
  text-align: center;
}

.org-select-error {
  font-size: 12px;
  color: #d32f2f;
  margin: 0;
  text-align: center;
}

.org-select-link {
  color: var(--mm-black);
  text-decoration: underline;
  font-weight: 600;
  white-space: nowrap;
}
</style>
