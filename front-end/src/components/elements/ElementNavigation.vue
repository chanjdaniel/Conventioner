<script setup lang="ts">
import { inject } from 'vue';
import ElementNavigationItem from './ElementNavigationItem.vue';
import IconCommunity from '../icons/IconCommunity.vue';
import IconVendors from '../icons/IconVendors.vue';
import IconMarkets from '../icons/IconMarkets.vue';
import IconCloseRound from '../icons/IconCloseRound.vue';
import IconSignOutSquare from '../icons/IconSignOutSquare.vue';
import ElementSignoutButton from './ElementSignoutButton.vue';

const user = inject<string | null>('user');
</script>

<template>
  <div class="nav-bar" ref="nav-bar">
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
        <h3>Manage markets</h3>
      </ElementNavigationItem>

      <ElementNavigationItem to="/organizations" @menuClose="$emit('menuClose')">
        <template #icon>
          <IconCommunity class="nav-icon" />
        </template>
        <h3>Organizations</h3>
      </ElementNavigationItem>

      <ElementNavigationItem to="/vendors" @menuClose="$emit('menuClose')">
        <template #icon>
          <IconVendors class="nav-icon" />
        </template>
        <h3>
          <span>View </span>
          <span class="vendors-1">Vendors</span>
        </h3>
      </ElementNavigationItem>

      <ElementSignoutButton>
        <template #icon>
          <IconSignOutSquare class="nav-icon" />
        </template>
        <h3>Sign Out</h3>
      </ElementSignoutButton>
    </div>
  </div>
</template>

<style scoped>
.user-email {
  margin-top: 20px;
  font-size: 18px;
}

h3 {
  font-family: 'Merge One';
  font-style: normal;
  font-size: 18px;

  /* color: #ffffff; */
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

  background: #ffffff;
  border-radius: 0px 10px 10px 0px;
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

.vendors-1 {
  color: var(--mm-black);
}

.tables-1 {
  color: var(--mm-black);
}

.nav-icon {
  height: 24px;
  aspect-ratio: 1;
  margin: 6px;
  color: var(--mm-black);
}
</style>
