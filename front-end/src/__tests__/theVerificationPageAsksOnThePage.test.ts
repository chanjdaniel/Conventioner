// @vitest-environment happy-dom
/**
 * The page a verification link opens asks for the address on the page itself when the link fails,
 * never in a browser prompt, and says its answer as the sign-in page says it (`resentLink`):
 *
 * - "Send the link again" sends one link for a double click;
 * - any refusal under 500 reads as a link on its way, since the page never says whether an address
 *   has an account, but asking too often, which says how long to wait and keeps the form;
 * - a server's fault or no answer keeps the form, with the address typed, and says so;
 * - an empty address is refused under the field, and nothing is sent;
 * - "Redirecting to sign in…" follows only a verification, which then goes to `/login`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { AxiosError, AxiosHeaders } from 'axios';

const post = vi.fn();
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, post: (...a: unknown[]) => post(...a) } };
});

import EmailVerificationView from '@/views/EmailVerificationView.vue';
import { LINK_RESENT, resentLink } from '@/utils/signInNotice';
import { OFFLINE_MESSAGE } from '@/utils/api';

const ADDRESS = 'organizer@example.com';
const INVALID = 'Invalid verification token';
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

async function atVerify(token: string | null = 'a-token') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/verify-email', component: EmailVerificationView },
      { path: '/login', component: Page },
    ],
  });
  await router.push(token === null ? '/verify-email' : `/verify-email?token=${token}`);
  const wrapper = mount(EmailVerificationView, {
    global: { plugins: [router] },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, router };
}

type Wrapper = Awaited<ReturnType<typeof atVerify>>['wrapper'];

const byTestId = (wrapper: Wrapper, testid: string) => wrapper.find(`[data-testid="${testid}"]`);

/** What the user can see: an element drawn, and not hidden by `v-show`. */
function shown(wrapper: Wrapper, testid: string): boolean {
  const found = byTestId(wrapper, testid);
  return found.exists() && (found.element as HTMLElement).style.display !== 'none';
}

/** The link failed: the page settles on the refusal and the form that answers it. */
async function aFailedLink() {
  post.mockRejectedValueOnce(refused(400, { msg: INVALID }));
  return atVerify();
}

async function sendTheLinkAgain(wrapper: Wrapper, address = ADDRESS) {
  await wrapper.get('[data-testid="email-verification-email-input"]').setValue(address);
  await wrapper.get('[data-testid="email-verification-resend-form"]').trigger('submit');
  await flushPromises();
}

function posts(path: string) {
  return post.mock.calls.filter(([url]) => String(url).endsWith(path));
}

beforeEach(() => {
  // happy-dom has no `prompt`; one the page opens throws, and fails the test.
  vi.stubGlobal('prompt', () => {
    throw new Error('the page opened a browser prompt');
  });
});

afterEach(() => {
  post.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('a link that failed', () => {
  it('says why, and asks for the address in a named field with "Send the link again"', async () => {
    const { wrapper } = await aFailedLink();

    expect(byTestId(wrapper, 'email-verification-error-message').text()).toBe(INVALID);
    const input = wrapper.get('[data-testid="email-verification-email-input"]');
    expect(input.classes()).toContain('field');
    expect(input.attributes('type')).toBe('email');
    const label = wrapper.get(`label[for="${input.attributes('id')}"]`);
    expect(label.text()).toBe('Email');
    expect(byTestId(wrapper, 'email-verification-resend-button').text()).toBe(
      'Send the link again',
    );
    expect(wrapper.text()).not.toContain('Redirecting');
  });

  it('asks the same when the address has no token at all, sending nothing to verify', async () => {
    const { wrapper } = await atVerify(null);

    expect(posts('/verify-email')).toHaveLength(0);
    expect(shown(wrapper, 'email-verification-error-message')).toBe(true);
    expect(byTestId(wrapper, 'email-verification-email-input').exists()).toBe(true);
  });

  it('offers "Back to sign in" as a link to /login', async () => {
    const { wrapper } = await aFailedLink();

    const back = byTestId(wrapper, 'email-verification-back-link');
    expect(back.element.tagName).toBe('A');
    expect(back.attributes('href')).toBe('/login');
    expect(back.text()).toBe('Back to sign in');
  });
});

describe('"Send the link again"', () => {
  it('sends the typed address, then says a new link is on its way, and never that it redirects', async () => {
    const { wrapper, router } = await aFailedLink();

    post.mockResolvedValueOnce({ status: 200, data: { msg: 'Verification email sent' } });
    await sendTheLinkAgain(wrapper);

    expect(posts('/resend-verification')).toHaveLength(1);
    expect(posts('/resend-verification')[0][1]).toEqual({ email: ADDRESS });
    expect(byTestId(wrapper, 'email-verification-resent-message').text()).toBe(LINK_RESENT);
    expect(shown(wrapper, 'email-verification-error-message')).toBe(false);
    expect(byTestId(wrapper, 'email-verification-resend-form').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Redirecting');
    expect(router.currentRoute.value.path).toBe('/verify-email');
  });

  it('moves focus to "Back to sign in" once the form is gone, so it never falls to the page', async () => {
    const { wrapper } = await aFailedLink();

    post.mockResolvedValueOnce({ status: 200, data: { msg: 'Verification email sent' } });
    const input = wrapper.get('[data-testid="email-verification-email-input"]');
    (input.element as HTMLInputElement).focus();
    await sendTheLinkAgain(wrapper);

    expect(byTestId(wrapper, 'email-verification-resend-form').exists()).toBe(false);
    expect(document.activeElement).toBe(byTestId(wrapper, 'email-verification-back-link').element);
  });

  it('says a link is on its way after a 400, whatever the server said of the address', async () => {
    const { wrapper } = await aFailedLink();

    post.mockRejectedValueOnce(refused(400, { msg: 'Email already verified' }));
    await sendTheLinkAgain(wrapper);

    expect(byTestId(wrapper, 'email-verification-resent-message').text()).toBe(LINK_RESENT);
    expect(shown(wrapper, 'email-verification-error-message')).toBe(false);
  });

  it('says how long to wait after asking too often, and keeps the form and the focus in it', async () => {
    const { wrapper } = await aFailedLink();

    post.mockRejectedValueOnce(refused(429, { msg: ASKED_TOO_OFTEN }));
    const input = wrapper.get('[data-testid="email-verification-email-input"]');
    (input.element as HTMLInputElement).focus();
    await sendTheLinkAgain(wrapper);

    expect(byTestId(wrapper, 'email-verification-error-message').text()).toBe(ASKED_TOO_OFTEN);
    expect(shown(wrapper, 'email-verification-resent-message')).toBe(false);
    expect((input.element as HTMLInputElement).value).toBe(ADDRESS);
    expect(document.activeElement).toBe(input.element);
  });

  it("keeps the form with the address on a server's fault, and says what the sign-in page says", async () => {
    const { wrapper } = await aFailedLink();

    const fault = refused(500, { msg: 'Failed to send verification email' });
    post.mockRejectedValueOnce(fault);
    await sendTheLinkAgain(wrapper);

    expect(byTestId(wrapper, 'email-verification-error-message').text()).toBe(
      resentLink(fault).text,
    );
    expect(shown(wrapper, 'email-verification-resent-message')).toBe(false);
    const input = wrapper.get('[data-testid="email-verification-email-input"]');
    expect((input.element as HTMLInputElement).value).toBe(ADDRESS);
    expect(
      wrapper.get('[data-testid="email-verification-resend-button"]').attributes('disabled'),
    ).toBeUndefined();
  });

  it('keeps the form when no answer came, and says so', async () => {
    const { wrapper } = await aFailedLink();

    post.mockRejectedValueOnce(refused(null));
    await sendTheLinkAgain(wrapper);

    expect(byTestId(wrapper, 'email-verification-error-message').text()).toBe(OFFLINE_MESSAGE);
    expect(byTestId(wrapper, 'email-verification-resend-form').exists()).toBe(true);
  });

  it('says "The link was not sent. Try again." when the request failed outside axios', async () => {
    const { wrapper } = await aFailedLink();

    post.mockRejectedValueOnce(new Error('not a request'));
    await sendTheLinkAgain(wrapper);

    expect(byTestId(wrapper, 'email-verification-error-message').text()).toBe(
      'The link was not sent. Try again.',
    );
    expect(byTestId(wrapper, 'email-verification-resend-form').exists()).toBe(true);
  });

  it('sends one link for a double click', async () => {
    const { wrapper } = await aFailedLink();

    let answer!: (value: unknown) => void;
    post.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await wrapper.get('[data-testid="email-verification-email-input"]').setValue(ADDRESS);
    const form = wrapper.get('[data-testid="email-verification-resend-form"]');
    await form.trigger('submit');
    await form.trigger('submit');
    expect(
      wrapper.get('[data-testid="email-verification-resend-button"]').attributes('disabled'),
    ).toBeDefined();
    answer({ status: 200, data: {} });
    await flushPromises();

    expect(posts('/resend-verification')).toHaveLength(1);
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
  ])('refuses an address that is %s under the field, sending nothing', async (_n, typed) => {
    const { wrapper } = await aFailedLink();

    await sendTheLinkAgain(wrapper, typed);

    expect(posts('/resend-verification')).toHaveLength(0);
    const input = wrapper.get('[data-testid="email-verification-email-input"]');
    const fieldError = wrapper.get('[data-testid="email-verification-email-error"]');
    expect(fieldError.text()).toBe('Type your email address.');
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('aria-describedby')).toBe(fieldError.attributes('id'));
    expect(document.activeElement).toBe(input.element);
    // The link's refusal still stands above it: the field's message is its own.
    expect(byTestId(wrapper, 'email-verification-error-message').text()).toBe(INVALID);

    await input.setValue(ADDRESS);
    expect(byTestId(wrapper, 'email-verification-email-error').exists()).toBe(false);
    expect(input.attributes('aria-invalid')).toBeUndefined();
  });
});

describe('a link that worked', () => {
  it('says so, then "Redirecting to sign in…", and goes to /login after its pause', async () => {
    vi.useFakeTimers();
    post.mockResolvedValueOnce({ status: 200, data: { msg: 'Email verified successfully' } });
    const { wrapper, router } = await atVerify();

    expect(byTestId(wrapper, 'email-verification-success-message').text()).toBe(
      'Email verified successfully',
    );
    expect(byTestId(wrapper, 'email-verification-redirecting').text()).toBe(
      'Redirecting to sign in…',
    );
    expect(byTestId(wrapper, 'email-verification-resend-form').exists()).toBe(false);
    expect(router.currentRoute.value.path).toBe('/verify-email');

    await vi.advanceTimersByTimeAsync(3000);
    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('does not take someone who left the page to sign in after the pause', async () => {
    vi.useFakeTimers();
    post.mockResolvedValueOnce({ status: 200, data: { msg: 'Email verified successfully' } });
    const { wrapper, router } = await atVerify();

    // Unmounting resets the router's current route, so the test watches for a push instead.
    const push = vi.spyOn(router, 'push');
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(3000);
    expect(push).not.toHaveBeenCalled();
  });
});
