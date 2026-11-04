/**
 * Where signing in continues to (E38/F11/S01): the page a signed-out link, or a session that ended
 * mid-work, was on, carried as `/login?next=<that page's full path>`.
 *
 * `next` is a value anyone can put in a link, so it is honoured only when it is a path of this app:
 * one leading `/` (not `//` or `/\`, which a browser reads as another host), no backslash or control
 * character anywhere, not the sign-in page itself, and resolving to this origin. Anything else is
 * dropped, and signing in goes to Markets.
 *
 * The sign-in page is any spelling the router matches as it: the router ignores case and one
 * trailing slash, so `/Login` and `/login/` are the sign-in page too.
 */
import type { LocationQueryValue, RouteLocationRaw } from 'vue-router';

const LOGIN_PATH = '/login';

const UNSAFE_CHARACTER = /[\\\u0000-\u001f\u007f]/;

/** Whether the router reads `path` as the sign-in page, whatever its case or trailing slash. */
function isSignInPath(path: string): boolean {
  return path.toLowerCase().replace(/\/$/, '') === LOGIN_PATH;
}

/** `next` when it is a same-origin path of this app, else null. */
export function safeNext(
  next: LocationQueryValue | LocationQueryValue[] | string | undefined,
): string | null {
  if (typeof next !== 'string') return null;
  if (!next.startsWith('/') || next.startsWith('//')) return null;
  if (UNSAFE_CHARACTER.test(next)) return null;
  let url: URL;
  try {
    url = new URL(next, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (isSignInPath(url.pathname)) return null;
  return next;
}

/** The sign-in page, carrying the page to return to when there is one, and why when it ended. */
export function loginAddress(
  fullPath: string,
  { ended = false }: { ended?: boolean } = {},
): RouteLocationRaw & { path: string; query: Record<string, string> } {
  const query: Record<string, string> = {};
  const next = safeNext(fullPath);
  if (next) query.next = next;
  if (ended) query.ended = '1';
  return { path: LOGIN_PATH, query };
}
