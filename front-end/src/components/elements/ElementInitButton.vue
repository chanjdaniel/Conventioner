<script setup lang="ts"></script>

<template>
  <button class="button">
    <slot></slot>
    <slot name="icon"></slot>
  </button>
</template>

<style scoped>
.button {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 346px;
  height: 95px;

  gap: var(--space-2);

  /* MMBlack */
  background: var(--mm-black);
  box-shadow: var(--shadow-card);
  border-radius: var(--radius-card);
}
</style>
