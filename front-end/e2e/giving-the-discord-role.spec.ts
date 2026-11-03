import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import { SEED_MARKET_DATE } from './helpers/seeds';
import { marketScreenPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { connectToFakeDiscord, fakeDiscordId, seedFakeDiscordServer } from './helpers/fakeDiscord';
import { ToolsPage } from './pages/ToolsPage';
import { VendorsPage } from './pages/VendorsPage';
import { PHONE } from './helpers/screens';
import { widths } from './helpers/phoneWindow';
import {
  detectLayout,
  gates,
  minTargetAt,
  SPACE_SCALE,
  TYPE_SCALE,
} from './helpers/layoutDetectors';

/**
 * Giving the market's role (E46/F01/S04): "Give roles" on the Vendors page confirms by the role's
 * name and how many vendors hold a seat, then shows the run's report by group, and gives the role
 * once the organizer fixes what Discord refused.
 *
 * Every step is the stack's own: the run goes to a fake Discord server the stack answers for
 * (`DISCORD_FAKE`, `back-end/discord_fake.py`) through the bot client's real requests, and the
 * route, its row check, its write, the served report and the history are the back end's. The
 * fake refuses a role at or above the bot's highest, as Discord does, so the first run's failure
 * is a real refusal.
 */
const QUESTION = 'discord_username';
const ROLE_NAME = 'Vendor Nov 2026';

test('Give roles confirms, reports a refusal by group, and gives the role once it is fixed', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  // Approved after the run, so holding no seat: not one the confirmation counts or the run gives.
  seedApprovedVendor(seed.marketId, 'e2e-discord-unseated@example.com', {
    dates: [SEED_MARKET_DATE],
    tiers: ['Gold'],
    extra: { [QUESTION]: 'ash_unseated' },
  });
  const seated = JSON.parse(
    mongoEval(
      `JSON.stringify(db.applications.find({ market_id: ${JSON.stringify(seed.marketId)}, ` +
        `applicant_email: { $ne: 'e2e-discord-unseated@example.com' } }, ` +
        `{ _id: 0, id: 1, applicant_email: 1 }).sort({ applicant_email: 1 }).toArray())`,
    ),
  ) as { id: string; applicant_email: string }[];
  expect(seated).toHaveLength(2);
  const [fern, oak] = seated;
  // Fern wrote their username; Oak wrote their display name, so the run does not find them and
  // the check offers the member with that name as a possible match.
  for (const [vendor, answer] of [
    [fern, 'fern_studio_42'],
    [oak, 'Oak & Co'],
  ] as const) {
    mongoEval(
      `db.applications.updateOne({ id: ${JSON.stringify(vendor.id)} }, ` +
        `{ $set: { 'form_data.${QUESTION}': ${JSON.stringify(answer)} } })`,
    );
  }

  const guildId = fakeDiscordId();
  const roleId = fakeDiscordId();
  const botRoleId = fakeDiscordId();
  seedFakeDiscordServer({
    guildId,
    name: 'Riverside Makers',
    // The bot's role sits below the market's, so Discord refuses every grant.
    roles: [
      { id: botRoleId, name: 'Conventioner', position: 1 },
      { id: roleId, name: ROLE_NAME, position: 2 },
    ],
    botRoles: [botRoleId],
    members: [
      { id: '1001', username: 'fern_studio_42', globalName: 'Fern Studio' },
      { id: '1002', username: 'oak_and_co', globalName: 'Oak & Co' },
      { id: '1003', username: 'ash_unseated' },
    ],
  });
  connectToFakeDiscord(seed.marketId, {
    guildId,
    guildName: 'Riverside Makers',
    roleId,
    roleName: ROLE_NAME,
  });
  const memberRoles = (memberId: string): string[] =>
    JSON.parse(
      mongoEval(
        `JSON.stringify(db.fake_discord_servers.findOne({ guildId: ${JSON.stringify(guildId)} })` +
          `.members.find((m) => m.user.id === ${JSON.stringify(memberId)}).roles)`,
      ),
    );

  const vendors = new VendorsPage(page);
  const summary = page.getByTestId('vendors-role-report-summary');
  const groups = page.getByTestId('vendors-role-report-group');
  const dialog = page.getByTestId('give-roles-window');
  await vendors.goto(seed.marketId);
  await expect(vendors.vendorListItems).toHaveCount(3, { timeout: 15000 });
  await expect(
    vendors.giveRolesButton,
    'the stack answers for Discord only with DISCORD_FAKE=true (docs/TESTING.md)',
  ).toBeVisible();
  await expect(vendors.roleReport).toHaveCount(0);

  await vendors.giveRolesButton.click();

  await expect(dialog).toContainText(`Give ${ROLE_NAME} to 2 assigned vendors?`);
  await expect(dialog).toContainText('never takes a role away');
  await page.getByTestId('give-roles-submit-button').click();

  // Discord refused the grant: Fern failed with the fix in words, and Oak, not found, has the
  // possible match their row shows.
  await expect(dialog).toHaveCount(0);
  await expect(vendors.roleReport).toContainText(`${ROLE_NAME}, last run just now`);
  await expect(summary).toHaveText('1 not found (1 possible match), 1 failed');
  await page.getByTestId('vendors-role-report-toggle').click();
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toContainText('Not found');
  await expect(groups.nth(0)).toContainText(oak.applicant_email);
  await expect(groups.nth(0).getByTestId('vendors-role-report-matches')).toHaveText(
    '1 has a possible match to confirm or decline.',
  );
  await expect(groups.nth(1)).toContainText('Failed');
  await expect(groups.nth(1)).toContainText(fern.applicant_email);
  await expect(groups.nth(1).getByTestId('vendors-role-report-reason')).toHaveText(
    `Conventioner's role is below ${ROLE_NAME}, or may not manage roles. In Discord, open ` +
      'Server Settings, then Roles, and drag the Conventioner role above it.',
  );
  await expect(
    vendors.vendorListItems
      .filter({ hasText: oak.applicant_email })
      .getByTestId('vendors-list-discord'),
  ).toHaveText('Discord: Possible match');
  expect(memberRoles('1001')).toEqual([]);

  // On the phone at the door (T180): the report, its groups open, and the rows' Discord states
  // keep the window's width and are laid out as the layout sweep holds a screen (the screens seed
  // connects no Discord), and Give roles opens inside the window.
  const desk = page.viewportSize()!;
  await page.setViewportSize(PHONE);
  expect(await widths(page), 'Vendors with the role report keeps the window').toMatchObject({
    layout: PHONE.width,
    sideways: 0,
  });
  const findings = await page.evaluate(detectLayout, {
    spaceScale: SPACE_SCALE,
    textScale: TYPE_SCALE,
    minTarget: minTargetAt(PHONE.width),
  });
  expect(
    findings.filter((f) => gates(f, PHONE.width)).map((f) => `${f.kind} ${f.el}: ${f.detail}`),
    'Vendors with Discord at 390x844 has layout findings',
  ).toEqual([]);
  await vendors.giveRolesButton.click();
  const box = (await dialog.boundingBox())!;
  expect(box.x, 'Give roles starts inside the window').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, 'Give roles ends inside the window').toBeLessThanOrEqual(PHONE.width);
  expect(box.y + box.height, 'Give roles ends inside the window').toBeLessThanOrEqual(PHONE.height);
  await page.getByTestId('give-roles-cancel-button').click();
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize(desk);

  // In Discord, the organizer drags the Conventioner role above the market's, and runs again.
  mongoEval(
    `db.fake_discord_servers.updateOne({ guildId: ${JSON.stringify(guildId)}, ` +
      `'roles.id': ${JSON.stringify(botRoleId)} }, { $set: { 'roles.$.position': 3 } })`,
  );
  await vendors.giveRolesButton.click();
  await page.getByTestId('give-roles-submit-button').click();

  await expect(dialog).toHaveCount(0);
  await expect(summary).toHaveText('1 given, 1 not found (1 possible match)');
  expect(memberRoles('1001')).toEqual([roleId]);
  // A run gives only to a vendor holding a seat.
  expect(memberRoles('1003')).toEqual([]);

  // The report is the market's: it holds through a reload.
  await page.reload();
  await expect(summary).toHaveText('1 given, 1 not found (1 possible match)', { timeout: 15000 });

  // The run is in the vendor's own history, with who gave it.
  await vendors.vendorListItems.filter({ hasText: fern.applicant_email }).click();
  await vendors.openTab('history');
  await expect(vendors.detailHistorySentences.first()).toHaveText(
    `${TEST_USER.email} gave the Discord role “${ROLE_NAME}”`,
  );
});

test('with nothing missing, the card leads to Give roles, on a phone as on a desk', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const guildId = fakeDiscordId();
  const roleId = fakeDiscordId();
  const botRoleId = fakeDiscordId();
  seedFakeDiscordServer({
    guildId,
    name: 'Riverside Makers',
    roles: [
      { id: roleId, name: ROLE_NAME, position: 1 },
      { id: botRoleId, name: 'Conventioner', position: 2 },
    ],
    botRoles: [botRoleId],
    members: [],
  });
  connectToFakeDiscord(seed.marketId, {
    guildId,
    guildName: 'Riverside Makers',
    roleId,
    roleName: ROLE_NAME,
  });

  const tools = new ToolsPage(page);
  await tools.goto(seed.marketId);
  await expect(tools.givingVendorsLink).toHaveText('Give roles on Vendors', { timeout: 15000 });
  await expect(tools.giving).toContainText(
    'Check who is in the server and give roles on the Vendors page.',
  );
  await expect(tools.givingItems).toHaveCount(0);

  const desk = page.viewportSize()!;
  await page.setViewportSize(PHONE);
  const link = (await tools.givingVendorsLink.boundingBox())!;
  expect(link.height, 'the link is a full target on a phone').toBeGreaterThanOrEqual(44);
  expect(await widths(page), 'the Tools tab with its link keeps the window').toMatchObject({
    layout: PHONE.width,
    sideways: 0,
  });
  const findings = await page.evaluate(detectLayout, {
    spaceScale: SPACE_SCALE,
    textScale: TYPE_SCALE,
    minTarget: minTargetAt(PHONE.width),
  });
  expect(
    findings.filter((f) => gates(f, PHONE.width)).map((f) => `${f.kind} ${f.el}: ${f.detail}`),
    'the Tools tab with its link at 390x844 has layout findings',
  ).toEqual([]);
  await page.setViewportSize(desk);

  await tools.givingVendorsLink.click();
  await expect(page).toHaveURL(new RegExp(`${marketScreenPath(seed.marketId, 'vendors')}$`));
  await expect(new VendorsPage(page).giveRolesButton).toBeVisible({ timeout: 15000 });
});
