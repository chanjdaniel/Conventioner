import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import { SEED_MARKET_DATE } from './helpers/seeds';
import { mongoEval } from './helpers/mongo';
import { connectToFakeDiscord, fakeDiscordId, seedFakeDiscordServer } from './helpers/fakeDiscord';
import { VendorsPage } from './pages/VendorsPage';

/**
 * Possible matches, confirmed into an update (E46/F01/S05): a vendor "Not found" whose answer is a
 * display name is offered the member with that name; confirming saves the member's username as an
 * update of their answer, so the next check finds them "In the server"; declining leaves the vendor
 * "Not found".
 *
 * Every step is the stack's own: the check runs against a fake Discord server the stack answers for
 * (`DISCORD_FAKE`, `back-end/discord_fake.py`), through the bot client's real requests, and the
 * offers, "Check again" and the next check are the back end's.
 */
const QUESTION = 'discord_username';

test('a member offered as a possible match is confirmed into an update, or declined', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const fern = seedApprovedVendor(seed.marketId, 'e2e-discord-fern@example.com', {
    dates: [SEED_MARKET_DATE],
    tiers: ['Gold'],
    extra: { [QUESTION]: 'Fern Studio' },
  });
  seedApprovedVendor(seed.marketId, 'e2e-discord-oak@example.com', {
    dates: [SEED_MARKET_DATE],
    tiers: ['Gold'],
    extra: { [QUESTION]: 'Oak & Co' },
  });
  const guildId = fakeDiscordId();
  seedFakeDiscordServer({
    guildId,
    name: 'Riverside Makers',
    members: [
      { id: '1001', username: 'fern_studio_42', globalName: 'Fern Studio' },
      { id: '1002', username: 'oak_and_co', globalName: 'Oak & Co' },
    ],
  });
  connectToFakeDiscord(seed.marketId, { guildId, guildName: 'Riverside Makers' });

  const vendors = new VendorsPage(page);
  const row = (email: string) => vendors.vendorListItems.filter({ hasText: email });
  const chip = (email: string) => row(email).getByTestId('vendors-list-discord');
  await vendors.goto(seed.marketId);
  await expect(row('e2e-discord-fern@example.com')).toHaveCount(1, { timeout: 15000 });
  await expect(
    vendors.checkDiscordButton,
    'the stack answers for Discord only with DISCORD_FAKE=true (docs/TESTING.md)',
  ).toBeVisible();

  await vendors.checkDiscordButton.click();

  await expect(chip('e2e-discord-fern@example.com')).toHaveText('Discord: Possible match');
  await expect(chip('e2e-discord-oak@example.com')).toHaveText('Discord: Possible match');
  await vendors.discordFilter.selectOption('possible_match');
  await expect(page).toHaveURL(/[?&]discord=possible_match/);
  await expect(vendors.discordStates).toHaveCount(2);

  // Confirming: the dialog says what they wrote and what it becomes, and saves the update.
  await row('e2e-discord-fern@example.com').click();
  const offer = vendors.detailPanel.getByTestId('vendors-detail-discord');
  await expect(offer.getByTestId('vendors-detail-discord-match')).toHaveText(
    /Possible match: Fern Studio @fern_studio_42/,
  );
  await offer.getByTestId('vendors-detail-discord-confirm').click();
  const dialog = page.getByTestId('discord-match-confirm-window');
  await expect(dialog).toContainText('They wrote');
  await expect(dialog).toContainText('Fern Studio');
  await expect(dialog).toContainText('fern_studio_42');
  await page.getByTestId('discord-match-confirm-submit-button').click();
  await expect(dialog).toBeHidden();

  await expect(vendors.detailPanel.getByTestId(`vendors-detail-answer-${QUESTION}`)).toContainText(
    'fern_studio_42',
  );
  await expect(offer).toContainText('Their username was updated after the last check.');
  const stored = JSON.parse(
    mongoEval(
      `JSON.stringify(db.applications.findOne({ id: ${JSON.stringify(fern)} }, ` +
        `{ _id: 0, form_data: 1, answer_updates: 1 }))`,
    ),
  );
  expect(stored.form_data[QUESTION]).toBe('Fern Studio');
  expect(stored.answer_updates[QUESTION].value).toBe('fern_studio_42');
  expect(stored.answer_updates[QUESTION].by.email).toBe(TEST_USER.email);

  // Declining: the vendor stays not found, and the member is not offered again.
  await vendors.closeDetail();
  await row('e2e-discord-oak@example.com').click();
  await vendors.detailPanel.getByTestId('vendors-detail-discord-decline').click();
  await expect(vendors.detailPanel.getByTestId('vendors-detail-discord')).toHaveCount(0);
  await vendors.closeDetail();

  await vendors.discordFilter.selectOption('');
  await expect(chip('e2e-discord-fern@example.com')).toHaveText('Discord: Check again');
  await expect(chip('e2e-discord-oak@example.com')).toHaveText('Discord: Not found');

  await vendors.checkDiscordButton.click();

  await expect(chip('e2e-discord-fern@example.com')).toHaveText('Discord: In the server');
  await expect(chip('e2e-discord-oak@example.com')).toHaveText('Discord: Not found');

  // Both are in the vendor's own history, with who, beside the checks that changed them.
  await row('e2e-discord-fern@example.com').click();
  await vendors.openTab('history');
  await expect(vendors.detailHistorySentences).toHaveText([
    `${TEST_USER.email} checked who is in the Discord server: In the server`,
    /updated the info of/,
    `${TEST_USER.email} checked who is in the Discord server: Not found`,
  ]);
  await expect(
    vendors.detailHistorySentences.filter({ hasText: 'updated the info of' }),
  ).toContainText(TEST_USER.email);
  await vendors.closeDetail();
  await row('e2e-discord-oak@example.com').click();
  await vendors.openTab('history');
  await expect(
    vendors.detailHistorySentences.filter({ hasText: 'said the Discord member' }),
  ).toHaveText(
    `${TEST_USER.email} said the Discord member @oak_and_co is not Eediscordoak Example`,
  );
});
