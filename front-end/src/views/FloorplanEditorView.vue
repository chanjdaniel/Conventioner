<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import FloorplanWorkflow from '@/components/floorplan/FloorplanWorkflow.vue'

const router = useRouter()
const route = useRoute()

const marketId = computed(() => route.query.marketId as string | undefined)

function handleSaved(_payload: { market_id: string }) {
  router.push('/market-setup')
}
</script>

<template>
  <div class="floorplan-editor-view">
    <div class="editor-wrapper">
      <FloorplanWorkflow
        v-if="marketId"
        :marketId="marketId"
        @saved="handleSaved"
      />
      <div v-else class="no-market-message">
        <p>No market selected. Please start from the Market Setup page.</p>
        <button class="return-button" @click="router.push('/market-setup')">
          Go to Market Setup
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.floorplan-editor-view {
  width: 100%;
  min-width: 1000px;
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--mm-beige);
}

.editor-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.no-market-message {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 40px;
}

.no-market-message p {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 16px;
  color: var(--mm-black);
  text-align: center;
  margin: 0;
}

.return-button {
  height: 36px;
  padding: 0 20px;
  background: var(--mm-green);
  border: none;
  border-radius: 5px;
  font-family: 'Merge One', sans-serif;
  font-size: 16px;
  color: #ffffff;
  cursor: pointer;
  transition: opacity 0.15s ease-in-out, background-color 0.15s ease-in-out;
}

.return-button:hover {
  opacity: 0.9;
  background: color-mix(in srgb, var(--mm-green) 85%, black);
}
</style>
