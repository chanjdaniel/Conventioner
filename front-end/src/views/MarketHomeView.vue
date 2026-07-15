<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const marketSlug = computed(() => String(route.params.marketSlug ?? ''));
</script>

<template>
  <div class="market-home-stub">
    <h1>Market home</h1>
    <p class="slug-hint">{{ marketSlug }}</p>
  </div>
</template>

<style scoped>
.market-home-stub {
  padding: 32px 40px;
  font-family: 'Outfit Regular', sans-serif;
}
h1 {
  margin: 0 0 12px;
  font-size: 28px;
  font-weight: 600;
  color: var(--mm-black);
}
.slug-hint {
  margin: 0;
  color: #666;
  font-size: 14px;
}
</style>
