<script setup lang="ts">
import { RouterLink } from 'vue-router';

defineProps<{
  to: string;
}>();
</script>

<template>
  <RouterLink :to="to" class="nav-link" @click="$emit('menuClose')">
    <div class="item">
      <slot name="icon"></slot>
      <slot></slot>
    </div>
  </RouterLink>
</template>

<style scoped>
/* Without the 3px every link is given (`main.css`), so a link row is exactly as wide, as tall and
   as inset as the Sign out button below it. With it, Sign out sat 3px off the rows above, 6px
   shorter, and with a wider divider (bug 43). */
.nav-link {
  display: block;
  padding: 0;
}

.item {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 0px;

  width: 100%;
  height: 36px;

  border-bottom: 1.75px solid rgba(39, 35, 35, 0.49);
  border-top-left-radius: 10px;
  border-top-right-radius: 10px;
  transition:
    background-color 0.15s ease-in-out,
    box-shadow 0.15s ease-in-out;
}

.item:hover {
  background-color: var(--hover-grey);
  box-shadow: var(--shadow-card);
}

h3 {
  font-size: var(--text-lg);
  font-weight: 400;
  margin-bottom: 0.4rem;
}
</style>
