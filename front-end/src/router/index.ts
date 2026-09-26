import { createRouter, createWebHistory } from 'vue-router';
import InitView from '@/views/InitView.vue';
import LoginView from '@/views/LoginView.vue';
import EmailVerificationView from '@/views/EmailVerificationView.vue';
import PasswordResetRequestView from '@/views/PasswordResetRequestView.vue';
import PasswordResetView from '@/views/PasswordResetView.vue';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'root',
      redirect: '/dashboard',
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
    },
    {
      path: '/register',
      name: 'register',
      redirect: '/login',
    },
    {
      path: '/verify-email',
      name: 'verify-email',
      component: EmailVerificationView,
    },
    {
      path: '/reset-password-request',
      name: 'reset-password-request',
      component: PasswordResetRequestView,
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: PasswordResetView,
    },
    {
      path: '/init',
      name: 'init',
      component: InitView,
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
    },
    {
      path: '/markets',
      name: 'markets',
      component: () => import('@/views/MarketsView.vue'),
    },
    {
      path: '/organizations',
      name: 'organizations',
      component: () => import('@/views/OrganizationsView.vue'),
    },
    {
      path: '/markets/:marketId/vendors',
      name: 'vendors',
      component: () => import('@/views/VendorsView.vue'),
    },
    { path: '/vendors', redirect: '/markets' },
    {
      path: '/markets/:marketId/setup',
      name: 'market-setup',
      component: () => import('@/views/MarketSetupView.vue'),
    },
    // Every market screen is addressed by id (E21/F02/S02). The id-less path never held one to
    // preserve, so it can only send the organizer to choose a market.
    {
      path: '/market-setup',
      redirect: '/markets',
    },
    {
      path: '/markets/:marketId/import',
      name: 'import-applications',
      component: () => import('@/views/CsvImportView.vue'),
    },
    { path: '/import-applications', redirect: '/markets' },
    {
      path: '/markets/:marketId/floorplan',
      name: 'floorplan-editor',
      component: () => import('@/views/FloorplanEditorView.vue'),
    },
    // This one did carry an id, in the query, so an old link still opens the market it named.
    {
      path: '/floorplan-editor',
      redirect: (to) =>
        to.query.marketId
          ? `/markets/${encodeURIComponent(String(to.query.marketId))}/floorplan`
          : '/markets',
    },
    // Assignment Results is a tab on the market now (E10/F03/S01). The old path carried no market
    // id, so, like `/market-setup`, all it can do is send the organizer to choose a market.
    {
      path: '/assignment-results',
      redirect: '/markets',
    },
    {
      path: '/markets/:marketId/attendance',
      name: 'attendance-status',
      component: () => import('@/views/AttendanceStatusView.vue'),
    },
    {
      path: '/markets/:marketId/tables',
      name: 'tables-view',
      component: () => import('@/views/TablesView.vue'),
    },
    {
      path: '/:marketSlug/check-in',
      name: 'attendance-checkin',
      component: () => import('@/views/AttendanceCheckinView.vue'),
      meta: { public: true },
    },
    {
      path: '/:marketSlug',
      name: 'market-home',
      component: () => import('@/views/MarketHomeView.vue'),
      meta: { public: true },
    },
    {
      path: '/:marketSlug/apply',
      name: 'apply',
      component: () => import('@/views/ApplicationPage.vue'),
      meta: { public: true },
    },
    {
      path: '/:marketSlug/applicant-login',
      name: 'applicant-login',
      component: () => import('@/views/ApplicantLogin.vue'),
      meta: { public: true },
    },
    {
      path: '/:marketSlug/applicant/dashboard',
      name: 'applicant-dashboard',
      component: () => import('@/views/ApplicantDashboard.vue'),
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

router.beforeEach((to, _from, next) => {
  const publicPages = [
    '/login',
    '/register',
    '/verify-email',
    '/reset-password-request',
    '/reset-password',
  ];
  const user = JSON.parse(localStorage.getItem('user') || 'null');

  if (publicPages.includes(to.path)) {
    next();
    return;
  }

  if (to.matched.some((record) => record.meta.public === true)) {
    next();
    return;
  }

  if (!user) {
    next('/login');
    return;
  }

  if (user && to.path === '/login') {
    next('/dashboard');
    return;
  }

  next();
});

export default router;
