import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import { SEED_MARKET_DATE } from './helpers/seeds';
import { mongoEval } from './helpers/mongo';
import { connectDiscord, mockDiscordCheck, type FoundState } from './helpers/discord';
import { VendorsPage } from './pages/VendorsPage';

/**
 * Who is in the server (E46/F01/S03): "Check Discord" on the Vendors page shows each vendor's
 * Discord state, and the "Not found" filter lists exactly the vendors no member's username matched.
 *
 * Discord is mocked where the browser meets it (`helpers/discord.ts`).
 */
test('Check Discord shows each vendor’s state, and “Not found” lists exactly those vendors', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  // Two more vendors, so the filter leaves someone out on each side of it.
  for (const email of ['e2e-discord-cy@example.com', 'e2e-discord-dee@example.com']) {
    seedApprovedVendor(seed.marketId, email, { dates: [SEED_MARKET_DATE], tiers: ['Gold'] });
  }
  const applications = JSON.parse(
    mongoEval(
      `JSON.stringify(db.applications.find({ market_id: ${JSON.stringify(seed.marketId)} }, ` +
        `{ _id: 0, id: 1, applicant_email: 1 }).sort({ applicant_email: 1 }).toArray())`,
    ),
  ) as { id: string; applicant_email: string }[];
  expect(applications).toHaveLength(4);
  const [first, second, third, fourth] = applications;
  const found: Record<string, FoundState> = {
    [first.id]: 'has_role',
    [second.id]: 'not_found',
    [third.id]: 'in_server',
    [fourth.id]: 'not_found',
  };
  const notFound = [second.applicant_email, fourth.applicant_email];

  connectDiscord(seed.marketId);
  await mockDiscordCheck(page, seed.marketId, found);

  const vendors = new VendorsPage(page);
  await vendors.goto(seed.marketId);
  await expect(vendors.vendorListItems).toHaveCount(4, { timeout: 15000 });
  await expect(vendors.discordStates).toHaveCount(0);

  await vendors.checkDiscordButton.click();

  await expect(vendors.discordStates).toHaveCount(4);
  await expect(vendors.discordChecked).toHaveText('Checked just now');

  await vendors.discordFilter.selectOption('not_found');

  await expect(page).toHaveURL(/[?&]discord=not_found/);
  await expect(vendors.vendorListItems).toHaveCount(2);
  for (const email of notFound) {
    await expect(vendors.vendorListItems.filter({ hasText: email })).toHaveCount(1);
  }
  await expect(vendors.discordStates).toHaveText(['Discord: Not found', 'Discord: Not found']);
  await expect(vendors.summary).toContainText(/2\s+of\s+4\s+vendors shown/);

  // A link to the filter is a link: it holds through a reload.
  await page.reload();
  await expect(vendors.vendorListItems).toHaveCount(2, { timeout: 15000 });
  await expect(vendors.discordFilter).toHaveValue('not_found');
});
