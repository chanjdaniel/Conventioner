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

const props = defineProps<{
  notice: TableShareNotice;
  /** The applicant's own words, for the one reason that is about them. */
  words?: string;
  testid: string;
}>();

type Reason = TableShareNotice['reason'];

/** One sentence per reason, so a reason the server adds fails the type check, not the page. */
const WORDING: Record<Reason, (address: string, words: string) => string> = {
  no_address: (_, words) =>
    words
      ? `Their answer, "${words}", has no email address in it, so they may share with a stranger.`
      : 'Their answer has no email address in it, so they may share with a stranger.',
  no_applicant: (address) => `Nobody else in this market applied as ${address}.`,
  partner_wants_full_table: (address) =>
    `${address} asked for a full table, so the two will not share one.`,
  partner_not_accepted: (address) =>
    `${address} was not accepted for this market, so the two will not share a table.`,
  partner_asked_for_someone_else: (address) =>
    `${address} asked to share with someone else, and their own request comes first.`,
  another_named_not_used: (address) =>
    `Their answer also names ${address}, who applied too. Only the first applicant named is used.`,
};

const text = computed(() =>
  WORDING[props.notice.reason](props.notice.address ?? '', props.words ?? ''),
);
</script>

<template>
  <p class="note table-share-notice" role="note" aria-label="Table share" :data-testid="testid">
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
