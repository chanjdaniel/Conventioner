<script setup lang="ts">
/**
 * Creating a market: a name and an organization, and nothing else (E20/F01/S01).
 *
 * It stays a modal and stays minimal. `draft` is a full-width ordered page where everything else
 * about a market is decided in sequence, so this dialog's whole job is to give the market an
 * identity and hand off - create lands the organizer at the top of that page.
 *
 * A modal rather than a first section of that page because a market must not exist until the
 * organizer commits to one: creating in place would leave an empty draft behind every abandoned
 * attempt.
 *
 * This is the exemplar for `AppDialog`, and it had all three of the defects the shell exists to
 * stop: the name field rendered as bare text (`all: unset` on the input, and a container declaring
 * a radius with no border and no background under a comment saying "a field is a border" that was
 * never written), Enter did nothing on the first screen of the product, and the error was placed at
 * `top: 35px; left: 50%` - a coordinate measured against one arrangement of the dialog.
 */
import ElementOrgSelect from '@/components/elements/ElementOrgSelect.vue';
import { marketPath } from '@/utils/market';
import AppDialog from '@/components/AppDialog.vue';
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { type Market, MarketRole } from '@/assets/types/datatypes.ts';
import axios from 'axios';
import { api } from '@/utils/api';

const props = defineProps<{
  newOpen: boolean;
}>();

const emit = defineEmits<{
  newClose: [];
}>();

const router = useRouter();
const marketName = ref('');
const selectedOrgId = ref('');
const errorMessage = ref('');
const creating = ref(false);

watch(selectedOrgId, () => {
  errorMessage.value = '';
});

/**
 * Enter is inert while this is true, because the confirm button is `type="submit"` and disabled -
 * no key handler is involved. The same guard the button wears is the one Enter meets.
 */
const cannotCreate = computed(
  () => creating.value || !selectedOrgId.value || !marketName.value.trim(),
);

const handleSubmit = async () => {
  if (cannotCreate.value) return;
  errorMessage.value = '';
  creating.value = true;

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

    router.push(marketPath(marketId));
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 400 &&
      error.response?.data?.error
    ) {
      // The server's own words. This used to rewrite anything mentioning "market already" into "A
      // market with this name already exists" - which is false for the refusal that matters most:
      // "Cafe Market" beside "Café Market" is a different name on the SAME public address, and the
      // server says exactly that (E21/F03/S03).
      errorMessage.value = error.response.data.error;
    } else {
      errorMessage.value = 'An error occurred. Please try again.';
    }
  } finally {
    creating.value = false;
  }
};
</script>

<template>
  <AppDialog
    :open="props.newOpen"
    title="Create new market"
    testid="new-market"
    confirm-label="Create market"
    :confirm-disabled="cannotCreate"
    @close="emit('newClose')"
    @submit="handleSubmit"
  >
    <div class="dialog-field">
      <label class="field-label" for="new-market-org">Organization</label>
      <ElementOrgSelect id="new-market-org" v-model="selectedOrgId" />
    </div>

    <div class="dialog-field">
      <label class="field-label" for="new-market-name">Market name</label>
      <!-- `.field` owns height, padding, radius, type and focus. Nothing here resets it. -->
      <input
        id="new-market-name"
        v-model="marketName"
        type="text"
        class="field"
        placeholder="Winter Market 2026"
        data-testid="new-market-name-input"
        @input="errorMessage = ''"
      />
      <!--
        In flow, beneath the control it is about. Every error this dialog can raise is about the
        name: submission is gated on an organization being picked, so "organization is required"
        is unreachable, and what is left is the server refusing the name.
      -->
      <p v-if="errorMessage" class="error-message" data-testid="new-market-error">
        {{ errorMessage }}
      </p>
    </div>
  </AppDialog>
</template>

<style scoped>
.dialog-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.error-message {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}
</style>
