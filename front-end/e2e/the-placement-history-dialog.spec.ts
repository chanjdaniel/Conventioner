import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { namelessControls } from './helpers/accessibleNames';
import { TablesPage } from './pages/TablesPage';
import { VendorsPage } from './pages/VendorsPage';

/**
 * The placement history opens from a button (E35/F03/S03).
 *
 * The trail sat at the bottom of the Result page, below every table of every date, and named a
 * vendor by name alone. It opens from the results' action row now, before a run and after, for
 * anyone who can read the market, and names each vendor by name and email.
 */
const VIEWER = { email: 'e2e-history-viewer@example.com', password: 'e2ehistoryviewer1' };

test('a hand placement is in the history, by name and email, opened from the button', async ({
  authenticatedPage: page,
  request,
}) => {
  // Before any run: a hand placement is history too.
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    run: false,
  });
  const tables = new TablesPage(page);
  await tables.goto(seed.marketId);
  await tables.vacantSeat('Hall A 1').click();
  await tables.placeVendor('alice@example.com');
  await expect(tables.dialog).toBeHidden();

  const dialog = tables.historyDialog;
  const open = () => tables.openHistory();

  // Read as it opens: the placement just made is there, with no reload.
  await open();
  const vendor = dialog.getByTestId('placement-history-vendor').first();
  await expect(vendor).toContainText('Alice Example');
  await expect(vendor).toContainText('alice@example.com');
  expect(await namelessControls(page), 'the placement history dialog').toEqual([]);

  // Escape, the close control and the backdrop each close it.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await open();
  await page.getByTestId('placement-history-dialog-close-button').click();
  await expect(dialog).toBeHidden();
  await open();
  await page.getByTestId('placement-history-dialog-background').click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeHidden();

  // The vendor drawer's history holds the same placement, and names them the same way.
  await page.goto(`${marketScreenPath(seed.marketId, 'vendors')}?vendor=alice%40example.com`);
  const vendors = new VendorsPage(page);
  await vendors.openTab('history');
  const theirs = vendors.detailHistorySentences.first();
  await expect(theirs).toContainText('Alice Example');
  await expect(theirs).toContainText('alice@example.com');
});

test('after a run, a viewer opens the history too', async ({
  authenticatedPage: page,
  browser,
  request,
}) => {
  ensureVerifiedUser(VIEWER.email, VIEWER.password);
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const granted = await request.post(`${BACKEND_URL}/markets/${seed.marketId}/roles`, {
    data: { user_email: VIEWER.email, role: 'viewer' },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();
  await new TablesPage(page).goto(seed.marketId);
  await expect(new TablesPage(page).historyButton).toBeVisible();

  await withUser(browser, VIEWER.email, VIEWER.password, async (viewer) => {
    const theirs = new TablesPage(viewer);
    await theirs.goto(seed.marketId);
    await theirs.openHistory();
    await expect(theirs.historyEntries.first()).toContainText('Allocated tables');
  });
});
