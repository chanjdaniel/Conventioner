import axios, {
  AxiosError,
  type AxiosRequestTransformer,
  type InternalAxiosRequestConfig,
} from 'axios';

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
  // After axios's own, so the body is measured as it is sent, its JSON already written.
  transformRequest: [...defaultTransforms(), refuseWhatTheHostWould],
});

export const OFFLINE_MESSAGE = 'You seem to be offline. Check the connection and try again.';
export const SERVER_FAULT_MESSAGE = 'Something went wrong on our side. Try again in a moment.';
export const SESSION_ENDED_MESSAGE = 'Your session has ended. Sign in again.';
export const REQUEST_TOO_LARGE_MESSAGE = 'This was larger than the 4.5 MB one request can carry.';

/**
 * The host's limit on a request's body, 4.5 MB read as 4,500,000 bytes: `MAX_REQUEST_BODY_BYTES` in
 * `back-end/host_limits.py`, which holds a local stack's back end to it.
 */
export const MAX_REQUEST_BODY_BYTES = 4_500_000;
/** The `code` of a request the client refused to send, its body over the host's limit. */
export const REQUEST_TOO_LARGE_CODE = 'ERR_REQUEST_TOO_LARGE';

function defaultTransforms(): AxiosRequestTransformer[] {
  const transforms = axios.defaults.transformRequest;
  if (!transforms) return [];
  return Array.isArray(transforms) ? transforms : [transforms];
}

/** Whether a string passes the limit as the UTF-8 bytes it is sent as. */
function textPassesTheLimit(text: string): boolean {
  // Each UTF-16 unit is one to three bytes in UTF-8, so only a string between the two is encoded.
  if (text.length > MAX_REQUEST_BODY_BYTES) return true;
  if (text.length * 3 <= MAX_REQUEST_BODY_BYTES) return false;
  return new TextEncoder().encode(text).byteLength > MAX_REQUEST_BODY_BYTES;
}

/**
 * Whether a body, as axios sends it, passes the host's limit. A form is counted by its fields' and
 * files' bytes alone, its multipart framing left out, so nothing within the limit is refused.
 */
function passesTheHostsLimit(data: unknown): boolean {
  if (typeof data === 'string') return textPassesTheLimit(data);
  if (data instanceof Blob) return data.size > MAX_REQUEST_BODY_BYTES;
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
    return data.byteLength > MAX_REQUEST_BODY_BYTES;
  if (data instanceof URLSearchParams) return textPassesTheLimit(data.toString());
  if (data instanceof FormData) {
    let bytes = 0;
    for (const [, value] of data.entries()) {
      bytes += typeof value === 'string' ? new TextEncoder().encode(value).byteLength : value.size;
      if (bytes > MAX_REQUEST_BODY_BYTES) return true;
    }
  }
  return false;
}

/**
 * Refuse a body the host would refuse, before it is sent (T315). In production the API is on
 * another origin, and the host refuses a body over 4.5 MB itself, before the back end runs, with a
 * 413 that carries no CORS header: the browser hides that answer from the page, which would read
 * it as no answer at all and tell the organizer they seem to be offline. Refused here, the request
 * fails as a refusal `getApiErrorMessage` words as too large to carry.
 */
function refuseWhatTheHostWould(this: InternalAxiosRequestConfig, data: unknown): unknown {
  if (passesTheHostsLimit(data)) {
    throw new AxiosError(REQUEST_TOO_LARGE_MESSAGE, REQUEST_TOO_LARGE_CODE, this);
  }
  return data;
}

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
 * - A body the client refused to send, over the host's 4.5 MB (`refuseWhatTheHostWould`): too
 *   large to carry, so trying again cannot help.
 * - A 413 the page can read with no sentence of its own (a proxy's that sends CORS headers): the
 *   same. Production's host answers its own 413 with no CORS header, so that one reaches the page
 *   as no answer at all, a failed connection; the client's refusal above is what keeps a body over
 *   4.5 MB from meeting it.
 * - Any other refusal: its own sentence, a 401's included (the applicant's code check words its
 *   own), else `fallback`, which a screen words as what did not happen ("The verdict was not
 *   saved.").
 *
 * Anything that is not a request's failure reads as `fallback` too.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (!axios.isAxiosError(err) || axios.isCancel(err)) return fallback;
  if (err.code === REQUEST_TOO_LARGE_CODE) return REQUEST_TOO_LARGE_MESSAGE;
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
  if (response.status === 413) return REQUEST_TOO_LARGE_MESSAGE;
  return fallback;
}

/** The HTTP status of a caught request error, or null when it never reached the server. */
export function getApiErrorStatus(err: unknown): number | null {
  return axios.isAxiosError(err) ? (err.response?.status ?? null) : null;
}

/** The `code` of the back end's one 409 for a change to an organization's people that met another. */
export const ORGANIZATION_CHANGED_CODE = 'organization_changed';

/**
 * Whether a failed request is a change to an organization's people that the server refused because
 * someone else changed the same people since it was read (`back-end/organization_people.py`): a
 * 409 whose body's `code` is `organization_changed`. It stored nothing; its sentence is the
 * server's, which `getApiErrorMessage` reads as it reads any refusal.
 */
export function isOrganizationChanged(err: unknown): boolean {
  if (!axios.isAxiosError(err) || err.response?.status !== 409) return false;
  const data: unknown = err.response.data;
  return (
    !!data &&
    typeof data === 'object' &&
    (data as { code?: unknown }).code === ORGANIZATION_CHANGED_CODE
  );
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

/** The `code` of the placement doors' 409 for a vendor who has checked in that day (`VendorIsHere`). */
export const VENDOR_IS_HERE_CODE = 'vendor_is_here';

/**
 * Whether a failed request is a free, a move or a swap the server asked about first, because a
 * vendor it changes has checked in that day (`back-end/api/placements.py`, T318): a 409 whose body's
 * `code` is `vendor_is_here`. It stored nothing and nothing changed, so the screen asks with the
 * server's sentence and sends the same request again with `whileHere: true`.
 */
export function isVendorHere(err: unknown): boolean {
  if (!axios.isAxiosError(err) || err.response?.status !== 409) return false;
  const data: unknown = err.response.data;
  return (
    !!data && typeof data === 'object' && (data as { code?: unknown }).code === VENDOR_IS_HERE_CODE
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
