import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { VendorsPage } from './pages/VendorsPage';
import { VendorExportDialog } from './pages/VendorExportDialog';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { approvedVendorApplication, insertApplications } from './helpers/seedApplication';
import { SEED_MARKET_DATE } from './helpers/seeds';

/**
 * Exporting the vendors a page shows (E42/F01/S01).
 *
 * One table and two vendors who each want a whole one, so the run places one and leaves the other
 * unassigned; and a rejected applicant, who is listed but never unassigned. "Unassigned only" then
 * Export opens on that filter, previews only the unassigned vendor, and downloads exactly them.
 */
test('Export opens on "Unassigned only" and downloads exactly the unassigned vendors', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { tables: 1 },
  );
  insertApplications([
    {
      ...approvedVendorApplication(marketId, 'carol@example.com', {
        dates: [SEED_MARKET_DATE],
        tiers: ['Gold'],
      }),
      status: 'reviewer_rejected',
    },
  ]);

  const vendors = new VendorsPage(page);
  await vendors.goto(marketId);
  await expect(vendors.vendorListItems).toHaveCount(3);
  await vendors.unassignedOnly.click();
  await expect(vendors.vendorListItems).toHaveCount(1);
  const unassigned = (await vendors.vendorListItems.first().textContent())?.includes(
    'alice@example.com',
  )
    ? 'alice@example.com'
    : 'bob@example.com';

  await vendors.exportButton.click();
  const dialog = new VendorExportDialog(page);
  await expect(dialog.window).toBeVisible();
  await expect(dialog.status('approved')).toBeChecked();
  await expect(dialog.status('rejected')).not.toBeChecked();
  await expect(dialog.placed).toHaveValue('unplaced');
  await expect(dialog.summary).toHaveText('1 vendor, 3 columns');
  await expect(dialog.previewRows).toHaveCount(1);
  await expect(dialog.previewRows.first()).toContainText(unassigned);

  // The columns in the order put: the address first, the ticked ones heading the list.
  await dialog.moveUp('email');
  await expect(dialog.previewHeader).toHaveText(/^Email\s*Name\s*Status$/);

  const { filename, text } = await dialog.download();
  expect(filename).toMatch(/_vendors_\d{4}-\d{2}-\d{2}\.csv$/);
  expect(text.startsWith('\uFEFF')).toBe(true);
  const lines = text.slice(1).trim().split(/\r?\n/);
  expect(lines[0]).toBe('Email,Name,Status');
  expect(lines.slice(1)).toEqual([
    expect.stringMatching(new RegExp(`^${unassigned},.+,Approved$`)),
  ]);
  await expect(dialog.window).toBeHidden();
});
