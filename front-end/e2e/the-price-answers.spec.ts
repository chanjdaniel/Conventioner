import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { SEED_MARKET_DATE } from './helpers/seeds';
import { seedApprovedVendor } from './helpers/seedApplication';
import { savePlan } from './helpers/savePlan';
import { marketScreenPath } from './helpers/marketScreens';
import { namelessControls } from './helpers/accessibleNames';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import {
  ALUMNI,
  EXAMPLE_PRICING,
  NO_CLUB,
  PLAN,
  SECOND_DATE,
  STUDENT,
  seedExampleMarket,
} from './helpers/exampleCollegeMarket';
import { UpdateInfoDialog } from './pages/UpdateInfoDialog';

/**
 * Adding a vendor asks the price answers; updating them is an Admin's (E43/F01/S03).
 *
 * On the Example College market, whose price groups read whether a vendor is a student or alumni
 * and which clubs they are in, a vendor added by hand is asked both, each required, and is priced
 * by them like any other. An Editor reads those answers read-only in Update info; an Admin changes
 * them, and the price follows.
 */
const ALUMNUS = 'e2e-price-answers-alumnus@example.com';
const EDITOR = { email: 'e2e-price-answers-editor@example.com', password: 'e2epassword123' };
const ADMIN = { email: 'e2e-price-answers-admin@example.com', password: 'e2epassword123' };
const SECTIONS = [
  [SEED_MARKET_DATE, 'North Wing'],
  [SECOND_DATE, 'Landing'],
] as const;

async function ok(response: Awaited<ReturnType<APIRequestContext['get']>>, what: string) {
  expect(response.ok(), `${what}: ${await response.text()}`).toBeTruthy();
}

/** The Example College market priced by its three groups, in Assignment, with an alumnus in no
 *  club approved and given a table on both days. */
async function seedPricedMarket(request: APIRequestContext): Promise<string> {
  const { marketId } = await seedExampleMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    'E2E Price Answers',
  );
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
    ...PLAN,
    pricing: EXAMPLE_PRICING,
  });
  seedApprovedVendor(marketId, ALUMNUS, {
    dates: [SEED_MARKET_DATE, SECOND_DATE],
    tiers: ['Gold', 'Silver'],
    sections: ['North Wing', 'Landing'],
    fullName: 'Alma Alumna',
    extra: { affiliation: [ALUMNI], clubs: [NO_CLUB] },
  });
  for (const toPhase of ['applications', 'assignment']) {
    await ok(
      await request.post(`${BACKEND_URL}/markets/${marketId}/transition`, { data: { toPhase } }),
      `move to ${toPhase}`,
    );
  }
  await place(request, marketId, ALUMNUS, 1);
  return marketId;
}

/** Seat a vendor at table `n` of each day's section. */
async function place(request: APIRequestContext, marketId: string, email: string, n: number) {
  for (const [date, section] of SECTIONS) {
    await ok(
      await request.put(`${BACKEND_URL}/markets/${marketId}/placements`, {
        data: { email, date, table_code: `${section} ${n}`, table_choice: 'Full Table' },
      }),
      `place ${email}`,
    );
  }
}

/** The vendor's drawer on `tab`, on the Vendors page. */
async function drawer(page: Page, marketId: string, email: string, tab = 'application') {
  const query = new URLSearchParams({ vendor: email, vendorTab: tab });
  await page.goto(`${marketScreenPath(marketId, 'vendors')}?${query.toString()}`);
}

/** The price line on the first of the vendor's two date cards: Gold, the first day. */
async function goldPrice(page: Page, marketId: string, email: string) {
  await drawer(page, marketId, email, 'assignments');
  const cards = page.getByTestId('vendors-detail-assignment-item');
  await expect(cards).toHaveCount(2, { timeout: 15000 });
  return cards.first().getByTestId('vendor-date-card-price');
}

test('adding a vendor asks the answers the prices read, refuses without them, and prices by them', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await seedPricedMarket(request);

  // Asked without the answers, the server refuses as the dialog does.
  const refused = await request.post(`${BACKEND_URL}/markets/${marketId}/vendors`, {
    data: { name: 'No Answers', email: 'e2e-price-answers-none@example.com' },
  });
  expect(refused.status()).toBe(400);
  expect(await refused.text()).toContain(
    "'Are you an Example College student or alumni?' is required.",
  );

  await page.goto(marketScreenPath(marketId, 'vendors'));
  await page.getByTestId('vendors-add-button').click();
  const dialog = page.getByTestId('add-vendor-window');
  await expect(dialog.getByTestId('add-vendor-price-note')).toHaveText(
    'Their price is set by these answers.',
  );
  // Both questions, required though the form leaves them optional.
  for (const key of ['affiliation', 'clubs']) {
    await expect(
      dialog.getByTestId(`add-vendor-field-${key}`).locator('.form-required'),
    ).toHaveText('*');
  }
  expect(await namelessControls(page), 'the add-a-vendor dialog').toEqual([]);

  const add = dialog.getByTestId('add-vendor-submit-button');
  await dialog.getByTestId('add-vendor-name-input').fill('Walk-in Wares');
  await dialog.getByTestId('add-vendor-email-input').fill('e2e-price-answers-walk.in@example.com');
  await expect(add).toBeDisabled();
  await dialog.getByTestId(`add-vendor-input-affiliation-${STUDENT}`).check();
  await expect(add).toBeDisabled();
  await dialog.getByTestId('add-vendor-input-clubs-Art Club').check();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('vendors-detail-giver')).toContainText(
    `Added by ${TEST_USER.email}`,
  );

  // Seated by hand like anyone, they pay the student + club member price.
  await place(request, marketId, 'e2e-price-answers-walk.in@example.com', 2);
  await expect(await goldPrice(page, marketId, 'e2e-price-answers-walk.in@example.com')).toHaveText(
    'Gold, full table, Example College student + club member, $12',
  );

  // Their History says who added them, with the answers given under the form's questions.
  await drawer(page, marketId, 'e2e-price-answers-walk.in@example.com', 'history');
  const history = page.getByTestId('vendor-drawer-panel-history');
  // The oldest of their entries, under the two placements.
  await expect(history.getByTestId('market-history-sentence').last()).toHaveText(
    `${TEST_USER.email} added Walk-in Wares as a vendor`,
  );
  const entry = history.getByTestId('market-history-entry').last();
  await entry.getByTestId('market-history-toggle').click();
  const answer = entry
    .getByTestId('market-history-changes')
    .locator('tbody tr')
    .filter({
      has: page.getByRole('rowheader', { name: 'Are you an Example College student or alumni?' }),
    });
  await expect(answer).toContainText(STUDENT);
});

test('an Editor reads the answers the prices read; an Admin changes them, and the price follows', async ({
  browser,
  request,
}) => {
  const marketId = await seedPricedMarket(request);
  const market = `${BACKEND_URL}/markets/${marketId}`;
  for (const [user, role] of [
    [EDITOR, 'editor'],
    [ADMIN, 'admin'],
  ] as const) {
    ensureVerifiedUser(user.email, user.password);
    await ok(
      await request.post(`${market}/roles`, { data: { user_email: user.email, role } }),
      `make ${user.email} ${role}`,
    );
  }

  await withUser(browser, EDITOR.email, EDITOR.password, async (page) => {
    const dialog = new UpdateInfoDialog(page);
    await drawer(page, marketId, ALUMNUS);
    await dialog.open();
    await expect(dialog.window.getByTestId('update-info-price-note')).toHaveText(
      "Only an Admin or the owner may update the answers this market's assignment or prices read.",
    );
    await expect(dialog.input(`affiliation-${ALUMNI}`)).toBeChecked();
    await expect(dialog.input(`affiliation-${ALUMNI}`)).toBeDisabled();
    await expect(dialog.input(`affiliation-${STUDENT}`)).toBeDisabled();
    await expect(dialog.input(`clubs-${NO_CLUB}`)).toBeDisabled();
    await expect(dialog.saveButton).toBeDisabled();
  });

  await withUser(browser, ADMIN.email, ADMIN.password, async (page) => {
    const dialog = new UpdateInfoDialog(page);
    await expect(await goldPrice(page, marketId, ALUMNUS)).toHaveText(
      'Gold, full table, Everyone else, $35',
    );
    await drawer(page, marketId, ALUMNUS);
    await dialog.open();
    await expect(dialog.window.getByTestId('update-info-price-note')).toHaveCount(0);
    await dialog.input(`affiliation-${STUDENT}`).check();
    await dialog.input(`affiliation-${ALUMNI}`).uncheck();
    await expect(dialog.theirs('affiliation')).toContainText(`They wrote: ${ALUMNI}`);
    await dialog.save();

    await expect(await goldPrice(page, marketId, ALUMNUS)).toHaveText(
      'Gold, full table, Example College student only, $15',
    );
  });
});
