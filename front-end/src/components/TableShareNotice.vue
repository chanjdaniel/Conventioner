<script setup lang="ts">
/**
 * Says why a vendor's table-share request pairs nobody (E27/F01/S03).
 *
 * Without it, a request the product could not meet became an ordinary half-table request in
 * silence, and a vendor who asked to sit with a friend met a stranger on market day. It blocks
 * nothing: the organizer follows up outside the product. The reason is the server's
 * (`back-end/table_share.py`); only the wording is decided here.
 */
import { computed } from 'vue';
import type { TableShareNotice } from '@/assets/types/datatypes';

const props = defineProps<{ notice: TableShareNotice; testid: string }>();

const text = computed(() => {
  const address = props.notice.address ?? '';
  switch (props.notice.reason) {
    case 'no_address':
      return 'There is no email address in their answer, so they may share with a stranger.';
    case 'no_applicant':
      return `Nobody else in this market applied as ${address}.`;
    case 'partner_wants_full_table':
      return `${address} asked for a whole table, so the two will not share one.`;
    case 'partner_asked_for_someone_else':
      return `${address} asked to share with someone else, and their own request comes first.`;
    default:
      return 'This request to share a table cannot be met.';
  }
});
</script>

<template>
  <p class="note table-share-notice" role="note" :data-testid="testid">
    <strong>Table share:</strong> {{ text }}
  </p>
</template>

<style scoped>
.table-share-notice {
  border-left-color: var(--mm-yellow);
}

.table-share-notice strong {
  font-weight: 600;
}
</style>
