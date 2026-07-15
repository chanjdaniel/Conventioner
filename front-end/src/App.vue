<script setup lang="ts">
import axios from 'axios'
import { RouterView } from 'vue-router'
import ElementBanner from './components/elements/ElementBanner.vue'
import ElementNavigation from './components/elements/ElementNavigation.vue'

import { onMounted, ref, provide, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { routerSettled } from '@/utils/routerReady'

const hostname = import.meta.env.VITE_FLASK_HOST

const navOpen = ref(false)
const route = useRoute()
const router = useRouter()
const isLogin = computed(() => route.path === '/login')
const isPublicPage = computed(() => route.matched.some((r) => r.meta.public === true))

const user = ref<string | null>(null)
const setUser = (user_data: string | null) => {
  user.value = user_data
}

provide('user', user)
provide('setUser', setUser)

onMounted(async () => {
  // Wait for the first navigation to settle before probing the session.
  // Without this, the session check runs before the router knows which page
  // it is on, so every page reads as an authenticated one and the login
  // redirect never fires.
  await routerSettled(router)

  // Public pages do not require an organizer session.
  if (isPublicPage.value) return

  try {
    const response = await axios.get(`${hostname}/check-session`, {
      withCredentials: true,
    })

    if (response.status === 200) {
      const user_email = response.data.email
      localStorage.setItem('user', JSON.stringify(user_email))
      setUser(user_email)
    } else {
      localStorage.clear()
      router.push('/login')
    }
  } catch {
    localStorage.clear()
    router.push('/login')
  }
})

watch(isLogin, (newValue) => {
  if (newValue) {
    navOpen.value = false
  }
})
</script>

<template>
  <div class="app-container" :class="{ 'app-public': isPublicPage }">
    <header>
      <ElementBanner @menuOpen="navOpen = true" :isLogin="isLogin" />
    </header>

    <RouterView class="router-view" :class="{ 'router-view-public': isPublicPage }" />

    <div
      v-if="!isPublicPage"
      class="nav-background"
      :style="{
        opacity: navOpen ? '100%' : '0%',
        visibility: navOpen ? 'visible' : 'hidden',
      }"
      @click="navOpen = false"
    ></div>

    <ElementNavigation
      v-if="!isPublicPage"
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
  width: 100vw;
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
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.5);
  opacity: 100%;
  transition:
    opacity 0.3s ease-in-out,
    visibility 0.3s ease-in-out;
}

.banner {
  width: 100vw;
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
