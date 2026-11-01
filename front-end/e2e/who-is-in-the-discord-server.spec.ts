import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import { SEED_MARKET_DATE } from './helpers/seeds';
import { mongoEval } from './helpers/mongo';
import { connectToFakeDiscord, fakeDiscordId, seedFakeDiscordServer } from './helpers/fakeDiscord';
import { VendorsPage } from './pages/VendorsPage';

/**
 * Who is in the server (E46/F01/S03): "Check Discord" on the Vendors page shows each vendor's
 * Discord state, and the "Not found" filter lists exactly the vendors no member's username matched.
 *
 * The check is the back end's own, run against a fake Discord server the stack answers for
 * (`DISCORD_FAKE`, `back-end/discord_fake.py`): its members read through the bot client's real
 * requests, matched to each vendor's answer by username alone.
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
  // Each vendor's username as they wrote it: one holds the role, one is in the server without it,
  // and two no member has.
  const usernames = ['Maple.Crafts#1234', 'nobody.here', 'oak.and.co', 'ghost.vendor'];
  applications.forEach(({ id }, n) => {
    mongoEval(
      `db.applications.updateOne({ id: ${JSON.stringify(id)} }, ` +
        `{ $set: { 'form_data.discord_username': ${JSON.stringify(usernames[n])} } })`,
    );
  });
  const notFound = [applications[1].applicant_email, applications[3].applicant_email];

  const guildId = fakeDiscordId();
  const roleId = fakeDiscordId();
  const botRoleId = fakeDiscordId();
  seedFakeDiscordServer({
    guildId,
    name: 'Riverside Makers',
    roles: [
      { id: roleId, name: 'Vendor', position: 1 },
      { id: botRoleId, name: 'Conventioner', position: 2 },
    ],
    botRoles: [botRoleId],
    members: [
      { id: '1001', username: 'maple.crafts', roles: [roleId] },
      { id: '1002', username: 'oak.and.co' },
      { id: '1003', username: 'someone.else', globalName: 'Someone' },
    ],
  });
  connectToFakeDiscord(seed.marketId, {
    guildId,
    guildName: 'Riverside Makers',
    roleId,
    roleName: 'Vendor',
  });

  const vendors = new VendorsPage(page);
  await vendors.goto(seed.marketId);
  await expect(vendors.vendorListItems).toHaveCount(4, { timeout: 15000 });
  await expect(vendors.discordStates).toHaveCount(0);
  await expect(
    vendors.checkDiscordButton,
    'the stack answers for Discord only with DISCORD_FAKE=true (docs/TESTING.md)',
  ).toBeVisible();

  await vendors.checkDiscordButton.click();

  await expect(vendors.discordStates).toHaveCount(4);
  await expect(vendors.discordChecked).toHaveText('Checked just now');
  const chip = (email: string) =>
    vendors.vendorListItems.filter({ hasText: email }).getByTestId('vendors-list-discord');
  await expect(chip(applications[0].applicant_email)).toHaveText('Discord: Has the role');
  await expect(chip(applications[2].applicant_email)).toHaveText('Discord: In the server');

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
