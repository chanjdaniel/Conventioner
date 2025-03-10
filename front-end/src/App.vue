<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
// @ts-ignore
import ElementBanner from './components/elements/ElementBanner.vue'
import ElementNavigation from './components/elements/ElementNavigation.vue';

import { onMounted, ref, provide, computed, watch } from 'vue';
import { useRoute, useRouter } from "vue-router";

const hostname = import.meta.env.VITE_FLASK_HOST;

const navOpen = ref(false);
const route = useRoute();
const router = useRouter();
const isLogin = computed(() => route.path === "/login");

const user: any = ref(null);
const setUser = (user_data: any) => {
  user.value = user_data;
};

provide("user", user);
provide("setUser", setUser);

onMounted(async () => {
  try {
    const response = await fetch(`${hostname}/check-session`, {
      method: "GET",
      credentials: "include",
    });

    if (response.ok) {
      const userJSON = localStorage.getItem("user");
      user.value = userJSON ? JSON.parse(userJSON) : null;

    } else {
      localStorage.clear();
      router.push("/login");
    }

  } catch (error) {
    localStorage.clear();
    router.push("/login");
  }
});

watch(isLogin, (newValue) => {
  if (newValue) {
    navOpen.value = false;
  }
});

</script>

<template>
  <div class="app-container">
    <header>
      <ElementBanner @menuOpen="navOpen = true" :isLogin="isLogin"/>
    </header>

    <RouterView class="router-view"/>

    <div
      class="nav-background"
      :style="{
        opacity: navOpen ? '100%' : '0%', 
        visibility: navOpen ? 'visible' : 'hidden'
      }"
      @click="navOpen = false">
    </div>
    
    <ElementNavigation
      class="nav-bar"
      :style="{ left: navOpen ? '0px' : '-300px' }"
      @menuClose="navOpen = false"
      />
  </div>
</template>

<style scoped>

.app-container {
  width: 100vw;
  height: 100vh;
  background-color: white;
  padding: 0px;
  margin: 0px;
  position: absolute;
  left: 0;
  top: 0;

  display: flex;
  flex-direction: column;
}

header {
  /* position: fixed;
  top: 0;
  left: 0; */
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
  transition: left 0.3s ease-in-out;
}

.nav-bar.nav-open {
  left: 0;
}

.nav-background {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  opacity: 100%;
  transition: opacity 0.3s ease-in-out, visibility 0.3s ease-in-out;
}

.banner {

  width: 100vw;
  height: 5vh;
}

.router-view {
  width: 100vw;
  height: 95vh;

  min-width: 1000px;
  min-height: 1000px;
}
</style>
