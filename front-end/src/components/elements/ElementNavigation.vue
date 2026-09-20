<script setup lang="ts">
import { ref } from 'vue';

/**
 * The drawer's own element, named for the app shell.
 *
 * While the drawer is open the rest of the page is inert, and the walk that marks it has to be
 * able to tell the drawer apart from everything it marks. Exposed rather than read off `$el`,
 * which Vue types as `any`: the cast checked nothing, and a root that ever became a fragment
 * would hand back a comment node, putting the drawer itself among the marked (E14/F02/S04).
 */
const root = ref<HTMLElement | null>(null);
defineExpose({ root });

import { inject } from 'vue';
import ElementNavigationItem from './ElementNavigationItem.vue';
import IconOrganizations from '../icons/IconOrganizations.vue';
import IconVendors from '../icons/IconVendors.vue';
import IconMarkets from '../icons/IconMarkets.vue';
import IconCloseRound from '../icons/IconCloseRound.vue';
import IconSignOutSquare from '../icons/IconSignOutSquare.vue';
import ElementSignoutButton from './ElementSignoutButton.vue';

const user = inject<string | null>('user');
</script>

<template>
  <div class="nav-bar" ref="root" data-testid="app-nav">
    <button class="close-button" @click="$emit('menuClose')">
      <IconCloseRound class="close-icon" />
    </button>

    <h2 class="user-email">{{ user }}</h2>

    <div class="nav">
      <!-- Every item here goes where it says it goes.
           Four of six used to point at /vendors - "View Tables", "Discord Tools" and "View Change
           Log" all landed on the vendors page, and "Manage Tables" opened /init, which is the
           new-or-existing market chooser. Discord tools and a change log do not exist as pages at
           all, so those two are simply gone - inventing a destination is how they got here.
           Organizations is not a replacement for them: it is a real page that was reachable only
           from the dashboard. -->
      <ElementNavigationItem to="/markets" @menuClose="$emit('menuClose')">
        <template #icon>
          <IconMarkets class="nav-icon" />
        </template>
        <h3>Markets</h3>
      </ElementNavigationItem>

      <ElementNavigationItem to="/organizations" @menuClose="$emit('menuClose')">
        <template #icon>
          <IconOrganizations class="nav-icon" />
        </template>
        <h3>Organizations</h3>
      </ElementNavigationItem>

      <ElementNavigationItem to="/vendors" @menuClose="$emit('menuClose')">
        <template #icon>
          <IconVendors class="nav-icon" />
        </template>
        <!-- Scoped, and says so: this is the vendors of the market that is open, not a directory. -->
        <h3>Market vendors</h3>
      </ElementNavigationItem>

      <ElementSignoutButton>
        <template #icon>
          <IconSignOutSquare class="nav-icon" />
        </template>
        <span class="signout-label">Sign out</span>
      </ElementSignoutButton>
    </div>
  </div>
</template>

<style scoped>
.user-email {
  margin-top: 20px;
  font-size: var(--text-lg);
}

h3 {
  font-family: 'Merge One';
  font-style: normal;
  font-size: var(--text-lg);

  /* color: white; */
  color: var(--mm-black);
}

.nav-bar {
  /* Auto layout */
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px;

  width: 10vw;
  height: 100vh;

  min-width: 250px;
  max-width: 300px;

  background: white;
  border-radius: 0 var(--radius-card) var(--radius-card) 0;
}

.close-button {
  position: absolute;
  top: 0;
  right: 0;
  margin: 5px;
  padding: 0;

  height: 30px;
  aspect-ratio: 1;

  display: flex;
  align-items: center;
  justify-content: center;

  cursor: pointer;
  background-color: transparent;
  border: none;
}

.close-icon {
  aspect-ratio: 1;
  background-color: none;
}

.nav {
  display: flex;
  flex-direction: column;
  position: relative;
  top: 30px;
  align-self: stretch;
  gap: 10px;
}

.nav-icon {
  height: 24px;
  aspect-ratio: 1;
  margin: 6px;
  color: var(--mm-black);
}
</style>
