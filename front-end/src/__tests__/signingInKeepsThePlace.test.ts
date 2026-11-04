// @vitest-environment happy-dom
/**
 * Signing in returns to the page it was asked from, and says when a session ended
 * (E38/F11/S01): a link opened signed out, or a session that ended mid-work, reaches
 * `/login?next=<page>`, and both ways of signing in continue there.
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
const PLACE = '/markets/m-1/applications?view=all&status=undecided';

async function atLogin(query: Record<string, string>) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginView },
      { path: '/markets', component: Page },
      { path: '/markets/:id/applications', component: Page },
    ],
  });
  await router.push({ path: '/login', query });
  const wrapper = mount(LoginView, { global: { plugins: [router] } });
  return { router, wrapper };
}

const signedIn = { status: 200, data: { user_data: { email: 'organizer@example.com' } } };

afterEach(() => {
  post.mockReset();
  localStorage.clear();
});

describe('signing in', () => {
  it('says the session has ended when it did', async () => {
    const { wrapper } = await atLogin({ next: PLACE, ended: '1' });

    expect(wrapper.get('[data-testid="login-session-ended"]').text()).toBe(
      'Your session has ended. Sign in again.',
    );
  });

  it('says nothing of a session on a plain visit', async () => {
    const { wrapper } = await atLogin({});

    expect(wrapper.find('[data-testid="login-session-ended"]').exists()).toBe(false);
  });

  it('continues to the page carried after a password sign-in', async () => {
    post.mockResolvedValue(signedIn);
    const { router, wrapper } = await atLogin({ next: PLACE });

    await wrapper.get('[data-testid="login-email-input"]').setValue('organizer@example.com');
    await wrapper.get('[data-testid="login-password-input"]').setValue('a password');
    await wrapper.get('[data-testid="login-form"]').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe(PLACE);
  });

  it('continues to the page carried after a code sign-in', async () => {
    post.mockResolvedValue(signedIn);
    const { router, wrapper } = await atLogin({ next: PLACE });

    await wrapper.get('[data-testid="login-tab-otp"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="login-otp-email-input"]').setValue('organizer@example.com');
    post.mockResolvedValueOnce({ status: 200, data: { msg: 'A code was sent.' } });
    await wrapper.get('[data-testid="login-otp-form"]').trigger('submit');
    await flushPromises();
    await wrapper.get('[data-testid="login-otp-code-input"]').setValue('123456');
    await wrapper.get('[data-testid="login-otp-form"]').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe(PLACE);
  });

  it('goes to Markets when the page carried is not one of ours', async () => {
    post.mockResolvedValue(signedIn);
    const { router, wrapper } = await atLogin({ next: 'https://evil.example/' });

    await wrapper.get('[data-testid="login-email-input"]').setValue('organizer@example.com');
    await wrapper.get('[data-testid="login-password-input"]').setValue('a password');
    await wrapper.get('[data-testid="login-form"]').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/markets');
  });
});
