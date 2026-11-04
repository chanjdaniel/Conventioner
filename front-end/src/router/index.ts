import {
  createRouter,
  createWebHistory,
  type NavigationGuard,
  type RouteLocation,
} from 'vue-router';
import { marketPath } from '@/utils/market';
import { loginAddress, safeNext } from '@/utils/signInNext';
import { SETUP_VIEW_PAGES } from '@/utils/marketPage';
import LoginView from '@/views/LoginView.vue';
import EmailVerificationView from '@/views/EmailVerificationView.vue';
import PasswordResetRequestView from '@/views/PasswordResetRequestView.vue';
import PasswordResetView from '@/views/PasswordResetView.vue';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  // A page starts at its own top, directly under the pinned frame, rather than wherever the last one
  // was scrolled to (E21/F04/S01) - whichever view it belongs to, so a move on the rail lands at the
  // top of where its work is (E32/F01/S01). Back and forward return to where the reader was, and a
  // change of query alone (a filter) leaves the page where it is.
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;
    return to.path === from.path ? false : { top: 0 };
  },
  routes: [
    {
      path: '/',
      name: 'root',
      redirect: '/markets',
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { public: true },
    },
    {
      path: '/verify-email',
      name: 'verify-email',
      component: EmailVerificationView,
      meta: { public: true },
    },
    {
      path: '/reset-password-request',
      name: 'reset-password-request',
      component: PasswordResetRequestView,
      meta: { public: true },
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: PasswordResetView,
      meta: { public: true },
    },
    // Signing in landed here until Markets took over from the dashboard, so it is bookmarked.
    {
      path: '/dashboard',
      redirect: '/markets',
    },
    {
      path: '/markets',
      name: 'markets',
      component: () => import('@/views/MarketsView.vue'),
      // Signing in lands here, and it is the way to the market an organizer runs from the door on a
      // phone (T142), so it fits one.
      meta: { fitsAPhone: true },
    },
    {
      path: '/organizations',
      name: 'organizations',
      component: () => import('@/views/OrganizationsView.vue'),
      // The bar's other place, on the way to the door from a phone (T148), so it fits one.
      meta: { fitsAPhone: true },
    },
    // A market's own address lands on the page it is worked on in its phase (E22/F04/S02).
    {
      path: '/markets/:marketId',
      name: 'market',
      component: () => import('@/views/MarketLanding.vue'),
    },
    // Every market page has its own address (E22/F04/S02). The plan, the form, the applications and
    // the assignment rules are the pages of one view; the rest are views of their own.
    {
      path: `/markets/:marketId/:page(${SETUP_VIEW_PAGES.join('|')})`,
      name: 'market-setup',
      component: () => import('@/views/MarketSetupView.vue'),
      // A late application is decided and a vendor's answer corrected from a phone at the market
      // (T180), so the Applications page fits one; the plan, the form and Settings are built at a
      // desk before it, and keep the desktop floor.
      meta: { fitsAPhone: ['applications'] },
    },
    {
      path: '/markets/:marketId/assignments',
      name: 'market-assignments',
      component: () => import('@/views/ResultView.vue'),
      // The vendor drawer's "Change assignment" at the door leads here (T142), so it fits a phone
      // too.
      meta: { fitsAPhone: true },
    },
    // The Assignment tab's pages took the names of what they hold (E38/F08/S01): Assignment became
    // Settings and Result became Assignments. A saved link or a bookmark lands on the page it named,
    // its filters with it. Production's last release still serves the old names, so they stay until
    // a release or two has passed.
    ...(
      [
        ['assignment', 'settings'],
        ['result', 'assignments'],
      ] as const
    ).map(([old, page]) => ({
      path: `/markets/:marketId/${old}`,
      redirect: (to: RouteLocation) => ({
        path: marketPath(String(to.params.marketId), page),
        query: to.query,
        hash: to.hash,
      }),
    })),
    {
      path: '/markets/:marketId/vendors',
      name: 'vendors',
      component: () => import('@/views/VendorsView.vue'),
      // On market day a vendor is looked up, paid and corrected here, one tap from the door (T180),
      // so the page and its drawer fit a phone, as the door does.
      meta: { fitsAPhone: true },
    },
    // The market's money at a glance, and who has yet to pay (E44/F02/S01).
    {
      path: '/markets/:marketId/payments',
      name: 'market-payments',
      component: () => import('@/views/PaymentsView.vue'),
      // Who still owes is read at the door on market day (T180), so it fits a phone, as the door
      // does.
      meta: { fitsAPhone: true },
    },
    {
      path: '/markets/:marketId/attendance',
      name: 'attendance-status',
      component: () => import('@/views/AttendanceStatusView.vue'),
      // The door on market day is sometimes a phone (E29/F01).
      meta: { fitsAPhone: true },
    },
    // The manual tools an organizer runs in any phase, Discord first (E46/F01/S02).
    {
      path: '/markets/:marketId/tools',
      name: 'market-tools',
      component: () => import('@/views/ToolsView.vue'),
      // An organizer may connect Discord from a phone (Daniel, T113), so it fits one, as the door does.
      meta: { fitsAPhone: true },
    },
    // The market's figures, in every phase (E45/F01/S01).
    {
      path: '/markets/:marketId/stats',
      name: 'market-stats',
      component: () => import('@/views/StatsView.vue'),
      // How the day stands is read at the market, on a phone (T180), so it fits one, as the door
      // does.
      meta: { fitsAPhone: true },
    },
    // Where Discord's approval screen sends the organizer back (E46/F01/S02), registered as a
    // redirect in Discord's Developer Portal. It opens in a tab of its own: it finishes connecting,
    // tells the market's tab, and says the outcome.
    {
      path: '/discord/connected',
      name: 'discord-connected',
      component: () => import('@/views/DiscordConnectedView.vue'),
      // An AuthCard page, as the account pages are, so it fits a phone as they do.
      meta: { fitsAPhone: true },
    },
    {
      path: '/markets/:marketId/import',
      name: 'import-applications',
      component: () => import('@/views/CsvImportView.vue'),
    },
    {
      // Starting a draft's plan and form from a Google Form's responses (E24/F03).
      path: '/markets/:marketId/start-from-csv',
      name: 'start-from-csv',
      component: () => import('@/views/StartFromCsvView.vue'),
    },
    {
      path: '/markets/:marketId/floorplan',
      name: 'floorplan-editor',
      component: () => import('@/views/FloorplanEditorView.vue'),
    },
    // A market's vendor page (ADR 0022): sign-in, status, the application and the result, at the
    // market's own address.
    {
      path: '/:marketSlug',
      name: 'vendor-page',
      component: () => import('@/views/VendorPage.vue'),
      meta: { public: true },
    },
    // Anything deeper than one segment matched no route at all, so the app rendered a blank
    // page. `/:marketSlug` catches single-segment addresses and answers for itself.
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/components/PageNotFound.vue'),
      meta: { public: true },
    },
  ],
});

// The component library (T200): every reusable component in its variants and states, on synthetic
// data, for workshopping them. A development build's only: `vite build` replaces
// `import.meta.env.DEV` with `false`, so this block and its lazy imports are dropped and a
// production build emits nothing of `src/dev/` (`vite.config.ts`'s `noDevModules` fails the build
// if it does). It reads no API, so it is public, and it lays out on a phone. An entry the library does
// not have shows "page not found" (`LibraryEntryView.vue`).
if (import.meta.env.DEV) {
  const meta = { public: true, fitsAPhone: true } as const;
  router.addRoute({
    path: '/dev/components',
    name: 'component-library',
    component: () => import('@/dev/library/LibraryIndexView.vue'),
    meta,
  });
  router.addRoute({
    path: '/dev/components/:entry',
    name: 'component-library-entry',
    component: () => import('@/dev/library/LibraryEntryView.vue'),
    meta,
  });
}

/**
 * A page is public when its route says `meta.public`, and nowhere else (E26/F01/S01).
 *
 * The account pages used to be public only through a list of paths here, while the shell
 * (`App.vue`) reads `meta.public` to decide whether to probe the organizer's session. The two
 * disagreed, so a signed-out person opening a password-reset or verification link was let in by
 * this guard and then sent to `/login` by the shell's failed probe before the page could be used.
 */
export const requireSignIn: NavigationGuard = (to) => {
  const user = JSON.parse(localStorage.getItem('user') || 'null');

  // Before the public check, or it can never fire: `/login` is public. A stale `user` costs one
  // hop, since the shell's session probe clears it and comes back here. The page it carries is
  // where signing in would have gone (E38/F11/S01). By the route, not the path: the router
  // matches `/Login` and `/login/` to it too.
  if (user && to.name === 'login') return safeNext(to.query.next) ?? '/markets';

  if (to.matched.some((record) => record.meta.public === true)) return true;

  // A link opened signed out keeps its place: signing in returns to it (E38/F11/S01).
  if (!user) return loginAddress(to.fullPath);

  return true;
};

router.beforeEach(requireSignIn);

export default router;
