<script setup lang="ts">
import type { PreconditionResult } from '@/assets/types/datatypes';

defineProps<{
  blockers: PreconditionResult[];
}>();
</script>

<template>
  <div v-if="blockers.length" class="blocker-panel">
    <p class="blocker-heading">Cannot proceed:</p>
    <ul class="blocker-list">
      <li v-for="blocker in blockers" :key="blocker.id" class="blocker-item">
        <span class="blocker-message">{{ blocker.message }}</span>
        <router-link
          v-if="blocker.resolutionLink"
          :to="blocker.resolutionLink"
          class="blocker-link"
        >
          Fix this &rarr;
        </router-link>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.blocker-panel {
  padding: 1rem;
  border-radius: 0.5rem;
  background: var(--p-red-50, #fef2f2);
  border: 1px solid var(--p-red-200, #fecaca);
}

.blocker-heading {
  margin: 0 0 0.5rem 0;
  font-weight: 600;
  color: var(--p-red-700, #b91c1c);
}

.blocker-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.blocker-item {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.25rem 0;
  color: var(--p-red-600, #dc2626);
}

.blocker-item + .blocker-item {
  border-top: 1px solid var(--p-red-200, #fecaca);
}

.blocker-message {
  flex: 1;
}

.blocker-link {
  flex-shrink: 0;
  font-weight: 500;
  color: var(--p-red-700, #b91c1c);
  text-decoration: underline;
}
</style>
