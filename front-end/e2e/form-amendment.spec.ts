import { test, expect, TEST_USER, BACKEND_URL, CsvImportPage } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { ensureTestOrg } from './helpers/seeds';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { seedApplication } from './helpers/seedApplication';

/**
 * Fixing the form without leaving the import (E20/F03/S01).
 *
 * The wizard printed manual steps - "turn it off in the form builder, then import again" - and the
 * organizer lost their upload on the way. A Google Form market's first import runs while it is a
 * draft (E38/F04/S01), where its form is writable, so the dialog saves the form there and the file
 * and the mapping stay; once anything is imported the questions are fixed, and the ledger says so.
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
  '2026/05/02 9:14:03,nadia@ember.test,Nadia Okonkwo,"2099-08-01, 2099-08-08",2,Gold,half,,"Garden, Main Hall",Left hand twice',
];

const CSV = [HEADERS.join(','), ...ROWS].join('\n');

async function seedPlannedMarket(request: APIRequestContext) {
  return await seedApplicantMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    setupObject: planSetupObject(),
    // Importing is the CSV path's (E31/F03/S04).
    intakeMode: 'csv',
  });
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

  test('on a first import, it adds a question and the market stays a draft', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPlannedMarket(request);
    expect(await phaseOf(request, seed.marketId)).toBe('draft');

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

    await page.getByTestId('amend-form-submit-button').click();
    await expect(dialog).toBeHidden({ timeout: 20000 });

    // Still a draft - only an import, written, takes it into Review - and the new question is a
    // target the ledger offers.
    expect(await phaseOf(request, seed.marketId)).toBe('draft');
    await expect(importPage.map).toBeVisible();
    await expect(
      importPage.targetSelectAt(HEADERS.length - 1).locator('option[value="our_secret_handshake"]'),
    ).toHaveCount(1);

    // And Market Setup, reached without a reload, shows the market as the dialog left it: the
    // question it added (E21/F02/S04). The import used to read and never write a stored copy of
    // the market, so the way back showed the market as it had been.
    await page.getByTestId('import-leave-button').click();
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Draft', {
      timeout: 10000,
    });
    await page.getByTestId('market-bar-tab-form').click();
    await page.getByTestId('form-step-questions').click();
    await expect(page.getByTestId('form-field-label-input').last()).toHaveValue(
      'Our secret handshake',
      { timeout: 10000 },
    );
  });

  test('on a first import, it stops asking a ranking the file never answered', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPlannedMarket(request);

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

    expect(await phaseOf(request, seed.marketId)).toBe('draft');
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

  test('once something is imported the questions are fixed, and a Redo import says why', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPlannedMarket(request);
    seedApplication(seed.marketId, 'already@applied.test', { essential_full_name: 'Alva Reidy' });
    const moved = await request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
      data: { toPhase: 'applications' },
    });
    expect(moved.ok(), await moved.text()).toBeTruthy();

    // The wizard says so where the offer would have been, rather than offering and failing.
    const importPage = await reachTheLedger(page, request, seed.marketId);
    await importPage.targetSelectAt(HEADERS.length - 1).selectOption('__needs_a_field__');
    await expect(page.getByTestId('import-needs-a-field')).toContainText('The questions are fixed');
    await expect(page.getByTestId('import-add-a-field-button')).toHaveCount(0);
  });
});
