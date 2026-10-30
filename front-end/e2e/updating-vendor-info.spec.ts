import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { UpdateInfoDialog } from './pages/UpdateInfoDialog';

/**
 * An organizer updates a vendor's info (E41/F01/S01).
 *
 * "Update info" in the vendor drawer opens a dialog of the vendor's answers, each in its question's
 * own control, with Save and Cancel. Each answer changed says what the vendor wrote beside it before
 * Save. The update is kept beside the vendor's own answer, so it reads in its place in the drawer and
 * the review, and a re-import of the market's Google Form keeps it, saying when what the vendor
 * wrote has changed since.
 */
const VENDOR = 'nadia@ember.test';

const FIELDS = [
  { key: 'business_name', label: 'Business Name', type: 'text', required: true, options: [] },
  {
    key: 'student',
    label: 'Are you a student?',
    type: 'select',
    required: true,
    options: ['Yes', 'No'],
  },
].map((field, order) => ({ ...field, order }));

const HEADERS = [
  'Timestamp',
  'Email Address',
  'Full Legal Name',
  'Business name',
  'Are you a student?',
  'Which days can you attend?',
  'Which tiers will you accept?',
  'Full or half table?',
  'Rank the sections',
  'Table-share partner',
];

/** The import's mapping, by column: what the organizer maps on the import screen. */
const MAPPING = {
  submitted_at: 0,
  applicant_email: 1,
  essential_full_name: 2,
  business_name: 3,
  student: 4,
  essential_available_dates: 5,
  essential_tier_preference: 6,
  essential_table_choice: 7,
  essential_section_ranking: 8,
  essential_table_share_email: 9,
};

/** The market's Google Form responses, imported as the import screen imports them. */
async function importResponses(
  request: APIRequestContext,
  marketId: string,
  business: string,
  shareWords = '',
) {
  const row = [
    '2026/05/02 9:14:03',
    VENDOR,
    'Nadia Okonkwo',
    business,
    'No',
    '"2099-08-01, 2099-08-08"',
    'Gold',
    'half',
    '"Garden, Main Hall"',
    `"${shareWords}"`,
  ].join(',');
  const res = await request.post(`${BACKEND_URL}/markets/${marketId}/applications/import`, {
    data: { csvContent: [HEADERS.join(','), row].join('\n'), mapping: MAPPING },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** One of the vendor's answers in the drawer, and the words beside it. */
function drawerAnswer(page: Page, key: string) {
  const answer = page.getByTestId(`vendors-detail-answer-${key}`);
  return {
    answer,
    updated: page.getByTestId(`vendors-detail-answer-${key}-updated`),
    changed: page.getByTestId(`vendors-detail-answer-${key}-changed`),
  };
}

test('an organizer updates a vendor’s info, the review reads it, and a re-import keeps it', async ({
  authenticatedPage: page,
  request,
  expectAccessible,
}) => {
  const seed = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject(), intakeMode: 'csv', fields: FIELDS },
  );
  await importResponses(request, seed.marketId, 'Ember Ceramcs');

  const all = new ApplicationsAllPage(page);
  const dialog = new UpdateInfoDialog(page);
  const business = drawerAnswer(page, 'business_name');
  const student = drawerAnswer(page, 'student');
  await all.goto(seed.marketId);
  await all.open(VENDOR);
  await expect(business.answer).toHaveText('Ember Ceramcs');

  // Cancel leaves every answer as it was.
  await dialog.open();
  await dialog.input('business_name').fill('Something else');
  await dialog.cancelButton.click();
  await expect(dialog.window).toHaveCount(0);
  await expect(business.answer).toHaveText('Ember Ceramcs');
  await expect(business.updated).toHaveCount(0);

  // Escape closes the dialog alone: the drawer beneath stays open.
  await dialog.open();
  await page.keyboard.press('Escape');
  await expect(dialog.window).toHaveCount(0);
  await expect(business.answer).toBeVisible();

  // A text answer and a select answer, each beside what the vendor wrote before Save.
  await dialog.open();
  await expect(dialog.saveButton).toBeDisabled();
  // The essential questions are asked below the market's own, as the form asks them.
  await expect(dialog.essential('full-name-input')).toHaveValue('Nadia Okonkwo');
  await dialog.input('business_name').fill('Ember Ceramics');
  await dialog.input('student').selectOption('Yes');
  await expect(dialog.theirs('business_name')).toContainText('They wrote: Ember Ceramcs');
  await expect(dialog.theirs('student')).toContainText('They wrote: No');
  await expectAccessible('the Update info dialog, two answers changed');
  await dialog.save();

  await expect(business.answer).toContainText('Ember Ceramics');
  await expect(business.updated).toHaveText(
    /^Updated by e2e@example\.com, .+; they wrote Ember Ceramcs$/,
  );
  await expect(student.answer).toContainText('Yes');
  await expect(student.updated).toContainText('they wrote No');

  // "Use their answer" returns one to what the vendor wrote.
  await dialog.open();
  await dialog.useTheirs('student');
  await expect(dialog.theirs('student')).toHaveCount(0);
  await dialog.save();
  await expect(student.answer).toHaveText('No');
  await expect(student.updated).toHaveCount(0);
  await expect(business.updated).toBeVisible();

  // The review reads the update in its place, with who, when and what they wrote.
  const review = new ApplicationMonitorPage(page);
  await review.goto(seed.marketId);
  await review.waitForLoaded();
  await expect(page.getByTestId('app-monitor-answer-business_name')).toContainText(
    'Ember Ceramics',
  );
  await expect(page.getByTestId('app-monitor-answer-business_name-updated')).toHaveText(
    /^Updated by e2e@example\.com, .+; they wrote Ember Ceramcs$/,
  );

  // A re-import of the same answer keeps the update, and says nothing more.
  await importResponses(request, seed.marketId, 'Ember Ceramcs');
  await all.goto(seed.marketId);
  await all.open(VENDOR);
  await expect(business.answer).toContainText('Ember Ceramics');
  await expect(business.updated).toBeVisible();
  await expect(business.changed).toHaveCount(0);

  // One whose answer changed keeps it too, and says their answer changed, and to what.
  await importResponses(request, seed.marketId, 'Ember Pottery');
  await page.reload();
  await all.drawer.waitFor();
  await expect(business.answer).toContainText('Ember Ceramics');
  await expect(business.updated).toContainText('they wrote Ember Pottery');
  await expect(business.changed).toHaveText('Their answer changed since your update.');

  // Saving the update as it stands keeps it over what they wrote now, and the line goes
  // (Daniel, T111 review note 2); the vendor's History says it was kept.
  await dialog.open();
  await expect(dialog.updated('business_name')).toContainText('Save keeps your update.');
  await expect(dialog.saveButton).toBeEnabled();
  await dialog.save();
  await expect(business.answer).toContainText('Ember Ceramics');
  await expect(business.updated).toContainText('they wrote Ember Pottery');
  await expect(business.changed).toHaveCount(0);
  await page.getByTestId('vendor-drawer-tab-history').click();
  await expect(
    page.getByTestId('vendor-drawer-panel-history').getByTestId('market-history-sentence').first(),
  ).toHaveText('e2e@example.com kept their update to the info of Nadia Okonkwo');
});

test('an imported table-share answer in the vendor’s words does not block another answer’s Save', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject(), intakeMode: 'csv', fields: FIELDS },
  );
  const words = 'Seat me with Ana, ana@example.com';
  await importResponses(request, seed.marketId, 'Ember Ceramcs', words);

  const all = new ApplicationsAllPage(page);
  const dialog = new UpdateInfoDialog(page);
  const business = drawerAnswer(page, 'business_name');
  const share = dialog.essential('table-share-email-input');
  await all.goto(seed.marketId);
  await all.open(VENDOR);
  await dialog.open();
  await expect(share).toHaveValue(words);

  await dialog.input('business_name').fill('Ember Ceramics');
  await dialog.save();
  await expect(business.answer).toContainText('Ember Ceramics');
  await expect(business.updated).toBeVisible();

  await dialog.open();
  await expect(share).toHaveValue(words);
});
