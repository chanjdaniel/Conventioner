import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import { SEED_MARKET_DATE } from './helpers/seeds';
import { mongoEval } from './helpers/mongo';
import { VendorsPage } from './pages/VendorsPage';

/**
 * Giving the market's role (E46/F01/S04): "Give roles" on the Vendors page confirms by the role's
 * name and how many vendors hold a seat, then shows the run's report by group.
 *
 * Discord stands outside the stack, which runs without its values, so it is mocked where the
 * browser meets it: the market read says Discord is set up, and the run is answered as the server
 * answers it, after writing to the market what that run keeps. Who is given the role is the back
 * end's, pinned against a fake of Discord's API in `back-end/tests/test_discord_connection.py`.
 */
test('Give roles confirms by the role and the seated vendors, then reports by group', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  // Approved after the run, so holding no seat: not one the confirmation counts.
  seedApprovedVendor(seed.marketId, 'e2e-discord-unseated@example.com', {
    dates: [SEED_MARKET_DATE],
    tiers: ['Gold'],
  });
  const seated = JSON.parse(
    mongoEval(
      `JSON.stringify(db.applications.find({ market_id: ${JSON.stringify(seed.marketId)}, ` +
        `applicant_email: { $ne: 'e2e-discord-unseated@example.com' } }, ` +
        `{ _id: 0, id: 1, applicant_email: 1 }).sort({ applicant_email: 1 }).toArray())`,
    ),
  ) as { id: string; applicant_email: string }[];
  expect(seated).toHaveLength(2);
  const [first, second] = seated;
  const reason =
    "Conventioner's role is below Vendor Nov 2026, or may not manage roles. In Discord, open " +
    'Server Settings, then Roles, and drag the Conventioner role above it.';

  const connection = {
    guildId: '2909267986263572999',
    guildName: 'Riverside Makers',
    roleId: '2909267986263573001',
    roleName: 'Vendor Nov 2026',
    usernameQuestion: 'discord_username',
  };
  const marketFilter = `{ id: ${JSON.stringify(seed.marketId)} }`;
  mongoEval(
    `db.markets.updateOne(${marketFilter}, { $set: { discord: ${JSON.stringify(connection)} } })`,
  );

  await page.route(`**/markets/${seed.marketId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.market.discordSetUp = true;
    await route.fulfill({ response, json: body });
  });
  let runs = 0;
  await page.route(`**/markets/${seed.marketId}/discord/role-run`, async (route) => {
    runs += 1;
    const ranAt = new Date().toISOString();
    const roleRun = {
      ranAt,
      roleName: 'Vendor Nov 2026',
      outcomes: [
        { applicationId: first.id, outcome: 'given', reason: null },
        { applicationId: second.id, outcome: 'failed', reason },
      ],
    };
    mongoEval(
      `db.markets.updateOne(${marketFilter}, { $set: { 'discord.roleRun': ${JSON.stringify(
        roleRun,
      )} } })`,
    );
    await route.fulfill({
      json: {
        counts: { given: 1, already_had: 0, not_found: 0, no_username: 0, not_yet: 0, failed: 1 },
        ranAt,
      },
    });
  });

  const vendors = new VendorsPage(page);
  await vendors.goto(seed.marketId);
  await expect(vendors.vendorListItems).toHaveCount(3, { timeout: 15000 });
  await expect(vendors.roleReport).toHaveCount(0);

  await vendors.giveRolesButton.click();

  const dialog = page.getByTestId('give-roles-window');
  await expect(dialog).toContainText('Give Vendor Nov 2026 to 2 assigned vendors?');
  await expect(dialog).toContainText('never takes a role away');
  expect(runs).toBe(0);

  await page.getByTestId('give-roles-submit-button').click();

  await expect(dialog).toHaveCount(0);
  expect(runs).toBe(1);
  await expect(vendors.roleReport).toContainText('Vendor Nov 2026, last run just now');
  await expect(page.getByTestId('vendors-role-report-summary')).toHaveText('1 given, 1 failed');

  await page.getByTestId('vendors-role-report-toggle').click();

  const groups = page.getByTestId('vendors-role-report-group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toContainText('Given');
  await expect(groups.nth(0)).toContainText(first.applicant_email);
  await expect(groups.nth(1)).toContainText('Failed');
  await expect(groups.nth(1)).toContainText(second.applicant_email);
  await expect(groups.nth(1).getByTestId('vendors-role-report-reason')).toHaveText(reason);

  // The report is the market's: it holds through a reload.
  await page.reload();
  await expect(page.getByTestId('vendors-role-report-summary')).toHaveText('1 given, 1 failed', {
    timeout: 15000,
  });
});
