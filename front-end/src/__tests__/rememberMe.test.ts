// @vitest-environment happy-dom
/**
 * Signing in offers "Remember me" (E38/F14/S01): one choice, unticked until ticked, on the password
 * form and the code form alike, kept when moving between them, and sent as `remember` by both
 * sign-ins. The server decides what it means: 12 hours without it, 30 days with it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

const post = vi.fn();
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, post: (...a: unknown[]) => post(...a) } };
});

import LoginView from '@/views/LoginView.vue';

const Page = { template: '<div />' };
const signedIn = { status: 200, data: { user_data: { email: 'organizer@example.com' } } };

async function atLogin() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginView },
      { path: '/dashboard', component: Page },
    ],
  });
  await router.push('/login');
  return mount(LoginView, { global: { plugins: [router] }, attachTo: document.body });
}

type Wrapper = Awaited<ReturnType<typeof atLogin>>;

function box(wrapper: Wrapper, testid: string): HTMLInputElement {
  return wrapper.get(`[data-testid="${testid}"]`).element as HTMLInputElement;
}

async function signInByPassword(wrapper: Wrapper) {
  await wrapper.get('[data-testid="login-email-input"]').setValue('organizer@example.com');
  await wrapper.get('[data-testid="login-password-input"]').setValue('a password');
  await wrapper.get('[data-testid="login-form"]').trigger('submit');
  await flushPromises();
}

async function askForACode(wrapper: Wrapper) {
  await wrapper.get('[data-testid="login-tab-otp"]').trigger('click');
  await flushPromises();
  await wrapper.get('[data-testid="login-otp-email-input"]').setValue('organizer@example.com');
  post.mockResolvedValueOnce({ status: 200, data: { msg: 'A code was sent.' } });
  await wrapper.get('[data-testid="login-otp-form"]').trigger('submit');
  await flushPromises();
}

async function signInByCode(wrapper: Wrapper) {
  await wrapper.get('[data-testid="login-otp-code-input"]').setValue('123456');
  await wrapper.get('[data-testid="login-otp-form"]').trigger('submit');
  await flushPromises();
}

function sent(path: string) {
  const call = post.mock.calls.find(([url]) => String(url).endsWith(path));
  expect(call, `no post to ${path}`).toBeDefined();
  return call![1] as Record<string, unknown>;
}

afterEach(() => {
  post.mockReset();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('Remember me', () => {
  it('is a checkbox named "Remember me", unticked, on the password form', async () => {
    const wrapper = await atLogin();
    const remember = box(wrapper, 'login-remember-me');

    expect(remember.type).toBe('checkbox');
    expect(remember.checked).toBe(false);
    expect(remember.closest('label')?.textContent).toContain('Remember me');
    expect(remember.closest('form')?.getAttribute('data-testid')).toBe('login-form');
  });

  it('sends remember: false from the password form when left unticked', async () => {
    post.mockResolvedValue(signedIn);
    const wrapper = await atLogin();

    await signInByPassword(wrapper);

    expect(sent('/login')).toMatchObject({ remember: false });
  });

  it('sends remember: true from the password form when ticked', async () => {
    post.mockResolvedValue(signedIn);
    const wrapper = await atLogin();

    await wrapper.get('[data-testid="login-remember-me"]').setValue(true);
    await signInByPassword(wrapper);

    expect(sent('/login')).toMatchObject({ remember: true });
  });

  it('is on the code form once a code is asked for, and sent with the code', async () => {
    post.mockResolvedValue(signedIn);
    const wrapper = await atLogin();

    await askForACode(wrapper);
    const remember = box(wrapper, 'login-otp-remember-me');
    expect(remember.checked).toBe(false);
    expect(remember.closest('form')?.getAttribute('data-testid')).toBe('login-otp-form');
    await wrapper.get('[data-testid="login-otp-remember-me"]').setValue(true);
    await signInByCode(wrapper);

    expect(sent('/login-otp')).toMatchObject({ remember: true });
  });

  it('is one choice, kept when moving between the password and code forms', async () => {
    post.mockResolvedValue(signedIn);
    const wrapper = await atLogin();

    await wrapper.get('[data-testid="login-remember-me"]').setValue(true);
    await askForACode(wrapper);
    expect(box(wrapper, 'login-otp-remember-me').checked).toBe(true);

    await wrapper.get('[data-testid="login-otp-remember-me"]').setValue(false);
    await wrapper.get('[data-testid="login-tab-login"]').trigger('click');
    await flushPromises();
    expect(box(wrapper, 'login-remember-me').checked).toBe(false);
  });
});
