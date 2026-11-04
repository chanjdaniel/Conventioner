<script setup lang="ts">
import axios from 'axios';
import { RouterView } from 'vue-router';
import AppBar from './components/AppBar.vue';

import { onMounted, onUnmounted, ref, provide, inject, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { routerSettled } from '@/utils/routerReady';
import { fitsAPhone as routeFitsAPhone } from '@/utils/fitsAPhone';
import { endSession, keepsTheSession } from '@/utils/sessionEnded';
import { signedInEmail } from '@/utils/signedIn';
import ReadFailed from '@/components/ReadFailed.vue';
import { PAGE_FAILED, openAfresh } from '@/utils/pageFailed';

const hostname = import.meta.env.VITE_FLASK_HOST;

const route = useRoute();
const router = useRouter();
const isPublicPage = computed(() => route.matched.some((r) => r.meta.public === true));
/**
 * A page that must also work on a phone: every public page, and an organizer screen whose route says
 * so (`utils/fitsAPhone.ts`). Every other organizer screen keeps the desktop floor; this lifts the
 * floor and nothing else.
 */
const fitsAPhone = computed(() => isPublicPage.value || routeFitsAPhone(route));

// A page whose code could not be fetched: the click did nothing, so the shell says why.
const pageFailed = inject(PAGE_FAILED, ref(null));

/**
 * Who is signed in, as the app bar and "Page not found" read it. It starts from the stored user and is read again after
 * every navigation, so each way a session starts or ends (signing in, Sign out, `endSession`, a 401)
 * only has to change what is stored and move: none of them has to tell the shell. It is read again
 * on a `storage` event too, which says another tab changed what is stored or `forgetTheSession` ran
 * here, so the bar never goes on naming an account that has gone.
 */
const user = ref<string | null>(signedInEmail());
provide('user', user);
function readTheUser() {
  user.value = signedInEmail();
}
const stopReadingTheUser = router.afterEach(readTheUser);
onUnmounted(stopReadingTheUser);
window.addEventListener('storage', readTheUser);
onUnmounted(() => window.removeEventListener('storage', readTheUser));

onMounted(async () => {
  // Wait for the first navigation to settle before probing the session.
  // Without this, the session check runs before the router knows which page
  // it is on, so every page reads as an authenticated one and the login
  // redirect never fires.
  await routerSettled(router);

  // Public pages do not require an organizer session.
  if (isPublicPage.value) return;

  // The bar stands before the probe answers, so an organizer can sign out under it. The answer is
  // then about a session already over, and brings back neither the bar nor a note that it ended.
  const asked = signedInEmail();
  const sameSession = () => signedInEmail() === asked;

  try {
    const response = await axios.get(`${hostname}/check-session`, {
      withCredentials: true,
    });

    if (!sameSession()) return;

    if (response.status === 200) {
      const user_email = response.data.email;
      localStorage.setItem('user', JSON.stringify(user_email));
      user.value = user_email;
    } else {
      endSession(router, { ended: false });
    }
  } catch (err) {
    // A lost session forgets the open market too, for the reason signing out does, and signing in
    // returns to this page (E38/F11/S01). No answer, or a fault on the server, keeps it.
    if (sameSession()) keepsTheSession(router, err);
  }
});
</script>

<template>
  <div class="app-container" :class="{ 'app-public': fitsAPhone }">
    <header>
      <AppBar />
    </header>

    <!-- The one `main` landmark, on every route: the page's own content, apart from the bar. A
         wrapper, not the routed view's root, so no view has to remember to be it. -->
    <main class="app-main" :class="{ 'app-main-public': fitsAPhone }">
      <ReadFailed
        v-if="pageFailed"
        name="page"
        class="page-failed"
        :message="pageFailed.message"
        @retry="openAfresh(pageFailed.to)"
      />
      <RouterView class="router-view" />
    </main>
  </div>
</template>

<style scoped>
/* `100vw` includes the vertical scrollbar, so any page tall enough to scroll gained a horizontal
   scrollbar it did not need (E08/F01/S02). `left/right: 0` fills the containing block exactly,
   scrollbar or not. */
/*
 * The shell fills the viewport and GROWS past it, so the page scrolls (E16/F03).
 *
 * It used to be `position: absolute; height: 100vh`, pinned to the viewport - which meant no screen
 * could ever scroll the page, and every screen taller than the viewport had to handle its own
 * overflow internally. That is where Market Setup's six nested scrollers came from, and why its
 * card was capped at 80% of the viewport in the first place.
 */
.app-container {
  min-height: 100vh;
  min-width: 1000px;
  background-color: white;
  padding: 0;
  margin: 0;

  display: flex;
  flex-direction: column;
}

.app-container.app-public {
  min-width: 0;
}

/*
 * The navigation is reachable at any scroll position, on every page (E17/F04/S01).
 *
 * STICKY, not fixed: sticky keeps the bar in flow, so nothing has to be padded out from underneath
 * it and no screen has to know the bar's height. It also depends on the page being what scrolls -
 * `.app-container` grows past the viewport rather than capping at it (E16/F03), and a sticky
 * element inside an `overflow` ancestor would silently stop sticking. Do not reintroduce a
 * viewport-height shell to achieve this.
 */
header {
  position: sticky;
  top: 0;
  z-index: 30;

  width: 100%;
  line-height: 1.5;
  max-height: 100vh;
}

/* A printed page is the page: the way between the organizer's places has no use on paper. */
@media print {
  header {
    display: none;
  }
}

.app-main {
  flex: 1;
  min-height: 0;
  min-width: 1000px;

  display: flex;
  flex-direction: column;
}

.app-main-public {
  min-width: 0;
}

/* A page that could not be opened is the shell's to say, not the page's, so it is a strip under
   the banner, above the page the organizer is still on, its line centred on the window as every
   page's frame is. A notice's padding, `--space-2` by `--space-3`. */
.app-main > .page-failed {
  justify-content: center;
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--mm-border);
}

/* On a phone the line wraps, so it starts on the page's 16px gutter and Try again sits under its
   start rather than centred under a left-aligned sentence. */
@media (width <= 640px) {
  .app-main > .page-failed {
    justify-content: flex-start;
    padding: var(--space-2) var(--space-4);
  }
}

/* The routed view fills `main` exactly as it filled the shell when it was the shell's own child. */
.router-view {
  flex: 1;
  min-height: 0;
}
</style>
