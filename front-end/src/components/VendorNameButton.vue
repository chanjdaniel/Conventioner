<script setup lang="ts">
/**
 * A vendor's name that opens their drawer (E35/F01/S02): on a seat of the Result page and on a row
 * at the door. It reads as the name it is, underlined when pointed at, and does nothing else - the
 * seat's change and the door's check-in stay controls of their own beside it.
 */
import { computed } from 'vue';
import VendorIdentity from '@/components/VendorIdentity.vue';
import { vendorHeadline, type VendorNames } from '@/utils/vendorIdentity';

const props = defineProps<{
  email: string;
  names: VendorNames;
  testid: string;
}>();

const emit = defineEmits<{ open: [] }>();

const label = computed(() => `${vendorHeadline(props.email, props.names)}: their details`);
</script>

<template>
  <button
    type="button"
    class="vendor-name-button"
    :aria-label="label"
    :data-testid="testid"
    @click="emit('open')"
  >
    <VendorIdentity :email="email" :names="names" />
  </button>
</template>

<style scoped>
.vendor-name-button {
  display: inline-flex;
  min-width: 0;
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

.vendor-name-button:hover :deep(.vendor-identity-name) {
  text-decoration: underline;
}

.vendor-name-button:focus-visible {
  outline: 2px solid var(--mm-black);
  outline-offset: 2px;
}
</style>
