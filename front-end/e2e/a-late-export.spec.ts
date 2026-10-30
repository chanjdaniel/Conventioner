import {
  test,
  expect,
  TEST_USER,
  BACKEND_URL,
  CsvImportPage,
  ApplicationMonitorPage,
} from './fixtures';
import { marketScreenPath } from './helpers/marketScreens';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { EXPORT_HEADERS, EXPORT_MAPPING, RESPONSES, exportOf } from './helpers/googleFormExport';

/**
 * A late export comes in by Redo import (E38/F04/S03).
 *
 * Responses keep arriving on a Google Form after review has begun. The organizer brings them in
 * with "Redo import" in the rail's menu - never the main button, which in Review is the step onward
 * - which opens the import to read the whole responses file again, and the market stays in Review.
 * Nothing already decided is touched, except an approval whose answers the assignment reads have
 * since changed, which goes back to review; the later export adds only the responses that are new,
 * undecided.
 */
test.describe('A late export', () => {
  test('comes in by Redo import, keeps every verdict, and adds only what is new', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedApplicantMarket(
      page.request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { setupObject: planSetupObject(), intakeMode: 'csv' },
    );
    const importPage = new CsvImportPage(page);
    const monitor = new ApplicationMonitorPage(page);

    async function importExport(csv: string) {
      await expect(importPage.view).toBeVisible({ timeout: 15000 });
      await importPage.importCsv(csv, EXPORT_HEADERS, EXPORT_MAPPING);
    }

    // The first export, imported from draft - its way into Review (E38/F04/S01) - and reviewed.
    await page.goto(marketScreenPath(seed.marketId, 'import'));
    await importExport(exportOf(RESPONSES.nadia, RESPONSES.theo));
    await expect(importPage.resultSummary).toContainText('Imported 2 new applications');
    await page.getByTestId('import-finish-button').click();
    await expect(page).toHaveURL(/\/applications$/, { timeout: 15000 });
    await monitor.switchTo();
    await monitor.waitForLoaded();
    await monitor.approve('nadia@ember.test');
    await monitor.reject('theo@thistle.test');
    await expect(monitor.tally).toContainText('2 reviewed · 1 approved · 1 rejected');

    // The review screen offers no import (E38/F04/S03). Redo import is in the rail's menu, and
    // the main button is the step onward.
    await expect(page.getByTestId('market-setup-import-button')).toHaveCount(0);
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Review');
    await expect(page.getByTestId('phase-transition-assignment')).toBeVisible();
    await page.getByTestId('phase-rail-menu-button').click();
    const redo = page.getByTestId('phase-rail-action-redo-import');
    await expect(redo).toHaveText('Redo import');
    await redo.click();

    // The import, which says the whole file is read again; the market stays in Review.
    await expect(page).toHaveURL(/\/import$/, { timeout: 15000 });
    await expect(page.getByTestId('import-what-it-does')).toContainText('whole responses file');
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Review');

    // The later export holds Theo's response again, unchanged; Nadia's, now coming on another
    // day; and one new response.
    await importExport(exportOf(RESPONSES.nadiaMoved, RESPONSES.theo, RESPONSES.ines));
    await expect(importPage.resultSummary).toHaveText(
      'Imported 1 new application, updated 1. 1 unchanged.',
    );

    await expect(page.getByTestId('import-result-in-review')).toHaveCount(0);
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Review');
    await page.getByTestId('import-finish-button').click();
    await expect(page).toHaveURL(/\/applications$/, { timeout: 15000 });
    await monitor.switchTo();
    await monitor.waitForLoaded();

    // The new response waits for a verdict, and so does Nadia's: she was approved on answers the
    // assignment reads, and they have changed. Theo's verdict, on unchanged answers, is kept.
    await expect(monitor.progress).toContainText('of 2 to review');
    expect((await monitor.queuedEmails()).sort()).toEqual(['ines@loom.test', 'nadia@ember.test']);
    await expect(monitor.tally).toContainText('1 reviewed · 0 approved · 1 rejected');
    await monitor.openDecided();
    await expect(monitor.decidedStatusOf('theo@thistle.test')).toHaveText('Rejected');
  });
});
