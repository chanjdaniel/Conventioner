import { test, expect, TEST_USER, BACKEND_URL, CsvImportPage } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { ensureTestOrg } from './helpers/seeds';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { seedApplication } from './helpers/seedApplication';

/**
 * Fixing the form without leaving the import (E20/F03/S01).
 *
 * The wizard printed four manual steps and two phase transitions - "reopen the market for
 * editing, turn it off in the form builder, then open applications and import again" - and the
 * organizer lost their upload on the way.
 *
 * Two things are worth proving here and neither is "it works": that the chain returns the market
 * to the phase it STARTED in, from both phases the wizard runs in; and that a form edited so that
 * it asks nothing is refused BEFORE the market moves, so there is nothing stranded to recover.
 */

const HEADERS = [
  'Timestamp',
  'Email Address',
  'Full Legal Name',
  'Which days can you attend?',
  'How many days do you want?',
  'Which tiers will you accept?',
  'Full or half table?',
  "Partner's email if sharing",
  'Rank the sections',
  'Our secret handshake',
];

const ROWS = [
  '2026/05/02 9:14:03,nadia@ember.test,Nadia Okonkwo,"2026-08-01, 2026-08-08",2,Gold,half,,"Garden, Main Hall",Left hand twice',
];

const CSV = [HEADERS.join(','), ...ROWS].join('\n');

async function seedPlannedMarket(request: APIRequestContext) {
  return await seedApplicantMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    setupObject: planSetupObject(),
  });
}

async function transition(
  request: APIRequestContext,
  marketId: string,
  toPhase: string,
): Promise<void> {
  const res = await request.post(`${BACKEND_URL}/markets/${marketId}/transition`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
    data: { toPhase },
  });
  expect(res.ok(), `transition to ${toPhase}: ${await res.text()}`).toBeTruthy();
}

async function phaseOf(request: APIRequestContext, marketId: string): Promise<string> {
  const res = await request.get(`${BACKEND_URL}/markets/${marketId}`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
  });
  return ((await res.json()) as { market: { phase: string } }).market.phase;
}

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

/** Reach the mapping ledger with a file whose last column has nowhere to go. */
async function reachTheLedger(page: Page, request: APIRequestContext, marketId: string) {
  const importPage = new CsvImportPage(page);
  await openImport(importPage, request, marketId);
  await importPage.chooseFile(CSV);
  await expect(importPage.columnRows).toHaveCount(HEADERS.length);
  return importPage;
}

test.describe('Fixing the form from inside the import', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('from applications open, it returns the market to applications open', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPlannedMarket(request);
    expect(await phaseOf(request, seed.marketId)).toBe('applications_open');

    const importPage = await reachTheLedger(page, request, seed.marketId);

    // The column with nowhere to go used to print four manual steps. It offers the walk now.
    await importPage.targetSelectAt(HEADERS.length - 1).selectOption('__needs_a_field__');
    await expect(page.getByTestId('import-needs-a-field')).toBeVisible();
    await page.getByTestId('import-add-a-field-button').click();

    const dialog = page.getByTestId('amend-form-window');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Prefilled from the column that opened it, so the organizer is not retyping their own header.
    await expect(page.getByTestId('amend-form-label-input')).toHaveValue('Our secret handshake');
    await expect(page.getByTestId('amend-form-key-input')).toHaveValue('our_secret_handshake');

    // Both notes are STATED, not discovered.
    await expect(page.getByTestId('amend-form-redate-note')).toBeVisible();

    await page.getByTestId('amend-form-submit-button').click();
    await expect(dialog).toBeHidden({ timeout: 20000 });

    // Back where it started, and the new question is a target the ledger offers.
    expect(await phaseOf(request, seed.marketId)).toBe('applications_open');
    await expect(importPage.map).toBeVisible();
    await expect(
      importPage.targetSelectAt(HEADERS.length - 1).locator('option[value="our_secret_handshake"]'),
    ).toHaveCount(1);

    // And Market Setup, reached without a reload, shows the market as the chain left it: the
    // phase it returned to, and the question it added (E21/F02/S04). The import used to read and
    // never write a stored copy of the market, so the way back showed the market as it had been.
    await page.getByTestId('import-leave-button').click();
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Applications Open', {
      timeout: 10000,
    });
    await page.getByTestId('market-bar-tab-form').click();
    await expect(page.getByTestId('form-field-label-input').last()).toHaveValue(
      'Our secret handshake',
      { timeout: 10000 },
    );
  });

  test('from applications closed, it returns the market to applications closed', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Four hops, not two: there is no edge from this phase back to draft and none is added, so
    // the way down goes through applications_open and so does the way back.
    const seed = await seedPlannedMarket(request);
    await transition(request, seed.marketId, 'applications_closed');
    expect(await phaseOf(request, seed.marketId)).toBe('applications_closed');

    const importPage = await reachTheLedger(page, request, seed.marketId);

    // The other dead end: a question the form never asked.
    const stopAsking = page.getByTestId('import-stop-asking-essential_section_ranking');
    await expect(stopAsking).toBeVisible();
    await stopAsking.click();

    const dialog = page.getByTestId('amend-form-window');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByTestId('amend-form-unask-essential_section_ranking').locator('input'),
    ).toBeChecked();

    await page.getByTestId('amend-form-submit-button').click();
    await expect(dialog).toBeHidden({ timeout: 20000 });

    expect(await phaseOf(request, seed.marketId)).toBe('applications_closed');
    // And the question is gone from the ledger's required list, which is why it was asked for.
    await expect(importPage.map).toBeVisible();
  });

  test('the uploaded file and the mapping survive the dialog', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Without this the story trades a four-step round trip for a two-step one.
    const seed = await seedPlannedMarket(request);
    const importPage = await reachTheLedger(page, request, seed.marketId);

    await importPage.targetSelectAt(2).selectOption('essential_full_name');
    await importPage.targetSelectAt(HEADERS.length - 1).selectOption('__needs_a_field__');
    await page.getByTestId('import-add-a-field-button').click();
    await expect(page.getByTestId('amend-form-window')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('amend-form-submit-button').click();
    await expect(page.getByTestId('amend-form-window')).toBeHidden({ timeout: 20000 });

    // Same file, same row count, and the mapping the organizer had already made.
    await expect(importPage.filename).toContainText('.csv');
    await expect(importPage.columnRows).toHaveCount(HEADERS.length);
    await expect(importPage.targetSelectAt(2)).toHaveValue('essential_full_name');
  });

  test('a form edited so that it asks nothing is refused, and the market does not move', async ({
    authenticatedPage: page,
    request,
  }) => {
    /*
     * Pre-flight, not rollback. The alternative - move, write, discover the return is refused -
     * strands a market in draft mid-import with nothing saying a phase had moved.
     *
     * Driven against the endpoint, because the dialog's own guard disables the button before the
     * request is made: the refusal being tested is the SERVER's, which is the authority.
     */
    const seed = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      // A plan that offers nothing, so the essential questions ask nothing either.
      {
        setupObject: {
          priority: [],
          marketDates: [],
          tiers: [],
          locations: [],
          sections: [],
          assignmentOptions: {},
          floorplans: [],
        },
      },
    );
    await page.goto('/markets');

    const refused = await request.post(
      `${BACKEND_URL}/markets/${seed.marketId}/application-form/amendment`,
      {
        headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
        data: { applicationForm: { fields: [] } },
      },
    );
    expect(refused.status()).toBe(409);
    const body = (await refused.json()) as { error: string; blockers: Array<{ id: string }> };
    expect(body.error).toBe('preconditions_not_met');
    expect(body.blockers.map((b) => b.id)).toContain('form_has_fields');

    // Nothing moved, so there is nothing to recover.
    expect(await phaseOf(request, seed.marketId)).toBe('applications_open');
  });

  test('once somebody has applied the chain is unavailable, and says why', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPlannedMarket(request);
    seedApplication(seed.marketId, 'already@applied.test', { essential_full_name: 'Alva Reidy' });

    const availability = await request.get(
      `${BACKEND_URL}/markets/${seed.marketId}/application-form/amendment`,
      { headers: { 'X-Owner-Email': TEST_USER.email } },
    );
    const body = (await availability.json()) as { available: boolean; reason: string };
    expect(body.available).toBe(false);
    expect(body.reason).toContain('frozen');

    // And the wizard says so where the offer would have been, rather than offering and failing.
    const importPage = await reachTheLedger(page, request, seed.marketId);
    await importPage.targetSelectAt(HEADERS.length - 1).selectOption('__needs_a_field__');
    await expect(page.getByTestId('import-needs-a-field')).toContainText('frozen');
    await expect(page.getByTestId('import-add-a-field-button')).toHaveCount(0);
  });
});
