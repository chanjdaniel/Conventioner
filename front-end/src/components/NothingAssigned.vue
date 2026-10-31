<script setup lang="ts">
/**
 * What Assignments, Vendors and Payments say before an assignment is stored (E31/F03/S05).
 *
 * They drew the solver's unstored preview as if it were the result, then the plan's empty tables
 * as if an assignment had come out empty. Nothing is assigned until a run is stored, so each page
 * says that once, in the same words, and points at Assignment - or, where the phase refuses a run,
 * say why, in the words `assign_phase_refusal` uses on the server.
 */
import { computed } from 'vue';
import type { Market } from '@/assets/types/datatypes';
import { marketPath } from '@/utils/market';
import { assignRefusal } from '@/utils/assignPhase';

const props = defineProps<{ market: Market; testid: string }>();

const refusal = computed(() => assignRefusal(props.market.phase));
</script>

<template>
  <p class="note" :data-testid="testid">
    Nothing assigned yet.
    <!-- The space is spoken for: a template's trailing whitespace is condensed away, which ran
         "phase." into "Set the rules" (E30/F01/S01). -->
    <template v-if="refusal">{{ `${refusal} ` }}</template>
    <RouterLink :to="marketPath(market.id, 'settings')">
      {{ refusal ? 'Set the rules' : 'Set the rules and allocate tables' }}</RouterLink
    >.
    <slot />
  </p>
</template>
