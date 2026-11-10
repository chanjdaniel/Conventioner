import axios from 'axios';

/**
 * `withCredentials` is the whole of the client's side of authentication: the session cookie says
 * who the caller is, and the back end reads it and nothing else.
 *
 * This used to also send an `X-Owner-Email` header read from localStorage, and the back end
 * authorized against *that* (E07/F01/S02). A value the browser sets cannot prove identity, so any
 * signed-in user could act as any other by changing it. The header is no longer read by anything;
 * do not reintroduce it, and do not add another one like it.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_FLASK_HOST,
  withCredentials: true,
});

export const OFFLINE_MESSAGE = 'You seem to be offline. Check the connection and try again.';
export const SERVER_FAULT_MESSAGE = 'Something went wrong on our side. Try again in a moment.';
export const SESSION_ENDED_MESSAGE = 'Your session has ended. Sign in again.';

/** The sentence a refusal carries, when the server wrote one. */
function sentenceOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const { error, message } = data as { error?: unknown; message?: unknown };
  if (typeof error === 'string' && error) return error;
  if (typeof message === 'string' && message) return message;
  return null;
}

/**
 * What a failed request says, chosen by its kind, and only here (E38/F11/S01).
 *
 * - No answer at all: the connection, whatever the screen was doing.
 * - A 500: the server's fault, whatever its body says. The back end answers every unexpected
 *   exception `{"error": "Internal server error"}`, 500, which is for logs, never an organizer.
 * - Another 5xx: its own sentence when the back end wrote one (Discord's 502 and 503, which say
 *   what is wrong in Conventioner's words), else the server's fault too (a proxy's 502 or 504).
 * - A 401 with no sentence of its own (Flask-Login's): the session has ended. The response
 *   interceptor below also takes the organizer to sign in again.
 * - Any other refusal: its own sentence, a 401's included (the applicant's code check words its
 *   own), else `fallback`, which a screen words as what did not happen ("The verdict was not
 *   saved.").
 *
 * Anything that is not a request's failure reads as `fallback` too.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (!axios.isAxiosError(err) || axios.isCancel(err)) return fallback;
  return answerMessage(err.response, fallback);
}

/**
 * `getApiErrorMessage` for an answer already in hand: none at all, or its status and its body,
 * which a download reads out of the blob it asked for.
 */
export function answerMessage(
  response: { status: number; data?: unknown } | undefined,
  fallback: string,
): string {
  if (!response) return OFFLINE_MESSAGE;
  if (response.status === 500) return SERVER_FAULT_MESSAGE;
  const sentence = sentenceOf(response.data);
  if (sentence) return sentence;
  if (response.status >= 500) return SERVER_FAULT_MESSAGE;
  if (response.status === 401) return SESSION_ENDED_MESSAGE;
  return fallback;
}

/** The HTTP status of a caught request error, or null when it never reached the server. */
export function getApiErrorStatus(err: unknown): number | null {
  return axios.isAxiosError(err) ? (err.response?.status ?? null) : null;
}

/**
 * The requests whose 401 is not a session that ended: signing in, whose 401 is a wrong password or
 * code; the shell's session probe, which answers for itself; and every applicant and door request
 * (`/public/...`), which carries no organizer session: the applicant signs in on their own pages.
 */
const SIGN_IN_PATHS = new Set(['/login', '/login-otp', '/request-otp', '/register', '/logout']);
const SESSION_PROBE_PATH = '/check-session';

function endsTheSession(url: string | undefined): boolean {
  if (!url) return true;
  const path = new URL(url, 'http://request.invalid').pathname;
  if (path.startsWith('/public/')) return false;
  return !SIGN_IN_PATHS.has(path) && path !== SESSION_PROBE_PATH;
}

/**
 * Run `handler` when an organizer's request answers 401: their session has ended (E38/F11/S01).
 * The request still fails as it would have, so the screen's own catch runs too. A response
 * interceptor only: nothing is added to a request (see the note on `api`). Answers the function
 * that removes it.
 */
export function onSessionEnded(handler: () => void): () => void {
  const id = api.interceptors.response.use(undefined, (err: unknown) => {
    if (
      axios.isAxiosError(err) &&
      err.response?.status === 401 &&
      endsTheSession(err.config?.url)
    ) {
      handler();
    }
    return Promise.reject(err);
  });
  return () => api.interceptors.response.eject(id);
}

/** The `code` of the back end's one 409 for a write over a market that changed (`MarketChanged`). */
export const MARKET_CHANGED_CODE = 'market_changed';

/**
 * Whether a failed request is a write the server refused because the market changed since the
 * request read it (`back-end/market_write.py`): a 409 whose body's `code` is `market_changed`. It
 * stored nothing; its sentence is the server's, which `getApiErrorMessage` reads as it reads any
 * refusal.
 */
export function isMarketChanged(err: unknown): boolean {
  if (!axios.isAxiosError(err) || err.response?.status !== 409) return false;
  const data: unknown = err.response.data;
  return (
    !!data && typeof data === 'object' && (data as { code?: unknown }).code === MARKET_CHANGED_CODE
  );
}

/**
 * Run `handler` when a request answers that the market changed under it (`isMarketChanged`). The
 * request still fails as it would have, so the screen's own catch runs too and shows the sentence.
 * A response interceptor only, as `onSessionEnded` is. Answers the function that removes it.
 */
export function onMarketChanged(handler: () => void): () => void {
  const id = api.interceptors.response.use(undefined, (err: unknown) => {
    if (isMarketChanged(err)) handler();
    return Promise.reject(err);
  });
  return () => api.interceptors.response.eject(id);
}
