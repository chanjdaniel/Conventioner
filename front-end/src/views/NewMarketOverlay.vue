<script setup lang="ts">
import ElementOrgSelect from '@/components/elements/ElementOrgSelect.vue';
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { type Market, MarketRole } from '@/assets/types/datatypes.ts';
import axios from 'axios';
import { api } from '@/utils/api';

defineProps<{
  newOpen: boolean;
}>();

const router = useRouter();
const marketName = ref('');
const selectedOrgId = ref('');
const errorMessage = ref('');

watch(selectedOrgId, () => {
  errorMessage.value = '';
});

const handleSubmit = async () => {
  errorMessage.value = '';

  if (!selectedOrgId.value) {
    errorMessage.value = 'Organization is required';
    return;
  }

  if (!marketName.value.trim()) {
    errorMessage.value = 'Market name is required';
    return;
  }

  try {
    const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
    const newMarket: Omit<Market, 'id'> & { id?: string } = {
      name: marketName.value,
      creationDate: new Date().toISOString(),
      isDraft: true,
      organizationId: selectedOrgId.value,
      roles: {
        [userEmail]: MarketRole.Owner,
      },
      setupObject: null,
      modificationList: [],
      assignmentObject: {
        vendorAssignments: [],
        assignmentDate: '',
        totalVendorsAssigned: 0,
        totalTablesAssigned: 0,
        assignmentStatistics: null,
      },
    };

    const createResponse = await api.post('/markets', newMarket);
    const marketId = createResponse.data.market_id;

    const marketWithId: Market = { ...newMarket, id: marketId };
    localStorage.removeItem('market');
    localStorage.setItem('market', JSON.stringify(marketWithId));

    router.push('/market-setup');
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 400 &&
      error.response?.data?.error
    ) {
      const errorText = error.response.data.error.toLowerCase();
      if (errorText.includes('already exists') || errorText.includes('market already')) {
        errorMessage.value = 'A market with this name already exists';
      } else {
        errorMessage.value = error.response.data.error;
      }
    } else {
      errorMessage.value = 'An error occurred. Please try again.';
    }
  }
};
</script>

<template>
  <div class="container" :style="{ visibility: newOpen ? 'visible' : 'hidden' }">
    <div
      class="background"
      @click="$emit('newClose')"
      :style="{ opacity: newOpen ? '100%' : '0%' }"
      data-testid="new-market-overlay-background"
    ></div>
    <div v-if="newOpen" class="window">
      <h2>Create new market</h2>
      <div class="org-select-container">
        <label class="org-select-label">Organization</label>
        <ElementOrgSelect v-model="selectedOrgId" />
      </div>
      <div class="input-wrapper">
        <div style="width: 100%; height: 30px; display: grid; grid-template-columns: 1fr 3fr 1fr">
          <div></div>
          <div class="text-input-container">
            <input
              type="text"
              v-model="marketName"
              @keydown.enter="handleSubmit"
              @input="errorMessage = ''"
              style="all: unset; font-size: 14px; width: 100%; text-align: center"
              placeholder="Market name"
              data-testid="new-market-name-input"
            />
          </div>
          <div style="padding-left: 10px">
            <button
              @click="handleSubmit"
              :disabled="!selectedOrgId"
              style="all: unset; height: 100%; width: 100%; cursor: pointer"
              :style="{
                opacity: selectedOrgId ? '75%' : '30%',
                cursor: selectedOrgId ? 'pointer' : 'not-allowed',
              }"
              data-testid="new-market-submit-button"
            >
              Submit
            </button>
          </div>
        </div>
        <p v-show="errorMessage" class="error-message">{{ errorMessage }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
h3 {
  display: inline;
}

.container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
}

.background {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0%;
  transition:
    opacity 0.15s ease-in-out,
    visibility 0.15s ease-in-out;
  z-index: 0;
}

.window {
  position: relative;
  width: 25%;
  min-height: 140px;
  padding: 25px;
  gap: 10px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: white;
  border-radius: 8px;
  z-index: 1;
}

.org-select-container {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.org-select-label {
  font-size: 12px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.input-wrapper {
  width: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.text-input-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: row;
  box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
  border-radius: 8px;
}

.error-message {
  position: absolute;
  top: 35px;
  left: 50%;
  transform: translateX(-50%);
  color: #d32f2f;
  font-size: 13px;
  text-align: center;
  white-space: nowrap;
  pointer-events: none;
}
</style>
