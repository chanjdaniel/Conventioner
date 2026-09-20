<script setup lang="ts">
import axios from 'axios';
import { RouterView } from 'vue-router';
import ElementBanner from './components/elements/ElementBanner.vue';
import ElementNavigation from './components/elements/ElementNavigation.vue';
import { useInertBehind } from '@/utils/useInertBehind';

import { onMounted, ref, provide, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { routerSettled } from '@/utils/routerReady';

const hostname = import.meta.env.VITE_FLASK_HOST;

const navOpen = ref(false);

/**
 * Modal to the keyboard as well as to the mouse: the scrim stops clicks, and this takes the rest of
 * the page out of the tab order (E14/F02/S04).
 *
 * Both parts are named because they are siblings here rather than one wrapping the other: naming
 * only the scrim would mark the drawer itself, which is the thing that has to stay reachable.
 */
const navScrim = ref<HTMLElement | null>(null);
const navDrawer = ref<InstanceType<typeof ElementNavigation> | null>(null);
useInertBehind(navOpen, () => [navScrim.value, navDrawer.value?.root ?? null]);
const route = useRoute();
const router = useRouter();
const isLogin = computed(() => route.path === '/login');
const isPublicPage = computed(() => route.matched.some((r) => r.meta.public === true));

const user = ref<string | null>(null);
const setUser = (user_data: string | null) => {
  user.value = user_data;
};

provide('user', user);
provide('setUser', setUser);

onMounted(async () => {
  // Wait for the first navigation to settle before probing the session.
  // Without this, the session check runs before the router knows which page
  // it is on, so every page reads as an authenticated one and the login
  // redirect never fires.
  await routerSettled(router);

  // Public pages do not require an organizer session.
  if (isPublicPage.value) return;

  try {
    const response = await axios.get(`${hostname}/check-session`, {
      withCredentials: true,
    });

    if (response.status === 200) {
      const user_email = response.data.email;
      localStorage.setItem('user', JSON.stringify(user_email));
      setUser(user_email);
    } else {
      localStorage.clear();
      router.push('/login');
    }
  } catch {
    localStorage.clear();
    router.push('/login');
  }
});

watch(isLogin, (newValue) => {
  if (newValue) {
    navOpen.value = false;
  }
});
</script>

<template>
  <div class="app-container" :class="{ 'app-public': isPublicPage }">
    <header>
      <ElementBanner @menuOpen="navOpen = true" :isLogin="isLogin" :hasMenu="!isPublicPage" />
    </header>

    <RouterView class="router-view" :class="{ 'router-view-public': isPublicPage }" />

    <div
      v-if="!isPublicPage"
      ref="navScrim"
      class="nav-background"
      :style="{
        opacity: navOpen ? '100%' : '0%',
        visibility: navOpen ? 'visible' : 'hidden',
      }"
      @click="navOpen = false"
    ></div>

    <!-- `visibility` as well as `left`: slid off-screen is not the same as gone, and a drawer that
         is only off-screen keeps every one of its links in the tab order on every authenticated
         page. That is the defect `E14/F02/S04` removes from behind a modal, standing the other way
         round - a keyboard user tabbing into a menu nobody can see. -->
    <ElementNavigation
      v-if="!isPublicPage"
      ref="navDrawer"
      class="nav-bar"
      :style="{
        left: navOpen ? '0px' : '-300px',
        visibility: navOpen ? 'visible' : 'hidden',
      }"
      @menuClose="navOpen = false"
    />
  </div>
</template>

<style scoped>
/* `100vw` includes the vertical scrollbar, so any page tall enough to scroll gained a horizontal
   scrollbar it did not need (E08/F01/S02). `left/right: 0` fills the containing block exactly,
   scrollbar or not. */
.app-container {
  right: 0;
  height: 100vh;
  min-width: 1000px;
  background-color: white;
  padding: 0px;
  margin: 0px;
  position: absolute;
  left: 0;
  top: 0;

  display: flex;
  flex-direction: column;
}

.app-container.app-public {
  min-width: 0;
}

header {
  width: 100%;
  line-height: 1.5;
  max-height: 100vh;
}

.logo {
  display: block;
  margin: 0 auto 2rem;
}

.nav-bar {
  position: fixed;
  top: 0;
  left: -300px;
  /* `visibility` rides the same duration so it flips only once the drawer has finished sliding out,
     rather than blinking away at the start of the transition. */
  transition:
    left 0.3s ease-in-out,
    visibility 0.3s ease-in-out;
}

.nav-bar.nav-open {
  left: 0;
}

.nav-background {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  opacity: 100%;
  transition:
    opacity 0.3s ease-in-out,
    visibility 0.3s ease-in-out;
}

.banner {
  width: 100%;
  height: 5vh;
}

.router-view {
  flex: 1;
  min-height: 0;
  min-width: 1000px;
}

.router-view-public {
  min-width: 0;
}
</style>
