import type { HistoryState, Router } from 'vue-router';

/**
 * The `history.state` key that carries the responses file a market was just drafted from, from the
 * start's confirm to the Questions tab it lands on (T205/F20), as `vendorDrawer.ts` marks its
 * entries.
 *
 * Never in the address and never stored: the file is not kept, and its name is said only on the
 * arrival that follows the confirm.
 */
const DRAFTED_FROM = 'draftedFrom';

/** The state the start's confirm pushes the Questions tab with. */
export function draftedFromState(fileName: string): HistoryState {
  return { [DRAFTED_FROM]: fileName };
}

/**
 * The file this entry was drafted from, read once: the entry's mark is cleared as it is read, since
 * a browser keeps an entry's state across a reload and Back or Forward to it, where the notice must
 * not come back.
 */
export function takeDraftedFrom(router: Router, fullPath: string): string | null {
  const name = router.options.history.state[DRAFTED_FROM];
  if (typeof name !== 'string' || !name) return null;
  router.options.history.replace(fullPath, { [DRAFTED_FROM]: null });
  return name;
}
