import { createRouter, createWebHistory } from 'vue-router';
import InitView from '@/views/InitView.vue';
import LoginView from '@/views/LoginView.vue';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'root',
      redirect: '/init',
    },
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
      path: '/generate-assignment',
      name: 'generate-assignment',
      component: () => import('@/views/GenerateAssignmentView.vue'),
    },    
  ],
})

router.beforeEach((to, from, next) => {
  const publicPages = ["/login"];
  const user = JSON.parse(localStorage.getItem("user") || "null");

  if (publicPages.includes(to.path)) {
    next();
    return;
  }
  
  if (!user) {
    next("/login");
    return;
  }

  if (user && to.path === "/login") {
    next("/init");
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
