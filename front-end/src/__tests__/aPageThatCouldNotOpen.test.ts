// @vitest-environment happy-dom
/**
 * A page whose code could not be fetched says so, and Try again opens it (E38/F11/S01): a screen's
 * code is loaded when it is first opened, so with no connection, or after a deploy replaced it,
 * the navigation fails. The shell shows what happened, offline in the words every other offline
 * failure uses, and Try again loads the page afresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { OFFLINE_MESSAGE } from '@/utils/api';
import { PAGE_NOT_OPENED_MESSAGE, openAfresh, watchPageFailed } from '@/utils/pageFailed';

const Page = { template: '<div />' };
let fetchable = false;

let router: Router;

beforeEach(async () => {
  fetchable = false;
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/markets', component: Page },
      {
        path: '/organizations',
        component: () =>
          fetchable
            ? Promise.resolve(Page)
            : Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
      },
      {
        path: '/:anything(.*)*',
        component: () =>
          Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
      },
    ],
  });
  await router.push('/markets');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a page that could not be opened', () => {
  it('says so, and where it was going', async () => {
    const failed = watchPageFailed(router);

    await router.push('/organizations').catch(() => {});
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/markets');
    expect(failed.value).toEqual({ to: '/organizations', message: PAGE_NOT_OPENED_MESSAGE });
  });

  it('says the connection when the browser is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const failed = watchPageFailed(router);

    await router.push('/organizations').catch(() => {});
    await flushPromises();

    expect(failed.value?.message).toBe(OFFLINE_MESSAGE);
  });

  it('says nothing once a page opens', async () => {
    const failed = watchPageFailed(router);
    await router.push('/organizations').catch(() => {});
    await flushPromises();

    fetchable = true;
    await router.push('/organizations');

    expect(failed.value).toBeNull();
  });
});

describe('Try again', () => {
  const browser = () => ({ assign: vi.fn(), reload: vi.fn() });

  it('loads the page the navigation was going to', async () => {
    const failed = watchPageFailed(router);
    await router.push('/organizations?tab=people').catch(() => {});
    await flushPromises();
    const location = browser();

    openAfresh(failed.value!.to, location);

    expect(location.assign).toHaveBeenCalledWith('/organizations?tab=people');
  });

  // Where the window is sent is checked the one way every such address is: a navigation that
  // named another host reloads the page the organizer is on instead.
  it.each(['//evil.example/x', '/\\evil.example/x'])(
    'never leaves this app for %s',
    async (address) => {
      const failed = watchPageFailed(router);
      await router.push(address).catch(() => {});
      await flushPromises();
      expect(failed.value).not.toBeNull();
      const location = browser();

      openAfresh(failed.value!.to, location);

      expect(location.assign).not.toHaveBeenCalled();
      expect(location.reload).toHaveBeenCalled();
    },
  );
});
