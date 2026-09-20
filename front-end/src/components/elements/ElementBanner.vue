<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import IconMenu from '../icons/IconMenu.vue';

const props = defineProps({
  isLogin: Boolean,
  /**
   * Whether a navigation drawer exists to open. `App.vue` renders the drawer only for the
   * organizer app, but this button drew itself on every page that was not the sign-in screen -
   * so on the public check-in page a signed-out vendor got a hamburger that opened nothing,
   * with no nav element in the DOM at all.
   */
  hasMenu: { type: Boolean, default: true },
});

const router = useRouter();

/** The logo goes to the dashboard, which is an organizer route; off the organizer app it is a mark. */
const logoIsLink = computed(() => props.hasMenu && !props.isLogin);

function goToDashboard() {
  if (!logoIsLink.value) return;
  router.push({ name: 'dashboard' });
}
</script>

<template>
  <div class="banner">
    <button
      v-if="hasMenu"
      class="menu-button"
      data-testid="app-menu-button"
      @click="$emit('menuOpen')"
      aria-label="Open navigation"
      :style="{ visibility: isLogin ? 'hidden' : 'visible' }"
      :aria-hidden="isLogin"
      :tabindex="isLogin ? -1 : 0"
    >
      <IconMenu class="menu-icon" />
    </button>
    <!-- Keeps the logo's left offset when there is no menu button beside it. -->
    <span v-else class="menu-spacer" aria-hidden="true"></span>
    <component
      :is="logoIsLink ? 'button' : 'div'"
      class="logo-button"
      :class="{ 'logo-button--static': !logoIsLink }"
      v-bind="logoIsLink ? { type: 'button' } : {}"
      @click="goToDashboard"
    >
      <img
        alt="Conventioner logo"
        class="conventioner-logo"
        src="@/assets/icons/conventioner-logo.svg"
      />
    </component>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  position: relative;

  /* width: 100vw;
    height: 5vh; */

  min-height: 30px;
  max-height: 100px;

  /* MMWhite */
  background: #ffffff;
  box-shadow: 0px 4px 4px rgba(0, 0, 0, 0.25);

  /* Inside auto layout */
  flex: none;
  order: 0;
  align-self: stretch;
  flex-grow: 0;
}

.menu-button {
  /* MenuFrame */

  height: 100%;
  aspect-ratio: 1;

  /* Inside auto layout */
  flex: none;
  order: 0;
  flex-grow: 0;
  align-items: center;
  justify-content: center;

  background-color: white;
  cursor: pointer;
  transition: background-color 0.15s ease-in-out;
  border: none;
}

.menu-button:hover {
  background-color: #ececec;
  /* color: white; */
}

.menu-icon {
  aspect-ratio: 1;
}

.logo-button {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0;
  margin-left: 8px;
  background: none;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s ease-in-out;
}

.logo-button:hover {
  opacity: 0.8;
}

.logo-button--static {
  cursor: default;
}

.logo-button--static:hover {
  opacity: 1;
}

.menu-spacer {
  height: 100%;
  aspect-ratio: 1;
  flex: none;
}

.conventioner-logo {
  height: 65%;
}
</style>
