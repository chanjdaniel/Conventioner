import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { Page } from '@playwright/test';
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

/** Put the seeded market where every organizer view reads it, then open the import flow. */
async function openImport(page: Page, market: Record<string, unknown>) {
  await page.evaluate(
    ({ m, user }) => {
      localStorage.setItem('market', JSON.stringify(m));
      localStorage.setItem('user', JSON.stringify(user));
    },
    { m: market, user: TEST_USER.email },
  );
  await page.goto('/import-applications');
  await expect(page.getByTestId('import-view')).toBeVisible();
}

async function chooseFile(page: Page, contents: string) {
  await page.getByTestId('import-file-input').setInputFiles({
    name: 'form-responses.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(contents, 'utf-8'),
  });
}

/** Map a target onto the column whose header is `header`. */
async function mapColumn(page: Page, header: string, targetKey: string) {
  const index = HEADERS.indexOf(header);
  await page.getByTestId(`import-target-select-${index}`).selectOption(targetKey);
}

test.describe('CSV vendor import', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('the organizer imports a Google Forms CSV and the rows become applications', async ({
    authenticatedPage: page,
    request,
  }, testInfo) => {
    const seed = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { setupObject: planSetupObject() },
    );
    const marketRes = await request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market } = (await marketRes.json()) as { market: Record<string, unknown> };

    await openImport(page, market);
    await chooseFile(page, CSV);

    // Every column in the file is listed, in file order.
    await expect(page.getByTestId('import-column-row')).toHaveCount(HEADERS.length);
    await expect(page.getByTestId('import-filename')).toContainText('form-responses.csv');

    // Google Forms always writes Timestamp first and names the address column Email Address, so
    // those two are offered without asking. Everything else the organizer maps.
    await expect(page.getByTestId('import-unmapped-warning')).toBeVisible();
    await mapColumn(page, 'Which days can you attend?', 'essential_available_dates');
    await mapColumn(page, 'How many days do you want?', 'essential_max_dates');
    await mapColumn(page, 'Which tiers will you accept?', 'essential_tier_preference');
    await mapColumn(page, 'Full or half table?', 'essential_table_choice');
    await mapColumn(page, "Partner's email if sharing", 'essential_table_share_email');
    await mapColumn(page, 'Rank the sections', 'essential_section_ranking');
    await mapColumn(page, 'Business name', 'business_name');
    await mapColumn(page, 'What do you sell?', 'product_type');

    await expect(page.getByTestId('import-all-mapped')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('01-import-mapping.png'),
      fullPage: true,
    });

    // Nothing is written until the organizer confirms.
    // The dry run says exactly what will happen before anything is written: two of the three
    // rows, with the third named and its reason given.
    await page.getByTestId('import-preview-button').click();
    await expect(page.getByTestId('import-preview-counts')).toContainText('2 of 3 rows');
    const previewSkips = page.getByTestId('import-preview-failure-row');
    await expect(previewSkips).toHaveCount(1);
    await expect(previewSkips.first()).toContainText('Row 4');
    await expect(page.getByTestId('import-confirm-button')).toContainText('Import 2 rows');

    await page.getByTestId('import-confirm-button').click();
    await expect(page.getByTestId('import-result-summary')).toContainText('2 new applications');

    // The row with no email is skipped and named, not silently dropped.
    const failures = page.getByTestId('import-failure-row');
    await expect(failures).toHaveCount(1);
    await expect(failures.first()).toContainText('Row 4');
    await page.screenshot({
      path: testInfo.outputPath('02-import-result.png'),
      fullPage: true,
    });

    // The imported rows are ordinary applications: awaiting review, with the answers the solver
    // reads stored in exactly the shapes a form submission would have produced.
    const listRes = await request.get(`${BACKEND_URL}/markets/${seed.marketId}/applications`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { applications } = (await listRes.json()) as {
      applications: Array<{
        applicantEmail: string;
        statusRaw?: string;
        status?: string;
        submittedAt?: string;
        formData: Record<string, unknown>;
      }>;
    };
    const nadia = applications.find((a) => a.applicantEmail === 'nadia@ember.test');
    expect(nadia).toBeTruthy();
    expect(nadia!.statusRaw ?? nadia!.status).toBe('open');
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
    const seed = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { setupObject: planSetupObject() },
    );
    const marketRes = await request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market } = (await marketRes.json()) as { market: Record<string, unknown> };

    await openImport(page, market);
    await chooseFile(page, CSV);

    // Map everything except the tier question.
    await mapColumn(page, 'Which days can you attend?', 'essential_available_dates');
    await mapColumn(page, 'How many days do you want?', 'essential_max_dates');
    await mapColumn(page, 'Full or half table?', 'essential_table_choice');
    await mapColumn(page, 'Rank the sections', 'essential_section_ranking');
    await mapColumn(page, 'Business name', 'business_name');
    await mapColumn(page, 'What do you sell?', 'product_type');

    // A configuration error, so the flow will not even offer to proceed.
    await expect(page.getByTestId('import-unmapped-warning')).toContainText('Tier preference');
    await expect(page.getByTestId('import-preview-button')).toBeDisabled();

    const listRes = await request.get(`${BACKEND_URL}/markets/${seed.marketId}/applications`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { applications } = (await listRes.json()) as { applications: unknown[] };
    expect(applications).toHaveLength(0);
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

    const seed = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { setupObject: planSetupObject() },
    );
    const marketRes = await request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market } = (await marketRes.json()) as { market: Record<string, unknown> };

    await openImport(page, market);
    await chooseFile(page, gridCsv);

    // Two grids are recognised, each shown once with its member columns beneath it, and the
    // screen says which shape it read so a wrong guess is visible rather than silent.
    await expect(page.getByTestId('import-group-row')).toHaveCount(2);
    await expect(page.getByTestId('import-group-shape').first()).toContainText(
      '2 columns · one per option',
    );
    await expect(page.getByTestId('import-group-member')).toHaveCount(4);

    // One action maps all of a grid's columns.
    await page.getByTestId('import-group-select-3').selectOption('essential_available_dates');
    await page.getByTestId('import-group-select-8').selectOption('essential_section_ranking');
    await page.getByTestId('import-target-select-5').selectOption('essential_max_dates');
    await page.getByTestId('import-target-select-6').selectOption('essential_tier_preference');
    await page.getByTestId('import-target-select-7').selectOption('essential_table_choice');
    await page.getByTestId('import-target-select-2').selectOption('business_name');
    await page.getByTestId('import-target-select-10').selectOption('product_type');

    await expect(page.getByTestId('import-all-mapped')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('03-import-grid-mapping.png'),
      fullPage: true,
    });

    await page.getByTestId('import-preview-button').click();
    await page.getByTestId('import-confirm-button').click();
    await expect(page.getByTestId('import-result-summary')).toContainText('1 new application');

    const listRes = await request.get(`${BACKEND_URL}/markets/${seed.marketId}/applications`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { applications } = (await listRes.json()) as {
      applications: Array<{ applicantEmail: string; formData: Record<string, unknown> }>;
    };
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

    const seed = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { setupObject: planSetupObject() },
    );
    const marketRes = await request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market } = (await marketRes.json()) as { market: Record<string, unknown> };

    await openImport(page, market);
    await chooseFile(page, csv);

    // Bracketed headers that are not really one question: the organizer says so and gets two
    // ordinary rows back.
    await expect(page.getByTestId('import-group-row')).toHaveCount(1);
    await page.getByTestId('import-split-group-1').click();
    await expect(page.getByTestId('import-group-row')).toHaveCount(0);
    await expect(page.getByTestId('import-target-select-1')).toBeVisible();
    await expect(page.getByTestId('import-target-select-2')).toBeVisible();
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

    const seed = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { setupObject: planSetupObject() },
    );
    const marketRes = await request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market } = (await marketRes.json()) as { market: Record<string, unknown> };

    await openImport(page, market);
    await chooseFile(page, rows);

    await mapColumn(page, 'Which days can you attend?', 'essential_available_dates');
    await mapColumn(page, 'How many days do you want?', 'essential_max_dates');
    await mapColumn(page, 'Which tiers will you accept?', 'essential_tier_preference');
    await mapColumn(page, 'Full or half table?', 'essential_table_choice');
    await mapColumn(page, "Partner's email if sharing", 'essential_table_share_email');
    await mapColumn(page, 'Rank the sections', 'essential_section_ranking');
    await mapColumn(page, 'Business name', 'business_name');
    await mapColumn(page, 'What do you sell?', 'product_type');

    // Everything is mapped, but the check finds a value nobody has spoken for and keeps the
    // organizer here rather than importing something it had to guess at.
    await page.getByTestId('import-preview-button').click();
    await expect(page.getByTestId('import-value-fixes')).toBeVisible();
    await expect(page.getByTestId('import-unmatched-value')).toHaveText('Gold Tier');
    // One decision per distinct value, with the number of rows it affects - not one per row.
    await expect(page.getByTestId('import-value-fixes')).toContainText('2 rows');
    await expect(page.getByTestId('import-unresolved-warning')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('04-import-value-fix.png'),
      fullPage: true,
    });

    await page.getByTestId('import-fix-Gold Tier').selectOption('Gold');
    await page.getByTestId('import-preview-button').click();
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await page.getByTestId('import-confirm-button').click();
    await expect(page.getByTestId('import-result-summary')).toContainText('2 new applications');

    // The one resolution reached every row carrying that value.
    const listRes = await request.get(`${BACKEND_URL}/markets/${seed.marketId}/applications`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { applications } = (await listRes.json()) as {
      applications: Array<{ applicantEmail: string; formData: Record<string, unknown> }>;
    };
    expect(applications).toHaveLength(2);
    for (const app of applications) {
      expect(app.formData.essential_tier_preference).toEqual(['Gold']);
    }
  });
});
