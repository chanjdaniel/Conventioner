import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { transitionMarket } from './helpers/seedPhaseMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { UpdateInfoDialog } from './pages/UpdateInfoDialog';

/**
 * An Admin updates an answer the assignment reads (E41/F01/S02).
 *
 * The essential questions are in the same Update info dialog, asked as the form asks them. A vendor
 * who accepted Gold on the first day is updated to Silver there; the result then says the approved
 * applications changed since tables were allocated, and the run that follows seats them at Silver.
 */
const VENDOR = 'nadia@ember.test';
const FIRST_DAY = '2099-08-01';

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

/** The vendor, imported as Gold on both their days, approved, and allocated a table. */
async function allocated(request: APIRequestContext): Promise<string> {
  const seed = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject(), intakeMode: 'csv', fields: FIELDS },
  );
  const marketId = seed.marketId;
  const row = [
    '2026/05/02 9:14:03',
    VENDOR,
    'Nadia Okonkwo',
    'Ember Ceramics',
    `"${FIRST_DAY}, 2099-08-08"`,
    'Gold',
    'full',
    '"Main Hall, Garden"',
  ].join(',');
  const imported = await request.post(`${BACKEND_URL}/markets/${marketId}/applications/import`, {
    data: { csvContent: [HEADERS.join(','), row].join('\n'), mapping: MAPPING },
  });
  expect(imported.ok(), await imported.text()).toBeTruthy();

  const listed = await request.get(`${BACKEND_URL}/markets/${marketId}/applications`);
  const [application] = (await listed.json()).applications as { id: string }[];
  const approved = await request.put(
    `${BACKEND_URL}/markets/${marketId}/applications/${application.id}/review`,
    { data: { status: 'reviewer_approved' } },
  );
  expect(approved.ok(), await approved.text()).toBeTruthy();
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'assignment');
  const ran = await request.post(`${BACKEND_URL}/markets/${marketId}/assignment`);
  expect(ran.ok(), await ran.text()).toBeTruthy();
  return marketId;
}

test('an Admin updates a day’s tiers, and the next run seats the vendor by them', async ({
  authenticatedPage: page,
  request,
  expectAccessible,
}) => {
  const marketId = await allocated(request);
  const all = new ApplicationsAllPage(page);
  const dialog = new UpdateInfoDialog(page);
  const gold = dialog.essential(`tier-${FIRST_DAY}-Gold`);
  const silver = dialog.essential(`tier-${FIRST_DAY}-Silver`);
  const firstDayCard = page.getByTestId('vendors-detail-assignment-item').first();

  await all.goto(marketId);
  await all.open(VENDOR);
  await page.getByTestId('vendor-drawer-tab-assignments').click();
  await expect(firstDayCard).toContainText('Gold');

  await page.getByTestId('vendor-drawer-tab-application').click();
  await dialog.open();
  await expect(dialog.essentialsNote).toContainText('the next run places them by what you save');
  await expect(gold).toBeChecked();
  await silver.check();
  await gold.uncheck();
  await expect(dialog.theirs('essential_tier_preference')).toContainText('They wrote:');
  await expect(dialog.theirs('essential_tier_preference')).toContainText('Gold');
  await expectAccessible('the Update info dialog, a day’s tiers changed');
  await dialog.save();

  // The vendor's own History tab says who updated their info, newest first (E40/F01/S04).
  await page.getByTestId('vendor-drawer-tab-history').click();
  await expect(
    page.getByTestId('vendor-drawer-panel-history').getByTestId('market-history-sentence').first(),
  ).toHaveText(`${TEST_USER.email} updated the info of Nadia Okonkwo`);

  // The Assignments page says what changed, until tables are allocated again.
  await page.goto(marketScreenPath(marketId, 'assignments'));
  const line = page.getByTestId('assignment-out-of-date');
  await expect(line).toContainText('approved applications changed since tables were allocated', {
    timeout: 10000,
  });
  await line.getByRole('link', { name: 'Allocate tables again' }).click();
  await page.getByTestId('market-setup-assign-button').click();
  await expect(page).toHaveURL(new RegExp(`/markets/${marketId}/assignments$`), { timeout: 15000 });
  await expect(line).toHaveCount(0);

  await all.goto(marketId);
  await all.open(VENDOR);
  await page.getByTestId('vendor-drawer-tab-assignments').click();
  await expect(firstDayCard).toContainText('Silver');
});

test('an answer the form would refuse is refused in the form’s words', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await allocated(request);
  const all = new ApplicationsAllPage(page);
  const dialog = new UpdateInfoDialog(page);

  await all.goto(marketId);
  await all.open(VENDOR);
  await dialog.open();
  // The browser holds the number of dates to the form's range itself; the name is the server's.
  await dialog.essential('full-name-input').fill('');
  await dialog.saveButton.click();

  await expect(dialog.window).toContainText("'Full name' is required.");
  await expect(dialog.essential('full-name-input')).toHaveValue('');
});
