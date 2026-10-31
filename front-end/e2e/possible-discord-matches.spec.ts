import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import { SEED_MARKET_DATE } from './helpers/seeds';
import { mongoEval } from './helpers/mongo';
import { VendorsPage } from './pages/VendorsPage';

/**
 * Possible matches, confirmed into an update (E46/F01/S05): a vendor "Not found" whose answer is a
 * display name is offered the member with that name; confirming saves the member's username as an
 * update of their answer, so the next check finds them "In the server"; declining leaves the vendor
 * "Not found".
 *
 * Discord stands outside the stack, which runs without its values, so it is mocked where the
 * browser meets it, as in `who-is-in-the-discord-server.spec.ts`: the market read says Discord is
 * set up, and the check is answered by a fake server of two members, matched to each vendor's
 * answer as the organizer reads it now (an update in its place), written to the market as the
 * check writes it. Confirming and declining are the stack's own routes. The matching and the offers
 * are the back end's, pinned against a fake of Discord's API in
 * `back-end/tests/test_discord_connection.py`.
 */
const QUESTION = 'discord_username';
const SERVER = [
  { username: 'fern_studio_42', displayName: 'Fern Studio' },
  { username: 'oak_and_co', displayName: 'Oak & Co' },
];

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
  const oak = seedApprovedVendor(seed.marketId, 'e2e-discord-oak@example.com', {
    dates: [SEED_MARKET_DATE],
    tiers: ['Gold'],
    extra: { [QUESTION]: 'Oak & Co' },
  });
  const marketFilter = `{ id: ${JSON.stringify(seed.marketId)} }`;
  const field = { key: QUESTION, label: 'Discord Username', type: 'text', required: false };
  mongoEval(
    `const m = db.markets.findOne(${marketFilter}); ` +
      `const fields = ((m.applicationForm || {}).fields || []).concat([${JSON.stringify(field)}]); ` +
      `db.markets.updateOne(${marketFilter}, { $set: { 'applicationForm.fields': fields, ` +
      `discord: ${JSON.stringify({
        guildId: '2909267986263572999',
        guildName: 'Riverside Makers',
        usernameQuestion: QUESTION,
      })} } })`,
  );

  await page.route(`**/markets/${seed.marketId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.market.discordSetUp = true;
    await route.fulfill({ response, json: body });
  });
  await page.route(`**/markets/${seed.marketId}/discord/check`, async (route) => {
    // The fake server: each vendor's answer as the organizer reads it, matched by username, and
    // a member whose display name is the answer offered.
    const answers = JSON.parse(
      mongoEval(
        `JSON.stringify(db.applications.find({ id: { $in: ${JSON.stringify([fern, oak])} } }).` +
          `toArray().map((a) => ({ id: a.id, answer: ((a.answer_updates || {})[` +
          `${JSON.stringify(QUESTION)}] || {}).value ?? a.form_data[${JSON.stringify(QUESTION)}] })))`,
      ),
    ) as { id: string; answer: string }[];
    const declined = JSON.parse(
      mongoEval(
        `JSON.stringify((db.markets.findOne(${marketFilter}).discord.declinedMatches) || {})`,
      ),
    ) as Record<string, string[]>;
    const vendorStates = answers.map(({ id, answer }) => {
      if (SERVER.some((member) => member.username === answer)) {
        return { applicationId: id, state: 'in_server', answer };
      }
      const possibleMatches = SERVER.filter(
        (member) =>
          member.displayName === answer && !(declined[id] ?? []).includes(member.username),
      );
      return {
        applicationId: id,
        state: 'not_found',
        answer,
        ...(possibleMatches.length ? { possibleMatches } : {}),
      };
    });
    const checkedAt = new Date().toISOString();
    mongoEval(
      `db.markets.updateOne(${marketFilter}, { $set: { 'discord.checkedAt': ${JSON.stringify(
        checkedAt,
      )}, 'discord.vendorStates': ${JSON.stringify(vendorStates)} } })`,
    );
    await route.fulfill({ json: { counts: {}, checkedAt } });
  });

  const vendors = new VendorsPage(page);
  const row = (email: string) => vendors.vendorListItems.filter({ hasText: email });
  const chip = (email: string) => row(email).getByTestId('vendors-list-discord');
  await vendors.goto(seed.marketId);
  await expect(row('e2e-discord-fern@example.com')).toHaveCount(1, { timeout: 15000 });

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

  // Both are in the vendor's own history, with who and when.
  await row('e2e-discord-fern@example.com').click();
  await vendors.openTab('history');
  await expect(vendors.detailHistorySentences.first()).toContainText('updated the info of');
  await vendors.closeDetail();
  await row('e2e-discord-oak@example.com').click();
  await vendors.openTab('history');
  await expect(vendors.detailHistorySentences.first()).toContainText(
    'said the Discord member @oak_and_co is not',
  );
});
