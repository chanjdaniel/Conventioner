import { test, expect, TEST_USER, BACKEND_URL, ApplicationFormPage } from './fixtures';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { seedPhaseMarket } from './helpers/seedPhaseMarket';
import { ensureTestOrg } from './helpers/seeds';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { fakeDiscordId, seedFakeDiscordServer } from './helpers/fakeDiscord';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { PHONE } from './helpers/screens';
import { widths } from './helpers/phoneWindow';
import {
  detectLayout,
  gates,
  minTargetAt,
  SPACE_SCALE,
  TYPE_SCALE,
} from './helpers/layoutDetectors';
import { ToolsPage } from './pages/ToolsPage';

/**
 * The Tools tab (E46/F01/S02): the manual tools an organizer runs in any phase, just left of Stats
 * on the market bar, at its own address. It holds the Discord card, which Market Setup no longer
 * shows; and the form builder offers a one-click question for each vendor's Discord username.
 *
 * The card is met here connected by a row written to the market, as the connection's routes leave
 * it, to a server no Discord answers for (a stack runs without Discord's values, with fixture ones,
 * or with the fake of `DISCORD_FAKE`, which has no such server): either way someone the row refuses
 * reads the card. Where a spec saves a choice, the server is one the fake answers for, so the
 * refusal and the role are the back end's own.
 */
const VIEWER = { email: 'e2e-tools-viewer@example.com', password: 'e2etoolsviewer1' };

/** A market connected to a server the fake answers for, with nothing chosen; its role's id. */
function connectWithNothingChosen(marketId: string): string {
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
    members: [],
  });
  mongoEval(
    `db.markets.updateOne({ id: ${JSON.stringify(marketId)} }, { $set: { discord: ${JSON.stringify({
      guildId,
      guildName: 'Riverside Makers',
    })} } })`,
  );
  return roleId;
}

test.beforeAll(async ({ request }) => {
  await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
});

test('the Discord card stands on the Tools tab, left of Stats, and no longer on Market Setup', async ({
  authenticatedPage: page,
  browser,
  request,
}) => {
  ensureVerifiedUser(VIEWER.email, VIEWER.password);
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  mongoEval(
    `db.markets.updateOne({ id: ${JSON.stringify(marketId)} }, { $set: { discord: ${JSON.stringify({
      guildId: '2909267986263572999',
      guildName: 'Riverside Makers',
      roleId: '2909267986263573001',
      roleName: 'Vendor',
      inviteLink: 'https://discord.gg/riverside',
    })} } })`,
  );
  const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: VIEWER.email, role: 'viewer' },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();

  await page.goto(marketSetupPath(marketId, 'setup'));
  await expect(page.getByTestId('plan-card-dates')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('plan-card-discord')).toHaveCount(0);
  const tabs = page.getByTestId('market-bar-tabs').locator('[data-testid^="market-bar-tab-"]');
  await expect(tabs.nth(5)).toHaveText('Tools');
  await expect(tabs.nth(6)).toHaveText('Stats');

  // Reached from the bar, at its own address, and a refresh keeps it.
  const tools = new ToolsPage(page);
  await page.getByTestId('market-bar-tab-tools').click();
  await expect(page).toHaveURL(new RegExp(`/markets/${marketId}/tools$`));
  await expect(page.getByTestId('market-bar-tab-tools')).toHaveClass(/active/);
  await expect(tools.serverName).toHaveText('Riverside Makers');
  await page.reload();
  await expect(tools.serverName).toHaveText('Riverside Makers', { timeout: 15000 });

  // A Viewer reads the card, with no control.
  await withUser(browser, VIEWER.email, VIEWER.password, async (viewer) => {
    const theirs = new ToolsPage(viewer);
    await theirs.goto(marketId);
    await expect(theirs.serverName).toHaveText('Riverside Makers', { timeout: 15000 });
    await expect(theirs.roleValue).toHaveText('Vendor');
    await expect(theirs.inviteValue).toHaveText('https://discord.gg/riverside');
    await expect(theirs.discordCard.getByRole('button')).toHaveCount(0);
  });
});

test('a half-typed invite link is refused in its own words, and stays to be finished', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  const guildId = fakeDiscordId();
  const roleId = fakeDiscordId();
  const botRoleId = fakeDiscordId();
  seedFakeDiscordServer({
    guildId,
    name: 'Riverside Makers',
    // The role sits above the bot's, so the warning that follows choosing it shows the re-read.
    roles: [
      { id: botRoleId, name: 'Conventioner', position: 1 },
      { id: roleId, name: 'Vendor', position: 2 },
    ],
    botRoles: [botRoleId],
    members: [],
  });
  mongoEval(
    `db.markets.updateOne({ id: ${JSON.stringify(marketId)} }, { $set: { discord: ${JSON.stringify({
      guildId,
      guildName: 'Riverside Makers',
    })} } })`,
  );

  const tools = new ToolsPage(page);
  await tools.goto(marketId);
  await expect(
    tools.roleOption(roleId),
    'the stack answers for Discord only with DISCORD_FAKE=true (docs/TESTING.md)',
  ).toBeAttached({ timeout: 15000 });

  // Left half-typed: the words under the choices, and the text still there to be finished.
  await tools.leaveInviteLink('discord.gg/abc');
  await expect(tools.inviteError).toHaveText(
    'An invite link is a web address starting https://, like https://discord.gg/abc123.',
  );
  await expect(tools.inviteInput).toHaveValue('discord.gg/abc');

  // A role saved meanwhile re-reads the market, and says nothing of the link, still not saved.
  await tools.roleSelect.selectOption(roleId);
  await expect(tools.roleWarning).toBeVisible();
  await expect(tools.inviteInput).toHaveValue('discord.gg/abc');
  await expect(tools.inviteError).toBeVisible();

  // Finished, it saves, the words go, and a reload shows it.
  await tools.leaveInviteLink('https://discord.gg/abc');
  await expect(tools.inviteError).toHaveCount(0);
  await page.reload();
  await expect(tools.inviteInput).toHaveValue('https://discord.gg/abc', { timeout: 15000 });

  // Refused again, then cleared: the words go, and a reload shows no link stored.
  await tools.leaveInviteLink('discord.gg/abc');
  await expect(tools.inviteError).toBeVisible();
  await tools.leaveInviteLink('');
  await expect(tools.inviteError).toHaveCount(0);
  await expect(tools.inviteInput).toHaveValue('');
  await page.reload();
  await expect(tools.roleSelect).toHaveValue(roleId, { timeout: 15000 });
  await expect(tools.inviteInput).toHaveValue('');
});

test('the card says where roles are given, and walks what is missing down to the assignment', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  const roleId = connectWithNothingChosen(marketId);
  const tools = new ToolsPage(page);
  const address = new RegExp(`${marketScreenPath(marketId, 'tools')}$`);
  await tools.goto(marketId);
  await expect(
    tools.roleOption(roleId),
    'the stack answers for Discord only with DISCORD_FAKE=true (docs/TESTING.md)',
  ).toBeAttached({ timeout: 15000 });

  await expect(tools.giving).toContainText(
    'Check who is in the server and give roles on the Vendors page.',
  );
  await expect(tools.givingItems).toHaveText([
    'Choose the role to give',
    'Choose the question that asks their Discord username',
    'Make the assignment',
  ]);
  await expect(tools.givingVendorsLink).toHaveCount(0);

  // Each item takes the organizer to its select, on this card, and goes once its choice has saved.
  await tools.givingNeedsRole.click();
  await expect(tools.roleSelect).toBeFocused();
  await expect(page).toHaveURL(address);
  await page.keyboard.press('Escape');
  await tools.roleSelect.selectOption(roleId);
  await expect(tools.givingNeedsRole).toHaveCount(0);

  await tools.givingNeedsQuestion.click();
  await expect(tools.questionSelect).toBeFocused();
  await expect(page).toHaveURL(address);
  await page.keyboard.press('Escape');
  await tools.questionSelect.selectOption('name');
  await expect(tools.givingNeedsQuestion).toHaveCount(0);
  await expect(tools.givingItems).toHaveText(['Make the assignment']);

  // A draft cannot run one yet: the link leads where Vendors' own "Nothing assigned yet" does.
  await tools.givingNeedsAssignment.click();
  await expect(page).toHaveURL(new RegExp(`${marketScreenPath(marketId, 'settings')}$`));
});

test('a form with no text question sends the organizer to the form, not an empty select', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  const roleId = connectWithNothingChosen(marketId);
  const tools = new ToolsPage(page);
  await tools.goto(marketId);
  await expect(tools.roleOption(roleId)).toBeAttached({ timeout: 15000 });

  await expect(tools.givingNeedsQuestion).toHaveText(
    'Add a question that asks their Discord username',
  );
  await tools.givingNeedsQuestion.click();
  await expect(page).toHaveURL(new RegExp(`${marketScreenPath(marketId, 'form')}$`));
});

test('the checklist fits a phone, each link a full target', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  const roleId = connectWithNothingChosen(marketId);
  const tools = new ToolsPage(page);
  await page.setViewportSize(PHONE);
  await tools.goto(marketId);
  await expect(tools.roleOption(roleId)).toBeAttached({ timeout: 15000 });
  await expect(tools.giving).toBeVisible();

  for (const link of [
    tools.givingNeedsRole,
    tools.givingNeedsQuestion,
    tools.givingNeedsAssignment,
  ]) {
    const box = (await link.boundingBox())!;
    expect(box.height, await link.innerText()).toBeGreaterThanOrEqual(44);
  }
  const card = (await tools.discordCard.boundingBox())!;
  const block = (await tools.giving.boundingBox())!;
  expect(block.x + block.width, 'the block ends inside the card').toBeLessThanOrEqual(
    card.x + card.width,
  );
  expect(await widths(page), 'the Tools tab with the checklist keeps the window').toMatchObject({
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
    'the Tools tab with the checklist at 390x844 has layout findings',
  ).toEqual([]);
});

test('the form builder adds a Discord username question in one click, once', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  const form = new ApplicationFormPage(page);
  await page.goto(marketSetupPath(marketId, 'form'));
  await form.openStep('questions');

  await form.addDiscordButton.click();
  await expect(form.labelInput(0)).toHaveValue('Discord username');
  await expect(form.keyInput(0)).toHaveValue('discord_username');
  await expect(form.typeSelect(0)).toHaveValue('text');
  await expect(form.requiredCheckbox(0)).not.toBeChecked();
  await expect(form.addDiscordButton).toHaveCount(0);

  await form.save();
  await expect(form.saveSuccess).toBeVisible({ timeout: 15000 });
  await page.goto(marketScreenPath(marketId, 'form'));
  await form.openStep('questions');
  await expect(form.labelInput(0)).toHaveValue('Discord username', { timeout: 15000 });
  await expect(form.addDiscordButton).toHaveCount(0);
});

test('the Tools tab fits a phone, a draft with its three rail actions included', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  const tools = new ToolsPage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await tools.goto(marketId);
  await expect(tools.discordCard).toBeVisible({ timeout: 15000 });
  // A draft's rail offers Pick market dates, Open applications and More, which ran past the window.
  await expect(page.getByTestId('phase-rail-menu-button')).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the page scrolls sideways on a phone').toBeLessThanOrEqual(0);
  await expect(page.getByTestId('phase-rail-menu-button')).toBeInViewport({ ratio: 1 });
});
