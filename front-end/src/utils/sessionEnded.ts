import type { Router } from 'vue-router';
import { useMarketStore } from '@/stores/market';
import { api, getApiErrorStatus, onSessionEnded } from '@/utils/api';
import { loginAddress } from '@/utils/signInNext';

/**
 * Forget what this browser holds of a session: `localStorage`, the stored user with it, and the open
 * market. A tab hears only another tab's change as a `storage` event, so this says so to its own, for
 * a session that ends with no navigation to read the stored user again on (a finished reset).
 */
export function forgetTheSession(): void {
  localStorage.clear();
  useMarketStore().clear();
  window.dispatchEvent(new StorageEvent('storage', { key: null }));
}

/**
 * Forget the session this browser held and go to sign in again, carrying the page it was on so
 * signing in returns there (E38/F11/S01). `ended` says the session ended under the organizer, which
 * the sign-in page tells them.
 */
export function endSession(router: Router, { ended }: { ended: boolean }): void {
  const here = router.currentRoute.value;
  forgetTheSession();
  void router.push(loginAddress(here.fullPath, { ended }));
}

/**
 * Tell the server this browser's session is over, whatever it answers: a failure on the wire is
 * logged and goes no further.
 *
 * `fetch`, not the app's `axios`: a 401 here is a session already over, not one that ended under
 * the organizer, and must not be told as one (`onSessionEnded`).
 */
export async function endTheSessionOnTheServer(): Promise<void> {
  try {
    await fetch(`${import.meta.env.VITE_FLASK_HOST}/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch (error) {
    console.error('Logout failed:', error);
  }
}

/**
 * Sign out: tell the server, then forget what `endSession` forgets and go to sign in, whether or
 * not the server heard. A sign-out that failed on the wire still leaves this browser signed out to
 * whoever sits down at it next.
 */
export async function signOut(router: Router): Promise<void> {
  await endTheSessionOnTheServer();
  forgetTheSession();
  await router.push('/login');
}

/**
 * What Sign out everywhere came to: `done`, every sign-in of the account ended, this browser's with
 * it; `ended`, a 401, so the session was already over and has ended here as any organizer request's
 * 401 ends it (`installSessionEnded`); `failed`, any other failure, the person still signed in here
 * and elsewhere.
 */
export type SignedOutEverywhere = 'done' | 'ended' | 'failed';

/**
 * Sign out everywhere: end every sign-in of the account on the server, then forget what
 * `endSession` forgets and go to sign in, which says the person is signed out on every device.
 *
 * Through the app's `api`, unlike `signOut`: a 401 is a session that ended under the organizer, and
 * is told as one. A failure forgets nothing, since the other devices are still signed in, and
 * the caller says so.
 */
export async function signOutEverywhere(router: Router): Promise<SignedOutEverywhere> {
  try {
    await api.post('/logout-everywhere');
  } catch (error) {
    return getApiErrorStatus(error) === 401 ? 'ended' : 'failed';
  }
  forgetTheSession();
  await router.push(loginAddress(null, { everywhere: true }));
  return 'done';
}

/**
 * What the shell makes of its session probe at load failing, and whether the session is kept.
 * No answer, or a fault on the server, says nothing of the session: the organizer stays on the
 * page, whose own read says what went wrong and offers Try again, and a request that answers 401
 * later ends the session then. Any other answer ends it, a 401 as a session that ended.
 */
export function keepsTheSession(router: Router, err: unknown): boolean {
  const status = getApiErrorStatus(err);
  if (status === null || status >= 500) return true;
  endSession(router, { ended: status === 401 });
  return false;
}

/**
 * A 401 from an organizer's request ends the session (`onSessionEnded`), unless the page is public:
 * a public page has no organizer session to end, and the sign-in page is one. Answers the function
 * that removes it.
 */
export function installSessionEnded(router: Router): () => void {
  return onSessionEnded(() => {
    const here = router.currentRoute.value;
    if (here.matched.some((record) => record.meta.public === true)) return;
    endSession(router, { ended: true });
  });
}
