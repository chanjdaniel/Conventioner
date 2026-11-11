import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { oneByOnePath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { UpdateInfoDialog } from './pages/UpdateInfoDialog';

/**
 * An organizer's update of an answer moves the answers' version (T270).
 *
 * A verdict is written only on the answers its giver saw (E34/F03/S01). An organizer's update is
 * kept beside the vendor's answer and read in its place (E41/F01/S01), so it changes what a
 * reviewer decides on: a verdict on a card opened before it is refused, and the card shows the
 * answers as they stand. The organizer who updated an answer in the All view's drawer decides
 * there on what they just saved.
 */
const VENDOR = 'nadia@ember.test';
const REVIEWER = {
  email: 'e2e-answers-version-reviewer@example.com',
  password: 'e2eanswersversion1',
};

const FIELDS = [
  { key: 'business_name', label: 'Business Name', type: 'text', required: true, options: [] },
].map((field, order) => ({ ...field, order }));

const HEADERS = [
  'Timestamp',
  'Email Address',
  'Full Legal Name',
  'Business name',
  'Which days can you attend?',
  'Which tiers will you accept?',
  'Full or half table?',
  'Rank the sections',
];

const MAPPING = {
  submitted_at: 0,
  applicant_email: 1,
  essential_full_name: 2,
  business_name: 3,
  essential_available_dates: 4,
  essential_tier_preference: 5,
  essential_table_choice: 6,
  essential_section_ranking: 7,
};

/** A Google Form market with the vendor's response imported, open for review. */
async function imported(request: APIRequestContext): Promise<string> {
  const { marketId } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject(), intakeMode: 'csv', fields: FIELDS },
  );
  const row = [
    '2026/05/02 9:14:03',
    VENDOR,
    'Nadia Okonkwo',
    'Ember Ceramcs',
    '"2099-08-01, 2099-08-08"',
    'Gold',
    'full',
    '"Main Hall, Garden"',
  ].join(',');
  const res = await request.post(`${BACKEND_URL}/markets/${marketId}/applications/import`, {
    data: { csvContent: [HEADERS.join(','), row].join('\n'), mapping: MAPPING },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return marketId;
}

function storedStatus(marketId: string): string {
  return mongoEval(
    `db.applications.findOne({ market_id: ${JSON.stringify(marketId)}, ` +
      `applicant_email: ${JSON.stringify(VENDOR)} }).status`,
  );
}

test('a verdict on a card opened before an organizer updated its answer is refused, and the card shows the update', async ({
  authenticatedPage: page,
  browser,
  request,
}) => {
  ensureVerifiedUser(REVIEWER.email, REVIEWER.password);
  const marketId = await imported(request);
  const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: REVIEWER.email, role: 'editor' },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();

  await withUser(browser, REVIEWER.email, REVIEWER.password, async (other) => {
    const review = new ApplicationMonitorPage(other);
    const shop = other.getByTestId('app-monitor-answer-business_name');
    await other.goto(oneByOnePath(marketId));
    await review.waitForLoaded();
    await expect(review.email).toHaveText(VENDOR);
    await expect(shop).toHaveText('Ember Ceramcs');

    // While the card is open, the organizer corrects the shop's name from the All view's drawer.
    const all = new ApplicationsAllPage(page);
    const dialog = new UpdateInfoDialog(page);
    await all.goto(marketId);
    await all.open(VENDOR);
    await dialog.open();
    await dialog.input('business_name').fill('Ember Ceramics');
    await dialog.save();
    await expect(page.getByTestId('vendors-detail-answer-business_name')).toContainText(
      'Ember Ceramics',
    );

    // The reviewer approves what they opened: refused, and the card shows the answer as it stands.
    await review.approveButton.click();
    await expect(other.getByTestId('app-monitor-changed')).toContainText(
      'Its answers changed since you opened it.',
    );
    await expect(review.email).toHaveText(VENDOR);
    await expect(shop).toContainText('Ember Ceramics');
    await expect(review.status).toHaveText('Open');
    expect(storedStatus(marketId)).toBe('open');

    // Deciding again, on what is really stored, lands.
    await review.approveButton.click();
    await expect(other.getByTestId('app-monitor-changed')).toHaveCount(0);
    await expect.poll(() => storedStatus(marketId)).toBe('reviewer_approved');
  });
});

test('an organizer who updates an answer in the All view’s drawer decides there on it', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await imported(request);
  const all = new ApplicationsAllPage(page);
  const dialog = new UpdateInfoDialog(page);

  await all.goto(marketId);
  await all.open(VENDOR);
  // On a slow network the list is read again well after the dialog closes; the verdict given
  // meanwhile is still on the answers just saved.
  await page.route(`**/api/markets/${marketId}/applications`, async (route) => {
    if (route.request().method() === 'GET') await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await dialog.open();
  await dialog.input('business_name').fill('Ember Ceramics');
  await dialog.save();
  await all.drawerButton('approve').click();

  await expect(all.statusOf(VENDOR)).toHaveText('Approved');
  await expect(page.getByTestId('applications-all-verdict-message')).toHaveCount(0);
  expect(storedStatus(marketId)).toBe('reviewer_approved');
});
