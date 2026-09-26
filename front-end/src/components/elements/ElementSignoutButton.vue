<script setup lang="ts">
import { inject } from 'vue';
import { useRouter } from 'vue-router';
import { useMarketStore } from '@/stores/market';

const setUser = inject<(user: unknown) => void>('setUser', () => {});
const hostname = import.meta.env.VITE_FLASK_HOST;
const router = useRouter();
// The market store outlives a route change, so signing out has to forget it: otherwise the next
// account to sign in on this browser is shown this one's market until its own arrives.
const marketStore = useMarketStore();

const logout = async () => {
  try {
    await fetch(`${hostname}/logout`, {
      method: 'POST',
      credentials: 'include',
    });

    localStorage.clear();
    marketStore.clear();
    setUser(null);
    router.push('/login');
  } catch (error) {
    console.error('Logout failed:', error);

    localStorage.clear();
    marketStore.clear();
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

.signout-button :deep(.signout-label) {
  font-size: var(--text-lg);
  font-weight: 400;
  margin-bottom: 0.4rem;
}
</style>
