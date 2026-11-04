<script setup lang="ts">
/**
 * The app bar: the way between the organizer's places, always in sight and always the same (T209).
 * The market bar under it is the market's own navigation; this one is the organizer's.
 *
 * The bar reads the route and the signed-in organizer itself, so the shell only places it. A public
 * page shows the logo alone. At 640px and below, the market frame's break, the menu button stands
 * for the links and the account menu, in CSS, so the two layouts never disagree with the frame's.
 */
import { computed, inject, ref, type Ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import RowMenu from '@/components/RowMenu.vue';
import IconExpandDown from '@/components/icons/IconExpandDown.vue';
import IconMenu from '@/components/icons/IconMenu.vue';
import { currentPlace, type AppPlace } from '@/utils/currentPlace';
import { signOut } from '@/utils/sessionEnded';

defineEmits<{ menuOpen: [] }>();

const PLACES: readonly { place: AppPlace; to: string; label: string }[] = [
  { place: 'markets', to: '/markets', label: 'Markets' },
  { place: 'organizations', to: '/organizations', label: 'Organizations' },
];
const ACCOUNT_ITEMS = [{ id: 'sign-out', label: 'Sign out' }];

const route = useRoute();
const router = useRouter();
const user = inject<Ref<string | null>>('user', ref(null));
const setUser = inject<(user: string | null) => void>('setUser', () => {});

const isOrganizerPage = computed(() => !route.matched.some((r) => r.meta.public === true));
const here = computed(() => currentPlace(route));

async function chooseFromAccount(id: string) {
  if (id !== 'sign-out') return;
  await signOut(router);
  setUser(null);
}
</script>

<template>
  <div class="app-bar" data-testid="app-bar">
    <template v-if="isOrganizerPage">
      <button
        type="button"
        class="app-bar-menu-button"
        data-testid="app-menu-button"
        aria-label="Open navigation"
        @click="$emit('menuOpen')"
      >
        <IconMenu />
      </button>
      <RouterLink to="/markets" class="app-bar-logo-link">
        <img
          class="app-bar-logo"
          alt="Conventioner, Markets"
          src="@/assets/icons/conventioner-logo.svg"
        />
      </RouterLink>
      <nav class="app-bar-links" aria-label="Main">
        <RouterLink
          v-for="{ place, to, label } in PLACES"
          :key="place"
          :to="to"
          class="app-bar-link"
          :data-words="label"
          :aria-current="here === place ? 'page' : undefined"
        >
          {{ label }}
        </RouterLink>
      </nav>
      <RowMenu
        v-if="user"
        class="app-bar-account"
        label="Account"
        :items="ACCOUNT_ITEMS"
        testid="app-bar-account"
        @select="chooseFromAccount"
      >
        <template #trigger>
          <span class="app-bar-address" :title="user">{{ user }}</span>
          <IconExpandDown class="app-bar-chevron" aria-hidden="true" />
        </template>
      </RowMenu>
    </template>
    <img
      v-else
      class="app-bar-logo"
      alt="Conventioner"
      src="@/assets/icons/conventioner-logo.svg"
    />
  </div>
</template>

<style scoped>
.app-bar {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  /* A token, because the market frame sticks at exactly this offset (E21/F04/S01). */
  height: var(--banner-h);
  /* The market frame's card edge and the phone's gutter, so the logo lines up with both. */
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--mm-border);
  background: white;
}

.app-bar-logo {
  display: block;
  flex: none;
  height: 26px;
  width: auto;
}

.app-bar-logo-link {
  flex: none;
  border-radius: var(--radius-control);
  transition: opacity 0.15s ease-in-out;
}

.app-bar-logo-link:hover {
  opacity: 0.8;
}

.app-bar-links {
  display: flex;
  align-self: stretch;
  flex: none;
  margin-left: var(--space-6);
}

/* Words centred in the band's full height, so the whole height is the target. */
.app-bar-link {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-3);
  color: var(--mm-black);
  font-size: var(--text-sm);
  /* A control's compact line box (`main.css`), so its words stand level with the account's. */
  line-height: normal;
}

/* The current link's heavier words, held open on every link, so moving between the places never
   nudges the link beside it. */
.app-bar-link::before {
  content: attr(data-words);
  height: 0;
  overflow: hidden;
  visibility: hidden;
  font-weight: 600;
}

.app-bar-link:hover {
  color: var(--mm-green);
}

/* The link fills the band, whose edges would cut a halo off at the window's top and under the market
   bar, so it wears the halo inside its edge. */
.app-bar-link:focus-visible {
  box-shadow: var(--focus-halo-inset);
}

.app-bar-link[aria-current='page'] {
  color: var(--mm-green);
  font-weight: 600;
}

/* Over the band's own line, at its very bottom edge. */
.app-bar-link[aria-current='page']::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: var(--mm-green);
}

/* The account gives way first, by its address, when the window is short of room. */
.app-bar .app-bar-account {
  flex-shrink: 1;
  min-width: 0;
  max-width: 260px;
  margin-left: auto;
}

.app-bar-address {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-bar-chevron {
  flex: none;
  width: 16px;
  height: 16px;
}

.app-bar-menu-button {
  display: none;
}

@media (width <= 640px) {
  .app-bar-links,
  .app-bar .app-bar-account {
    display: none;
  }

  /* To the window's edge, so its words line up with nothing and its target is whole. */
  .app-bar-menu-button {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--target-min);
    height: var(--target-min);
    margin-left: calc(-1 * var(--space-4));
    padding: 0;
    border: none;
    background: none;
    color: var(--mm-black);
    cursor: pointer;
  }

  .app-bar-menu-button:hover {
    background: var(--mm-beige);
  }

  .app-bar-logo-link {
    margin-left: var(--space-1);
  }
}
</style>
