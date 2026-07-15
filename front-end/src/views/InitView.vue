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
    <ElementInitButton @click="newOpen = true" data-testid="init-setup-new-market-button">
      <h3>
        <span>Set Up </span>
        <span class="text-new">New </span>
        <span>Market</span>
      </h3>
      <template #icon>
        <IconAddSquare class="nav-icon" />
      </template>
    </ElementInitButton>

    <ElementInitButton @click="loadOpen = true" data-testid="init-load-existing-market-button">
      <h3>
        <span>Load </span>
        <span class="text-existing">Existing </span>
        <span>Market</span>
      </h3>
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

  gap: 72px;
  height: 100%;
  width: 100%;
  margin: 0;
}

h3 {
  font-family: 'Merge One';
  font-style: normal;
  font-weight: 100;
  font-size: 20px;

  color: #ffffff;
}

.text-new {
  color: var(--mm-green);
}

.text-existing {
  color: var(--mm-yellow);
}

.nav-icon {
  color: white;
}
</style>
