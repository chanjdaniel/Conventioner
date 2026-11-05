import type { APIRequestContext, Page, Route } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, CsvImportPage } from './fixtures';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { MarketsPage } from './pages/MarketsPage';

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

/** A Google Form draft of the owner's, ready for its first import, with Ana and Ben on it. */
async function draftWithPeople(request: APIRequestContext) {
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
  return market;
}

test('a first import with two reviewers ticked deals its three rows 2 and 1, in the order they applied', async ({
  authenticatedPage: page,
  request,
}) => {
  const market = await draftWithPeople(request);

  const importPage = new CsvImportPage(page);
  await page.goto(marketScreenPath(market.marketId, 'import'));
  await expect(importPage.view).toBeVisible();
  await importPage.chooseFile(CSV);
  await importPage.mapColumns(HEADERS, MAPPING);
  await expect(importPage.allMapped).toBeVisible();
  await importPage.clickPreview();
  await expect(importPage.previewCounts).toContainText('3 of 3 rows');

  // The section names itself, offers the choice with its hint, and chooses no one.
  await expect(page.getByRole('region', { name: 'Reviewers' })).toHaveAttribute(
    'data-testid',
    'import-reviewers',
  );
  await expect(importPage.reviewers).toContainText(
    'Choose no one and everyone reviews first come, first served.',
  );
  await expect(importPage.reviewerChooser.chips).toHaveCount(0);
  await importPage.reviewerChooser.choose(ANA, BEN);
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
  await expect(page.getByTestId('reviewers-line')).toHaveText(`2 reviewers: ${ANA} and ${BEN}`);
  const body = (await (await listed).json()) as {
    applications: Array<{ applicantEmail: string; reviewer: { email: string } | null }>;
  };
  const dealt = Object.fromEntries(
    body.applications.map((row) => [row.applicantEmail, row.reviewer?.email ?? null]),
  );
  expect(dealt).toEqual({ [FIRST]: ANA, [SECOND]: BEN, [THIRD]: ANA });
});

/** Every import the page sends, by its address, and the write of the reviewers held by a route. */
async function holdTheWrite(page: Page) {
  const imports: string[] = [];
  page.on('request', (sent) => {
    if (sent.url().endsWith('/applications/import')) imports.push(sent.url());
  });
  const held: Route[] = [];
  const write = /\/reviewers$/;
  await page.route(write, (route) => {
    held.push(route);
  });
  return { imports, held, write };
}

/** The rail's way into a draft's first import, so the page stands on the app already running. */
async function followTheRail(page: Page, importPage: CsvImportPage) {
  await page.getByTestId('phase-rail-fix').click();
  await expect(importPage.view).toBeVisible();
}

async function toThePreview(importPage: CsvImportPage, file: string) {
  await importPage.chooseFile(file);
  await importPage.mapColumns(HEADERS, MAPPING);
  await expect(importPage.allMapped).toBeVisible();
  await importPage.clickPreview();
  await expect(importPage.previewCounts).toBeVisible();
}

async function applicationsOf(request: APIRequestContext, marketId: string) {
  const res = await request.get(`${BACKEND_URL}/markets/${marketId}/applications`);
  expect(res.ok(), await res.text()).toBeTruthy();
  const { applications } = (await res.json()) as {
    applications: Array<{ applicantEmail: string; formData: Record<string, unknown> }>;
  };
  return applications;
}

test('a first import left during its write imports nothing, here or into the market now on screen', async ({
  authenticatedPage: page,
  request,
}) => {
  const here = await draftWithPeople(request);
  const there = await draftWithPeople(request);
  await page.goto(marketScreenPath(here.marketId, 'import'));
  const importPage = new CsvImportPage(page);
  await toThePreview(importPage, CSV);
  const { imports, held, write } = await holdTheWrite(page);
  await importPage.reviewerChooser.choose(ANA);
  await importPage.clickConfirm();
  await expect.poll(() => held.length).toBe(1);

  // By the app bar and the Markets page, as a person goes, so the app stays the one running.
  await page.getByTestId('app-bar-logo').click();
  const markets = new MarketsPage(page);
  await markets.searchInput.fill(there.marketName);
  await markets.cardNames.filter({ hasText: there.marketName }).getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`/markets/${there.marketId}/`));

  // Answered by the server, so the market re-read that comes next says the write landed.
  const reread = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().endsWith(`/markets/${there.marketId}`),
  );
  await held[0]!.continue();
  await page.unroute(write);
  await reread;

  await expect.poll(() => applicationsOf(request, here.marketId)).toEqual([]);
  expect(imports).toEqual([]);
  expect(await applicationsOf(request, there.marketId)).toEqual([]);
  const written = await request.get(`${BACKEND_URL}/markets/${here.marketId}`);
  expect(
    (await written.json()).market.reviewTeam.reviewers.map((r: { email: string }) => r.email),
  ).toEqual([ANA]);
});

test('a file the person left never replaces the one they confirmed last', async ({
  authenticatedPage: page,
  request,
}) => {
  const market = await draftWithPeople(request);
  // Arrive from Tools, a view of its own, so that Back leaves the import.
  await page.goto(marketScreenPath(market.marketId, 'tools'));
  const importPage = new CsvImportPage(page);
  await followTheRail(page, importPage);
  const left = [
    HEADERS.join(','),
    `2026/05/02 9:14:03,${FIRST},Nadia Okonkwo,Ember Ceramics,2099-08-01,1,Gold,half,"Garden, Main Hall",Pottery`,
    `2026/05/02 11:40:22,${SECOND},Theo Marchetti,Thorn & Thistle,2099-08-01,1,Silver,full,"Main Hall, Garden",Dried flowers`,
  ].join('\n');
  const confirmed = [
    HEADERS.join(','),
    `2026/05/02 9:14:03,${FIRST},Nadia Okonkwo,Ember Ceramics,2099-08-01,1,Gold,half,"Garden, Main Hall",Linocuts`,
    `2026/05/03 8:02:10,${THIRD},Iris Vale,Driftwood Prints,2099-08-08,1,Gold,full,"Garden, Main Hall",Linocuts`,
  ].join('\n');
  await toThePreview(importPage, left);
  const { imports, held, write } = await holdTheWrite(page);
  await importPage.reviewerChooser.choose(ANA);
  await importPage.clickConfirm();
  await expect.poll(() => held.length).toBe(1);

  await page.goBack();
  await expect(page).toHaveURL(/\/tools$/);
  await followTheRail(page, importPage);
  await toThePreview(importPage, confirmed);
  await expect(importPage.reviewerChooser.chip(ANA)).toBeVisible();
  await importPage.clickConfirm();
  await expect(importPage.confirmButton).toBeDisabled();
  expect(imports).toEqual([]);

  // The gone page's re-read answers before this page's import can: a gone page importing would have
  // sent it by the time the result shows.
  const reread = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().endsWith(`/markets/${market.marketId}`),
  );
  await held[0]!.continue();
  await page.unroute(write);
  await reread;
  await expect(importPage.resultSummary).toContainText('Imported 2 new applications');
  expect(imports).toHaveLength(1);
  const applications = await applicationsOf(request, market.marketId);
  expect(applications.map((row) => row.applicantEmail).sort()).toEqual([THIRD, FIRST]);
  const nadia = applications.find((row) => row.applicantEmail === FIRST);
  expect(nadia?.formData.product_type).toBe('Linocuts');
});

test("a history jump to another market's import, the same page on screen, takes no file with it", async ({
  authenticatedPage: page,
  request,
}) => {
  const jumpedTo = await draftWithPeople(request);
  const here = await draftWithPeople(request);
  const importPage = new CsvImportPage(page);
  const position = () => page.evaluate(() => (history.state as { position: number }).position);

  await page.goto(marketScreenPath(jumpedTo.marketId, 'tools'));
  await followTheRail(page, importPage);
  const jumpedToAt = await position();
  await page.getByTestId('app-bar-logo').click();
  const markets = new MarketsPage(page);
  await markets.searchInput.fill(here.marketName);
  await markets.cardNames.filter({ hasText: here.marketName }).getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`/markets/${here.marketId}/`));
  await followTheRail(page, importPage);

  await toThePreview(importPage, CSV);
  const { imports, held, write } = await holdTheWrite(page);
  await importPage.reviewerChooser.choose(ANA);
  await importPage.clickConfirm();
  await expect.poll(() => held.length).toBe(1);

  // A long press on Back: the router keeps this page and hands it the other market.
  const steps = jumpedToAt - (await position());
  await page.evaluate((delta) => history.go(delta), steps);
  await expect(page).toHaveURL(new RegExp(`/markets/${jumpedTo.marketId}/import$`));

  const reread = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().endsWith(`/markets/${jumpedTo.marketId}`),
  );
  await held[0]!.continue();
  await page.unroute(write);
  await reread;

  // Upload, on the market in the address, ready for its own file.
  await expect(importPage.fileInput).toBeAttached();
  await expect(importPage.preview).toBeHidden();
  await expect(importPage.filename).toBeHidden();
  await expect.poll(() => applicationsOf(request, here.marketId)).toEqual([]);
  expect(imports).toEqual([]);
  expect(await applicationsOf(request, jumpedTo.marketId)).toEqual([]);
});
