<script setup lang="ts">
/** One phase pill: the phase's name in the phase's colour, wherever a phase is shown. */
import { computed } from 'vue';
import { MarketPhase } from '@/assets/types/datatypes';
import { phaseLabel } from '@/utils/phase';

const props = defineProps<{ phase?: string | null }>();

const current = computed(() => String(props.phase ?? MarketPhase.Draft));
const label = computed(() => phaseLabel(current.value));
</script>

<template>
  <span class="phase-badge" :class="`phase-${current}`" data-testid="phase-badge">
    {{ label }}
  </span>
</template>

<style scoped>
.phase-badge {
  display: inline-block;
  padding: 4px 14px;
  border-radius: 20px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: white;
  white-space: nowrap;
}

.phase-draft {
  background: #6b7280;
}
.phase-applications_open {
  background: #3472d8;
}
.phase-applications_closed {
  background: #a46a07;
}
.phase-review {
  background: #8558ec;
}
.phase-assignment {
  background: #048197;
}
.phase-offers {
  background: #cd3f85;
}
.phase-market_days {
  background: #0c875e;
}
.phase-archived {
  background: #374151;
}
</style>
