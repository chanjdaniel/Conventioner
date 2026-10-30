import { test, expect, TEST_USER, BACKEND_URL, ApplicationFormPage } from './fixtures';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { ensureTestOrg } from './helpers/seeds';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ToolsPage } from './pages/ToolsPage';

/**
 * The Tools tab (E46/F01/S02): the manual tools an organizer runs in any phase, just left of Stats
 * on the market bar, at its own address. It holds the Discord card, which Market Setup no longer
 * shows; and the form builder offers a one-click question for each vendor's Discord username.
 *
 * Connecting needs a real Discord, so the card is met here connected by a row written to the market,
 * as the connection's routes leave it: the stack runs without Discord's values or with fixture ones,
 * and either way someone the row refuses reads the card.
 */
const VIEWER = { email: 'e2e-tools-viewer@example.com', password: 'e2etoolsviewer1' };

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
