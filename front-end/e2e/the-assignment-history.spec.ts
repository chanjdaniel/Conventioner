import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { savePlan } from './helpers/savePlan';
import { completePlan, SEED_MARKET_DATE } from './helpers/seeds';
import { approvedVendorApplication, insertApplications } from './helpers/seedApplication';
import { seedPhaseMarket, transitionMarket } from './helpers/seedPhaseMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { namelessControls } from './helpers/accessibleNames';
import { ManageMarketPage } from './pages/ManageMarketPage';
import { TablesPage } from './pages/TablesPage';
import { VendorsPage } from './pages/VendorsPage';

/**
 * Assignment history is the market's History, narrowed to assignments (T224).
 *
 * It opens from the results' action row, before a run and after (E35/F03/S03), for whoever may read
 * the history. It reads what Manage market's History reads when narrowed to Assignment, in the same
 * order and the same words but for the market day, which leads each entry, in a dialog whose body is
 * the one scroller. It opens on the date the page is showing.
 */
const VIEWER = { email: 'e2e-history-viewer@example.com', password: 'e2ehistoryviewer1' };
const PAGE = 25;
const SECOND_DATE = '2099-05-02';
const FIRST_DAY = 'May 1, 2099';
const SECOND_DAY = 'May 2, 2099';
const EVERY_DAY = 'Every market day';

async function ok(response: Awaited<ReturnType<APIRequestContext['put']>>) {
  expect(response.ok(), await response.text()).toBeTruthy();
}

/** Places a vendor on a table and frees them `times` times, as the page does: two entries a time. */
async function placeAndFree(
  request: APIRequestContext,
  marketId: string,
  times: number,
  email = 'alice@example.com',
) {
  const placements = `${BACKEND_URL}/markets/${marketId}/placements`;
  for (let n = 1; n <= times; n++) {
    await ok(
      await request.put(placements, {
        data: {
          email,
          date: SEED_MARKET_DATE,
          table_code: `Hall A ${(n % 5) + 1}`,
          table_choice: 'Full Table',
        },
      }),
    );
    await ok(await request.delete(placements, { data: { email, date: SEED_MARKET_DATE } }));
  }
}

/** Places a vendor on a table on a date, as the page does. */
async function place(
  request: APIRequestContext,
  marketId: string,
  email: string,
  date: string,
  tableCode: string,
) {
  await ok(
    await request.put(`${BACKEND_URL}/markets/${marketId}/placements`, {
      data: { email, date, table_code: tableCode, table_choice: 'Full Table' },
    }),
  );
}

test('a hand placement is there as it opens, and Escape, close and the backdrop close it', async ({
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

  // Read as it opens: the placement just made is there, with no reload, named and with its address.
  await open();
  const vendor = tables.historyVendorLinks.first();
  await expect(vendor).toContainText('Alice Example');
  await expect(vendor).toContainText('alice@example.com');
  await expect(tables.historySentences.first()).toContainText(`${TEST_USER.email} assigned`);
  expect(await namelessControls(page), 'the assignment history').toEqual([]);

  // Its one kind of change is not drawn, and is not a filter there is anything to clear of.
  await expect(dialog.getByTestId('market-history-kind')).toHaveCount(0);
  await expect(dialog.getByTestId('market-history-clear')).toHaveCount(0);

  // Escape, the close control and the backdrop each close it, and focus goes back to the button.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(tables.historyButton).toBeFocused();
  await open();
  await page.getByTestId('assignment-history-dialog-close-button').click();
  await expect(dialog).toBeHidden();
  await expect(tables.historyButton).toBeFocused();
  await open();
  await page
    .getByTestId('assignment-history-dialog-background')
    .click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeHidden();
  await expect(tables.historyButton).toBeFocused();

  // The vendor drawer's history holds the same placement, naming them by name alone, since its
  // head shows their address.
  await page.goto(`${marketScreenPath(seed.marketId, 'vendors')}?vendor=alice%40example.com`);
  const vendors = new VendorsPage(page);
  await vendors.openTab('history');
  const theirs = vendors.detailHistorySentences.first();
  await expect(theirs).toContainText('Alice Example');
  await expect(theirs).not.toContainText('alice@example.com');
});

test('nothing changed yet says so', async ({ authenticatedPage: page, request }) => {
  // A plan that leaves the assignment's rules as they are: nothing of this kind has happened.
  const seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  await savePlan(request, BACKEND_URL, TEST_USER.email, seed.marketId, completePlan());
  insertApplications([
    approvedVendorApplication(seed.marketId, 'alice@example.com', {
      dates: [SEED_MARKET_DATE],
      tiers: ['Gold'],
      fullName: 'Alice Example',
    }),
  ]);
  for (const phase of ['applications', 'assignment'] as const) {
    await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, phase);
  }
  const tables = new TablesPage(page);
  await tables.goto(seed.marketId);
  await tables.openHistory();
  await expect(tables.historyDialog.getByTestId('market-history-empty')).toHaveText(
    'No assignments have been changed yet.',
  );
  await expect(tables.historyDialog.getByTestId('market-history-clear')).toHaveCount(0);
});

test("its sentences are Manage market's History narrowed to Assignment, in the same order", async ({
  authenticatedPage: page,
  request,
}) => {
  ensureVerifiedUser(VIEWER.email, VIEWER.password);
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    run: false,
  });
  await placeAndFree(request, seed.marketId, 2);
  // A run, and a change of another kind, which the dialog leaves out.
  await ok(await request.post(`${BACKEND_URL}/markets/${seed.marketId}/assignment`));
  await ok(
    await request.post(`${BACKEND_URL}/markets/${seed.marketId}/roles`, {
      data: { user_email: VIEWER.email, role: 'viewer' },
    }),
  );

  const tables = new TablesPage(page);
  await tables.goto(seed.marketId);
  await tables.openHistory();
  await expect(tables.historySentences.first()).toBeVisible();
  const inTheDialog = await tables.historySentences.allInnerTexts();
  await page.keyboard.press('Escape');

  await page.goto(`/markets?q=${encodeURIComponent(seed.marketName)}`);
  await page.getByTestId('market-card-manage-button').click();
  const manage = new ManageMarketPage(page);
  await manage.waitForOverlay();
  await manage.openHistory();
  await expect(manage.historySentences.first()).toBeVisible();
  // The role given is there before narrowing, and is not in the dialog.
  await expect(manage.historySentences.first()).toContainText(VIEWER.email);
  await manage.historyKind.selectOption('Assignment');
  await expect(manage.historySentences).toHaveCount(inTheDialog.length);

  // The same words, but for the market day, which leads the entry in the dialog.
  const manages = await manage.historySentences.allInnerTexts();
  expect(manages.some((sentence) => sentence.includes(` on ${FIRST_DAY}`))).toBe(true);
  expect(manages.map((sentence) => sentence.replace(` on ${FIRST_DAY}`, ''))).toEqual(inTheDialog);
  expect(inTheDialog.some((sentence) => sentence.includes('allocated tables'))).toBe(true);
  expect(inTheDialog.some((sentence) => sentence.includes(VIEWER.email))).toBe(false);
});

test('it opens on the date the page shows, and the day can be changed and let go', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    run: false,
    dates: [SEED_MARKET_DATE, SECOND_DATE],
  });
  await place(request, seed.marketId, 'alice@example.com', SEED_MARKET_DATE, 'Hall A 1');
  await place(request, seed.marketId, 'bob@example.com', SECOND_DATE, 'Hall A 2');
  await ok(await request.post(`${BACKEND_URL}/markets/${seed.marketId}/assignment`));
  const tables = new TablesPage(page);

  // On the second date: its placement, and the run and the rules, about every day, which lead so.
  await tables.gotoWithFilters(seed.marketId, { date: SECOND_DATE });
  await tables.openHistory();
  await expect(tables.historyMarketDay).toHaveValue(SECOND_DATE);
  await expect(tables.historyMarketDay).toBeFocused();
  await expect(tables.historyMarketDay.locator('option')).toHaveText([
    EVERY_DAY,
    FIRST_DAY,
    SECOND_DAY,
  ]);
  await expect(tables.historyDays).toHaveText([EVERY_DAY, SECOND_DAY, EVERY_DAY]);
  await expect(tables.historySentences.nth(0)).toContainText('allocated tables');
  await expect(tables.historySentences.nth(1)).toContainText('assigned');
  await expect(tables.historySentences.nth(1)).toContainText('bob@example.com');
  await expect(tables.historySentences.nth(2)).toContainText('changed the assignment rules');
  // Its sentence no longer says the day, which leads it.
  await expect(tables.historySentences.nth(1)).not.toContainText(SECOND_DAY);
  await expect(tables.historySentences.nth(1)).toContainText(/Hall A 2 \(Full Table\)$/);

  // Changed in the dialog, it reads that day, and the page's date stays as it was.
  await tables.historyMarketDay.selectOption(SEED_MARKET_DATE);
  await expect(tables.historyDays).toHaveText([EVERY_DAY, FIRST_DAY, EVERY_DAY]);
  await expect(tables.historySentences.nth(1)).toContainText('alice@example.com');
  await expect(page).toHaveURL(new RegExp(`date=${SECOND_DATE}`));

  // Let go, it reads every market day, and there is nothing left to clear.
  await tables.historyClear.click();
  await expect(tables.historyMarketDay).toHaveValue('');
  await expect(tables.historyDays).toHaveText([EVERY_DAY, SECOND_DAY, FIRST_DAY, EVERY_DAY]);
  await expect(tables.historyClear).toHaveCount(0);

  // Opened again, it is back on the page's date.
  await page.keyboard.press('Escape');
  await tables.openHistory();
  await expect(tables.historyMarketDay).toHaveValue(SECOND_DATE);
  await expect(tables.historyDays).toHaveCount(3);
  await page.keyboard.press('Escape');

  // With no date in the address it opens on every market day, focus on the same filter.
  await tables.goto(seed.marketId);
  await tables.openHistory();
  await expect(tables.historyMarketDay).toHaveValue('');
  await expect(tables.historyMarketDay).toBeFocused();
  await expect(tables.historyDays).toHaveCount(4);
  await expect(tables.historyClear).toHaveCount(0);
  await page.keyboard.press('Escape');

  // A date the plan does not hold is no day to open on.
  await tables.gotoWithFilters(seed.marketId, { date: '2099-12-25' });
  await tables.openHistory();
  await expect(tables.historyMarketDay).toHaveValue('');
  await expect(tables.historyDays).toHaveCount(4);
});

test('a day with nothing says no change matches, and the filter lets it go', async ({
  authenticatedPage: page,
  request,
}) => {
  // A plan that leaves the assignment's rules as they are, so nothing is about every day.
  const seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  await savePlan(
    request,
    BACKEND_URL,
    TEST_USER.email,
    seed.marketId,
    completePlan(SEED_MARKET_DATE, [SECOND_DATE]),
  );
  insertApplications([
    approvedVendorApplication(seed.marketId, 'alice@example.com', {
      dates: [SEED_MARKET_DATE, SECOND_DATE],
      tiers: ['Gold'],
      fullName: 'Alice Example',
    }),
  ]);
  for (const phase of ['applications', 'assignment'] as const) {
    await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, phase);
  }
  await place(request, seed.marketId, 'alice@example.com', SEED_MARKET_DATE, 'Hall A 1');

  const tables = new TablesPage(page);
  await tables.gotoWithFilters(seed.marketId, { date: SECOND_DATE });
  await tables.openHistory();
  await expect(tables.historyEmpty).toHaveText('No change matches these filters.');
  await expect(tables.historyMarketDay).toHaveValue(SECOND_DATE);

  await tables.historyClear.click();
  await expect(tables.historyEmpty).toHaveCount(0);
  await expect(tables.historyDays).toHaveText([FIRST_DAY]);
  await expect(tables.historySentences).toHaveCount(1);
});

test('on a phone "Every market day" reads whole, the day and who each on a row of their own', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    run: false,
    dates: [SEED_MARKET_DATE, SECOND_DATE],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const tables = new TablesPage(page);
  await tables.goto(seed.marketId);
  await tables.openHistory();
  await expect(tables.historyMarketDay).toHaveValue('');

  const fits = await tables.historyMarketDay.evaluate((el) => {
    const select = el as HTMLSelectElement;
    const style = getComputedStyle(select);
    const pen = document.createElement('canvas').getContext('2d')!;
    pen.font = style.font;
    return {
      text: pen.measureText(select.selectedOptions[0].text).width,
      room: select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    };
  });
  expect(fits.text, 'the words are not cut').toBeLessThanOrEqual(fits.room);

  // "Who"'s list stays on its field now that the field is a row, inside the dialog.
  const who = tables.historyDialog.getByTestId('market-history-who-input');
  const vendor = tables.historyDialog.getByTestId('market-history-vendor-input');
  const whoBox = (await who.boundingBox())!;
  const vendorBox = (await vendor.boundingBox())!;
  expect(whoBox.width, 'who is as wide as the vendor, on a row').toBeCloseTo(vendorBox.width, 0);
  await who.click();
  const listBox = (await tables.historyDialog
    .getByTestId('market-history-who-list')
    .boundingBox())!;
  const windowBox = (await tables.historyDialog.boundingBox())!;
  expect(listBox.x).toBeGreaterThanOrEqual(windowBox.x);
  expect(listBox.x + listBox.width).toBeLessThanOrEqual(windowBox.x + windowBox.width);
});

test('a vendor opens on the Vendors page, the dialog gone and nothing behind it held', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    run: false,
  });
  await placeAndFree(request, seed.marketId, 1);

  const tables = new TablesPage(page);
  await tables.goto(seed.marketId);
  await tables.openHistory();
  await tables.historyVendorLinks.first().click();

  await expect(page).toHaveURL(/\/vendors\?vendor=alice@example\.com$/);
  const vendors = new VendorsPage(page);
  await expect(vendors.detailPanel).toBeVisible();
  await expect(tables.historyDialog).toHaveCount(0);

  // Closing the drawer leaves a page that answers: no dialog left it inert.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vendors-detail-close')).toBeHidden();
  await expect(page.locator('[inert]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/vendors$/);
});

test('past a page it fetches as the dialog body reaches its end, with no scroller of its own', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    run: false,
  });
  // Two entries a time, and the rules this seed's plan set: one page and four more.
  await placeAndFree(request, seed.marketId, 14);

  const tables = new TablesPage(page);
  await tables.goto(seed.marketId);
  await tables.openHistory();
  await expect(tables.historySentences).toHaveCount(PAGE);
  await expect(tables.historyDialog).not.toContainText('Load more');

  // The list stands in the flow of the body: no scroller, and no shade, of its own.
  const list = tables.historyDialog.getByTestId('market-history-box');
  await expect(list.evaluate((box) => getComputedStyle(box).overflowY)).resolves.toBe('visible');
  await expect(list.evaluate((box) => box.scrollHeight === box.clientHeight)).resolves.toBe(true);
  await expect(tables.historyDialog.getByTestId('market-history-box-shade-bottom')).toHaveCount(0);
  await expect(page.getByTestId('assignment-history-dialog-shade-bottom')).toBeVisible();

  const first = await tables.historySentences.allInnerTexts();
  const window = await tables.historyDialog.boundingBox();
  await tables.scrollHistoryToEnd();

  await expect(tables.historySentences).toHaveCount(PAGE + 4);
  const all = await tables.historySentences.allInnerTexts();
  expect(all.slice(0, PAGE)).toEqual(first);
  // The dialog's window held where it was, with its title in view.
  expect(await tables.historyDialog.boundingBox()).toEqual(window);
  await expect(
    tables.historyDialog.getByRole('heading', { name: 'Assignment history' }),
  ).toBeInViewport();
});

test('a page that fails with the body at its end says so in sight', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    run: false,
  });
  await placeAndFree(request, seed.marketId, 14);
  const tables = new TablesPage(page);
  await tables.goto(seed.marketId);
  await tables.openHistory();
  await expect(tables.historySentences).toHaveCount(PAGE);

  const shade = page.getByTestId('assignment-history-dialog-shade-bottom');
  await expect(shade).toBeVisible();

  await page.route(/\/history\?.*before=/, (route) => route.abort());
  await tables.scrollHistoryToEnd();
  const failed = tables.historyDialog.getByTestId('market-history-read-failed');
  await expect(failed).toBeVisible();

  const body = page.getByTestId('assignment-history-dialog-body');
  const bodyRect = (await body.boundingBox())!;
  const rect = (await failed.boundingBox())!;
  expect(rect.y + rect.height, 'whole inside the body').toBeLessThanOrEqual(
    bodyRect.y + bodyRect.height,
  );
  await expect(shade).toHaveCount(0);
  await expect(tables.historyMarketDay).toBeFocused();
});

test('a viewer reads it after a run, and someone below the row is not offered it', async ({
  authenticatedPage: page,
  browser,
  request,
}) => {
  ensureVerifiedUser(VIEWER.email, VIEWER.password);
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const market = `${BACKEND_URL}/markets/${seed.marketId}`;
  await ok(
    await request.post(`${market}/roles`, { data: { user_email: VIEWER.email, role: 'viewer' } }),
  );
  await new TablesPage(page).goto(seed.marketId);
  await expect(new TablesPage(page).historyButton).toBeVisible();

  await withUser(browser, VIEWER.email, VIEWER.password, async (viewer) => {
    const theirs = new TablesPage(viewer);
    await theirs.goto(seed.marketId);
    await theirs.openHistory();
    await expect(theirs.historySentences.first()).toContainText('allocated tables');
    await viewer.keyboard.press('Escape');

    // As the owner raises it from the Permissions section.
    await ok(await request.put(`${market}/permissions/read-history`, { data: { role: 'editor' } }));
    await theirs.goto(seed.marketId);
    await expect(viewer.getByTestId('result-download-csv-button')).toBeVisible();
    await expect(theirs.historyButton).toHaveCount(0);
  });
});
