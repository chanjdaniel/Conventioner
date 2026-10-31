<script setup lang="ts">
/**
 * "Give roles" confirmed (E46/F01/S04): the market's role, by its name, to the vendors holding a
 * seat, which the server gives to each one it finds in the connected server. A run only gives, so
 * the confirmation says so: nobody loses a role by it.
 */
import { computed, ref, watch } from 'vue';

import AppDialog from '@/components/AppDialog.vue';
import { getApiErrorMessage } from '@/utils/api';
import { giveRoles, giveRolesQuestion } from '@/utils/discordRoles';

const props = defineProps<{
  open: boolean;
  marketId: string;
  roleName: string;
  serverName: string;
  /** How many vendors hold a seat on any date, or null when where they sit could not be read. */
  assigned: number | null;
}>();

const emit = defineEmits<{ close: []; given: []; refused: [] }>();

const busy = ref(false);
const error = ref('');
watch(
  () => props.open,
  (open) => {
    if (open) error.value = '';
  },
);

const question = computed(() => giveRolesQuestion(props.roleName, props.assigned));

async function give(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await giveRoles(props.marketId);
    emit('given');
  } catch (err) {
    error.value = getApiErrorMessage(err, 'The roles could not be given. Try again.');
    emit('refused');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog
    :open="open"
    title="Give roles"
    testid="give-roles"
    :confirm-label="busy ? 'Giving roles…' : 'Give roles'"
    :confirm-disabled="busy"
    :error="error"
    @close="emit('close')"
    @submit="give"
  >
    <div class="give-roles-body">
      <p class="give-roles-question">{{ question }}</p>
      <p class="give-roles-note">
        Conventioner gives it to each assigned vendor whose Discord username it finds in
        {{ serverName || 'the server' }}. It never takes a role away, so a vendor who has lost their
        seat keeps the role they have.
      </p>
    </div>
  </AppDialog>
</template>

<style scoped>
.give-roles-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.give-roles-question {
  margin: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.give-roles-note {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}
</style>
