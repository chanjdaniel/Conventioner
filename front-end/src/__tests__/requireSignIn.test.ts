import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { requireSignIn } from '@/router';

/**
 * The organizer's pages need a signed-in user, and a page is public only by its `meta.public`
 * (E26/F01/S01).
 */

const Page = { template: '<div />' };

const routerUnderGuard = () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: Page, meta: { public: true } },
      { path: '/reset-password', component: Page, meta: { public: true } },
      { path: '/dashboard', component: Page },
      { path: '/markets', component: Page },
    ],
  });
  router.beforeEach(requireSignIn);
  return router;
};

const signIn = () =>
  localStorage.setItem('user', JSON.stringify({ email: 'organizer@example.com' }));

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the sign-in guard', () => {
  it('sends a signed-in user from the login page to the dashboard', async () => {
    signIn();
    const router = routerUnderGuard();

    await router.push('/login');

    expect(router.currentRoute.value.path).toBe('/dashboard');
  });

  it('sends a signed-out person from a protected page to the login page', async () => {
    const router = routerUnderGuard();

    await router.push('/markets');

    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('lets a signed-out person open a public page', async () => {
    const router = routerUnderGuard();

    await router.push('/reset-password');

    expect(router.currentRoute.value.path).toBe('/reset-password');
  });

  it('lets a signed-in user open a protected page', async () => {
    signIn();
    const router = routerUnderGuard();

    await router.push('/markets');

    expect(router.currentRoute.value.path).toBe('/markets');
  });

  it('navigates without the deprecated next() callback warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    signIn();
    const router = routerUnderGuard();

    await router.push('/login');
    await router.push('/markets');
    localStorage.clear();
    await router.push('/dashboard');

    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/next\(\)/);
  });
});
