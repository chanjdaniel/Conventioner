<script setup lang="ts">
import IconAddSquare from '@/components/icons/IconAddSquare.vue';
import IconUpload from '@/components/icons/IconUpload.vue';
import ElementInitButton from '@/components/elements/ElementInitButton.vue';
import NewMarketOverlay from './NewMarketOverlay.vue';
import LoadMarketOverlay from './LoadMarketOverlay.vue';
import { ref } from 'vue';

const loadOpen = ref(false);
const newOpen = ref(false);
</script>

<template>
  <div class="init-view">
    <!-- The page's title, for a screen reader to land on; its two buttons say the rest. -->
    <h1 class="visually-hidden">Set up or load a market</h1>
    <ElementInitButton @click="newOpen = true" data-testid="init-setup-new-market-button">
      <span class="init-label">
        <span>Set Up </span>
        <span>New </span>
        <span>Market</span>
      </span>
      <template #icon>
        <IconAddSquare class="nav-icon" />
      </template>
    </ElementInitButton>

    <ElementInitButton @click="loadOpen = true" data-testid="init-load-existing-market-button">
      <span class="init-label">
        <span>Load </span>
        <span>Existing </span>
        <span>Market</span>
      </span>
      <template #icon>
        <IconUpload class="nav-icon" />
      </template>
    </ElementInitButton>

    <NewMarketOverlay @newClose="newOpen = false" :newOpen="newOpen" />
    <LoadMarketOverlay @loadClose="loadOpen = false" :loadOpen="loadOpen" />
  </div>
</template>

<style scoped>
.init-view {
  flex-grow: 1;
  display: flex;
  flex-direction: row;

  justify-content: center;
  align-items: center;

  gap: var(--space-12);
  height: 100%;
  width: 100%;
  margin: 0;
}

/* A button is named by its words: a heading inside one put the buttons in the page's outline. */
.init-label {
  font-family: 'Merge One';
  font-style: normal;
  font-weight: 400;
  font-size: var(--text-lg);

  color: white;
}

.nav-icon {
  color: white;
}
</style>
