<script setup lang="ts">
/**
 * Handing a market on (T283): its Owner picks someone who has access, found by typing part of
 * their address, reads what the other person gains and what they keep, and confirms.
 *
 * Destructive, since the Owner cannot take it back themselves: once it lands, only the new Owner can
 * hand it back. The choices are everyone with access but the Owner, the person looking, each with
 * the role that counts beside the address; the words saying what changes show once a choice is
 * made, and the button waits for one. Nothing closes the dialog while the request is in flight, so
 * its refusal is read here, under the choice it refused. A choice the people no longer offer, as
 * when a re-read finds the person gone, is let go, so the field never shows someone it would not
 * hand on to; a choice the person makes is told (`choose`), so the refusal of the last one goes.
 */
import { computed, ref, watch } from 'vue';
import type { PersonWithAccess } from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import EmailAddress from '@/components/EmailAddress.vue';
import SearchPicker from '@/components/SearchPicker.vue';
import { PEOPLE_CAP, findsPerson, isTheReader } from '@/utils/personChoice';
import { roleWords } from '@/utils/peopleWithAccess';

const props = defineProps<{
  open: boolean;
  marketName: string;
  /**
   * Everyone with access, as the market read serves them. The person looking is never offered: only
   * the Owner is let open this dialog, and the server refuses a hand-on to themselves.
   */
  people: PersonWithAccess[];
  /** The organization a role comes through, by name, as Users with access says it. */
  organizationName: string;
  busy?: boolean;
  error?: string;
}>();

const emit = defineEmits<{ close: []; confirm: [userId: string]; choose: [] }>();

const chosen = ref('');

const choices = computed(() => props.people.filter((person) => !isTheReader(person.email)));

const groups = computed(() => [
  {
    options: choices.value.map((person) => ({
      value: person.email,
      label: person.email,
      address: true,
      detail: roleWords(person, props.organizationName),
    })),
  },
]);

/** The person chosen, by their address, while they are still one of the choices. */
const newOwner = computed(() => choices.value.find((person) => person.email === chosen.value));

watch(newOwner, (person) => {
  if (!person && chosen.value) chosen.value = '';
});

watch(
  () => props.open,
  (opened) => {
    if (opened) chosen.value = '';
  },
  { immediate: true },
);
</script>

<template>
  <AppDialog
    :open="open"
    :title="`Hand ${marketName} on`"
    testid="hand-on-market"
    destructive
    confirm-label="Hand on"
    :confirm-disabled="!newOwner || busy"
    :close-disabled="busy"
    :error="error"
    @close="emit('close')"
    @submit="newOwner && emit('confirm', newOwner.userId)"
  >
    <SearchPicker
      v-model="chosen"
      class="hand-on-picker"
      :groups="groups"
      :finds="findsPerson"
      :cap="PEOPLE_CAP"
      :disabled="busy"
      label="New owner"
      placeholder="Type an address…"
      testid="hand-on-market-picker"
      @update:model-value="emit('choose')"
    />
    <p v-if="newOwner" class="hand-on-text" data-testid="hand-on-market-consequence">
      <EmailAddress :words="newOwner.email" /> becomes its Owner: only they can delete it, give and
      take Admin roles and change who may do what. You stay on it as an Admin, and cannot take it
      back yourself.
    </p>
  </AppDialog>
</template>

<style scoped>
.hand-on-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

/* The picker's label reads as the dialog's text does, as far above its field. */
.hand-on-picker :deep(.field-label) {
  margin-bottom: var(--space-2);
  font-size: var(--text-sm);
  color: var(--mm-black);
}
</style>
