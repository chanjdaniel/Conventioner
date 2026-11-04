<script setup lang="ts">
/**
 * The app bar: the way between the organizer's places, always in sight and always the same (T209).
 * The market bar under it is the market's own navigation; this one is the organizer's.
 *
 * The bar reads the route and the signed-in organizer itself, so the shell only places it. A public
 * page shows the logo alone. At 640px and below, the market frame's break, the menu button stands
 * for the links and the account menu, in CSS, so the two layouts never disagree with the frame's.
 *
 * The button opens a sheet under the bar. A list of places and not a form in a window, so it is not
 * an `AppDialog`, but it keeps a modal's contract: the page behind is inert, focus moves in, and
 * Escape, the scrim and the button close it and give focus back.
 */
import { computed, inject, nextTick, onUnmounted, ref, useId, watch, type Ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import RowMenu from '@/components/RowMenu.vue';
import IconCloseRound from '@/components/icons/IconCloseRound.vue';
import IconExpandDown from '@/components/icons/IconExpandDown.vue';
import IconMenu from '@/components/icons/IconMenu.vue';
import { currentPlace, type AppPlace } from '@/utils/currentPlace';
import { signOut } from '@/utils/sessionEnded';
import { useEscapeToClose } from '@/utils/useEscapeToClose';
import { useFocusGoesBack } from '@/utils/useFocusGoesBack';
import { useInertBehind } from '@/utils/useInertBehind';

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

async function leave() {
  closeSheet();
  await signOut(router);
  setUser(null);
}

function chooseFromAccount(id: string) {
  if (id === 'sign-out') void leave();
}

const sheetOpen = ref(false);
function closeSheet() {
  sheetOpen.value = false;
}

const sheetId = `app-bar-sheet-${useId()}`;
const menuButton = ref<HTMLButtonElement | null>(null);
const scrim = ref<HTMLElement | null>(null);
const sheet = ref<HTMLElement | null>(null);

function toggleSheet() {
  if (sheetOpen.value) {
    closeSheet();
    return;
  }
  // A tap does not focus a button in every browser, and focus comes back to what held it on opening.
  menuButton.value?.focus();
  sheetOpen.value = true;
  void nextTick(() => sheet.value?.querySelector('a')?.focus());
}

// The button is one of its parts, since it is how the sheet closes.
useInertBehind(sheetOpen, () => [scrim.value, sheet.value, menuButton.value]);
useEscapeToClose(sheetOpen, closeSheet);
useFocusGoesBack(() => sheetOpen.value);
watch(() => route.fullPath, closeSheet);

/** Past the break the button is gone, and nothing would be left to close the sheet with. */
let phoneWindow: MediaQueryList | null = null;
function closeOnWidening(event: MediaQueryListEvent) {
  if (!event.matches) closeSheet();
}
function stopWatchingTheWindow() {
  phoneWindow?.removeEventListener('change', closeOnWidening);
  phoneWindow = null;
}
watch(sheetOpen, (open) => {
  stopWatchingTheWindow();
  if (!open) return;
  phoneWindow = window.matchMedia('(width <= 640px)');
  phoneWindow.addEventListener('change', closeOnWidening);
});
onUnmounted(stopWatchingTheWindow);
</script>

<template>
  <div class="app-bar" data-testid="app-bar">
    <div class="app-bar-row">
      <template v-if="isOrganizerPage">
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
        <button
          ref="menuButton"
          type="button"
          class="app-bar-menu-button"
          data-testid="app-bar-menu-button"
          :aria-label="sheetOpen ? 'Close menu' : 'Open menu'"
          :aria-expanded="sheetOpen"
          :aria-controls="sheetId"
          @click="toggleSheet"
        >
          <IconCloseRound v-if="sheetOpen" aria-hidden="true" />
          <IconMenu v-else aria-hidden="true" />
        </button>
      </template>
      <img
        v-else
        class="app-bar-logo"
        alt="Conventioner"
        src="@/assets/icons/conventioner-logo.svg"
      />
    </div>

    <template v-if="sheetOpen">
      <div ref="scrim" class="app-bar-scrim" data-testid="app-bar-scrim" @click="closeSheet"></div>
      <div :id="sheetId" ref="sheet" class="app-bar-sheet" data-testid="app-bar-sheet">
        <nav aria-label="Main">
          <RouterLink
            v-for="{ place, to, label } in PLACES"
            :key="place"
            :to="to"
            class="app-bar-sheet-row"
            :aria-current="here === place ? 'page' : undefined"
            @click="closeSheet"
          >
            {{ label }}
          </RouterLink>
        </nav>
        <template v-if="user">
          <p class="app-bar-sheet-row app-bar-sheet-address" :title="user">{{ user }}</p>
          <button
            type="button"
            class="app-bar-sheet-row"
            data-testid="app-bar-sheet-sign-out"
            @click="leave"
          >
            Sign out
          </button>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* The band, as wide as the page, so its line runs on under a page that scrolls sideways. */
.app-bar {
  box-sizing: border-box;
  /* A token, because the market frame sticks at exactly this offset (E21/F04/S01). */
  height: var(--banner-h);
  border-bottom: 1px solid var(--mm-border);
  background: white;
}

/*
 * What the band holds, the window's width: on a screen keeping the desktop floor the page is wider
 * than the window, and only a fixed box both fills the window, less a scroll bar, and stays in it as
 * the page scrolls sideways. A sticky one is held inside the page's own width. It stands over the
 * band's line, so the band stays in the flow and nothing is padded out from under it.
 */
.app-bar-row {
  box-sizing: border-box;
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  display: flex;
  align-items: center;
  height: var(--banner-h);
  /* The market frame's card edge and the phone's gutter, so the logo lines up with both. */
  padding: 0 var(--space-4);
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
  bottom: 0;
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

/* Under the bar, so the button that closes the sheet stays in sight and to hand. */
.app-bar-scrim {
  position: fixed;
  inset: var(--banner-h) 0 0;
  background: rgba(0, 0, 0, 0.5);
}

.app-bar-sheet {
  position: fixed;
  top: var(--banner-h);
  right: 0;
  left: 0;
  overflow-y: auto;
  /* `dvh`, since a phone's browser bar would otherwise cover its last row. */
  max-height: calc(100dvh - var(--banner-h));
  padding: var(--space-1) 0 var(--space-2);
  background: white;
  box-shadow: var(--shadow-card);
}

/* A row's words stand on the logo's left edge, at the phone's gutter. */
.app-bar-sheet-row {
  position: relative;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  min-height: var(--target-min);
  margin: 0;
  padding: 0 var(--space-4);
  border: none;
  /* A filled row the whole width is the target, as a menu's item is, so its halo runs its width. */
  background: white;
  color: var(--mm-black);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-md);
  line-height: normal;
  text-align: left;
}

.app-bar-sheet-row:hover {
  background: var(--mm-beige);
}

/* The sheet scrolls, so its edges would cut off a halo drawn outside a row. */
.app-bar-sheet-row:focus-visible {
  box-shadow: var(--focus-halo-inset);
}

.app-bar-sheet-row[aria-current='page'] {
  color: var(--mm-green);
  font-weight: 600;
}

/* Over the row, not beside its words, so the mark moves nothing as the place changes. */
.app-bar-sheet-row[aria-current='page']::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  background: var(--mm-green);
}

/* Not a control. A `title` is no use to a thumb, so a long address wraps, whole, and never cuts. */
.app-bar-sheet-address:hover {
  background: white;
}

.app-bar-sheet-address {
  margin-top: var(--space-1);
  padding: var(--space-1) var(--space-4);
  border-top: 1px solid var(--mm-border);
  overflow-wrap: anywhere;
  color: var(--mm-text-muted);
  cursor: auto;
  font-size: var(--text-sm);
}

@media (width <= 640px) {
  .app-bar-links,
  .app-bar .app-bar-account {
    display: none;
  }

  /* The band's height, a thumb's target, so it wears the halo inside its edge as the links do. */
  .app-bar-logo-link {
    display: flex;
    align-items: center;
    height: var(--target-min);
  }

  .app-bar-logo-link:focus-visible {
    box-shadow: var(--focus-halo-inset);
  }

  /* Its target runs into the gutter, so its icon rather than its box stands by the gutter's edge. */
  .app-bar-menu-button {
    box-sizing: border-box;
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--target-min);
    height: var(--target-min);
    margin-right: calc(-1 * var(--space-3));
    margin-left: auto;
    padding: 0;
    /* Its hover stops short of the band's line, which it stands over. */
    border: none;
    border-bottom: 1px solid transparent;
    background: none;
    background-clip: padding-box;
    color: var(--mm-black);
    cursor: pointer;
  }

  .app-bar-menu-button:hover {
    background-color: var(--mm-beige);
  }

  /* It fills the band, whose edge is the window's, so it wears the halo inside its own. */
  .app-bar-menu-button:focus-visible {
    box-shadow: var(--focus-halo-inset);
  }
}
</style>
