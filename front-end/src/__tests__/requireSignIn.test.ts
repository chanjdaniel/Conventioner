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
      { path: '/login', name: 'login', component: Page, meta: { public: true } },
      { path: '/reset-password', component: Page, meta: { public: true } },
      { path: '/markets', component: Page },
      { path: '/markets/:id/applications', component: Page },
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
  it('sends a signed-in user from the login page to Markets', async () => {
    signIn();
    const router = routerUnderGuard();

    await router.push('/login');

    expect(router.currentRoute.value.path).toBe('/markets');
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
    await router.push('/markets/m-1/applications');

    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/next\(\)/);
  });

  it('carries the page a signed-out person opened to the login page, query and all', async () => {
    const router = routerUnderGuard();

    await router.push('/markets/m-1/applications?view=all&status=undecided');

    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query).toEqual({
      next: '/markets/m-1/applications?view=all&status=undecided',
    });
  });

  it('sends a signed-in user from the login page to the page it carries', async () => {
    signIn();
    const router = routerUnderGuard();

    await router.push({ path: '/login', query: { next: '/markets/m-1/applications?view=all' } });

    expect(router.currentRoute.value.fullPath).toBe('/markets/m-1/applications?view=all');
  });

  it('sends a signed-in user to Markets when the page carried is not one of ours', async () => {
    signIn();
    const router = routerUnderGuard();

    await router.push({ path: '/login', query: { next: '//evil.example/markets' } });

    expect(router.currentRoute.value.path).toBe('/markets');
  });

  // The router matches a path whatever its case and with a trailing slash, so each of these is the
  // sign-in page, and a signed-in user is never shown it again.
  it.each(['/Login', '/LOGIN', '/login/'])(
    'sends a signed-in user from the login page spelled %s to Markets',
    async (path) => {
      signIn();
      const router = routerUnderGuard();

      await router.push(path);

      expect(router.currentRoute.value.path).toBe('/markets');
    },
  );

  it('sends a signed-in user to Markets when the page carried is the login page again', async () => {
    signIn();
    const router = routerUnderGuard();

    await router.push({ path: '/login', query: { next: '/Login' } });

    expect(router.currentRoute.value.path).toBe('/markets');
  });
});
