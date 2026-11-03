import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Route } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, CsvImportPage } from './fixtures';
import { StartFromCsvPage } from './pages/StartFromCsvPage';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { marketScreenPath } from './helpers/marketScreens';

/**
 * The start from a Google Form and the import take a file on one upload step (T205, F11 of the
 * 2026-11-02 walk): at 1440 wide the import's panel stood centred at x 353 to 1073 and the start's
 * at the page's left, x 48 to 768, each with a drop zone of its own design.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '..', '..', 'back-end', 'tests', 'test_data', 'google_forms');

/** The halo's outer ring, as the browser computes `--focus-halo`. */
const HALO = 'rgba(54, 130, 111, 0.35)';

async function edges(panel: Locator): Promise<{ left: number; right: number }> {
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  return { left: Math.round(box.x), right: Math.round(box.x + box.width) };
}

test.describe('The upload steps are one', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the start's panels stand where the import's does", async ({
    authenticatedPage: page,
    request,
  }) => {
    // A Google Form market with its plan ready opens its import on the upload step; the same
    // market has a form already, so its start is refused.
    const planned = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { setupObject: planSetupObject(), intakeMode: 'csv' },
    );
    const importing = new CsvImportPage(page);
    await page.goto(marketScreenPath(planned.marketId, 'import'));
    const imported = await edges(importing.upload);
    expect(imported.right - imported.left).toBe(720);

    const start = new StartFromCsvPage(page);
    await start.open(planned.marketId);
    expect(await edges(start.refused)).toEqual(imported);

    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await start.open(marketId);
    expect(await edges(start.upload)).toEqual(imported);
    await expect(start.dropZone).toContainText('Any form tool or spreadsheet that exports CSV');

    // Reading the file: the proposal is held until the panel has been measured.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/csv-proposal', async (route: Route) => {
      await held;
      await route.continue();
    });
    await start.chooseFile(join(CORPUS, 'five-day-grid.csv'));
    expect(await edges(start.reading)).toEqual(imported);
    release();
    await start.answerYear();
    await expect(start.ledger).toBeVisible();
  });

  test("Tab reaches the zone's input, the zone shows it, and Enter or Space opens the chooser", async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    // Playwright starts catching file choosers when the first listener is added, without waiting
    // for the browser to agree, so a chooser opened by the very next key could slip past it. Listen
    // from before the page loads, so the first key's chooser is caught like the second's.
    page.on('filechooser', () => {});
    const start = new StartFromCsvPage(page);
    await start.open(marketId);
    await expect(start.upload).toBeVisible();
    // The input is named by the zone's words, so a screen reader says what it asks for.
    await expect(page.getByLabel('Drop your CSV here, or choose a file')).toBeAttached();

    await start.dropZone.evaluate((zone) => zone.closest('section')?.focus());
    for (let press = 0; press < 40; press++) {
      await page.keyboard.press('Tab');
      if (await start.fileInput.evaluate((input) => input === document.activeElement)) break;
    }
    await expect(start.fileInput).toBeFocused();
    await expect(start.dropZone).toHaveCSS(
      'box-shadow',
      new RegExp(HALO.replace(/[().]/g, '\\$&')),
    );

    for (const key of ['Enter', 'Space']) {
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press(key);
      expect((await chooser).isMultiple(), `${key} opens a chooser for one file`).toBe(false);
    }
  });
});
