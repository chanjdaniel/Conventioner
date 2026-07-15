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

  gap: 10px;

  /* MMBlack */
  background: #272323;
  box-shadow: 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
  border-radius: 10px;
}
</style>
