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
      path: '/vendors',
      name: 'vendors',
      component: () => import('@/views/VendorsView.vue'),
    },
    {
      path: '/market-setup',
      name: 'market-setup',
      component: () => import('@/views/MarketSetupView.vue'),
    },
    {
      path: '/assignment-results',
      name: 'assignment-results',
      component: () => import('@/views/GenerateAssignmentView.vue'),
    },
    {
      path: '/markets/:marketId/attendance',
      name: 'attendance-status',
      component: () => import('@/views/AttendanceStatusView.vue'),
    },
    {
      path: '/:marketSlug/check-in',
      name: 'attendance-checkin',
      component: () => import('@/views/AttendanceCheckinView.vue'),
    },
    {
      path: '/:marketSlug',
      name: 'market-home',
      component: () => import('@/views/MarketHomeView.vue'),
    },
  ],
})

router.beforeEach((to, from, next) => {
  const publicPages = ["/login", "/register", "/verify-email", "/reset-password-request", "/reset-password"];
  const user = JSON.parse(localStorage.getItem("user") || "null");

  if (publicPages.includes(to.path)) {
    next();
    return;
  }

  if (to.path.endsWith('/check-in')) {
    next();
    return;
  }
  
  if (!user) {
    next("/login");
    return;
  }

  if (user && to.path === "/login") {
    next("/dashboard");
    return;
  }

  next();

  // if (!user && !publicPages.includes(to.path)) {
  //   next("/login");
  // } else if (user && to.path === "/login") {
  //   next("/init");
  // } else {
  //   next();
  // }
});

export default router
