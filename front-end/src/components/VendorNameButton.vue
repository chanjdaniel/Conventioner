<script setup lang="ts">
/**
 * A vendor's name that opens their drawer (E35/F01/S02): on a seat of the Result page and on a row
 * at the door. It does nothing else - the seat's change and the door's check-in stay controls of
 * their own beside it.
 *
 * It reads as a link at rest, in the design language's link ink and underlined, as an answer's
 * link is (E38/F09/S01). Underlined only when pointed at, it read as plain text, and on a phone at
 * the door nothing is pointed at: the organizer looking for a vendor's details did not see the
 * name was the way in. Only the name line: the address beneath it stays a quiet second line.
 */
import VendorIdentity from '@/components/VendorIdentity.vue';
import type { VendorNames } from '@/utils/vendorIdentity';

defineProps<{
  email: string;
  names: VendorNames;
  testid: string;
}>();

const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <!-- Named by what it shows, then what it does: a voice user says the name they see, so the
       accessible name starts with it rather than replacing it (WCAG 2.5.3). -->
  <button type="button" class="vendor-name-button" :data-testid="testid" @click="emit('open')">
    <VendorIdentity :email="email" :names="names" />
    <span class="visually-hidden">: their details</span>
  </button>
</template>

<style scoped>
.vendor-name-button {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  min-height: var(--target-min);
  max-width: 100%;
  padding: 0;
  border: none;
  border-radius: var(--radius-control);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.vendor-name-button :deep(.vendor-identity-name) {
  color: var(--mm-text-link);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
