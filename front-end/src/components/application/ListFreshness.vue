<script setup lang="ts">
/**
 * When the review's list was last read, and Refresh (E38/F05/S03), as both views show it.
 *
 * Others decide and open cards while a reviewer works, and the list on screen is what was read,
 * not what is: this says how old it is, ageing as it sits, and reads it again on request. The view
 * owns the read; this only shows it and asks for another.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { updatedAgo } from '@/utils/updatedAgo';

const props = defineProps<{
  /** When the list was last read from the server, in milliseconds, or null before the first. */
  readAt: number | null;
  refreshing: boolean;
  /** Why the last refresh failed, in one line; empty when it did not. */
  failed: string;
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
    <span v-if="words" class="freshness-time" data-testid="applications-updated">{{ words }}</span>
    <button
      type="button"
      class="btn btn--secondary btn--compact"
      :disabled="refreshing"
      data-testid="applications-refresh"
      @click="emit('refresh')"
    >
      Refresh
    </button>
    <span
      v-if="failed"
      class="freshness-error"
      role="alert"
      data-testid="applications-refresh-error"
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
