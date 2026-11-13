<script setup lang="ts">
/**
 * When a list was last read, and Refresh: the review's lists (E38/F05/S03) and the door's roster
 * (T318) show it.
 *
 * Others change what a list shows while someone works from it, and the list on screen is what was
 * read, not what is: this says how old it is, ageing as it sits, and reads it again on request. The
 * view owns the read; this only shows it and asks for another. `testid` starts its test ids, so
 * each screen's are its own: `<testid>-updated`, `<testid>-refresh`, `<testid>-refresh-error`.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { updatedAgo } from '@/utils/updatedAgo';

const props = defineProps<{
  /** When the list was last read from the server, in milliseconds, or null before the first. */
  readAt: number | null;
  refreshing: boolean;
  /** Why the last refresh failed, in one line; empty when it did not. */
  failed: string;
  testid: string;
}>();
const emit = defineEmits<{ refresh: [] }>();

/** Often enough that a minute's turn shows within a few seconds of it. */
const AGEING_MS = 10_000;
const now = ref(Date.now());
let ageing: ReturnType<typeof setInterval> | null = null;
onMounted(() => (ageing = setInterval(() => (now.value = Date.now()), AGEING_MS)));
onUnmounted(() => {
  if (ageing) clearInterval(ageing);
});

// A read is now: it is said as just now at once, not at the next turn of the clock.
const words = computed(() =>
  props.readAt === null ? '' : updatedAgo(props.readAt, Math.max(now.value, props.readAt)),
);
</script>

<template>
  <div class="freshness">
    <span v-if="words" class="freshness-time" :data-testid="`${testid}-updated`">{{ words }}</span>
    <button
      type="button"
      class="btn btn--secondary btn--compact"
      :disabled="refreshing"
      :data-testid="`${testid}-refresh`"
      @click="emit('refresh')"
    >
      Refresh
    </button>
    <span
      v-if="failed"
      class="freshness-error"
      role="alert"
      :data-testid="`${testid}-refresh-error`"
    >
      {{ failed }}
    </span>
  </div>
</template>

<style scoped>
.freshness {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.freshness-time {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.freshness-error {
  font-size: var(--text-xs);
  color: var(--mm-red);
}
</style>
