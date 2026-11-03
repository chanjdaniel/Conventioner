import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, CsvImportPage, MarketSetupPage } from './fixtures';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { savePlan } from './helpers/savePlan';
import { completePlan } from './helpers/seeds';

/**
 * The first import's refusal lists everything it waits on (T205/F09).
 *
 * A draft Google Form market with no dates, no location and no tables opened its import on "This
 * market has no market dates": the organizer picked dates, came back, was refused for the location,
 * added it, came back, was refused for the tables. Three trips for one list. The refusal now names
 * every blocker of the move into Review at once, each linked to where it is done, and the server's
 * 409 names every one too, so a stale page or a direct call reads the whole list.
 */

const NO_DATES = "This market has no market dates. Pick them on Market Setup's calendar.";
const NO_LOCATION = 'This market has no location. Add one on Market Setup.';
const NO_TABLES = 'This market has no tables yet. Add a section with tables on Market Setup.';

async function bareGoogleFormDraft(request: APIRequestContext): Promise<string> {
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'csv' },
  );
  return marketId;
}

test('a bare Google Form draft is told everything its first import waits on, at once', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await bareGoogleFormDraft(request);
  const importPage = new CsvImportPage(page);

  await page.goto(marketScreenPath(marketId, 'import'));
  await expect(importPage.wrongPhase).toBeVisible({ timeout: 15000 });
  await expect(importPage.wrongPhase.getByRole('heading')).toHaveText(
    'This market is not ready for its first import',
  );
  await expect(importPage.waitsOnHeading).toHaveText('Before its first import, this market needs:');
  // In the guards' order, the three the walk met one trip at a time.
  const items = await importPage.waitsOn.allInnerTexts();
  const at = (message: string) => items.findIndex((item) => item.includes(message));
  expect(at(NO_DATES), items.join('\n')).toBeGreaterThanOrEqual(0);
  expect(at(NO_LOCATION), items.join('\n')).toBeGreaterThan(at(NO_DATES));
  expect(at(NO_TABLES), items.join('\n')).toBeGreaterThan(at(NO_LOCATION));
  await expect(importPage.wrongPhase).not.toContainText('Nothing has been imported yet');
  for (const label of ['Pick market dates', 'Add a location', 'Add tables']) {
    await expect(importPage.waitsOnLinks.filter({ hasText: label })).toHaveAttribute(
      'href',
      marketSetupPath(marketId, 'setup'),
    );
  }
  await expect(importPage.upload).toHaveCount(0);
  await expect(
    importPage.wrongPhase.getByRole('button', { name: 'Back to the market' }),
  ).toBeVisible();

  // The server says the same list, so a stale page or a direct call reads all of it.
  const direct = await request.post(
    `${BACKEND_URL}/markets/${marketId}/applications/import/inspect`,
    { data: { csvContent: 'Timestamp,Email Address\n' } },
  );
  expect(direct.status()).toBe(409);
  const { error } = (await direct.json()) as { error: string };
  expect(error).toContain(`${NO_DATES} ${NO_LOCATION} ${NO_TABLES}`);

  // One trip: following a link lands on Market Setup, where it is done.
  await importPage.waitsOnLinks.filter({ hasText: 'Add a location' }).click();
  await expect(page).toHaveURL(marketSetupPath(marketId, 'setup'));
  await expect(new MarketSetupPage(page).locationAddButton).toBeVisible();
});

test('a draft missing one thing shows that one item, and a complete one opens on the upload', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await bareGoogleFormDraft(request);
  const importPage = new CsvImportPage(page);
  const plan = completePlan();

  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
    ...plan,
    locations: [],
    sections: [{ name: 'Hall A', tier: { id: 1, name: 'Gold' }, count: 5 }],
  });
  await page.goto(marketScreenPath(marketId, 'import'));
  await expect(importPage.waitsOnHeading).toHaveText(
    'Before its first import, this market needs:',
    { timeout: 15000 },
  );
  await expect(importPage.waitsOn).toHaveCount(1);
  await expect(importPage.waitsOn).toContainText(NO_LOCATION);
  await expect(importPage.waitsOnLinks).toHaveText(['Add a location →']);

  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, plan);
  await page.goto(marketScreenPath(marketId, 'import'));
  await expect(importPage.upload).toBeVisible({ timeout: 15000 });
  await expect(importPage.wrongPhase).toHaveCount(0);
});

test('a draft whose vendors apply on its page says it takes no import, as the server does', async ({
  authenticatedPage: page,
  request,
}) => {
  // Nothing links here on a form market; a typed address or an old bookmark still reaches it, and
  // the page must say what the server's 409 says, never a checklist that cannot be completed.
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  const importPage = new CsvImportPage(page);
  const takesNoImport =
    'This market takes applications on its own page, so nothing is imported into it.';

  await page.goto(marketScreenPath(marketId, 'import'));
  await expect(importPage.wrongPhase.getByRole('heading')).toHaveText(
    "Vendors apply on this market's page",
    { timeout: 15000 },
  );
  await expect(importPage.wrongPhase).toContainText(takesNoImport);
  await expect(importPage.waitsOnHeading).toHaveCount(0);
  await expect(importPage.upload).toHaveCount(0);

  const direct = await request.post(
    `${BACKEND_URL}/markets/${marketId}/applications/import/inspect`,
    { data: { csvContent: 'Timestamp,Email Address\n' } },
  );
  expect(direct.status()).toBe(409);
  const { error } = (await direct.json()) as { error: string };
  expect(error).toBe(takesNoImport);
});
