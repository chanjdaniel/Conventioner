// @vitest-environment happy-dom
/**
 * Sign out everywhere (T311): the account menu's and the sheet's third entry asks first, in a
 * dialog, then ends every sign-in of the account on the server, this browser's with it.
 *
 * Done, it forgets the session and goes to sign in, which says the person is signed out on every
 * device. A 401 is a session already over, which ends here as any organizer request's 401 does. Any
 * other failure keeps the dialog open, saying so, and the person signed in, since other devices are
 * still signed in.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import SignOutEverywhereDialog from '@/components/SignOutEverywhereDialog.vue';
import { api } from '@/utils/api';
import { installSessionEnded, signOutEverywhere } from '@/utils/sessionEnded';
import { SIGNED_OUT_EVERYWHERE_MESSAGE, loginAddress } from '@/utils/signInNext';

const Page = { template: '<div />' };
const PLACE = '/markets/m-1/applications?view=all';
const COULD_NOT = 'Could not sign out everywhere. Try again.';

let router: Router;
let uninstall: () => void;
let asked: string[];

/** The server answers every request with this status, or never reaches the server with `null`. */
function answer(status: number | null) {
  api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    asked.push(`${config.method} ${config.url}`);
    if (status === null) throw new AxiosError('Network Error', 'ERR_NETWORK', config, {});
    const response = { data: {}, status, statusText: '', headers: {}, config };
    if (status < 400) return response;
    throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, response);
  };
}

beforeEach(async () => {
  setActivePinia(createPinia());
  asked = [];
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: Page, meta: { public: true } },
      { path: '/markets', component: Page },
      { path: '/markets/:id/applications', component: Page },
    ],
  });
  uninstall = installSessionEnded(router);
  localStorage.setItem('user', JSON.stringify('organizer@example.com'));
  await router.push(PLACE);
});

afterEach(() => {
  uninstall();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('signOutEverywhere', () => {
  it('ends every sign-in on the server, forgets the session and says so at sign-in', async () => {
    answer(200);

    expect(await signOutEverywhere(router)).toBe('done');

    expect(asked).toEqual(['post /logout-everywhere']);
    expect(localStorage.getItem('user')).toBeNull();
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query).toEqual({ everywhere: '1' });
  });

  it.each([
    ['no answer', null],
    ['a fault on the server', 500],
    ['a refusal', 403],
  ])('keeps the person signed in on %s', async (_case, status) => {
    answer(status);

    expect(await signOutEverywhere(router)).toBe('failed');

    expect(localStorage.getItem('user')).not.toBeNull();
    expect(router.currentRoute.value.fullPath).toBe(PLACE);
  });

  it('ends a session that was already over as any 401 does', async () => {
    answer(401);

    expect(await signOutEverywhere(router)).toBe('ended');
    await flushPromises();

    expect(localStorage.getItem('user')).toBeNull();
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query).toEqual({ next: PLACE, ended: '1' });
  });
});

describe('the sign-in page it lands on', () => {
  it('carries why, and no page to return to', () => {
    expect(loginAddress(null, { everywhere: true })).toEqual({
      path: '/login',
      query: { everywhere: '1' },
    });
    expect(SIGNED_OUT_EVERYWHERE_MESSAGE).toBe('You are signed out on every device.');
  });
});

describe('the dialog', () => {
  let wrapper: VueWrapper;

  function openTheDialog() {
    wrapper = mount(SignOutEverywhereDialog, {
      props: { open: true },
      attachTo: document.body,
      global: { plugins: [router] },
    });
    return wrapper;
  }

  const byTestid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const confirm = () => byTestid('sign-out-everywhere-submit-button')!;

  afterEach(() => wrapper?.unmount());

  it('asks first, in its own words, and opens on Cancel', async () => {
    answer(200);
    openTheDialog();
    await flushPromises();

    const window = byTestid('sign-out-everywhere-window')!;
    expect(window.getAttribute('role')).toBe('dialog');
    expect(window.textContent).toContain('Sign out everywhere?');
    expect(window.textContent).toContain(
      'This signs you out on every device and browser, this one too.',
    );
    expect(confirm().textContent?.trim()).toBe('Sign out everywhere');
    expect(document.activeElement).toBe(byTestid('sign-out-everywhere-cancel-button'));
    expect(asked).toEqual([]);
  });

  it('closes on Cancel and sends nothing', async () => {
    answer(200);
    openTheDialog();
    await flushPromises();

    byTestid('sign-out-everywhere-cancel-button')!.click();
    await flushPromises();

    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(asked).toEqual([]);
    expect(localStorage.getItem('user')).not.toBeNull();
  });

  it('done, forgets the session, goes to sign in and closes', async () => {
    answer(200);
    openTheDialog();
    await flushPromises();

    confirm().click();
    await flushPromises();

    expect(asked).toEqual(['post /logout-everywhere']);
    expect(localStorage.getItem('user')).toBeNull();
    expect(router.currentRoute.value.query).toEqual({ everywhere: '1' });
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it.each([
    ['no answer', null],
    ['a fault on the server', 500],
  ])('on %s stays open saying so, the person signed in', async (_case, status) => {
    answer(status);
    openTheDialog();
    await flushPromises();

    confirm().click();
    await flushPromises();

    expect(byTestid('sign-out-everywhere-error')?.textContent?.trim()).toBe(COULD_NOT);
    expect(byTestid('sign-out-everywhere-error')?.getAttribute('role')).toBe('alert');
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(localStorage.getItem('user')).not.toBeNull();
    expect(router.currentRoute.value.fullPath).toBe(PLACE);
    expect(confirm().hasAttribute('disabled')).toBe(false);
  });

  it('holds while the request is in flight, so nothing hides its answer', async () => {
    let settle: () => void = () => {};
    api.defaults.adapter = (config: InternalAxiosRequestConfig) =>
      new Promise((resolve) => {
        settle = () => resolve({ data: {}, status: 200, statusText: '', headers: {}, config });
      });
    openTheDialog();
    await flushPromises();

    confirm().click();
    await flushPromises();

    expect(confirm().hasAttribute('disabled')).toBe(true);
    expect(byTestid('sign-out-everywhere-cancel-button')!.hasAttribute('disabled')).toBe(true);
    byTestid('sign-out-everywhere-cancel-button')!.click();
    expect(wrapper.emitted('close')).toBeUndefined();

    settle();
    await flushPromises();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('a second opening starts with no failure said', async () => {
    answer(500);
    openTheDialog();
    await flushPromises();
    confirm().click();
    await flushPromises();
    expect(byTestid('sign-out-everywhere-error')).not.toBeNull();

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(byTestid('sign-out-everywhere-error')).toBeNull();
  });

  it('on a 401 ends the session as any request does, and closes', async () => {
    answer(401);
    openTheDialog();
    await flushPromises();

    confirm().click();
    await flushPromises();

    expect(byTestid('sign-out-everywhere-error')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(router.currentRoute.value.query).toEqual({ next: PLACE, ended: '1' });
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
