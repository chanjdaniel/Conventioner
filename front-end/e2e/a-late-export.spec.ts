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
 * A late export comes in from the menu (E32/F02/S02).
 *
 * Responses keep arriving on a Google Form after review has begun. The organizer brings them in
 * with "Import more responses" in the rail's menu - never the main button, which in review is the
 * step onward - one move back to importing that lands on the import. Nothing already decided is
 * touched, and the later export adds only the responses that are new, undecided.
 */
test.describe('A late export', () => {
  test('comes in from the menu, keeps every verdict, and adds only what is new', async ({
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
      await importPage.chooseFile(csv);
      await importPage.mapColumns(EXPORT_HEADERS, EXPORT_MAPPING);
      await expect(importPage.allMapped).toBeVisible();
      await importPage.clickPreview();
      await importPage.clickConfirm();
    }

    // The first export, imported and reviewed.
    await page.goto(marketScreenPath(seed.marketId, 'import'));
    await importExport(exportOf(RESPONSES.nadia, RESPONSES.theo));
    await expect(importPage.resultSummary).toContainText('Imported 2 new applications');
    await page.getByTestId('phase-transition-review').click();
    await expect(page).toHaveURL(/\/applications$/, { timeout: 15000 });
    await monitor.waitForLoaded();
    await monitor.approve('nadia@ember.test');
    await monitor.reject('theo@thistle.test');
    await expect(monitor.tally).toContainText('2 reviewed · 1 approved · 1 rejected');

    // Reviewing is its own step: the page offers no import (E32/F02/S03). Importing more is in
    // the rail's menu, and the main button is the step onward.
    await expect(page.getByTestId('market-setup-import-button')).toHaveCount(0);
    // The phase the path steps through is never a stage of its rail (E32/F02/S01).
    await expect(page.getByTestId('phase-rail-spine')).not.toContainText('Imported');
    await expect(page.getByTestId('phase-rail-spine')).not.toContainText('Form Closed');
    await expect(page.getByTestId('phase-transition-applications_open')).toHaveCount(0);
    await page.getByTestId('phase-rail-menu-button').click();
    const more = page.getByTestId('phase-transition-applications_open');
    await expect(more).toHaveText('Import more responses');
    await more.click();

    // One move back to importing, landing on the import.
    await expect(page).toHaveURL(/\/import$/, { timeout: 15000 });
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Import');

    // The later export holds both earlier responses again, and one new one.
    await importExport(exportOf(RESPONSES.nadia, RESPONSES.theo, RESPONSES.ines));
    await expect(importPage.resultSummary).toHaveText('Imported 1 new application. 2 unchanged.');

    await page.getByTestId('phase-transition-review').click();
    await expect(page).toHaveURL(/\/applications$/, { timeout: 15000 });
    await monitor.waitForLoaded();

    // Only the new response waits for a verdict; the two given before are as they were.
    await expect(monitor.progress).toContainText('of 1 to review');
    await expect(monitor.email).toHaveText('ines@loom.test');
    await expect(monitor.tally).toContainText('2 reviewed · 1 approved · 1 rejected');
    await monitor.openDecided();
    await expect(monitor.decidedStatusOf('nadia@ember.test')).toHaveText('Approved');
    await expect(monitor.decidedStatusOf('theo@thistle.test')).toHaveText('Rejected');
  });
});
