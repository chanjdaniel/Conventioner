/**
 * The back end counts sign-in tries in fixed quarter-hour windows aligned to the clock
 * (`back-end/sign_in_limits.py`), so tries that straddle a window's end are counted in two windows,
 * and a spec that fills a limit and then meets it can find the next try in a fresh window, allowed.
 * A spec that fills a limit starts only when the window has room for the whole test.
 */
const WINDOW_MS = 15 * 60 * 1000;
const ROOM_MS = 60 * 1000;

/** How long `waitForRoomInWindow` can take at most; a test calling it raises its timeout by this. */
export const ROOM_IN_WINDOW_WAIT_MS = ROOM_MS + 1000;

/** Waits, when the current window has less than a minute left, until the next one has begun. */
export async function waitForRoomInWindow(): Promise<void> {
  const left = WINDOW_MS - (Date.now() % WINDOW_MS);
  if (left >= ROOM_MS) return;
  await new Promise((resolve) => setTimeout(resolve, left + 1000));
}
