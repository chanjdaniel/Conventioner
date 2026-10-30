import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { VendorsPage } from './pages/VendorsPage';

/**
 * One vendor drawer, with tabs (E35/F01/S01).
 *
 * The notes and the submission sat well; the assignments and the placement history were at the
 * bottom, where nobody found them. The notes are pinned at the top now, and below them Application,
 * Assignments, Payment (E44/F01/S01) and History, each one click away, the tab kept in the address.
 */
test('the drawer opens on the application, each tab a click away, the notes on every one', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const vendors = new VendorsPage(page);
  await vendors.goto(seed.marketId);
  await vendors.clickVendor(0);

  const tabs = page.getByRole('tablist', { name: 'Vendor detail' });
  await expect(tabs.getByRole('tab')).toHaveText([
    'Application',
    'Assignments',
    'Payment',
    'History',
  ]);
  await expect(tabs.getByRole('tab', { name: 'Application' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tabpanel')).toContainText('Submission');

  for (const [tab, panel] of [
    ['Assignments', 'vendors-detail-assignment-item'],
    ['Payment', 'payment-tab'],
    ['History', 'market-history'],
  ] as const) {
    await tabs.getByRole('tab', { name: tab }).click();
    await expect(tabs.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel').getByTestId(panel).first()).toBeVisible();
    // The notes are pinned above the tabs, on every one.
    await expect(page.getByTestId('vendors-detail-notes')).toBeVisible();
  }

  // The tab is part of the address: a refresh comes back to it.
  await expect(page).toHaveURL(/vendorTab=history/);
  await page.reload();
  await expect(tabs.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');

  // A tab list moves with the arrow keys.
  await tabs.getByRole('tab', { name: 'History' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Application' })).toBeFocused();
  await expect(tabs.getByRole('tab', { name: 'Application' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
