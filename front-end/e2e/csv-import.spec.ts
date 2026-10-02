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
  'Full Legal Name',
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
  '2026/05/02 9:14:03,nadia@ember.test,Nadia Okonkwo,Ember Ceramics,"2026-08-01, 2026-08-08",2,Gold,half,,"Garden, Main Hall",Pottery',
  '2026/05/02 11:40:22,theo@thistle.test,Theo Marchetti,Thorn & Thistle,2026-08-01,1,Silver,full,,"Main Hall, Garden",Dried flowers',
  // Deliberately broken: no email, so it must be skipped and named rather than silently dropped.
  '2026/05/03 8:02:10,,Jan van der Berg,Driftwood Prints,2026-08-08,1,Gold,either,,"Garden, Main Hall",Linocuts',
];

const CSV = [HEADERS.join(','), ...ROWS].join('\n');

/**
 * Every question in HEADERS the organizer has to map by hand.
 *
 * Google Forms always writes Timestamp first and names the address column Email Address, so those
 * two are offered without asking and are absent here.
 */
const FULL_MAPPING: Record<string, string> = {
  'Full Legal Name': 'essential_full_name',
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
  await importPage.open(market);
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

    // An import writes applications into one market, and the page used to name none of them.
    await expect(importPage.targetMarket).toContainText(seed.marketName);
    await expect(importPage.dropZone).toBeVisible();

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

    // The step is called Preview, so it shows the organizer's own rows read through the mapping
    // they just chose - not a second recap of the mapping itself. This is the only place the
    // mapping can be checked against real data before 232 applications are written.
    await expect(importPage.sampleRows.first()).toContainText('Ember Ceramics');
    await expect(importPage.sampleRows.first()).toContainText('nadia@ember.test');

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
      // Per date (E01/F05); this row answered once, so it applies to every date it can attend.
      essential_tier_preference: {
        '2026-08-01': [PLAN_TIERS[0]],
        '2026-08-08': [PLAN_TIERS[0]],
      },
      essential_table_choice: 'half',
      essential_table_share_email: '',
      essential_section_ranking: ['Garden', 'Main Hall'],
    });
    // Their own submission time, not the moment of import - a first-come-first-served priority
    // rule reads this, and one shared timestamp would make it meaningless.
    // Stored as a moment, not as the text the form wrote (E01/F04/S02): every reader - the
    // solver's priority rule and the review queue's sort - compares this one stored value.
    expect(nadia!.submittedAt).toBe('2026-05-02T09:14:03');
  });

  test('a file of headers and nothing else previews no rows, rather than three empty ones', async ({
    authenticatedPage: page,
    request,
  }) => {
    // A Google Form with no responses yet exports exactly this: the question row, and nothing
    // under it. It parses fine and maps fine, so it reaches the preview like any other file.
    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);

    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(HEADERS.join(','));
    await importPage.mapColumns(HEADERS, FULL_MAPPING);
    await importPage.clickPreview();

    await expect(importPage.previewCounts).toContainText('0 of 0 rows');
    // Not three cards of "no answer" under "The first 3 rows, as they will be imported".
    await expect(importPage.sampleRows).toHaveCount(0);
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
      'Full Legal Name',
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
      '2026/05/02 9:14:03,nadia@ember.test,Nadia Okonkwo,Ember Ceramics,Yes,Yes,2,Gold,half,2nd choice,1st choice,Pottery',
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
      'Full Legal Name': 'essential_full_name',
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

  test('a tier grid headed by days as Google writes them imports, by hand', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Bug 26 (E26/F02/S05): a day heading was offered only tiers to match, so no heading but an
    // ISO one could ever import, and "Not available" was one more tier nobody offered.
    const headers = [
      'Timestamp',
      'Email Address',
      'Full Legal Name',
      'Business name',
      'Which tiers would you take? [Saturday, August 1]',
      'Which tiers would you take? [Second Saturday]',
      'Which tiers would you take? [Saturday, August 15, 2026]',
      'How many days do you want?',
      'Full or half table?',
      'Rank the sections',
      'What do you sell?',
    ];
    const file = [
      headers.map((h) => (h.includes(',') ? `"${h}"` : h)).join(','),
      '2026/05/02 9:14:03,nadia@ember.test,Nadia Okonkwo,Ember Ceramics,Gold,Not available,Silver,2,half,"Garden, Main Hall",Pottery',
      '2026/05/02 11:40:22,theo@thistle.test,Theo Marchetti,Thorn & Thistle,None,"Gold, Silver",Not available,1,full,"Main Hall, Garden",Dried flowers',
    ].join('\n');

    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);
    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(file);
    await importPage.mapGroup(
      headers,
      'Which tiers would you take? [Saturday, August 1]',
      'essential_tier_preference',
    );
    await importPage.mapColumns(headers, {
      'Full Legal Name': 'essential_full_name',
      'How many days do you want?': 'essential_max_dates',
      'Full or half table?': 'essential_table_choice',
      'Rank the sections': 'essential_section_ranking',
      'Business name': 'business_name',
      'What do you sell?': 'product_type',
    });
    await importPage.clickPreview();

    // A day the heading names is recognised, with or without its year; only the one heading that
    // names no date is asked about - and it is offered the market's dates, not its tiers.
    await expect(importPage.unmatchedValues).toHaveText(['Second Saturday']);
    const fix = page.getByTestId('import-fix-Second Saturday');
    await expect(fix.locator('option[value="2026-08-08"]')).toHaveCount(1);
    await expect(fix.locator('option[value="Gold"]')).toHaveCount(0);
    await importPage.resolveValue('Second Saturday', '2026-08-08');
    await importPage.clickPreview();

    await expect(importPage.previewCounts).toContainText('2 of 2 rows');
    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toContainText('Imported 2 new applications');

    const applications = await listApplications(request, seed.marketId);
    const answers = Object.fromEntries(
      applications.map((a) => [
        a.applicantEmail,
        [a.formData.essential_available_dates, a.formData.essential_tier_preference],
      ]),
    );
    expect(answers).toEqual({
      'nadia@ember.test': [
        ['2026-08-01', '2026-08-15'],
        { '2026-08-01': ['Gold'], '2026-08-15': ['Silver'] },
      ],
      'theo@thistle.test': [['2026-08-08'], { '2026-08-08': ['Gold', 'Silver'] }],
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
      '2026/05/02 9:14:03,nadia@ember.test,Nadia Okonkwo,Ember Ceramics,"2026-08-01, 2026-08-08",2,Gold Tier,half,,"Garden, Main Hall",Pottery',
      '2026/05/02 11:40:22,theo@thistle.test,Theo Marchetti,Thorn & Thistle,2026-08-01,1,Gold Tier,full,,"Main Hall, Garden",Dried flowers',
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
      // Per date (E01/F05). This row answered once, so Gold applies to every date it can attend.
      expect(app.formData.essential_tier_preference).toEqual(
        Object.fromEntries(
          (app.formData.essential_available_dates as string[]).map((d) => [d, ['Gold']]),
        ),
      );
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

  test('a value decision stays on the mapping step, and a restored one can be changed', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Bug 28 (E26/F02/S06): a matched value vanished once the preview ran, Back did not bring it
    // back, and a decision restored from the last import was applied silently with no way to see
    // or change it short of starting over.
    const file = [HEADERS.join(','), ROWS[0].replace(',Gold,', ',Gold Tier,')].join('\n');
    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);

    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(file);
    await importPage.mapColumns(HEADERS, FULL_MAPPING);
    await importPage.clickPreview();
    await importPage.resolveValue('Gold Tier', 'Gold');
    await importPage.clickPreview();
    await expect(importPage.previewCounts).toBeVisible();

    // Back from the preview: the decision is still on the page, and still what was chosen.
    await importPage.backButton.click();
    await expect(importPage.decidedValues).toHaveText(['Gold Tier']);
    await expect(importPage.decision('Gold Tier')).toHaveValue('Gold');
    await importPage.clickPreview();
    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toContainText('Imported 1 new application');

    // The next import restores that decision - and shows it, before any preview, to be changed.
    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(file);
    await expect(importPage.restoredBanner).toBeVisible();
    await expect(importPage.decidedValues).toHaveText(['Gold Tier']);
    await expect(importPage.decision('Gold Tier')).toHaveValue('Gold');
    await importPage.decision('Gold Tier').selectOption('Silver');
    await importPage.clickPreview();
    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toContainText('updated 1');

    const [nadia] = await listApplications(request, seed.marketId);
    expect(nadia.formData.essential_tier_preference).toEqual({
      '2026-08-01': ['Silver'],
      '2026-08-08': ['Silver'],
    });
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

  /**
   * The flow sits at the workspace width, centred, and does not move between steps (E20/F02/S01).
   *
   * It never joined the project's sizing model: uncapped, so at 1920 its 720px panel sat pinned to
   * the left of a full-bleed header with 1,200px of nothing beside it, and Cancel was a screen's
   * width away from the thing it cancelled.
   *
   * ONE shell width for all four steps, although three are narrow panels and the mapping ledger
   * wants the whole room. A shell that changed width as the organizer pressed Next would read as
   * instability, and the step indicator already says where they are - so the WALK is the test.
   */
  test('the flow is one width, centred, from upload to confirm', async ({
    authenticatedPage: page,
    request,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);
    await openImport(importPage, request, seed.marketId);

    const shell = page.locator('.import-view');
    const workspace = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--workspace-max')),
    );
    expect(workspace, '--workspace-max is not defined').toBeGreaterThan(0);

    /** The shell's box, plus anything hiding its content in a nested scroller. */
    const measure = async () =>
      await page.evaluate(() => {
        const view = document.querySelector('.import-view')!;
        const box = view.getBoundingClientRect();
        // The page's own width: the root reserves the scrollbar's room whether or not it scrolls,
        // and `clientWidth` does not count that room out.
        const page = document.body.getBoundingClientRect();
        const boxed = Array.from(document.querySelectorAll('*'))
          .filter((el) => {
            const style = getComputedStyle(el);
            return /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 24;
          })
          .map((el) => el.className.toString().split(' ')[0] || el.tagName);
        return {
          width: Math.round(box.width),
          left: Math.round(box.left),
          right: Math.round(page.right - box.right),
          boxed,
        };
      });

    const seen: Array<{ step: string; width: number; left: number; right: number }> = [];
    const record = async (step: string) => {
      const m = await measure();
      expect(m.boxed, `${step} is hiding its content inside a box`).toEqual([]);
      seen.push({ step, width: m.width, left: m.left, right: m.right });
    };

    await expect(importPage.dropZone).toBeVisible();
    await record('upload');

    await importPage.chooseFile(CSV);
    await expect(importPage.columnRows).toHaveCount(HEADERS.length);
    await record('map');

    await importPage.mapColumns(HEADERS, FULL_MAPPING);
    await importPage.clickPreview();
    await expect(importPage.previewCounts).toBeVisible();
    await record('preview');

    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toBeVisible();
    await record('done');

    // One of the two named widths, and centred - not a width of its own and not full bleed.
    for (const step of seen) {
      expect(step.width, `${step.step} is not at the workspace width`).toBe(workspace);
      expect(step.left, `${step.step} is not centred`).toBe(step.right);
    }

    // And the SAME width at every step, which is what the walk is here to prove.
    expect(
      new Set(seen.map((step) => step.width)).size,
      `the shell changes width between steps: ${JSON.stringify(seen)}`,
    ).toBe(1);

    // The narrow steps centre their panel inside that shell rather than hugging its left edge.
    await expect(shell.locator('.import-panel')).toHaveCount(1);
    const panel = await page.evaluate(() => {
      const view = document.querySelector('.import-view')!.getBoundingClientRect();
      const box = document.querySelector('.import-panel')!.getBoundingClientRect();
      return { lead: Math.round(box.left - view.left), trail: Math.round(view.right - box.right) };
    });
    expect(panel.lead, 'the panel is not centred within the shell').toBe(panel.trail);
    expect(panel.lead).toBeGreaterThan(0);
  });

  test('a day spelled with a comma is one answer, and a date matched twice counts once', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Bug 27 (E26/F02/S04): Google joins a checkbox answer's options with ", ", and a day like
    // "Saturday, August 1st" has a comma of its own. Every comma was a split, so the organizer
    // matched "Saturday" and "August 1st" separately - and matching both halves to the same date
    // refused the row for repeating it.
    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);
    const file = [
      HEADERS.join(','),
      ROWS[0].replace('"2026-08-01, 2026-08-08"', '"Saturday, August 1st, Saturday, August 8th"'),
      // The same day twice, once as the market spells it and once as the form did.
      ROWS[1].replace(',2026-08-01,1,', ',"2026-08-01, Saturday, August 1st",1,'),
    ].join('\n');

    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(file);
    await importPage.mapColumns(HEADERS, FULL_MAPPING);
    await importPage.clickPreview();

    // Each day is read whole, and as the market day it names - no halves to match, and no
    // decision at all (bug 26 taught the import to read a day written in words).
    await expect(importPage.previewCounts).toContainText('2 of 2 rows');
    await expect(importPage.valueFixes).toHaveCount(0);
    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toContainText('Imported 2 new applications');

    const applications = await listApplications(request, seed.marketId);
    const dates = Object.fromEntries(
      applications.map((a) => [a.applicantEmail, a.formData.essential_available_dates]),
    );
    expect(dates).toEqual({
      'nadia@ember.test': ['2026-08-01', '2026-08-08'],
      'theo@thistle.test': ['2026-08-01'],
    });
  });

  test('the preview reports honestly: its sample, every problem, and what really changed', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Bug 40 (E26/F02/S08), items 1, 3 and 4.
    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);
    const broken = ROWS[2].replace('8:02:10,,Jan van der Berg', '8:02:10,jan@driftwood.test,');
    const file = [HEADERS.join(','), broken.replace(',either,', ',,'), ROWS[0], ROWS[1]].join('\n');

    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(file);
    await importPage.mapColumns(HEADERS, FULL_MAPPING);
    await importPage.clickPreview();

    // Every problem the skipped row has, so one round in the spreadsheet fixes it.
    await expect(importPage.previewFailureRows).toHaveCount(1);
    await expect(importPage.previewFailureRows.first()).toContainText("'Full name' is required.");
    await expect(importPage.previewFailureRows.first()).toContainText(
      "'Table choice' is required.",
    );
    // The sample is rows that will import - not the file's first three, one of them skipped - and
    // reads as the applicant's answers will be stored.
    await expect(importPage.sampleRows).toHaveCount(2);
    await expect(importPage.sampleRows.first()).toContainText('Ember Ceramics');
    await expect(importPage.sampleRows.first()).toContainText('Saturday, August 1, 2026');
    await expect(importPage.sampleRows.first()).toContainText('Half a table, shared');
    await expect(importPage.preview).not.toContainText('Driftwood Prints');
    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toHaveText('Imported 2 new applications.');

    // Imported again with one applicant's answers changed: one updated, one unchanged - not two
    // "updated" for a file in which one thing moved.
    const changed = [
      HEADERS.join(','),
      ROWS[0].replace('Ember Ceramics', 'Ember Ceramics Studio'),
      ROWS[1],
    ].join('\n');
    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(changed);
    await importPage.clickPreview();
    await expect(importPage.previewMerge).toContainText('0 new, 1 updated, 1 unchanged');
    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toHaveText(
      'Imported 0 new applications, updated 1. 1 unchanged.',
    );
  });

  test('a ragged file is refused, and a day grid and an unmapped question are described truly', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Bug 40 items 5, 6 and 7.
    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);
    await openImport(importPage, request, seed.marketId);

    // A heading with an unquoted comma: every later column is one place off on every row.
    await importPage.chooseFile(
      [
        'Timestamp,Email Address,Name, if any,Business name',
        ROWS[0].split(',').slice(0, 4).join(','),
      ].join('\n'),
    );
    await expect(page.getByTestId('import-error')).toContainText('Row 2 has 4 cells');
    await expect(page.getByTestId('import-error')).toContainText('header has 5');

    const gridHeaders = ['Email Address', 'Tiers? [2026-08-01]', 'Tiers? [2026-08-08]'];
    await importPage.open({ id: seed.marketId });
    await importPage.chooseFile([gridHeaders.join(','), 'nadia@ember.test,Gold,Silver'].join('\n'));
    await importPage.mapGroup(gridHeaders, 'Tiers? [2026-08-01]', 'essential_tier_preference');
    await expect(importPage.groupShape.first()).toHaveText('2 columns · one per day');
    // Not "Your form never asked it": this market's own online form does ask it.
    await expect(page.getByTestId('import-declare-unasked').first()).toContainText(
      'No column in this file answers',
    );
  });

  test('a skipped row is not written, and an address that is not one is skipped', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Bugs 5 and 35 (E26/F02/S02): a row the preview skipped was still created as an empty
    // application, and any text at all in the email column was taken as the applicant's address.
    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);
    const file = [
      HEADERS.join(','),
      ROWS[0],
      ROWS[1].replace('theo@thistle.test', 'not-an-email'),
      // A real address, but no name - a required answer - so the row cannot be imported.
      ROWS[2].replace('8:02:10,,Jan van der Berg', '8:02:10,jan@driftwood.test,'),
    ].join('\n');

    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(file);
    await importPage.mapColumns(HEADERS, FULL_MAPPING);
    await importPage.clickPreview();

    await expect(importPage.previewCounts).toContainText('1 of 3 rows');
    await expect(importPage.previewFailureRows).toHaveCount(2);
    await expect(importPage.previewFailureRows.nth(0)).toContainText('Row 3');
    await expect(importPage.previewFailureRows.nth(0)).toContainText(
      "'not-an-email' is not an email address",
    );
    await expect(importPage.previewFailureRows.nth(1)).toContainText('Row 4');
    await expect(importPage.previewFailureRows.nth(1)).toContainText('jan@driftwood.test');

    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toContainText('Imported 1 new application.');
    await expect(importPage.failureRows).toHaveCount(2);

    // Exactly what the preview promised: the skipped rows are not in the market at all.
    const applications = await listApplications(request, seed.marketId);
    expect(applications.map((a) => a.applicantEmail)).toEqual(['nadia@ember.test']);
  });

  test('an applicant listed twice is imported once, from their latest row, and a re-import of the same file keeps their approval', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Bug 34 (E26/F02/S02): each row was compared in turn with the stored application, which
    // holds the last row's answers, so an unchanged repeat applicant read as changed on every
    // re-import and lost their approval. The preview counted applicants and the result rows.
    const seed = await seedPlannedMarket(request);
    const importPage = new CsvImportPage(page);
    // Nadia applied, then applied again the next day with more dates. Google Forms keeps both.
    const earlier = ROWS[0]
      .replace('2026/05/02 9:14:03', '2026/05/01 16:20:00')
      .replace('Ember Ceramics', 'Ember')
      .replace('"2026-08-01, 2026-08-08",2', '2026-08-01,1');
    const file = [HEADERS.join(','), earlier, ROWS[0], ROWS[1]].join('\n');

    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(file);
    await importPage.mapColumns(HEADERS, FULL_MAPPING);
    await importPage.clickPreview();

    await expect(importPage.previewCounts).toContainText('2 of 3 rows');
    await expect(importPage.repeatNote).toContainText('Row 2 (nadia@ember.test)');
    await expect(importPage.repeatNote).toContainText('latest row');
    await expect(importPage.previewFailureRows).toHaveCount(0);
    await expect(importPage.confirmButton).toContainText('Import 2 rows');

    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toHaveText('Imported 2 new applications.');

    const applications = await listApplications(request, seed.marketId);
    expect(applications).toHaveLength(2);
    const nadia = applications.find((a) => a.applicantEmail === 'nadia@ember.test')!;
    // Their answers are their latest ones...
    expect(nadia.formData.business_name).toBe('Ember Ceramics');
    expect(nadia.formData.essential_available_dates).toEqual(['2026-08-01', '2026-08-08']);
    // ...and their place in a first-come-first-served queue is when they first applied.
    expect(nadia.submittedAt).toBe('2026-05-01T16:20:00');

    // The organizer approves everyone, then imports the same export again.
    for (const application of applications) {
      const res = await request.put(
        `${BACKEND_URL}/markets/${seed.marketId}/applications/${application.id}/review`,
        { headers: { 'X-Owner-Email': TEST_USER.email }, data: { status: 'reviewer_approved' } },
      );
      expect(res.ok()).toBeTruthy();
    }

    await openImport(importPage, request, seed.marketId);
    await importPage.chooseFile(file);
    await expect(importPage.restoredBanner).toBeVisible();
    await importPage.clickPreview();

    // Nothing changed, so nobody's decision is undone - and both screens count the same thing.
    await expect(importPage.previewMerge).toContainText('0 new, 0 updated, 2 unchanged');
    await expect(importPage.returningNote).toHaveCount(0);
    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toHaveText('Imported 0 new applications. 2 unchanged.');

    const after = await listApplications(request, seed.marketId);
    expect(after.map(statusOf)).toEqual(['reviewer_approved', 'reviewer_approved']);
  });
});
