<script setup lang="ts">
import { inject } from 'vue';
import { useRouter } from 'vue-router';

const setUser = inject<(user: unknown) => void>('setUser', () => {});
const hostname = import.meta.env.VITE_FLASK_HOST;
const router = useRouter();

const logout = async () => {
  try {
    await fetch(`${hostname}/logout`, {
      method: 'POST',
      credentials: 'include',
    });

    localStorage.clear();
    setUser(null);
    router.push('/login');
  } catch (error) {
    console.error('Logout failed:', error);

    localStorage.clear();
    setUser(null);
    router.push('/login');
  }
};
</script>

<template>
  <!-- A real <button>. This was a clickable <div> with tabIndex -1, so a keyboard user could not
       sign out from the drawer at all, and its label was an <h3> sitting in the heading outline. -->
  <button type="button" class="signout-button" @click="logout" data-testid="nav-sign-out-button">
    <div class="item">
      <slot name="icon"></slot>
      <slot></slot>
    </div>
  </button>
</template>

<style scoped>
.signout-button {
  border: none;
  background-color: transparent;
  cursor: pointer;
  width: 100%;
  padding: 0;
  text-align: left;
  font: inherit;
  color: inherit;
}

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
  transition:
    background-color 0.15s ease-in-out,
    box-shadow 0.15s ease-in-out;
}

.item:hover {
  background-color: var(--hover-grey);
  box-shadow: 0px -1.5px 5px 1.5px var(--hover-grey);
}

.signout-button :deep(.signout-label) {
  font-size: 1.2rem;
  font-weight: 400;
  margin-bottom: 0.4rem;
}
</style>
