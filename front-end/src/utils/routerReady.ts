import type { Router } from 'vue-router'

/**
 * The first navigation, settled - however it ended, asked as many times as anyone needs to ask.
 *
 * Every route component is lazily imported, so until the first navigation lands the router has
 * matched nothing, and every question the shell asks about the page it is painting - starting with
 * whether it is a public one - is a question about no page at all. So more than one caller has to
 * wait for this: the mount, and the session probe in `App.vue` that decides whether a visitor with no
 * organizer session belongs on the login screen.
 *
 * `router.isReady()` cannot serve both of them. When the first navigation *fails* - a lazy chunk a
 * deploy has replaced, a guard that threw - vue-router rejects every promise it has handed out,
 * empties the set that held them, and leaves the router not ready. A second `isReady()` then
 * registers a handler in that emptied set and waits for a navigation that has already happened and
 * that nothing is going to drive again: it never settles, neither resolving nor rejecting, and the
 * caller waiting on it never runs another line. For the session probe that means an organizer left on
 * an empty shell, never sent to `/login` - the recovery the mount's own tolerance of this failure
 * exists to make possible, lost one await later.
 *
 * So the first navigation is awaited exactly once per router and everyone shares that one answer,
 * which is also what makes the failure absorbable: it is reported and then let go of, because the
 * shell the router could not fill is the only surface left that could tell anybody what happened.
 *
 * The one thing this needs of its callers: the *first* call has to be made while the first navigation
 * is still in flight, which is what `main.ts` does - synchronously, in the same tick as `app.use`,
 * which is what starts it. A promise asked for after the failure is the promise that never settles,
 * and there is nothing this can do about that but be there first.
 */
const settledByRouter = new WeakMap<Router, Promise<void>>()

export function routerSettled(router: Router): Promise<void> {
  let settled = settledByRouter.get(router)
  if (!settled) {
    settled = router.isReady().catch((err: unknown) => {
      console.error('The first navigation failed; carrying on without it.', err)
    })
    settledByRouter.set(router, settled)
  }
  return settled
}
