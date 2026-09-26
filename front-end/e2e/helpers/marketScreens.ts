import type { Page } from '@playwright/test';

/**
 * Where a market's screens live (E21/F02/S02).
 *
 * Every market screen is addressed by id, and takes its market from the server. A spec used to
 * write a market into `localStorage` and go to `/market-setup`, which carried no id; it names the
 * market in the URL now, the way a bookmark or a shared link would.
 */
export function marketSetupPath(marketId: string, tab?: string): string {
  const base = `/markets/${encodeURIComponent(marketId)}/setup`;
  return tab ? `${base}?tab=${tab}` : base;
}

/** Open a market's setup screen, on a tab when one is named. */
export async function openMarketSetup(page: Page, marketId: string, tab?: string): Promise<void> {
  await page.goto(marketSetupPath(marketId, tab));
}

/** Matches the URL of any market's setup screen, for `waitForURL` after a redirect lands there. */
export const MARKET_SETUP_URL = /\/markets\/[^/]+\/setup(\?.*)?$/;

/** Any of a market's screens by id: `vendors`, `import`, `floorplan`, `tables`, `attendance`. */
export function marketScreenPath(
  marketId: string,
  screen: 'vendors' | 'import' | 'floorplan' | 'tables' | 'attendance',
): string {
  return `/markets/${encodeURIComponent(marketId)}/${screen}`;
}
