<script setup lang="ts">
/** THROWAWAY prototype scaffolding. Hidden in production builds. */
import { computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const props = defineProps<{ variants: { key: string; name: string }[] }>();

const route = useRoute();
const router = useRouter();

const isProd = import.meta.env.PROD;

const currentIndex = computed(() => {
  const key = String(route.query.variant ?? props.variants[0].key).toUpperCase();
  const i = props.variants.findIndex((v) => v.key === key);
  return i === -1 ? 0 : i;
});

const current = computed(() => props.variants[currentIndex.value]);

function go(step: number) {
  const next = (currentIndex.value + step + props.variants.length) % props.variants.length;
  router.replace({ query: { ...route.query, variant: props.variants[next].key } });
}

function isTyping(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (isTyping(document.activeElement)) return;
  go(e.key === 'ArrowLeft' ? -1 : 1);
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="!isProd" class="proto-switcher">
    <button class="arrow" @click="go(-1)" aria-label="Previous variant">&#8592;</button>
    <span class="label">{{ current.key }} ({{ current.name }})</span>
    <button class="arrow" @click="go(1)" aria-label="Next variant">&#8594;</button>
  </div>
</template>

<style scoped>
.proto-switcher {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2000;

  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;

  padding: 6px 8px;
  border-radius: 999px;
  background: #111;
  border: 2px dashed var(--mm-yellow);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
}

.label {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  letter-spacing: 0.04em;
  color: #fff;
  padding: 0 10px;
  white-space: nowrap;
}

.arrow {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  background: var(--mm-yellow);
  color: #111;
  font-size: 14px;
  line-height: 1;
}

.arrow:hover {
  background: #fff;
}
</style>
