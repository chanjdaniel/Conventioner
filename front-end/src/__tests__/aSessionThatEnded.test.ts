// @vitest-environment happy-dom
/**
 * A session that ends mid-work takes the organizer to sign in again, and back (E38/F11/S01): a 401
 * from any of the organizer's requests clears the stored user and goes to
 * `/login?next=<the page>&ended=1`. The applicant's pages have their own sign-in, so their 401s,
 * and any on a public page, are left to the page.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { api } from '@/utils/api';
import { installSessionEnded, keepsTheSession } from '@/utils/sessionEnded';

const Page = { template: '<div />' };
const PLACE = '/markets/m-1/applications?view=all&status=undecided';

let router: Router;
let uninstall: () => void;

/** The server answers every request with this status. */
function answer(status: number) {
  api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const response = { data: '<!doctype html>', status, statusText: '', headers: {}, config };
    if (status < 400) return response;
    throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, response);
  };
}

beforeEach(async () => {
  setActivePinia(createPinia());
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: Page, meta: { public: true } },
      { path: '/markets', component: Page },
      { path: '/markets/:id/applications', component: Page },
      { path: '/:marketSlug', component: Page, meta: { public: true } },
    ],
  });
  uninstall = installSessionEnded(router);
  localStorage.setItem('user', JSON.stringify('organizer@example.com'));
  await router.push(PLACE);
});

afterEach(() => {
  uninstall();
  localStorage.clear();
});

describe('a session that ended', () => {
  it('sends the organizer to sign in again, carrying the page and why', async () => {
    answer(401);

    await expect(api.put('/markets/m-1/applications/a-1/review', {})).rejects.toThrow();
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query).toEqual({ next: PLACE, ended: '1' });
    expect(localStorage.getItem('user')).toBeNull();
  });

  it("leaves an applicant's 401 to the applicant's page", async () => {
    answer(401);

    await expect(api.get('/public/markets/spring/applicant/application')).rejects.toThrow();
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe(PLACE);
    expect(localStorage.getItem('user')).not.toBeNull();
  });

  // No screen sends these through `api` today (signing in and the shell's probe use their own
  // calls); the exemption is for the day one does, when a wrong password must not read as an
  // ended session.
  it.each([
    ['a wrong password', 'post', '/login'],
    ['a wrong code', 'post', '/login-otp'],
    ['a code asked for', 'post', '/request-otp'],
    ['an account made', 'post', '/register'],
    ['a sign-out', 'post', '/logout'],
    ["the shell's session probe", 'get', '/check-session'],
  ] as const)('leaves the 401 of %s to its caller', async (_name, method, url) => {
    answer(401);

    await expect(api[method](url)).rejects.toThrow();
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe(PLACE);
    expect(localStorage.getItem('user')).not.toBeNull();
  });

  it('leaves a 401 on a public page to the page', async () => {
    await router.push('/spring');
    answer(401);

    await expect(api.get('/markets/m-1')).rejects.toThrow();
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/spring');
  });

  it('leaves any other refusal to the screen', async () => {
    answer(403);

    await expect(api.get('/markets/m-1')).rejects.toThrow();
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe(PLACE);
    expect(localStorage.getItem('user')).not.toBeNull();
  });
});

describe("the shell's session probe failing", () => {
  /** The probe's failure: no answer at all when `status` is null. */
  const failure = (status: number | null) => {
    const config = { headers: {} } as InternalAxiosRequestConfig;
    const response =
      status === null ? undefined : { data: {}, status, statusText: '', headers: {}, config };
    return new AxiosError('Request failed', 'ERR', config, {}, response);
  };

  it.each([
    ['no answer', null],
    ['a fault on the server', 500],
    ["a proxy's gateway error", 502],
  ])('keeps the session on %s, which says nothing of it', async (_name, status) => {
    expect(keepsTheSession(router, failure(status))).toBe(true);
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe(PLACE);
    expect(localStorage.getItem('user')).not.toBeNull();
  });

  it('ends a session the server no longer holds, and says so', async () => {
    expect(keepsTheSession(router, failure(401))).toBe(false);
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query).toEqual({ next: PLACE, ended: '1' });
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('ends the session on any other answer, without saying it ended', async () => {
    expect(keepsTheSession(router, failure(403))).toBe(false);
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query).toEqual({ next: PLACE });
  });
});
