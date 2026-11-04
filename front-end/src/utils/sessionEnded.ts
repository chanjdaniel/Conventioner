import type { Router } from 'vue-router';
import { useMarketStore } from '@/stores/market';
import { getApiErrorStatus, onSessionEnded } from '@/utils/api';
import { loginAddress } from '@/utils/signInNext';

/**
 * Forget the session this browser held and go to sign in again, carrying the page it was on so
 * signing in returns there (E38/F11/S01). `ended` says the session ended under the organizer, which
 * the sign-in page tells them.
 *
 * What is forgotten is what signing out forgets: `localStorage`, the stored user with it, and the
 * open market.
 */
export function endSession(router: Router, { ended }: { ended: boolean }): void {
  const here = router.currentRoute.value;
  localStorage.clear();
  useMarketStore().clear();
  void router.push(loginAddress(here.fullPath, { ended }));
}

/**
 * Sign out: tell the server, then forget what `endSession` forgets and go to sign in, whether or
 * not the server heard. A sign-out that failed on the wire still leaves this browser signed out to
 * whoever sits down at it next.
 *
 * `fetch`, not the app's `axios`: a 401 here is a session already over, not one that ended under
 * the organizer, and must not be told as one (`onSessionEnded`).
 */
export async function signOut(router: Router): Promise<void> {
  try {
    await fetch(`${import.meta.env.VITE_FLASK_HOST}/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch (error) {
    console.error('Logout failed:', error);
  }
  localStorage.clear();
  useMarketStore().clear();
  await router.push('/login');
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
