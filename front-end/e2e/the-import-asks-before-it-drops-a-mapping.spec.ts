import type { APIRequestContext, Page, Route } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, CsvImportPage } from './fixtures';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { marketScreenPath } from './helpers/marketScreens';

/**
 * The CSV import asks before it drops a mapping not yet imported (T271).
 *
 * The column mapping and every value decision live in the page until the final import, and any
 * link, Back or reload dropped them with no word. On Map columns and Preview a move off the import
 * now asks, and a reload is asked by the browser; Upload, the done step and an import already
 * running hold nothing to lose, so they leave without asking.
 */

const SENTENCE =
  'Nothing from this file is imported yet. Leaving drops the column mapping and every value you settled.';

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

/** The organizer's form said "Gold Tier"; the market's tier is called "Gold", a value to settle. */
const CSV = [
  HEADERS.join(','),
  '2026/05/02 9:14:03,nadia@ember.test,Nadia Okonkwo,Ember Ceramics,2099-08-01,1,Gold Tier,half,"Garden, Main Hall",Pottery',
  '2026/05/02 11:40:22,theo@thistle.test,Theo Marchetti,Thorn & Thistle,2099-08-01,1,Gold Tier,full,"Main Hall, Garden",Dried flowers',
].join('\n');

/** A Google Form draft with dates, tiers and sections on its plan, ready for its first import. */
async function seedImportableDraft(request: APIRequestContext): Promise<string> {
  const { marketId } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject(), intakeMode: 'csv' },
  );
  return marketId;
}

async function applicationCount(request: APIRequestContext, marketId: string): Promise<number> {
  const res = await request.get(`${BACKEND_URL}/markets/${marketId}/applications`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { applications: unknown[] }).applications.length;
}

/** Map every column, check the values, and settle "Gold Tier" as Gold: still on Map columns. */
async function toSettledValues(importPage: CsvImportPage): Promise<void> {
  await importPage.chooseFile(CSV);
  await importPage.mapColumns(HEADERS, MAPPING);
  await expect(importPage.allMapped).toBeVisible();
  await importPage.clickPreview();
  await expect(importPage.unmatchedValues).toHaveText('Gold Tier');
  await importPage.resolveValue('Gold Tier', 'Gold');
  await expect(importPage.unresolvedWarning).toBeHidden();
}

/**
 * Still on Map columns, with every column mapped and "Gold Tier" settled as Gold: where it was
 * settled, or, once a preview has read it, among the values already decided.
 */
async function expectTheMappingKept(page: Page, importPage: CsvImportPage): Promise<void> {
  await expect(importPage.map).toBeVisible();
  await expect(importPage.allMapped).toBeVisible();
  await expect(
    importPage.valueFix('Gold Tier').root.or(importPage.decidedFix('Gold Tier').root),
  ).toHaveValue('Gold');
  await expect(importPage.unresolvedWarning).toBeHidden();
  await expect(importPage.filename).toContainText('form-responses.csv');
  expect(new URL(page.url()).pathname).toMatch(/\/import$/);
}

const question = (page: Page) => page.getByTestId('unsaved-work-window');

test.describe('The import asks before it drops a mapping', () => {
  test('a tab on Map columns asks first; Stay keeps the mapping and the values settled, Leave goes', async ({
    authenticatedPage: page,
    request,
    expectAccessible,
  }) => {
    const marketId = await seedImportableDraft(request);
    const importPage = new CsvImportPage(page);
    await page.goto(marketScreenPath(marketId, 'import'));
    await expect(importPage.view).toBeVisible();
    await toSettledValues(importPage);

    const applications = page.getByTestId('market-bar-tab-applications');
    await applications.click();
    await expect(question(page)).toBeVisible();
    await expect(question(page)).toHaveAccessibleName('Leave without saving?');
    await expect(page.getByTestId('unsaved-work-sentence')).toHaveText(SENTENCE);
    await expect(page.getByTestId('unsaved-work-cancel-button')).toBeFocused();
    await expectAccessible('the leave question over the import');

    await page.getByTestId('unsaved-work-cancel-button').click();
    await expect(question(page)).toBeHidden();
    await expectTheMappingKept(page, importPage);

    await applications.click();
    await page.getByTestId('unsaved-work-submit-button').click();
    await expect(page).toHaveURL(new RegExp(`${marketScreenPath(marketId, 'applications')}$`));
    await expect(question(page)).toBeHidden();
    expect(await applicationCount(request, marketId)).toBe(0);
  });

  test('on Preview, Cancel import, Back and the app bar ask, and Stay keeps the preview', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await seedImportableDraft(request);
    const importPage = new CsvImportPage(page);
    // Arrive from Tools, a page of its own, so that Back leaves the import.
    await page.goto(marketScreenPath(marketId, 'tools'));
    await page.getByTestId('phase-rail-fix').click();
    await expect(importPage.view).toBeVisible();
    await toSettledValues(importPage);
    await importPage.clickPreview();
    await expect(importPage.previewCounts).toContainText('2 of 2 rows');

    const staysOnThePreview = async (how: string, leave: () => Promise<void>) => {
      await leave();
      await expect(question(page), `${how} asks`).toBeVisible();
      await expect(page.getByTestId('unsaved-work-sentence')).toHaveText(SENTENCE);
      await page.getByTestId('unsaved-work-cancel-button').click();
      await expect(question(page)).toBeHidden();
      await expect(importPage.preview, `Stay after ${how} keeps the preview`).toBeVisible();
      await expect(importPage.previewCounts).toContainText('2 of 2 rows');
      await expect(page).toHaveURL(new RegExp(`${marketScreenPath(marketId, 'import')}$`));
    };
    await staysOnThePreview('Cancel import', () => page.getByTestId('import-leave-button').click());
    await staysOnThePreview('Back', async () => {
      await page.goBack({ waitUntil: 'commit' });
    });
    await staysOnThePreview('the app bar', () => page.getByTestId('app-bar-logo').click());

    // The import's own Back stays inside the page, so it never asks.
    await importPage.backButton.click();
    await expect(question(page)).toBeHidden();
    await expectTheMappingKept(page, importPage);

    await page.getByTestId('import-leave-button').click();
    await page.getByTestId('unsaved-work-submit-button').click();
    await expect(page).toHaveURL(new RegExp(`${marketScreenPath(marketId, 'applications')}$`));
    expect(await applicationCount(request, marketId)).toBe(0);
  });

  test('a reload on Map columns is asked by the browser, and one on Upload is not', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await seedImportableDraft(request);
    const importPage = new CsvImportPage(page);
    await page.goto(marketScreenPath(marketId, 'import'));
    await expect(importPage.view).toBeVisible();
    await toSettledValues(importPage);

    const asked: string[] = [];
    page.on('dialog', (dialog) => {
      asked.push(dialog.type());
      void dialog.accept();
    });
    await page.reload();
    await expect(importPage.upload).toBeVisible();
    expect(asked).toEqual(['beforeunload']);

    // Upload holds no file, so nothing asks, though the page has been pressed.
    await importPage.heading.click();
    await page.reload();
    await expect(importPage.upload).toBeVisible();
    expect(asked).toEqual(['beforeunload']);
  });

  test('Upload, an import running and the done step leave without asking', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await seedImportableDraft(request);
    const importPage = new CsvImportPage(page);
    await page.goto(marketScreenPath(marketId, 'import'));
    await expect(importPage.upload).toBeVisible();
    await page.getByTestId('import-leave-button').click();
    await expect(page).toHaveURL(new RegExp(`${marketScreenPath(marketId, 'applications')}$`));
    await expect(question(page)).toBeHidden();

    // While the import is being written, leaving does not stop it, so there is nothing to ask.
    await page.goto(marketScreenPath(marketId, 'import'));
    await toSettledValues(importPage);
    await importPage.clickPreview();
    await expect(importPage.previewCounts).toContainText('2 of 2 rows');
    const write = /\/applications\/import$/;
    const held: Route[] = [];
    await page.route(write, (route) => {
      held.push(route);
    });
    await importPage.clickConfirm();
    await expect.poll(() => held.length).toBe(1);
    await page.getByTestId('market-bar-tab-tools').click();
    await expect(page).toHaveURL(new RegExp(`${marketScreenPath(marketId, 'tools')}$`));
    await expect(question(page)).toBeHidden();
    await held[0]!.continue();
    await page.unroute(write);
    await expect.poll(() => applicationCount(request, marketId)).toBe(2);

    // The done step: the import is written, so its way on leaves at once.
    await page.goto(marketScreenPath(marketId, 'import'));
    await importPage.chooseFile(CSV);
    await expect(importPage.map).toBeVisible();
    await expect(importPage.allMapped).toBeVisible();
    await importPage.previewAndConfirm();
    await page.getByTestId('import-finish-button').click();
    await expect(page).toHaveURL(new RegExp(`${marketScreenPath(marketId, 'applications')}$`));
    await expect(question(page)).toBeHidden();
  });
});
