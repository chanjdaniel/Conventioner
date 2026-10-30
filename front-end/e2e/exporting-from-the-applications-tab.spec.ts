import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { VendorExportDialog } from './pages/VendorExportDialog';

/** The address column of a downloaded file's rows, its header left out. */
function emailsIn(text: string): string[] {
  const lines = text.slice(1).trim().split(/\r?\n/);
  expect(lines[0]).toBe('Name,Email,Status');
  return lines.slice(1).map((line) => line.split(',')[1] ?? '');
}

/**
 * Exporting the review's lists from the Applications tab (E42/F01/S03).
 *
 * In review, two approved applicants, one rejected, one open, one the organizer follows up and one
 * nobody does yet. The All view's "Approved" then Export opens the vendor export on the approved,
 * and the file holds exactly them; "Needs follow-up" with Mine exports only the organizer's own.
 */
test('Export from the All view opens on its filter and Mine, and downloads exactly them', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  seedApplicationWithStatus(marketId, 'reviewer_approved', 'ana@ember.test');
  seedApplicationWithStatus(marketId, 'reviewer_approved', 'ben@ember.test');
  seedApplicationWithStatus(marketId, 'reviewer_rejected', 'cy@ember.test');
  seedApplicationWithStatus(marketId, 'open', 'eve@ember.test');
  const dee = seedApplicationWithStatus(marketId, 'open', 'dee@ember.test');
  seedApplicationWithStatus(marketId, 'needs_follow_up', 'fay@ember.test');
  const followUp = await request.put(
    `${BACKEND_URL}/markets/${marketId}/applications/${dee}/review`,
    { data: { status: 'needs_follow_up' } },
  );
  expect(followUp.ok(), await followUp.text()).toBeTruthy();

  const all = new ApplicationsAllPage(page);
  const dialog = new VendorExportDialog(page);
  await all.goto(marketId);
  await expect(all.rows).toHaveCount(6);
  await all.filter('reviewer_approved');
  await expect(all.rows).toHaveCount(2);

  await all.exportButton.click();
  await expect(dialog.window).toBeVisible();
  // A vendor added by hand is approved in the All view, so the export keeps them too.
  await expect(dialog.status('approved')).toBeChecked();
  await expect(dialog.status('added')).toBeChecked();
  await expect(dialog.status('rejected')).not.toBeChecked();
  await expect(dialog.status('open')).not.toBeChecked();
  await expect(dialog.mine).not.toBeChecked();
  await expect(dialog.summary).toHaveText('2 vendors, 3 columns');
  await expect(dialog.previewRows).toHaveCount(2);

  const approved = await dialog.download();
  expect(approved.filename).toMatch(/_vendors_\d{4}-\d{2}-\d{2}\.csv$/);
  expect(emailsIn(approved.text).sort()).toEqual(['ana@ember.test', 'ben@ember.test']);
  await expect(dialog.window).toBeHidden();

  await all.filter('needs_follow_up');
  await expect(all.rows).toHaveCount(2);
  await all.mine.check();
  await expect(all.rows).toHaveCount(1);
  await all.exportButton.click();
  await expect(dialog.status('follow_up')).toBeChecked();
  await expect(dialog.mine).toBeChecked();
  await expect(dialog.summary).toHaveText('1 vendor, 3 columns');

  const mine = await dialog.download();
  expect(emailsIn(mine.text)).toEqual(['dee@ember.test']);
});
