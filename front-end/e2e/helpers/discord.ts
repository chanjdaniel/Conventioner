import type { Page } from '@playwright/test';
import { mongoEval } from './mongo';

/**
 * Discord stands outside the stack, which runs without its values, so the specs that need it mock
 * it where the browser meets it (E46/F01/S03): the market is connected by writing its card's
 * choices, the market read says Discord is set up, and "Check Discord" is answered as the server
 * answers it, after writing to the market what that check keeps. The matching itself is the back
 * end's, pinned against a fake of Discord's API in `back-end/tests/test_discord_connection.py`.
 */

export type FoundState = 'has_role' | 'in_server' | 'not_found' | 'no_username';

/** A card's choices, with the username question the form asks it by. */
export const DISCORD_CONNECTION = {
  guildId: '2909267986263572999',
  guildName: 'Riverside Makers',
  roleId: '2909267986263573001',
  roleName: 'Vendor',
  usernameQuestion: 'discord_username',
};

const marketFilter = (marketId: string) => `{ id: ${JSON.stringify(marketId)} }`;

/** Connect the market to a server, its card holding these choices. */
export function connectDiscord(
  marketId: string,
  connection: Record<string, string> = DISCORD_CONNECTION,
): void {
  mongoEval(
    `db.markets.updateOne(${marketFilter(marketId)}, ` +
      `{ $set: { discord: ${JSON.stringify(connection)} } })`,
  );
}

/**
 * Say Discord is set up, and answer "Check Discord" with each application's state, `found` by its
 * id, keeping them on the market as the check does.
 */
export async function mockDiscordCheck(
  page: Page,
  marketId: string,
  found: Record<string, FoundState>,
): Promise<void> {
  await page.route(`**/markets/${marketId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.market.discordSetUp = true;
    await route.fulfill({ response, json: body });
  });
  await page.route(`**/markets/${marketId}/discord/check`, async (route) => {
    const checkedAt = new Date().toISOString();
    const vendorStates = Object.entries(found).map(([applicationId, state]) => ({
      applicationId,
      state,
    }));
    mongoEval(
      `db.markets.updateOne(${marketFilter(marketId)}, { $set: { 'discord.checkedAt': ${JSON.stringify(
        checkedAt,
      )}, 'discord.vendorStates': ${JSON.stringify(vendorStates)} } })`,
    );
    const counts = { has_role: 0, in_server: 0, not_found: 0, no_username: 0 };
    for (const state of Object.values(found)) counts[state] += 1;
    await route.fulfill({ json: { counts, checkedAt } });
  });
}
