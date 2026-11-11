// @vitest-environment happy-dom
/**
 * The sign-in screen's messages say what happened and what to do next (E38/F14/S02), one at a time
 * on each form, the newer replacing the older:
 *
 * - a refused password offers "Forgot password?" in the message, and so do too many tries;
 * - an address that needs verifying offers "Send the link again", which asks for the link for the
 *   address that was refused and then says so, whatever the server answered of the address, unless
 *   it was asked for too often, which says how long to wait in place of a link on its way;
 * - a wrong code replaces the "code sent" line, so a red line never sits under a green one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { AxiosError, AxiosHeaders } from 'axios';

const post = vi.fn();
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, post: (...a: unknown[]) => post(...a) } };
});

import LoginView from '@/views/LoginView.vue';
import { OFFLINE_MESSAGE, SERVER_FAULT_MESSAGE } from '@/utils/api';

const ADDRESS = 'organizer@example.com';
const DO_NOT_MATCH = 'That email and password do not match.';
const VERIFY_FIRST = 'Verify your email address first: we sent you a link when you registered.';
const RESENT = 'If that address needs verifying, a new link is on its way.';
const CODE_SENT = 'If an account exists for that address, a sign-in code has been sent to it.';
const WRONG_CODE = 'That code is not right.';
const TOO_MANY = 'Too many sign-in attempts. Try again in 15 minutes, or reset your password.';
const ASKED_TOO_OFTEN = 'You have asked several times. Try again in 15 minutes.';

const Page = { template: '<div />' };

/** A refusal as axios rejects with one: a status and a body, or no answer at all. */
function refused(status: number | null, data: Record<string, string> = {}): AxiosError {
  const error = new AxiosError('refused');
  if (status !== null) {
    error.response = {
      status,
      statusText: '',
      data,
      headers: {},
      config: { headers: new AxiosHeaders() },
    };
  }
  return error;
}

async function atLogin() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginView },
      { path: '/markets', component: Page },
      { path: '/reset-password-request', component: Page },
    ],
  });
  await router.push('/login');
  return mount(LoginView, { global: { plugins: [router] }, attachTo: document.body });
}

type Wrapper = Awaited<ReturnType<typeof atLogin>>;

const byTestId = (wrapper: Wrapper, testid: string) => wrapper.find(`[data-testid="${testid}"]`);

/** What the user can see: an element drawn, and not hidden by `v-show`. */
function shown(wrapper: Wrapper, testid: string): boolean {
  const found = byTestId(wrapper, testid);
  return found.exists() && (found.element as HTMLElement).style.display !== 'none';
}

async function signInByPassword(wrapper: Wrapper, address = ADDRESS) {
  await wrapper.get('[data-testid="login-email-input"]').setValue(address);
  await wrapper.get('[data-testid="login-password-input"]').setValue('a password');
  await wrapper.get('[data-testid="login-form"]').trigger('submit');
  await flushPromises();
}

async function askForACode(wrapper: Wrapper) {
  await wrapper.get('[data-testid="login-tab-otp"]').trigger('click');
  await flushPromises();
  await wrapper.get('[data-testid="login-otp-email-input"]').setValue(ADDRESS);
  await wrapper.get('[data-testid="login-otp-form"]').trigger('submit');
  await flushPromises();
}

async function sendACode(wrapper: Wrapper, code: string) {
  await wrapper.get('[data-testid="login-otp-code-input"]').setValue(code);
  await wrapper.get('[data-testid="login-otp-form"]').trigger('submit');
  await flushPromises();
}

function posts(path: string) {
  return post.mock.calls.filter(([url]) => String(url).endsWith(path));
}

afterEach(() => {
  post.mockReset();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('the links under the forms', () => {
  // A link is a link: it can be opened in a new tab, and its address is read out (t181 p3-4a).
  it('makes "Forgot password?" a link to the reset page', async () => {
    const wrapper = await atLogin();

    const forgot = byTestId(wrapper, 'login-forgot-password-link');
    expect(forgot.element.tagName).toBe('A');
    expect(forgot.attributes('href')).toBe('/reset-password-request');
  });

  // It changes the form and goes nowhere, so it is a button; the address field it gives back
  // takes the focus, since the button itself goes.
  it('makes "Use a different email" a button that gives the focus to the address', async () => {
    post.mockResolvedValueOnce({ status: 200, data: { msg: CODE_SENT } });
    const wrapper = await atLogin();
    await askForACode(wrapper);

    const different = byTestId(wrapper, 'login-otp-different-email-button');
    expect(different.element.tagName).toBe('BUTTON');
    expect(different.attributes('type')).toBe('button');
    expect(different.attributes('href')).toBeUndefined();

    await different.trigger('click');
    await flushPromises();

    expect(document.activeElement).toBe(byTestId(wrapper, 'login-otp-email-input').element);
  });
});

describe('a refused password', () => {
  it('says the email and password do not match, with "Forgot password?" in the message', async () => {
    post.mockRejectedValueOnce(refused(401, { message: DO_NOT_MATCH }));
    const wrapper = await atLogin();

    await signInByPassword(wrapper);

    const message = byTestId(wrapper, 'login-error-message');
    expect(shown(wrapper, 'login-error-message')).toBe(true);
    expect(message.text()).toContain(DO_NOT_MATCH);
    const forgot = message.find('[data-testid="login-error-forgot-password-link"]');
    expect(forgot.text()).toBe('Forgot password?');
    expect(forgot.attributes('href')).toBe('/reset-password-request');
  });

  it('says to wait after too many tries, with "Forgot password?" in the message', async () => {
    post.mockRejectedValueOnce(refused(429, { message: TOO_MANY }));
    const wrapper = await atLogin();

    await signInByPassword(wrapper);

    const message = byTestId(wrapper, 'login-error-message');
    expect(shown(wrapper, 'login-error-message')).toBe(true);
    expect(message.text()).toContain(TOO_MANY);
    const forgot = message.find('[data-testid="login-error-forgot-password-link"]');
    expect(forgot.text()).toBe('Forgot password?');
    expect(forgot.attributes('href')).toBe('/reset-password-request');
    expect(byTestId(wrapper, 'login-resend-verification-button').exists()).toBe(false);
  });

  it('says the server is unreachable when no answer came, offering nothing', async () => {
    post.mockRejectedValueOnce(refused(null));
    const wrapper = await atLogin();

    await signInByPassword(wrapper);

    expect(byTestId(wrapper, 'login-error-message').text()).toBe(OFFLINE_MESSAGE);
    expect(byTestId(wrapper, 'login-error-forgot-password-link').exists()).toBe(false);
  });

  it("says it is the server's fault on a 500, offering nothing", async () => {
    post.mockRejectedValueOnce(refused(500, { error: 'Internal server error' }));
    const wrapper = await atLogin();

    await signInByPassword(wrapper);

    expect(byTestId(wrapper, 'login-error-message').text()).toBe(SERVER_FAULT_MESSAGE);
    expect(byTestId(wrapper, 'login-resend-verification-button').exists()).toBe(false);
  });
});

describe('an address that needs verifying', () => {
  it('says to verify first, and offers to send the link again', async () => {
    post.mockRejectedValueOnce(refused(403, { message: VERIFY_FIRST }));
    const wrapper = await atLogin();

    await signInByPassword(wrapper);

    expect(byTestId(wrapper, 'login-error-message').text()).toBe(VERIFY_FIRST);
    expect(byTestId(wrapper, 'login-error-forgot-password-link').exists()).toBe(false);
    expect(byTestId(wrapper, 'login-resend-verification-button').text()).toBe(
      'Send the link again',
    );
  });

  it('sends the link for the address that was refused, and then says so in place of the verify line', async () => {
    post.mockRejectedValueOnce(refused(403, { message: VERIFY_FIRST }));
    const wrapper = await atLogin();
    await signInByPassword(wrapper);
    // Typed over after the refusal: the link is for the address the verify line is about.
    await wrapper.get('[data-testid="login-email-input"]').setValue('someone-else@example.com');

    post.mockResolvedValueOnce({ status: 200, data: { msg: 'Verification email sent' } });
    await wrapper.get('[data-testid="login-resend-verification-button"]').trigger('click');
    await flushPromises();

    expect(posts('/resend-verification')).toHaveLength(1);
    expect(posts('/resend-verification')[0][1]).toEqual({ email: ADDRESS });
    expect(shown(wrapper, 'login-success-message')).toBe(true);
    expect(byTestId(wrapper, 'login-success-message').text()).toBe(RESENT);
    expect(shown(wrapper, 'login-error-message')).toBe(false);
    expect(byTestId(wrapper, 'login-resend-verification-button').exists()).toBe(false);
  });

  it.each([
    ['a refusal', refused(400, { msg: 'Email already verified' })],
    ['the uniform answer', { status: 200, data: { msg: 'If an account exists' } }],
  ])('says the same after %s, whatever the server said of the address', async (_name, answer) => {
    post.mockRejectedValueOnce(refused(403, { message: VERIFY_FIRST }));
    const wrapper = await atLogin();
    await signInByPassword(wrapper);

    if (answer instanceof AxiosError) post.mockRejectedValueOnce(answer);
    else post.mockResolvedValueOnce(answer);
    await wrapper.get('[data-testid="login-resend-verification-button"]').trigger('click');
    await flushPromises();

    expect(byTestId(wrapper, 'login-success-message').text()).toBe(RESENT);
  });

  it('says how long to wait when the link was asked for too often, and offers it no more', async () => {
    post.mockRejectedValueOnce(refused(403, { message: VERIFY_FIRST }));
    const wrapper = await atLogin();
    await signInByPassword(wrapper);

    post.mockRejectedValueOnce(refused(429, { msg: ASKED_TOO_OFTEN }));
    await wrapper.get('[data-testid="login-resend-verification-button"]').trigger('click');
    await flushPromises();

    expect(byTestId(wrapper, 'login-error-message').text()).toBe(ASKED_TOO_OFTEN);
    expect(shown(wrapper, 'login-success-message')).toBe(false);
    expect(byTestId(wrapper, 'login-resend-verification-button').exists()).toBe(false);
  });

  it('says the link was not sent when no answer came, and offers it again', async () => {
    post.mockRejectedValueOnce(refused(403, { message: VERIFY_FIRST }));
    const wrapper = await atLogin();
    await signInByPassword(wrapper);

    post.mockRejectedValueOnce(refused(null));
    await wrapper.get('[data-testid="login-resend-verification-button"]').trigger('click');
    await flushPromises();

    expect(byTestId(wrapper, 'login-error-message').text()).toBe(OFFLINE_MESSAGE);
    expect(shown(wrapper, 'login-success-message')).toBe(false);
    expect(byTestId(wrapper, 'login-resend-verification-button').exists()).toBe(true);
  });

  // The button goes once the link is on its way, so the focus on it would fall to the page: it
  // moves to the line saying what happened, as the verification page keeps a keyboard in place.
  it('moves the focus to the line that says the link is on its way', async () => {
    post.mockRejectedValueOnce(refused(403, { message: VERIFY_FIRST }));
    const wrapper = await atLogin();
    await signInByPassword(wrapper);

    post.mockResolvedValueOnce({ status: 200, data: {} });
    const button = wrapper.get('[data-testid="login-resend-verification-button"]');
    (button.element as HTMLElement).focus();
    await button.trigger('click');
    await flushPromises();

    expect(document.activeElement).toBe(byTestId(wrapper, 'login-success-message').element);
  });

  it('moves the focus to the line that says to wait, when the button goes with it', async () => {
    post.mockRejectedValueOnce(refused(403, { message: VERIFY_FIRST }));
    const wrapper = await atLogin();
    await signInByPassword(wrapper);

    post.mockRejectedValueOnce(refused(429, { msg: ASKED_TOO_OFTEN }));
    const button = wrapper.get('[data-testid="login-resend-verification-button"]');
    (button.element as HTMLElement).focus();
    await button.trigger('click');
    await flushPromises();

    expect(document.activeElement).toBe(byTestId(wrapper, 'login-error-message').element);
  });

  it('keeps the focus on the button when it is offered again', async () => {
    post.mockRejectedValueOnce(refused(403, { message: VERIFY_FIRST }));
    const wrapper = await atLogin();
    await signInByPassword(wrapper);

    post.mockRejectedValueOnce(refused(null));
    const button = wrapper.get('[data-testid="login-resend-verification-button"]');
    (button.element as HTMLElement).focus();
    await button.trigger('click');
    await flushPromises();

    expect(document.activeElement).toBe(
      byTestId(wrapper, 'login-resend-verification-button').element,
    );
  });

  it('sends one link for a double click', async () => {
    post.mockRejectedValueOnce(refused(403, { message: VERIFY_FIRST }));
    const wrapper = await atLogin();
    await signInByPassword(wrapper);

    let answer!: (value: unknown) => void;
    post.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const button = wrapper.get('[data-testid="login-resend-verification-button"]');
    await button.trigger('click');
    await button.trigger('click');
    answer({ status: 200, data: {} });
    await flushPromises();

    expect(posts('/resend-verification')).toHaveLength(1);
  });

  it('offers the link on the code form too, when a code is asked for', async () => {
    post.mockRejectedValueOnce(refused(403, { msg: VERIFY_FIRST }));
    const wrapper = await atLogin();

    await askForACode(wrapper);

    expect(byTestId(wrapper, 'login-otp-error-message').text()).toBe(VERIFY_FIRST);
    post.mockResolvedValueOnce({ status: 200, data: {} });
    await wrapper.get('[data-testid="login-otp-resend-verification-button"]').trigger('click');
    await flushPromises();

    expect(posts('/resend-verification')[0][1]).toEqual({ email: ADDRESS });
    expect(byTestId(wrapper, 'login-otp-success-message').text()).toBe(RESENT);
    expect(shown(wrapper, 'login-otp-error-message')).toBe(false);
  });
});

describe('the code sign-in', () => {
  it('replaces the "code sent" line with a wrong code\'s, never showing both', async () => {
    post.mockResolvedValueOnce({ status: 200, data: { msg: CODE_SENT } });
    const wrapper = await atLogin();
    await askForACode(wrapper);
    expect(byTestId(wrapper, 'login-otp-success-message').text()).toBe(CODE_SENT);

    post.mockRejectedValueOnce(refused(401, { msg: WRONG_CODE }));
    await sendACode(wrapper, '000000');

    expect(shown(wrapper, 'login-otp-error-message')).toBe(true);
    expect(byTestId(wrapper, 'login-otp-error-message').text()).toBe(WRONG_CODE);
    expect(shown(wrapper, 'login-otp-success-message')).toBe(false);
    expect(byTestId(wrapper, 'login-otp-resend-verification-button').exists()).toBe(false);
  });

  it('says to wait after too many tries, offering nothing beside it', async () => {
    post.mockResolvedValueOnce({ status: 200, data: { msg: CODE_SENT } });
    const wrapper = await atLogin();
    await askForACode(wrapper);

    post.mockRejectedValueOnce(refused(429, { msg: TOO_MANY }));
    await sendACode(wrapper, '000000');

    expect(byTestId(wrapper, 'login-otp-error-message').text()).toBe(TOO_MANY);
    expect(byTestId(wrapper, 'login-otp-error-forgot-password-link').exists()).toBe(false);
    expect(byTestId(wrapper, 'login-otp-resend-verification-button').exists()).toBe(false);
  });

  it('clears the line when the address is changed', async () => {
    post.mockResolvedValueOnce({ status: 200, data: { msg: CODE_SENT } });
    const wrapper = await atLogin();
    await askForACode(wrapper);
    post.mockRejectedValueOnce(refused(401, { msg: WRONG_CODE }));
    await sendACode(wrapper, '000000');

    await wrapper.get('[data-testid="login-otp-different-email-button"]').trigger('click');
    await flushPromises();

    expect(shown(wrapper, 'login-otp-error-message')).toBe(false);
    expect(shown(wrapper, 'login-otp-success-message')).toBe(false);
  });
});
