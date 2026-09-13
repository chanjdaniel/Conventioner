import { test, expect, TEST_USER, BACKEND_URL, CsvImportPage } from './fixtures';
import type { APIRequestContext } from '@playwright/test';
import { ensureTestOrg } from './helpers/seeds';
import { seedApplicantMarket, planSetupObject, PLAN_TIERS } from './helpers/seedApplicantMarket';

/**
 * Importing vendors from the CSV a Google Form produced (E01/F02/S02).
 *
 * The MVP's answer to "set up the vendors": the organizer maps their form's columns onto the
 * questions the solver reads, and the rows become applications awaiting review - the same kind of
 * document the public application form produces.
 */

/** Headers with the organizer's own question text, as a Google Form actually writes them. */
const HEADERS = [
  'Timestamp',
  'Email Address',
  'Business name',
  'Which days can you attend?',
  'How many days do you want?',
  'Which tiers will you accept?',
  'Full or half table?',
  "Partner's email if sharing",
  'Rank the sections',
  'What do you sell?',
];

const ROWS = [
  '2026/05/02 9:14:03,nadia@ember.test,Ember Ceramics,"2026-08-01, 2026-08-08",2,Gold,half,,"Garden, Main Hall",Pottery',
  '2026/05/02 11:40:22,theo@thistle.test,Thorn & Thistle,2026-08-01,1,Silver,full,,"Main Hall, Garden",Dried flowers',
  // Deliberately broken: no email, so it must be skipped and named rather than silently dropped.
  '2026/05/03 8:02:10,,Driftwood Prints,2026-08-08,1,Gold,either,,"Garden, Main Hall",Linocuts',
];

const CSV = [HEADERS.join(','), ...ROWS].join('\n');

/**
 * Every question in HEADERS the organizer has to map by hand.
 *
 * Google Forms always writes Timestamp first and names the address column Email Address, so those
 * two are offered without asking and are absent here.
 */
const FULL_MAPPING: Record<string, string> = {
  'Which days can you attend?': 'essential_available_dates',
  'How many days do you want?': 'essential_max_dates',
  'Which tiers will you accept?': 'essential_tier_preference',
  'Full or half table?': 'essential_table_choice',
  "Partner's email if sharing": 'essential_table_share_email',
  'Rank the sections': 'essential_section_ranking',
  'Business name': 'business_name',
  'What do you sell?': 'product_type',
};

/** A market with dates, tiers and sections on its plan, ready to be imported into. */
async function seedPlannedMarket(request: APIRequestContext) {
  return await seedApplicantMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    setupObject: planSetupObject(),
  });
}

/**
 * Open the import flow on a market, re-fetching it first so it carries the latest phase.
 *
 * The view reads the current market out of local storage, so every visit needs the document as it
 * stands now - a stale copy would show the organizer the phase they were in two transitions ago.
 */
async function openImport(
  importPage: CsvImportPage,
  request: APIRequestContext,
  marketId: string,
): Promise<void> {
  const res = await request.get(`${BACKEND_URL}/markets/${marketId}`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
  });
  const { market } = (await res.json()) as { market: Record<string, unknown> };
  await importPage.open(market, TEST_USER.email);
}

/** Which field carries the status varies by serializer version; this says so once. */
function statusOf(app: ApplicationRow): string | undefined {
  return app.statusRaw ?? app.status;
}

type ApplicationRow = {
  id: string;
  applicantEmail: string;
  statusRaw?: string;
  status?: string;
  submittedAt?: string;
  formData: Record<string, unknown>;
};

async function listApplications(
  request: APIRequestContext,
  marketId: string,
): Promise<ApplicationRow[]> {
  const res = await request.get(`${BACKEND_URL}/markets/${marketId}/applications`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
  });
  return ((await res.json()) as { applications: ApplicationRow[] }).applications;
}

test.describe('CSV vendor import', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('the organizer imports a Google Forms CSV and the rows become applications', async ({
    authenticatedPage: page,
    request,
  }, testInfo) => {
    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);

    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(CSV);

    // Every column in the file is listed, in file order.
    await expect(importPage.columnRows).toHaveCount(HEADERS.length);
    await expect(importPage.filename).toContainText('form-responses.csv');

    // Timestamp and Email Address are recognised without asking; everything else is mapped here.
    await expect(importPage.unmappedWarning).toBeVisible();
    await importPage.mapColumns(HEADERS, FULL_MAPPING);

    await expect(importPage.allMapped).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('01-import-mapping.png'),
      fullPage: true,
    });

    // Nothing is written until the organizer confirms.
    // The dry run says exactly what will happen before anything is written: two of the three
    // rows, with the third named and its reason given.
    await importPage.clickPreview();
    await expect(importPage.previewCounts).toContainText('2 of 3 rows');
    await expect(importPage.previewFailureRows).toHaveCount(1);
    await expect(importPage.previewFailureRows.first()).toContainText('Row 4');
    await expect(importPage.confirmButton).toContainText('Import 2 rows');

    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toContainText('2 new applications');

    // The row with no email is skipped and named, not silently dropped.
    await expect(importPage.failureRows).toHaveCount(1);
    await expect(importPage.failureRows.first()).toContainText('Row 4');
    await page.screenshot({
      path: testInfo.outputPath('02-import-result.png'),
      fullPage: true,
    });

    // The imported rows are ordinary applications: awaiting review, with the answers the solver
    // reads stored in exactly the shapes a form submission would have produced.
    const applications = await listApplications(request, seed.marketId);
    const nadia = applications.find((a) => a.applicantEmail === 'nadia@ember.test');
    expect(nadia).toBeTruthy();
    expect(statusOf(nadia!)).toBe('open');
    expect(nadia!.formData).toMatchObject({
      business_name: 'Ember Ceramics',
      product_type: 'Pottery',
      essential_available_dates: ['2026-08-01', '2026-08-08'],
      essential_max_dates: 2,
      essential_tier_preference: [PLAN_TIERS[0]],
      essential_table_choice: 'half',
      essential_table_share_email: '',
      essential_section_ranking: ['Garden', 'Main Hall'],
    });
    // Their own submission time, not the moment of import - a first-come-first-served priority
    // rule reads this, and one shared timestamp would make it meaningless.
    expect(nadia!.submittedAt).toBe('2026/05/02 9:14:03');
  });

  test('an unmapped required question imports nothing', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);

    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(CSV);

    // Map everything except the tier question.
    const withoutTier = Object.fromEntries(
      Object.entries(FULL_MAPPING).filter(([header]) => header !== 'Which tiers will you accept?'),
    );
    await importPage.mapColumns(HEADERS, withoutTier);

    // A configuration error, so the flow will not even offer to proceed.
    await expect(importPage.unmappedWarning).toContainText('Tier preference');
    await expect(importPage.previewButton).toBeDisabled();

    expect(await listApplications(request, seed.marketId)).toHaveLength(0);
  });

  test('a checkbox grid is mapped as one question', async ({
    authenticatedPage: page,
    request,
  }, testInfo) => {
    // The same market plan, asked as a Google Forms GRID: one column per option, the header
    // carrying the question stem and the option in brackets.
    const gridHeaders = [
      'Timestamp',
      'Email Address',
      'Business name',
      'Which days can you attend? [2026-08-01]',
      'Which days can you attend? [2026-08-08]',
      'How many days do you want?',
      'Which tiers will you accept?',
      'Full or half table?',
      'Rank the sections [Main Hall]',
      'Rank the sections [Garden]',
      'What do you sell?',
    ];
    const gridCsv = [
      gridHeaders.join(','),
      '2026/05/02 9:14:03,nadia@ember.test,Ember Ceramics,Yes,Yes,2,Gold,half,2nd choice,1st choice,Pottery',
    ].join('\n');

    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);

    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(gridCsv);

    // Two grids are recognised, each shown once with its member columns beneath it, and the
    // screen says which shape it read so a wrong guess is visible rather than silent.
    await expect(importPage.groupRows).toHaveCount(2);
    await expect(importPage.groupShape.first()).toContainText('2 columns · one per option');
    await expect(importPage.groupMembers).toHaveCount(4);

    // One action maps all of a grid's columns.
    await importPage.mapGroup(
      gridHeaders,
      'Which days can you attend? [2026-08-01]',
      'essential_available_dates',
    );
    await importPage.mapGroup(
      gridHeaders,
      'Rank the sections [Main Hall]',
      'essential_section_ranking',
    );
    await importPage.mapColumns(gridHeaders, {
      'How many days do you want?': 'essential_max_dates',
      'Which tiers will you accept?': 'essential_tier_preference',
      'Full or half table?': 'essential_table_choice',
      'Business name': 'business_name',
      'What do you sell?': 'product_type',
    });

    await expect(importPage.allMapped).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('03-import-grid-mapping.png'),
      fullPage: true,
    });

    await importPage.previewAndConfirm();
    await expect(importPage.resultSummary).toContainText('1 new application');

    const applications = await listApplications(request, seed.marketId);
    const nadia = applications.find((a) => a.applicantEmail === 'nadia@ember.test');
    // Identical to what the single-column spelling of the same answers produces.
    expect(nadia!.formData).toMatchObject({
      essential_available_dates: ['2026-08-01', '2026-08-08'],
      // The grid's own cells carry the order, so Garden's "1st choice" wins over column position.
      essential_section_ranking: ['Garden', 'Main Hall'],
    });
  });

  test('a grid the detection got wrong can be split apart', async ({
    authenticatedPage: page,
    request,
  }) => {
    const headers = ['Email Address', 'Notes [internal]', 'Notes [public]'];
    const csv = [headers.join(','), 'nadia@ember.test,a,b'].join('\n');

    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);

    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(csv);

    // Bracketed headers that are not really one question: the organizer says so and gets two
    // ordinary rows back.
    await expect(importPage.groupRows).toHaveCount(1);
    await importPage.splitGroup(headers, 'Notes [internal]');
    await expect(importPage.groupRows).toHaveCount(0);
    await expect(importPage.targetSelectAt(1)).toBeVisible();
    await expect(importPage.targetSelectAt(2)).toBeVisible();
  });

  test('a value the market does not recognise is resolved before anything is written', async ({
    authenticatedPage: page,
    request,
  }, testInfo) => {
    // The organizer's form said "Gold Tier"; the market's tier is called "Gold".
    const rows = [
      HEADERS.join(','),
      '2026/05/02 9:14:03,nadia@ember.test,Ember Ceramics,"2026-08-01, 2026-08-08",2,Gold Tier,half,,"Garden, Main Hall",Pottery',
      '2026/05/02 11:40:22,theo@thistle.test,Thorn & Thistle,2026-08-01,1,Gold Tier,full,,"Main Hall, Garden",Dried flowers',
    ].join('\n');

    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);

    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(rows);
    await importPage.mapColumns(HEADERS, FULL_MAPPING);

    // Everything is mapped, but the check finds a value nobody has spoken for and keeps the
    // organizer here rather than importing something it had to guess at.
    await importPage.clickPreview();
    await expect(importPage.valueFixes).toBeVisible();
    await expect(importPage.unmatchedValues).toHaveText('Gold Tier');
    // One decision per distinct value, with the number of rows it affects - not one per row.
    await expect(importPage.valueFixes).toContainText('2 rows');
    await expect(importPage.unresolvedWarning).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('04-import-value-fix.png'),
      fullPage: true,
    });

    await importPage.resolveValue('Gold Tier', 'Gold');
    await importPage.clickPreview();
    await expect(importPage.preview).toBeVisible();
    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toContainText('2 new applications');

    // The one resolution reached every row carrying that value.
    const applications = await listApplications(request, seed.marketId);
    expect(applications).toHaveLength(2);
    for (const app of applications) {
      expect(app.formData.essential_tier_preference).toEqual(['Gold']);
    }
  });

  test('a second import opens with the last mapping restored', async ({
    authenticatedPage: page,
    request,
  }, testInfo) => {
    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);

    // First import: the organizer maps everything by hand.
    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(CSV);
    await expect(importPage.restoredBanner).toHaveCount(0);
    await importPage.mapColumns(HEADERS, FULL_MAPPING);
    await importPage.previewAndConfirm();

    // Second import of the same form: nothing to redo. The form has since gained a question, and
    // that column is called out rather than quietly ignored.
    const secondHeaders = [...HEADERS, 'Anything else?'];
    const secondCsv = [secondHeaders.join(','), ROWS[0] + ',No'].join('\n');

    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(secondCsv);

    await expect(importPage.restoredBanner).toBeVisible();
    await expect(importPage.restoredNew).toContainText('1 column is new');
    await expect(importPage.restoredBadges.first()).toBeVisible();
    // Every required question is already served, so the organizer can go straight on.
    await expect(importPage.allMapped).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('05-import-restored.png'),
      fullPage: true,
    });

    await importPage.clickPreview();
    await expect(importPage.preview).toBeVisible();
  });

  test('a re-import updates who is already here and leaves the absent alone', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);

    // First import: two vendors (the third row has no email and is skipped).
    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(CSV);
    await importPage.mapColumns(HEADERS, FULL_MAPPING);
    await importPage.previewAndConfirm();

    const before = await listApplications(request, seed.marketId);
    const nadiaIdBefore = before.find((a) => a.applicantEmail === 'nadia@ember.test')!.id;

    // Second file: Nadia's answer has changed, and Theo is simply not in this export.
    const second = [
      HEADERS.join(','),
      ROWS[0].replace('Ember Ceramics', 'Ember Ceramics Studio'),
    ].join('\n');

    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(second);
    await expect(importPage.restoredBanner).toBeVisible();
    await importPage.clickPreview();

    // The preview separates the three fates before anything is written.
    await expect(importPage.previewMerge).toContainText('0 new, 1 updated');
    await expect(importPage.absentNote).toContainText('theo@thistle.test');
    await expect(importPage.absentNote).toContainText('left exactly as they are');

    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toBeVisible();

    const after = await listApplications(request, seed.marketId);
    // Updated in place, same id - the review view and any future offer reference it.
    const nadia = after.find((a) => a.applicantEmail === 'nadia@ember.test')!;
    expect(nadia.id).toBe(nadiaIdBefore);
    expect(nadia.formData.business_name).toBe('Ember Ceramics Studio');
    // Absent, and untouched.
    const theo = after.find((a) => a.applicantEmail === 'theo@thistle.test');
    expect(theo).toBeTruthy();
    expect(theo!.formData.business_name).toBe('Thorn & Thistle');
  });

  test('a re-import that changes a solver answer returns an approval to review', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);

    const onlyNadia = [HEADERS.join(','), ROWS[0]].join('\n');
    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(onlyNadia);
    await importPage.mapColumns(HEADERS, FULL_MAPPING);
    await importPage.previewAndConfirm();

    // The organizer reviews and approves them.
    const imported = (await listApplications(request, seed.marketId)).find(
      (a) => a.applicantEmail === 'nadia@ember.test',
    )!;
    const reviewRes = await request.put(
      `${BACKEND_URL}/markets/${seed.marketId}/applications/${imported.id}/review`,
      { headers: { 'X-Owner-Email': TEST_USER.email }, data: { status: 'reviewer_approved' } },
    );
    expect(reviewRes.ok()).toBeTruthy();

    // The form is re-exported with their availability narrowed - an answer the solver reads.
    const narrowed = [
      HEADERS.join(','),
      ROWS[0].replace('"2026-08-01, 2026-08-08",2', '2026-08-01,1'),
    ].join('\n');
    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(narrowed);
    await importPage.clickPreview();

    // Said before it happens: silently un-approving someone is not acceptable either way.
    await expect(importPage.returningNote).toContainText(
      '1 approved application will return to review',
    );
    await expect(importPage.returningNote).toContainText('nadia@ember.test');

    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toBeVisible();

    const after = (await listApplications(request, seed.marketId)).find(
      (a) => a.applicantEmail === 'nadia@ember.test',
    )!;
    expect(statusOf(after)).toBe('open');
  });

  test('importing is refused once review has begun, and possible again after reopening', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);
    const transition = async (toPhase: string) => {
      const res = await request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
        headers: { 'X-Owner-Email': TEST_USER.email },
        data: { toPhase },
      });
      expect(res.ok(), `transition to ${toPhase}: ${await res.text()}`).toBeTruthy();
    };

    await transition('applications_closed');
    await transition('review');

    // Server-side, not merely a hidden button: the endpoint refuses directly.
    const direct = await request.post(
      `${BACKEND_URL}/markets/${seed.marketId}/applications/import/inspect`,
      { headers: { 'X-Owner-Email': TEST_USER.email }, data: { csvContent: CSV } },
    );
    expect(direct.status()).toBe(409);
    expect(await direct.text()).toContain('Reopen applications');

    // And the screen says so before asking for a file.
    await openImport(importPage, request, seed.marketId);
    await expect(importPage.wrongPhase).toBeVisible();
    await expect(importPage.upload).toHaveCount(0);

    // The way through is the edge the state machine already has.
    await transition('applications_closed');
    await openImport(importPage, request, seed.marketId);
    await expect(importPage.upload).toBeVisible();
    await importPage.chooseFile(CSV);
    await expect(importPage.map).toBeVisible();
  });
});
