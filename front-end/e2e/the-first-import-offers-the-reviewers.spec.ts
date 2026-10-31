import { test, expect, TEST_USER, BACKEND_URL, CsvImportPage } from './fixtures';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * The first import's preview step offers the reviewers (E38/F07/S02).
 *
 * A Google Form market's first import is its way into the review. The owner imports three rows and
 * ticks two reviewers on the preview step; the reviewers are written before the rows, so the rows
 * are dealt as they arrive, round robin in the order the vendors applied: two to the first reviewer
 * and one to the second.
 */
const PASSWORD = 'e2epassword123';
const ANA = 'e2e-first-import-ana@example.com';
const BEN = 'e2e-first-import-ben@example.com';

const HEADERS = [
  'Timestamp',
  'Email Address',
  'Full Legal Name',
  'Business name',
  'Which days can you attend?',
  'How many days do you want?',
  'Which tiers will you accept?',
  'Full or half table?',
  'Rank the sections',
  'What do you sell?',
];

const MAPPING: Record<string, string> = {
  'Full Legal Name': 'essential_full_name',
  'Which days can you attend?': 'essential_available_dates',
  'How many days do you want?': 'essential_max_dates',
  'Which tiers will you accept?': 'essential_tier_preference',
  'Full or half table?': 'essential_table_choice',
  'Rank the sections': 'essential_section_ranking',
  'Business name': 'business_name',
  'What do you sell?': 'product_type',
};

/** In the order they applied, which the file does not follow: the deal goes by the timestamp. */
const FIRST = 'nadia@ember.test';
const SECOND = 'theo@thistle.test';
const THIRD = 'iris@driftwood.test';

const CSV = [
  HEADERS.join(','),
  `2026/05/02 11:40:22,${SECOND},Theo Marchetti,Thorn & Thistle,2099-08-01,1,Silver,full,"Main Hall, Garden",Dried flowers`,
  `2026/05/02 9:14:03,${FIRST},Nadia Okonkwo,Ember Ceramics,2099-08-01,1,Gold,half,"Garden, Main Hall",Pottery`,
  `2026/05/03 8:02:10,${THIRD},Iris Vale,Driftwood Prints,2099-08-08,1,Gold,full,"Garden, Main Hall",Linocuts`,
].join('\n');

test('a first import with two reviewers ticked deals its three rows 2 and 1, in the order they applied', async ({
  authenticatedPage: page,
  request,
}) => {
  for (const email of [ANA, BEN]) ensureVerifiedUser(email, PASSWORD);
  const market = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject(), intakeMode: 'csv' },
  );
  for (const email of [ANA, BEN]) {
    const res = await request.post(`${BACKEND_URL}/markets/${market.marketId}/roles`, {
      data: { user_email: email, role: 'viewer' },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  const importPage = new CsvImportPage(page);
  await page.goto(marketScreenPath(market.marketId, 'import'));
  await expect(importPage.view).toBeVisible();
  await importPage.chooseFile(CSV);
  await importPage.mapColumns(HEADERS, MAPPING);
  await expect(importPage.allMapped).toBeVisible();
  await importPage.clickPreview();
  await expect(importPage.previewCounts).toContainText('3 of 3 rows');

  // The section names itself, offers the choice with its hint, and ticks no one.
  await expect(page.getByRole('region', { name: 'Reviewers' })).toHaveAttribute(
    'data-testid',
    'import-reviewers',
  );
  await expect(importPage.reviewers).toContainText(
    'Choose no one and everyone reviews first come, first served.',
  );
  await expect(importPage.reviewer(ANA)).not.toBeChecked();
  await importPage.reviewer(ANA).check();
  await importPage.reviewer(BEN).check();
  await importPage.clickConfirm();
  await expect(importPage.resultSummary).toContainText('Imported 3 new applications');

  // The done step leads to the review, whose list answers each application's reviewer.
  const listed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.request().resourceType() !== 'document' &&
      response.url().endsWith(`/markets/${market.marketId}/applications`),
  );
  await page.getByTestId('import-finish-button').click();
  await expect(page).toHaveURL(/\/applications$/);
  await expect(page.getByTestId('reviewers-person')).toHaveText([ANA, BEN]);
  const body = (await (await listed).json()) as {
    applications: Array<{ applicantEmail: string; reviewer: { email: string } | null }>;
  };
  const dealt = Object.fromEntries(
    body.applications.map((row) => [row.applicantEmail, row.reviewer?.email ?? null]),
  );
  expect(dealt).toEqual({ [FIRST]: ANA, [SECOND]: BEN, [THIRD]: ANA });
});
