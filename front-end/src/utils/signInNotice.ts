import { getApiErrorMessage, getApiErrorStatus } from '@/utils/api';

/**
 * The one line a sign-in form says (E38/F14/S02), and what it offers to do next: reset the
 * password, or send the verification link again.
 */
export interface SignInNotice {
  tone: 'error' | 'success';
  text: string;
  next?: 'reset' | 'resend';
}

/** What "Send the link again" says once it is sent, whatever the server said of the address. */
export const LINK_RESENT = 'If that address needs verifying, a new link is on its way.';

/**
 * A refused sign-in, said in the server's words, with what to do next: a 403 is an address that
 * needs verifying, and on the password sign-in a 401 is an email and password that do not match
 * and a 429 too many tries, both of which offer the reset.
 *
 * An answer that never came and a server's fault say what `api.ts` says of every request. The
 * account endpoints word a refusal as `message` or `msg`, which `api.ts` does not read, so a
 * refusal's sentence is read here.
 */
export function refusedSignIn(
  err: unknown,
  fallback: string,
  { offersReset = false } = {},
): SignInNotice {
  const status = getApiErrorStatus(err);
  if (status === null || status >= 500) {
    return { tone: 'error', text: getApiErrorMessage(err, fallback) };
  }
  const text = serverSentence(err) ?? fallback;
  if (status === 403) return { tone: 'error', text, next: 'resend' };
  if ((status === 401 || status === 429) && offersReset) {
    return { tone: 'error', text, next: 'reset' };
  }
  return { tone: 'error', text };
}

/**
 * What "Send the link again" says of its answer: any refusal is said as a link on its way, since
 * the screen never says whether an address has an account, except a 429, a link asked for too
 * often, which says the server's sentence with how long to wait and offers nothing beside it; an
 * answer that never came or a server's fault says so, and offers the link again.
 */
export function resentLink(err: unknown | null): SignInNotice {
  const status = err === null ? 200 : getApiErrorStatus(err);
  if (status === 429) {
    return {
      tone: 'error',
      text: serverSentence(err) ?? 'You have asked several times. Try again later.',
    };
  }
  if (status !== null && status < 500) return { tone: 'success', text: LINK_RESENT };
  return {
    tone: 'error',
    text: getApiErrorMessage(err, 'The link was not sent. Try again.'),
    next: 'resend',
  };
}

/** The sentence an account endpoint's refusal says, under `message` or `msg`, if any. */
function serverSentence(err: unknown): string | undefined {
  const data = (err as { response?: { data?: { message?: unknown; msg?: unknown } } }).response
    ?.data;
  return [data?.message, data?.msg].find((s): s is string => typeof s === 'string' && s !== '');
}
