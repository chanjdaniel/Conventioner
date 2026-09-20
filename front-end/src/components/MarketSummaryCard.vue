<script setup lang="ts">
/**
 * What a market's row says, in one place, for the three lists that show one.
 *
 * Settled by wayfinding ticket 07. Against what it replaced:
 *
 * - **Dates, not Created.** An organizer identifies a market by when it *runs*. The creation date
 *   was the weakest thing on the row.
 * - **A phase badge.** Phase is the single source of truth for a market's state and the row
 *   omitted it, so a running market looked exactly like a draft.
 * - **No "Your role".** Permission detail on a navigation list, and `Manage` is already gated on it.
 * - **A missing organization says so** rather than dropping the line, which was half the reason
 *   the rows did not line up.
 *
 * Not progress counts: they are not in the list payload and would cost a query per row.
 */
import { computed } from 'vue';
import { type Market, MarketRole } from '@/assets/types/datatypes';
import type { SummaryFact } from '@/utils/summary';
import { getDateRange } from '@/utils/utils';
import SummaryCard from '@/components/SummaryCard.vue';
import PhaseBadge from '@/components/PhaseBadge.vue';

const props = defineProps<{
  market: Market;
  /** The row's own action, when the list has one beyond opening the market. */
  showManage?: boolean;
}>();

defineEmits<{ open: []; manage: [] }>();

const canManage = computed(
  () => props.market.userRole === MarketRole.Owner || props.market.userRole === MarketRole.Admin,
);

const facts = computed<SummaryFact[]>(() => [
  {
    label: 'Dates',
    value: getDateRange(props.market.setupObject?.marketDates?.map((d) => d.date)),
  },
  props.market.organizationName
    ? { label: 'Organization', value: props.market.organizationName }
    : { label: 'Organization', value: 'No longer available', missing: true },
]);
</script>

<template>
  <SummaryCard
    :facts="facts"
    selectable
    :selectLabel="`Open ${market.name}`"
    data-testid="market-card"
    @select="$emit('open')"
  >
    <template #name>
      <h3 data-testid="market-card-name">{{ market.name }}</h3>
    </template>
    <template #badge>
      <PhaseBadge :phase="market.phase" />
    </template>
    <template #actions>
      <!-- Manage stays a visible control rather than moving behind a `...`: it is where a market
           is renamed and deleted, and burying a destructive action one level down is what the
           rest of this epic is undoing. It is secondary to Open, which is the row itself. -->
      <button
        v-if="showManage && canManage"
        type="button"
        class="manage-button"
        data-testid="market-card-manage-button"
        @click="$emit('manage')"
      >
        Manage
      </button>
    </template>
  </SummaryCard>
</template>

<style scoped>
.manage-button {
  height: 34px;
  padding: 0 16px;
  border-radius: var(--radius-control);
  border: 1px solid var(--mm-border);
  background: white;
  color: var(--mm-black);
  font-size: var(--text-sm);
  cursor: pointer;
}

.manage-button:hover {
  border-color: var(--mm-black);
}
</style>
