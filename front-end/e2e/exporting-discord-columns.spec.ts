import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import { SEED_MARKET_DATE } from './helpers/seeds';
import { mongoEval } from './helpers/mongo';
import { connectDiscord, mockDiscordCheck, type FoundState } from './helpers/discord';
import { VendorsPage } from './pages/VendorsPage';
import { VendorExportDialog } from './pages/VendorExportDialog';

/**
 * The export's Discord columns (E42/F01/S05): "please fix your Discord username" is one export.
 *
 * Four vendors, each with a Discord username on the form; a check finds two of them nowhere in the
 * server, one of whose usernames an organizer has since updated. The Vendors page's "Not found"
 * filter, then Export, downloads exactly those two with their names, addresses and usernames, the
 * updated one as updated. Discord is mocked where the browser meets it (`helpers/discord.ts`).
 */
test('Export from “Not found” downloads exactly the vendors the page shows as not found', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const market = `{ id: ${JSON.stringify(marketId)} }`;
  // The form asks for the username the card names, as "Add Discord username" asks it.
  mongoEval(
    `db.markets.updateOne(${market}, { $push: { 'applicationForm.fields': ${JSON.stringify({
      key: 'discord_username',
      label: 'Discord Username',
      type: 'text',
      required: false,
      options: [],
      order: 99,
    })} } })`,
  );
  for (const [email, username] of [
    ['e2e-discord-cy@example.com', 'cy.ceramics'],
    ['e2e-discord-dee@example.com', 'dee_prints'],
  ]) {
    seedApprovedVendor(marketId, email, {
      dates: [SEED_MARKET_DATE],
      tiers: ['Gold'],
      extra: { discord_username: username },
    });
  }
  for (const [email, username] of [
    ['alice@example.com', 'alice.makes'],
    ['bob@example.com', 'bobb'],
  ]) {
    mongoEval(
      `db.applications.updateOne({ market_id: ${JSON.stringify(marketId)}, applicant_email: ` +
        `${JSON.stringify(email)} }, { $set: { 'form_data.discord_username': ` +
        `${JSON.stringify(username)} } })`,
    );
  }
  // Bob wrote his username wrong, and an organizer has updated it since.
  mongoEval(
    `db.applications.updateOne({ market_id: ${JSON.stringify(marketId)}, applicant_email: ` +
      `'bob@example.com' }, { $set: { answer_updates: { discord_username: ${JSON.stringify({
        value: 'bob.bakes',
        by: { user_id: null, email: TEST_USER.email },
        at: '2026-10-30T12:00:00Z',
        over: 'bobb',
      })} } } })`,
  );

  const applications = JSON.parse(
    mongoEval(
      `JSON.stringify(db.applications.find({ market_id: ${JSON.stringify(marketId)} }, ` +
        `{ _id: 0, id: 1, applicant_email: 1 }).toArray())`,
    ),
  ) as { id: string; applicant_email: string }[];
  expect(applications).toHaveLength(4);
  const states: Record<string, FoundState> = {
    'alice@example.com': 'has_role',
    'bob@example.com': 'not_found',
    'e2e-discord-cy@example.com': 'in_server',
    'e2e-discord-dee@example.com': 'not_found',
  };
  connectDiscord(marketId);
  await mockDiscordCheck(
    page,
    marketId,
    Object.fromEntries(applications.map((a) => [a.id, states[a.applicant_email]!])),
  );

  const vendors = new VendorsPage(page);
  await vendors.goto(marketId);
  await expect(vendors.vendorListItems).toHaveCount(4, { timeout: 15000 });
  await vendors.checkDiscordButton.click();
  await expect(vendors.discordStates).toHaveCount(4);
  await vendors.discordFilter.selectOption('not_found');
  await expect(vendors.vendorListItems).toHaveCount(2);
  // The rows the page lists, by the address each shows.
  const listed = await vendors.vendorListItems.allTextContents();
  const shown = Object.keys(states)
    .filter((email) => listed.some((text) => text.includes(email)))
    .sort();
  expect(shown).toEqual(['bob@example.com', 'e2e-discord-dee@example.com']);

  await vendors.exportButton.click();
  const dialog = new VendorExportDialog(page);
  await expect(dialog.window).toBeVisible();
  await expect(dialog.discordState('not_found')).toBeChecked();
  await expect(dialog.discordState('in_server')).not.toBeChecked();
  await expect(dialog.group('discord')).toContainText('Discord username');
  await expect(dialog.group('answers')).not.toContainText('Discord Username');

  await dialog.column('status').uncheck();
  await dialog.column('discordUsername').check();
  await expect(dialog.summary).toHaveText('2 vendors, 3 columns');
  await expect(dialog.previewHeader).toHaveText(/^Name\s*Email\s*Discord username$/);

  const { text } = await dialog.download();
  const lines = text.slice(1).trim().split(/\r?\n/);
  expect(lines[0]).toBe('Name,Email,Discord username');
  const rows = lines
    .slice(1)
    .map((line) => line.split(','))
    .sort((a, b) => a[1]!.localeCompare(b[1]!));
  expect(rows.map((row) => row[1])).toEqual(shown);
  expect(rows.map((row) => row[2])).toEqual(['bob.bakes', 'dee_prints']);
  for (const row of rows) expect(row[0]).not.toBe('');
});
