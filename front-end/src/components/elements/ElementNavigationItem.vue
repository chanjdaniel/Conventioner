<script setup lang="ts">
import { inject } from 'vue';
import { RouterLink, useRouter } from 'vue-router';

const props = defineProps<{
  to: string;
}>();

</script>

<template>
  <RouterLink :to="to">
    <div class="item">
      <slot name="icon"></slot>
      <slot></slot>
    </div>
  </RouterLink>
</template>

<style scoped>
.item {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 0px;

  width: 100%;
  height: 36px;

  border-bottom: 1.75px solid #2723237c;
  border-top-left-radius: 10px;
  border-top-right-radius: 10px;
  transition: background-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
}

.item:hover {
  background-color: var(--hover-grey);
  box-shadow: 0px -1.5px 5px 1.5px var(--hover-grey);
}

h3 {
  font-size: 1.2rem;
  font-weight: 500;
  margin-bottom: 0.4rem;
}
</style>