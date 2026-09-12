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
    await page.getByTestId('import-preview-button').click();
    await expect(page.getByTestId('import-preview')).toContainText('3 rows');

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
});
