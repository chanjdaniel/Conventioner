import type { Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import { SEED_MARKET_DATE } from './helpers/seeds';
import { marketScreenPath } from './helpers/marketScreens';
import { grantMarketRole } from './helpers/grantMarketRole';
import { mongoEval } from './helpers/mongo';
import {
  connectToFakeDiscord,
  fakeDiscordId,
  removeFakeDiscordServer,
  seedFakeDiscordServer,
} from './helpers/fakeDiscord';
import { ToolsPage } from './pages/ToolsPage';
import { VendorsPage } from './pages/VendorsPage';
import { PHONE } from './helpers/screens';
import { widths } from './helpers/phoneWindow';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
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
/** A Viewer of the market, whom the "Connect Discord and give roles" row refuses. */
const VIEWER = { email: 'e2e-discord-row-viewer@example.com', password: 'e2epassword123' };

/** Connect the market to a server of its own, no one in it, with nothing left to choose. */
function connectWithNoMembers(marketId: string): string {
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
  connectToFakeDiscord(marketId, {
    guildId,
    guildName: 'Riverside Makers',
    roleId,
    roleName: ROLE_NAME,
  });
  return guildId;
}

/** The window keeps its width and the page is laid out as the layout sweep holds a screen. */
async function expectLaidOutOnAPhone(page: Page, what: string) {
  expect(await widths(page), `${what} keeps the window`).toMatchObject({
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
    `${what} at 390x844 has layout findings`,
  ).toEqual([]);
}

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
  await expectLaidOutOnAPhone(page, 'Vendors with the role report');
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
  connectWithNoMembers(seed.marketId);

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
  await expectLaidOutOnAPhone(page, 'the Tools tab with its link');
  await page.setViewportSize(desk);

  await tools.givingVendorsLink.click();
  await expect(page).toHaveURL(new RegExp(`${marketScreenPath(seed.marketId, 'vendors')}$`));
  await expect(new VendorsPage(page).giveRolesButton).toBeVisible({ timeout: 15000 });
});

/** Where each thing on the Vendors page's Discord row stands, once it is on the page. */
async function boxOf(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = (await locator.boundingBox())!;
  return { ...box, right: box.x + box.width, bottom: box.y + box.height };
}

/** The row with the filter and all three actions on it. */
async function rowBoxes(vendors: VendorsPage) {
  return {
    row: await boxOf(vendors.discordRow),
    filter: await boxOf(vendors.discordFilter),
    checked: await boxOf(vendors.discordChecked),
    check: await boxOf(vendors.checkDiscordButton),
    give: await boxOf(vendors.giveRolesButton),
  };
}

/** Two edges are one edge, to within a rounding of the layout. */
function sameEdge(actual: number, expected: number, what: string) {
  expect(Math.abs(actual - expected), `${what}: ${actual} and ${expected}`).toBeLessThan(1);
}

/** The filter at the left, then "Checked…" and the buttons at the far right, on one line. */
async function expectTheRowOnOneLine(vendors: VendorsPage) {
  const { row, filter, checked, check, give } = await rowBoxes(vendors);
  sameEdge(filter.x, row.x, 'the filter starts the row');
  sameEdge(give.right, row.right, '"Give roles" ends the row');
  expect(filter.right, 'the filter stands left of the actions').toBeLessThan(checked.x);
  expect(checked.right, '"Checked…" before "Check Discord"').toBeLessThanOrEqual(check.x);
  expect(check.right, '"Check Discord" before "Give roles"').toBeLessThanOrEqual(give.x);
  for (const [what, box] of [
    ['"Checked…"', checked],
    ['"Check Discord"', check],
    ['"Give roles"', give],
  ] as const) {
    sameEdge(box.bottom, filter.bottom, `${what} stands on the filter's line`);
  }
}

/** The filter, then "Checked…" under it, then the two buttons under that, each at the line's start. */
async function expectTheRowStacked(vendors: VendorsPage) {
  const { row, filter, checked, check, give } = await rowBoxes(vendors);
  sameEdge(filter.x, row.x, 'the filter starts its line');
  sameEdge(checked.x, row.x, '"Checked…" starts its line');
  sameEdge(check.x, row.x, '"Check Discord" starts its line');
  expect(checked.y, '"Checked…" stands under the filter').toBeGreaterThanOrEqual(filter.bottom);
  expect(check.y, 'the buttons stand under "Checked…"').toBeGreaterThanOrEqual(checked.bottom);
  sameEdge(give.y, check.y, '"Give roles" stands beside "Check Discord"');
  expect(give.right, '"Give roles" stays on the row').toBeLessThanOrEqual(row.right);
}

test('the Discord row reads filter, then actions, with its error on a row of its own', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const guildId = connectWithNoMembers(seed.marketId);

  const vendors = new VendorsPage(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await vendors.goto(seed.marketId);
  await expect(vendors.giveRolesButton).toBeVisible({ timeout: 15000 });

  // Before the first check: no filter and no "Checked…", and the buttons at the far right already.
  await expect(vendors.discordFilter).toHaveCount(0);
  await expect(vendors.discordChecked).toHaveCount(0);
  const beforeCheck = await boxOf(vendors.checkDiscordButton);
  const beforeGive = await boxOf(vendors.giveRolesButton);
  sameEdge(beforeGive.right, (await boxOf(vendors.discordRow)).right, '"Give roles" ends the row');
  expect(beforeCheck.right, '"Check Discord" before "Give roles"').toBeLessThanOrEqual(
    beforeGive.x,
  );

  await vendors.checkDiscordButton.click();
  await expect(vendors.discordChecked).toHaveText('Checked just now');
  await expectTheRowOnOneLine(vendors);
  const { check: afterCheck, give: afterGive } = await rowBoxes(vendors);
  sameEdge(afterCheck.x, beforeCheck.x, 'the filter appearing leaves "Check Discord" where it was');
  sameEdge(afterGive.x, beforeGive.x, 'the filter appearing leaves "Give roles" where it was');

  // On a phone the actions take their own lines under the filter, and the page keeps the window.
  await page.setViewportSize(PHONE);
  await expectTheRowStacked(vendors);
  await expectLaidOutOnAPhone(page, 'Vendors with the Discord row');
  await page.setViewportSize({ width: 320, height: 640 });
  await expectTheRowStacked(vendors);

  // Discord no longer knows the server, so the back end refuses the next check.
  removeFakeDiscordServer(guildId);
  await page.setViewportSize({ width: 1280, height: 800 });
  await vendors.checkDiscordButton.click();
  await expect(vendors.discordError).toBeVisible();
  await expectTheRowOnOneLine(vendors);
  const expectTheErrorOnItsOwnRow = async () => {
    const row = await boxOf(vendors.discordRow);
    const error = await boxOf(vendors.discordError);
    sameEdge(error.x, row.x, 'the error starts its row');
    sameEdge(error.right, row.right, 'the error has its row to itself');
    expect(error.y, 'the error stands under the buttons').toBeGreaterThanOrEqual(
      (await boxOf(vendors.giveRolesButton)).bottom,
    );
  };
  await expectTheErrorOnItsOwnRow();
  await page.setViewportSize(PHONE);
  await expectTheRowStacked(vendors);
  await expectTheErrorOnItsOwnRow();
  await page.setViewportSize({ width: 320, height: 640 });
  await expectTheRowStacked(vendors);
  await expectTheErrorOnItsOwnRow();
});

test.beforeAll(() => {
  ensureVerifiedUser(VIEWER.email, VIEWER.password);
});

test('someone the row refuses reads the filter at the left and “Checked…” at the far right', async ({
  authenticatedPage: page,
  browser,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const guildId = fakeDiscordId();
  seedFakeDiscordServer({ guildId, name: 'Riverside Makers', members: [] });
  connectToFakeDiscord(seed.marketId, { guildId, guildName: 'Riverside Makers' });
  await grantMarketRole(request, seed.marketId, VIEWER, 'viewer');

  // The owner runs the check, so the Viewer reads when it ran.
  const owner = new VendorsPage(page);
  await owner.goto(seed.marketId);
  await owner.checkDiscordButton.click({ timeout: 15000 });
  await expect(owner.discordChecked).toHaveText('Checked just now');

  await withUser(browser, VIEWER.email, VIEWER.password, async (viewerPage) => {
    const vendors = new VendorsPage(viewerPage);
    await viewerPage.setViewportSize({ width: 1280, height: 800 });
    await vendors.goto(seed.marketId);
    await expect(vendors.discordChecked).toBeVisible({ timeout: 15000 });
    await expect(vendors.checkDiscordButton).toHaveCount(0);
    await expect(vendors.giveRolesButton).toHaveCount(0);

    const row = await boxOf(vendors.discordRow);
    const filter = await boxOf(vendors.discordFilter);
    const checked = await boxOf(vendors.discordChecked);
    sameEdge(filter.x, row.x, 'the filter starts the row');
    sameEdge(checked.right, row.right, '"Checked…" ends the row');
    sameEdge(checked.bottom, filter.bottom, '"Checked…" stands on the filter\'s line');

    await viewerPage.setViewportSize(PHONE);
    const phoneFilter = await boxOf(vendors.discordFilter);
    const phoneChecked = await boxOf(vendors.discordChecked);
    sameEdge(phoneChecked.x, phoneFilter.x, '"Checked…" starts its line on a phone');
    expect(phoneChecked.y, '"Checked…" stands under the filter on a phone').toBeGreaterThanOrEqual(
      phoneFilter.bottom,
    );
  });
});
