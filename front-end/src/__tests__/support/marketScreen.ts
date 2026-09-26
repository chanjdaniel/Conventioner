/**
 * Mounting a market screen in a unit test (E21/F02/S02).
 *
 * A market screen is addressed by id and takes its market from the one store, which fetches it:
 * there is no `localStorage` market to plant any more. So a test routes the screen to an id, has
 * the mocked API serve that market, and waits for the store to receive it.
 */
import type { Mock } from 'vitest';

export const MARKET_ID = 'market-1';

/** The route a market page is mounted at: its id and its page in the path (E22/F04/S02). */
export function marketRoute(page: string = 'setup') {
  return { name: 'market-setup', params: { marketId: MARKET_ID, page }, query: {} };
}

/**
 * Have the mocked `api.get` serve `market` at `GET /markets/:id`, and hand every other URL to
 * `otherwise` - so a test that wants the application form to hang, or to answer, still can.
 */
export function serveMarket(
  get: Mock,
  market: Record<string, unknown>,
  otherwise: (url: string) => unknown = () => Promise.resolve({ data: {} }),
): void {
  get.mockImplementation((url: string) =>
    url === `/markets/${market.id}` ? Promise.resolve({ data: { market } }) : otherwise(url),
  );
}
