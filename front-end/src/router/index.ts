import { createRouter, createWebHistory } from 'vue-router';
import InitView from '@/views/InitView.vue';
import HomeView from '@/views/HomeView.vue';
import LoginView from '@/views/LoginView.vue';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView,
    },
    {
      path: '/init',
      name: 'init',
      component: InitView,
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
      path: '/welcome',
      name: 'welcome',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/generate-assignment',
      name: 'generate-assignment',
      component: () => import('@/views/GenerateAssignmentView.vue'),
    },    
  ],
})

router.beforeEach((to, from, next) => {
  const publicPages = ["/login"];
  const user = JSON.parse(localStorage.getItem("user") || "null");
  publicPages.includes(to.path)

  if (!user && !publicPages.includes(to.path)) {
    next("/login");
  } else if (user && to.path === "/login") {
    next("/init");
  } else {
    next();
  }
});

export default router
