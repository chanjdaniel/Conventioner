<script setup lang="ts">
/**
 * "Assignment history" on the Assignments page: the market's History narrowed to the Assignment kind
 * of change (T224), so the two never disagree. The same entries in the same words, vendors who open,
 * "Before and after" and the same paging, in a dialog whose body is the one scroller.
 *
 * The list is read each time the dialog opens, so a placement made a moment ago on the page is in it
 * with no reload. Read-only: a close control, Escape and the backdrop, and nothing to confirm.
 */
import { computed } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import MarketHistory from '@/components/MarketHistory.vue';
import type { Market } from '@/assets/types/datatypes';
import { intakeModeOf } from '@/utils/marketGuide';

const props = defineProps<{ open: boolean; market: Market }>();
const emit = defineEmits<{ close: [] }>();

/** The market's own table's labels by row id, for a change to a row of it. */
const rowLabels = computed(() =>
  Object.fromEntries((props.market.permissionTable ?? []).map((row) => [row.id, row.label])),
);
const assignment = computed(() => ({
  days: (props.market.setupObject?.marketDates ?? []).map((day) => day.date),
}));
</script>

<template>
  <AppDialog
    :open="open"
    title="Assignment history"
    testid="assignment-history-dialog"
    size="wide"
    scroll="body"
    @close="emit('close')"
  >
    <MarketHistory
      v-if="open"
      :market-id="market.id"
      box="parent"
      :assignment="assignment"
      :row-labels="rowLabels"
      :path="intakeModeOf(market)"
      :questions="market.rejectionQuestions ?? []"
      :fields="market.applicationForm?.fields ?? []"
    />
  </AppDialog>
</template>
