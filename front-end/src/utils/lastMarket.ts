/**
 * Which market this browser last opened, for the dashboard's "continue where you left off"
 * (E21/F02/S05).
 *
 * A POINTER, never a copy. Nothing about a market is kept in the browser: the whole market used to
 * live in `localStorage` under `market`, written by eleven call sites and read by five screens,
 * which is how screens came to show a market the server had moved on from. This keeps only the id,
 * and the dashboard asks the server what that market is now.
 *
 * Storage can be unavailable (private mode, a full quota), and losing the pointer costs only a
 * convenience, so every access is allowed to fail quietly.
 */
const LAST_MARKET_KEY = 'lastMarketId';

export function lastMarketId(): string | null {
  try {
    return localStorage.getItem(LAST_MARKET_KEY);
  } catch {
    return null;
  }
}

export function rememberLastMarket(id: string): void {
  try {
    localStorage.setItem(LAST_MARKET_KEY, id);
  } catch {
    // A convenience, not a record: nothing depends on it being written.
  }
}

export function forgetLastMarket(): void {
  try {
    localStorage.removeItem(LAST_MARKET_KEY);
  } catch {
    // As above.
  }
}
