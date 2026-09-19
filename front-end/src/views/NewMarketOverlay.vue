<script setup lang="ts">
import ElementOrgSelect from '@/components/elements/ElementOrgSelect.vue';
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { type Market, MarketRole } from '@/assets/types/datatypes.ts';
import axios from 'axios';
import { api } from '@/utils/api';
import { useEscapeToClose } from '@/utils/useEscapeToClose';

const props = defineProps<{
  newOpen: boolean;
}>();

const emit = defineEmits<{
  newClose: [];
}>();

useEscapeToClose(
  () => props.newOpen,
  () => emit('newClose'),
);

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
      <button
        type="button"
        class="dialog-close"
        aria-label="Close"
        @click="emit('newClose')"
        data-testid="new-market-close-button"
      >
        &times;
      </button>
      <h2>Create new market</h2>
      <div class="org-select-container">
        <label class="org-select-label">Organization</label>
        <ElementOrgSelect v-model="selectedOrgId" />
      </div>
      <div class="input-wrapper">
        <label class="field-label" for="new-market-name">Market name</label>
        <div class="text-input-container">
          <input
            id="new-market-name"
            type="text"
            v-model="marketName"
            @keydown.enter="handleSubmit"
            @input="errorMessage = ''"
            placeholder="Winter Market 2026"
            data-testid="new-market-name-input"
          />
        </div>
        <div class="dialog-actions">
          <button type="button" class="secondary-button" @click="emit('newClose')">Cancel</button>
          <button
            type="button"
            class="primary-button"
            @click="handleSubmit"
            :disabled="!selectedOrgId || !marketName.trim()"
            data-testid="new-market-submit-button"
          >
            Create market
          </button>
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
  align-items: stretch;
  gap: 6px;
}

.field-label {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--mm-text-muted);
}

.text-input-container input {
  all: unset;
  width: 100%;
  font-size: 14px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}

/* Was `all: unset` - no background, no border, no padding, and enabled/disabled differed only by
   opacity, so the dialog's primary action read as a word rather than a button. */
.primary-button {
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 9px 18px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  cursor: pointer;
}

.primary-button:disabled {
  background: var(--mm-border);
  color: var(--mm-black);
  cursor: not-allowed;
}

.secondary-button {
  background: none;
  color: var(--mm-black);
  border: 1px solid var(--mm-border);
  border-radius: 6px;
  padding: 9px 18px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  cursor: pointer;
}

/* Every overlay in the product ignored Escape and two had no visible way out at all. */
.dialog-close {
  position: absolute;
  top: 8px;
  right: 12px;
  background: none;
  border: none;
  font-size: 24px;
  line-height: 1;
  padding: 4px 8px;
  color: var(--mm-text-muted);
  cursor: pointer;
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
