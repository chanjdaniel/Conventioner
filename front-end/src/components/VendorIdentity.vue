<script setup lang="ts">
/**
 * A vendor, named: their name, with their address beneath it.
 *
 * Name primary, email secondary, and never name instead of email - two vendors can share a name,
 * while the address is unique, is what check-in matches on, and is what ties a vendor back to
 * their application.
 *
 * A vendor with no stored name renders as a single line holding their address, which is exactly
 * what every one of these surfaces showed before names existed. That is deliberate: this ships
 * without making any existing market look worse, and nobody is labelled "Unnamed vendor".
 */
import { computed } from 'vue';
import { vendorHeadline, vendorName, type VendorNames } from '@/utils/vendorIdentity';

const props = defineProps<{
  email: string | null | undefined;
  names: VendorNames;
}>();

const headline = computed(() => vendorHeadline(props.email, props.names));
const named = computed(() => vendorName(props.email, props.names) !== '');
</script>

<template>
  <span class="vendor-identity" data-testid="vendor-identity">
    <span class="vendor-identity-name" data-testid="vendor-identity-name">{{ headline }}</span>
    <span v-if="named" class="vendor-identity-email" data-testid="vendor-identity-email">
      {{ email }}
    </span>
  </span>
</template>

<style scoped>
.vendor-identity {
  display: inline-flex;
  flex-direction: column;
  min-width: 0;
}

.vendor-identity-name {
  overflow-wrap: anywhere;
}

.vendor-identity-email {
  font-size: 0.8em;
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}
</style>
