import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, APP_API, BACKEND_URL, CsvImportPage, TEST_USER } from './fixtures';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { ResultPage } from './pages/ResultPage';
import { TablesPage } from './pages/TablesPage';
import { UpdateInfoDialog } from './pages/UpdateInfoDialog';
import { VendorExportDialog } from './pages/VendorExportDialog';
import { VendorsPage } from './pages/VendorsPage';
import { sweep } from './helpers/contrastSweep';
import {
  detectLayout,
  gates,
  minTargetAt,
  SPACE_SCALE,
  TYPE_SCALE,
} from './helpers/layoutDetectors';
import { marketScreenPath } from './helpers/marketScreens';
import { planSetupObject, seedApplicantMarket } from './helpers/seedApplicantMarket';
import { seedMarketAtScale, type MarketAtScaleSeed } from './helpers/seedMarketAtScale';

/**
 * The app's long lists at a real market's size (T223): each is a list frame over what its screen
 * reads, on the one market `seedMarketAtScale` makes through the real import.
 */

/** Nothing runs past the window, and the layout detectors find nothing that gates. */
async function holdsItsLayout(page: Page, width: number, what: string): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    `${what}: the page runs past the window`,
  ).toBeLessThanOrEqual(0);
  const findings = await page.evaluate(detectLayout, {
    spaceScale: SPACE_SCALE,
    textScale: TYPE_SCALE,
    minTarget: minTargetAt(width),
  });
  expect(
    findings
      .filter((finding) => gates(finding, width))
      .map((f) => `${f.kind} ${f.el}: ${f.detail}`),
    `${what}: the layout detectors' gating findings`,
  ).toEqual([]);
}

/** Every text at AA, with the pointer off whatever it last pressed, whose hover is its own look. */
async function readsAtAA(page: Page, what: string): Promise<void> {
  await page.mouse.move(0, 0);
  expect((await sweep(page)).failures, `${what} has text below AA`).toEqual([]);
}

test('the seed: 120 applications from the import, and the solver fills a section of 31 and one of 28', async ({
  authenticatedPage: page,
  request,
}) => {
  test.setTimeout(120_000);
  const seed = await seedMarketAtScale(request);
  const { applications, undecidedOrApproved, rejected } = seed.counts;
  const all = new ApplicationsAllPage(page);
  await all.goto(seed.marketId);
  await expect(all.count).toHaveText(`Showing 50 of ${applications}`);
  await all.filter('reviewer_approved');
  await expect(all.count).toHaveText(
    `Showing 50 of ${undecidedOrApproved} (${applications} in all)`,
  );
  await all.filter('reviewer_rejected');
  await expect(all.count).toHaveText(`${rejected} of ${applications} applications`);
  // The review closed on entering assignment, so there is nothing to tick.
  await expect(all.selectAll).toHaveCount(0);

  const res = await request.get(`${BACKEND_URL}/markets/${seed.marketId}`);
  const { market } = (await res.json()) as {
    market: { setupObject: { sections: { name: string; count: number }[] } };
  };
  expect(market.setupObject.sections.map(({ name, count }) => ({ name, count }))).toEqual(
    seed.sections,
  );
  await page.goto(marketScreenPath(seed.marketId, 'assignments'));
  const tables = seed.sections.reduce((all, { count }) => all + count, 0);
  await page.getByTestId('tables-show-all').click();
  await expect(page.getByTestId('tables-table-row')).toHaveCount(tables);
  // The solver filled the tables: more vendors want one than there are.
  await expect(page.getByTestId('tables-seat-empty')).toHaveCount(0);
  await expect(page.getByTestId('result-unassigned-link')).toContainText(
    `${undecidedOrApproved - tables} unassigned`,
  );
});

test.describe('Applications All', () => {
  for (const width of [1280, 390, 320]) {
    test.describe(`at ${width}`, () => {
      test.use({ viewport: { width, height: 844 } });

      test('finds one of 120 by name or address, in the address, and the frame reads them', async ({
        authenticatedPage: page,
        request,
        expectAccessible,
      }) => {
        test.setTimeout(120_000);
        const seed = await seedMarketAtScale(request, { assign: false });
        const all = new ApplicationsAllPage(page);
        const { applications, undecidedOrApproved } = seed.counts;

        // Reached from another screen, so Back has somewhere to leave to.
        await page.goto(marketScreenPath(seed.marketId, 'stats'));
        await page.getByTestId('market-bar-tab-applications').click();
        await expect(all.count).toHaveText(`Showing 50 of ${applications}`);
        await expect(all.rows).toHaveCount(50);
        await expect(all.more).toHaveText('Show 50 more');
        await expect(all.find).toHaveAccessibleName('Find by name or address');
        await expect(all.rows.first()).toContainText(seed.applicants[0]!.fullName);
        await holdsItsLayout(page, width, 'the first page');
        await expectAccessible('the first page of 120 applications');
        await readsAtAA(page, 'the first page');

        // A filter's count names the whole.
        await all.filter('undecided');
        await expect(all.count).toHaveText(
          `Showing 50 of ${undecidedOrApproved} (${applications} in all)`,
        );
        await all.filter('all');
        await expect(all.count).toHaveText(`Showing 50 of ${applications}`);

        // By a name past the first page, typed key by key: none may be lost to the address.
        const far = seed.applicants[100]!;
        await all.find.pressSequentially(far.fullName.split(' ')[0]!.toLowerCase());
        await expect(all.count).toHaveText(
          `1 of ${applications} matches "${far.fullName.split(' ')[0]!.toLowerCase()}"`,
        );
        await expect(all.rows).toHaveCount(1);
        await expect(all.row(far.email)).toBeVisible();

        // A family's twelve, capitals aside, past the first page too.
        await all.find.fill('ASHGROVE');
        await expect(all.count).toHaveText(`12 of ${applications} match "ASHGROVE"`);
        await expect(all.rows).toHaveCount(12);

        // By address.
        const addressed = seed.applicants[6]!;
        await all.find.fill(addressed.email);
        await expect(all.count).toHaveText(`1 of ${applications} matches "${addressed.email}"`);
        await expect(all.row(addressed.email)).toBeVisible();

        // By the name they go by, and by the legal name their row no longer shows.
        const goesBy = seed.applicants[19]!;
        await all.find.fill(goesBy.preferredName!);
        await expect(all.rows).toHaveCount(1);
        await expect(all.row(goesBy.email)).toContainText(goesBy.preferredName!);
        await all.find.fill(goesBy.fullName);
        await expect(all.rows).toHaveCount(1);
        await expect(all.row(goesBy.email)).toBeVisible();

        // Words that find nothing say so, with no Select all to press.
        await all.find.fill('nobody by this name');
        await expect(all.count).toHaveText('Nothing matches "nobody by this name"');
        await expect(all.rows).toHaveCount(0);
        await expect(all.selectAll).toHaveCount(0);
        await holdsItsLayout(page, width, 'words that find nothing');

        // A refresh and a link keep the words; Back leaves rather than stepping through them.
        await all.find.fill('birchwell');
        await expect(all.count).toHaveText(`12 of ${applications} match "birchwell"`);
        await page.reload();
        await expect(all.find).toHaveValue('birchwell');
        await expect(all.rows).toHaveCount(12);
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/markets/${seed.marketId}/stats`));

        await all.page.goto(`${marketScreenPath(seed.marketId, 'applications')}?search=dunmarrow`);
        await expect(all.find).toHaveValue('dunmarrow');
        await expect(all.count).toHaveText(`12 of ${applications} match "dunmarrow"`);
      });

      test('pages on with the focus, holds its place through a verdict, and folds back on a filter', async ({
        authenticatedPage: page,
        request,
      }) => {
        test.setTimeout(120_000);
        const seed = await seedMarketAtScale(request, { assign: false });
        const all = new ApplicationsAllPage(page);
        const { applications, undecidedOrApproved } = seed.counts;
        await all.goto(seed.marketId);
        await all.filter('undecided');
        await expect(all.rows).toHaveCount(50);

        // The focus goes on to the first new row, and Tab into it.
        await all.more.focus();
        await page.keyboard.press('Enter');
        await expect(all.rows).toHaveCount(100);
        await expect(all.rows.nth(50)).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(all.rows.nth(50).getByTestId('applications-all-tick')).toBeFocused();
        await expect(all.count).toHaveText(
          `Showing 100 of ${undecidedOrApproved} (${applications} in all)`,
        );
        await holdsItsLayout(page, width, 'two pages');

        // A verdict past the first page: the row leaves the filter, and the second page stays.
        const decided = seed.applicants[70]!;
        await all.open(decided.email);
        await all.drawerButton('approve').click();
        await expect(all.drawerVerdict).toContainText('Approved');
        await all.closeDrawer();
        await expect(all.rows).toHaveCount(100);
        await expect(all.count).toHaveText(
          `Showing 100 of ${undecidedOrApproved - 1} (${applications} in all)`,
        );
        await expect(all.row(decided.email)).toHaveCount(0);

        // Refresh holds it too.
        await page.getByTestId('applications-refresh').click();
        await expect(page.getByTestId('applications-refresh')).toBeEnabled();
        await expect(all.rows).toHaveCount(100);

        // New words, and a filter, fold back to 50.
        await all.find.fill('applicant');
        await expect(all.rows).toHaveCount(50);
        await all.find.fill('');
        await all.more.click();
        await expect(all.rows).toHaveCount(100);
        await all.filter('all');
        await expect(all.rows).toHaveCount(50);
      });

      test('Select all ticks only the rows on screen, and no verdict reaches any other', async ({
        authenticatedPage: page,
        request,
        expectAccessible,
      }) => {
        test.setTimeout(120_000);
        const seed = await seedMarketAtScale(request, { assign: false });
        const all = new ApplicationsAllPage(page);
        const dialog = new VendorExportDialog(page);
        await all.goto(seed.marketId);
        await all.filter('undecided');

        await expect(all.selectAll).toHaveText('Select all 50 shown');
        await all.selectAll.click();
        await expect(all.selection).toContainText('50 applications selected');
        await expect(all.rows.getByTestId('applications-all-tick').nth(49)).toBeChecked();
        await holdsItsLayout(page, width, 'a capped selection');
        await expectAccessible('a capped selection');
        await readsAtAA(page, 'a capped selection');

        // The next page comes unticked, and the button now names both.
        await all.more.click();
        await expect(all.selectAll).toHaveText('Select all 100 shown');
        await expect(all.selection).toContainText('50 applications selected');
        await expect(all.rows.nth(50).getByTestId('applications-all-tick')).not.toBeChecked();

        // Words take the ticked rows off the screen with them, and they do not come back.
        await all.find.fill('ashgrove');
        // Applicants 1, 11, 21, 31 and 41, of the 50 ticked.
        await expect(all.selection).toContainText('5 applications selected');
        await all.find.fill('');
        await expect(all.rows).toHaveCount(50);
        await expect(all.selection).toContainText('5 applications selected');
        await all.selection.getByTestId('applications-all-selection-clear').click();

        // Export opens on the words, as well as the filter.
        await all.find.fill('copperfen');
        await all.exportButton.click();
        await expect(dialog.window).toBeVisible();
        await expect(page.getByTestId('vendor-export-search')).toHaveValue('copperfen');
        await expect(dialog.status('open')).toBeChecked();
        await expect(dialog.summary).toHaveText('11 vendors, 3 columns');
        await page.keyboard.press('Escape');
        await expect(dialog.window).toBeHidden();
        await all.find.fill('');

        // A verdict on what Select all ticked reaches those 50, and they are the first 50.
        await expect(all.selectAll).toHaveText('Select all 50 shown');
        await all.selectAll.click();
        await all.decideSelection('approve');
        await expect(all.confirmWindow).toContainText('Approve 50 applications?');
        await all.confirmButton.click();
        await expect(all.result).toContainText('50 applications approved.');

        const listed = await request.get(`${BACKEND_URL}/markets/${seed.marketId}/applications`);
        const { applications } = (await listed.json()) as {
          applications: { applicantEmail: string; status: string }[];
        };
        const approved = applications
          .filter(({ status }) => status === 'reviewer_approved')
          .map(({ applicantEmail }) => applicantEmail)
          .sort();
        expect(approved).toEqual(
          seed.applicants
            .slice(0, 50)
            .map(({ email }) => email)
            .sort(),
        );
      });
    });
  }
});

test.describe('Vendors', () => {
  for (const width of [1280, 390]) {
    test.describe(`at ${width}`, () => {
      test.use({ viewport: { width, height: 844 } });

      test('shows 50 of 120 under its pinned search, whose words are in the address', async ({
        authenticatedPage: page,
        request,
        expectAccessible,
      }) => {
        test.setTimeout(120_000);
        const seed = await seedMarketAtScale(request);
        const vendors = new VendorsPage(page);
        const dialog = new VendorExportDialog(page);
        const { applications, undecidedOrApproved, rejected } = seed.counts;
        const tables = seed.sections.reduce((all, { count }) => all + count, 0);
        const assignedLine = `${tables} of ${undecidedOrApproved} vendors assigned`;

        // Reached from another screen, so Back has somewhere to leave to.
        await page.goto(marketScreenPath(seed.marketId, 'stats'));
        await vendors.goto(seed.marketId);
        await expect(vendors.listCount).toHaveText(`Showing 50 of ${applications}`);
        await expect(vendors.vendorListItems).toHaveCount(50);
        await expect(vendors.showMore).toHaveText('Show 50 more');
        await expect(vendors.summary).toHaveText(assignedLine);
        await expect(vendors.searchInput).toHaveAccessibleName('Search vendors');
        // Newest first, as the page reads them, so the first to arrive stands past the cap.
        await expect(vendors.vendorListItems.first()).toContainText(seed.applicants.at(-1)!.email);
        await expect(
          vendors.vendorListItems.filter({ hasText: seed.applicants[0]!.email }),
        ).toHaveCount(0);
        await holdsItsLayout(page, width, 'the first page');
        await expectAccessible('the first page of 120 vendors');
        await readsAtAA(page, 'the first page');

        // The search stays pinned with the frame on a desk, however far down the list has gone.
        await vendors.showMore.scrollIntoViewIfNeeded();
        if (width === 1280) await expect(vendors.searchInput).toBeInViewport();
        await page.evaluate(() => window.scrollTo(0, 0));

        // A name past the first page, typed key by key: none may be lost to the address.
        const far = seed.applicants[0]!;
        const family = far.fullName.split(' ')[1]!.toLowerCase();
        await vendors.searchInput.pressSequentially(family);
        await expect(page).toHaveURL(new RegExp(`[?&]search=${family}(&|$)`));
        await expect(vendors.vendorListItems).toHaveCount(12);
        await expect(vendors.vendorListItems.filter({ hasText: far.email })).toBeVisible();
        // The summary counts them, so the frame says nothing while it draws them all.
        await expect(vendors.summary).toHaveText(`12 of ${applications} vendors shown`);
        await expect(vendors.listCount).toHaveCount(0);
        await expect(vendors.showMore).toHaveCount(0);
        await holdsItsLayout(page, width, 'a search');

        // Export opens on the words, as it did when they lived in the page.
        await vendors.exportButton.click();
        await expect(dialog.window).toBeVisible();
        await expect(page.getByTestId('vendor-export-search')).toHaveValue(family);
        await expect(dialog.summary).toContainText('12 vendors');
        await page.keyboard.press('Escape');
        await expect(dialog.window).toBeHidden();

        // A refresh keeps them; Back leaves rather than stepping through them.
        await page.reload();
        await expect(vendors.searchInput).toHaveValue(family);
        await expect(vendors.vendorListItems).toHaveCount(12);
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/markets/${seed.marketId}/stats`));

        // So does a link, and a place filter's "Clear all" lets go of the filter alone.
        const date = await request
          .get(`${BACKEND_URL}/markets/${seed.marketId}`)
          .then(async (res) => {
            const { market } = (await res.json()) as {
              market: { setupObject: { marketDates: { date: string }[] } };
            };
            return market.setupObject.marketDates[0]!.date;
          });
        await page.goto(
          `${marketScreenPath(seed.marketId, 'vendors')}?search=${family}&date=${date}`,
        );
        await expect(vendors.searchInput).toHaveValue(family);
        await vendors.clearAllFilterButton.click();
        await expect(page).toHaveURL(new RegExp(`\\?search=${family}$`));
        await expect(vendors.searchInput).toHaveValue(family);
        await expect(vendors.vendorListItems).toHaveCount(12);

        // Words that find nothing say what they said.
        await vendors.searchInput.fill('nobody by this name');
        await expect(page.getByText('No vendors match "nobody by this name".')).toBeVisible();
        await expect(vendors.summary).toHaveText(`0 of ${applications} vendors shown`);
        await expect(vendors.listCount).toHaveCount(0);
        await holdsItsLayout(page, width, 'words that find nothing');

        // Emptied, the key goes and the summary reads as it did.
        await vendors.searchInput.fill('');
        await expect(page).not.toHaveURL(/search=/);
        await expect(vendors.summary).toHaveText(assignedLine);
        await expect(vendors.vendorListItems).toHaveCount(50);

        // A filter that leaves more than a page is capped; one that leaves fewer has no count.
        await vendors.unassignedOnly.click();
        const unassigned = undecidedOrApproved - tables;
        await expect(vendors.listCount).toHaveText(`Showing 50 of ${unassigned}`);
        await expect(vendors.showMore).toHaveText(`Show ${unassigned - 50} more`);
        await page.getByTestId('vendors-filter-rejected').click();
        await expect(vendors.vendorListItems).toHaveCount(rejected);
        await expect(vendors.listCount).toHaveCount(0);
      });

      test('pages on with the focus, holds its place through a change, and folds back on a filter', async ({
        authenticatedPage: page,
        request,
      }) => {
        test.setTimeout(120_000);
        const seed = await seedMarketAtScale(request);
        const vendors = new VendorsPage(page);
        const update = new UpdateInfoDialog(page);
        const { applications } = seed.counts;
        await vendors.goto(seed.marketId);
        await expect(vendors.vendorListItems).toHaveCount(50);

        // The focus goes on to the first new row, and Tab into it.
        await vendors.showMore.focus();
        await page.keyboard.press('Enter');
        await expect(vendors.vendorListItems).toHaveCount(100);
        await expect(vendors.listRows.nth(50)).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(vendors.vendorListItems.nth(50)).toBeFocused();
        await expect(vendors.listCount).toHaveText(`Showing 100 of ${applications}`);
        await holdsItsLayout(page, width, 'two pages');

        // A change in the drawer, on a row past the first page: the read again holds the place.
        const changed = seed.applicants[40]!;
        const row = vendors.vendorListItems.filter({ hasText: changed.email });
        await row.scrollIntoViewIfNeeded();
        const scrolled = await page.evaluate(() => Math.round(window.scrollY));
        expect(scrolled).toBeGreaterThan(0);
        await row.click();
        await expect(page.getByTestId('vendors-detail-email')).toHaveText(changed.email);
        await update.open();
        await update.input('business_name').fill('Stall of someone else');
        await update.saveButton.click();
        await expect(update.window).toBeHidden();
        // Hidden through the read again, then back as many as they were.
        await expect(vendors.listCount).toBeVisible();
        await expect(vendors.listCount).toHaveText(`Showing 100 of ${applications}`);
        await vendors.closeDetail();
        await expect(vendors.detailCloseButton).toBeHidden();
        await expect(vendors.vendorListItems).toHaveCount(100);
        await expect(row).toBeFocused();
        await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(scrolled);

        // New words fold back, and so does a filter.
        await vendors.search('applicant');
        await expect(vendors.vendorListItems).toHaveCount(50);
        await vendors.search('');
        await expect(vendors.vendorListItems).toHaveCount(50);
        await vendors.showMore.click();
        await expect(vendors.vendorListItems).toHaveCount(100);
        await vendors.unassignedOnly.click();
        await expect(vendors.vendorListItems).toHaveCount(50);

        // A last page says nothing more, and offers nothing more.
        await vendors.unassignedOnly.click();
        await expect(vendors.vendorListItems).toHaveCount(50);
        await vendors.showMore.click();
        await vendors.showMore.click();
        await expect(vendors.vendorListItems).toHaveCount(applications);
        await expect(vendors.showMore).toHaveCount(0);
        await expect(vendors.listCount).toHaveCount(0);
      });

      test('a link to a vendor past the cap opens the drawer and leaves the list as it was', async ({
        authenticatedPage: page,
        request,
      }) => {
        test.setTimeout(120_000);
        const seed = await seedMarketAtScale(request);
        const vendors = new VendorsPage(page);
        const far = seed.applicants[0]!;
        await page.goto(
          `${marketScreenPath(seed.marketId, 'vendors')}?vendor=${encodeURIComponent(far.email)}`,
        );
        await expect(page.getByTestId('vendors-detail-email')).toHaveText(far.email);
        await expect(vendors.vendorListItems).toHaveCount(50);
        await expect(vendors.listCount).toHaveText(`Showing 50 of ${seed.counts.applications}`);
        await expect(page.locator('.vendor-row--open')).toHaveCount(0);
        await holdsItsLayout(page, width, 'the drawer over a capped list');

        await vendors.closeDetail();
        await expect(vendors.detailCloseButton).toBeHidden();
        await expect(page).not.toHaveURL(/vendor=/);
        await expect(vendors.vendorListItems).toHaveCount(50);
      });
    });
  }
});

test.describe('Payments', () => {
  /** "$7,260.00" from 726000 cents, as the page writes CAD. */
  const dollars = (cents: number) =>
    `$${(cents / 100).toLocaleString('en-CA', { minimumFractionDigits: 2 })}`;

  for (const width of [1280, 390]) {
    test.describe(`at ${width}`, () => {
      test.use({ viewport: { width, height: 844 } });

      test('shows 50 of 120 with its table as it is, and every figure counts all 120', async ({
        authenticatedPage: page,
        request,
        expectAccessible,
      }) => {
        test.setTimeout(120_000);
        const seed = await seedMarketAtScale(request, { pays: true });
        const payments = new PaymentsPage(page);
        const { applications } = seed.counts;
        const read = await request.get(`${BACKEND_URL}/markets/${seed.marketId}/payments`);
        expect(read.ok(), await read.text()).toBeTruthy();
        const { vendors } = (await read.json()) as { vendors: { balanceState: string | null }[] };
        const inState = (state: string) => vendors.filter((v) => v.balanceState === state).length;
        const allPaid = seed.applicants.reduce((sum, { paysCents }) => sum + paysCents, 0);

        await payments.goto(seed.marketId);
        await expect(payments.listCount).toHaveText(`Showing 50 of ${applications}`);
        await expect(payments.rows).toHaveCount(50);
        await expect(payments.showMore).toHaveText('Show 50 more');

        // Under the cap the table stands as it was: its head, its sort, its order.
        await expect(payments.sortButtons).toHaveText(['Vendor▲', 'Owed', 'Paid', 'Difference']);
        await expect(payments.columnSortedBy('ascending')).toContainText('Vendor');
        await expect(payments.rows.first()).toContainText(seed.applicants[0]!.email);

        // Each figure counts every vendor, none of them cut to the rows on screen.
        await expect(payments.total('paidCents')).toContainText(dollars(allPaid));
        await expect(payments.summary).toHaveText(`${applications} vendors`);
        await expect(payments.filter('owes')).toHaveText(`Owes (${inState('owes')})`);
        await expect(payments.filter('over')).toHaveText(
          `Paid more than owed (${inState('over')})`,
        );

        // A row's values each beside their heading on a phone, and in their column at a desk.
        const firstRow = payments.rows.first();
        const labels = firstRow.getByTestId('payments-cell-label');
        await expect(labels).toHaveText(['Owed', 'Paid', 'Difference']);
        for (const label of await labels.all()) {
          await (width === 390 ? expect(label).toBeVisible() : expect(label).toBeHidden());
        }
        await holdsItsLayout(page, width, 'the first page');
        await expectAccessible('the first page of 120 vendors on Payments');
        await readsAtAA(page, 'the first page');

        // A filter that leaves more than a page is capped, and the toolbar still counts them.
        const over = inState('over');
        expect(over).toBeGreaterThan(50);
        await payments.filter('over').click();
        await expect(payments.summary).toHaveText(`${over} of ${applications} vendors shown`);
        await expect(payments.listCount).toHaveText(`Showing 50 of ${over}`);
        await expect(payments.total('paidCents')).toContainText(dollars(allPaid));
        await payments.filter('over').click();

        // Words, in the address as they were: the toolbar counts, so the frame says nothing.
        const far = seed.applicants[60]!;
        const family = far.fullName.split(' ')[1]!.toLowerCase();
        await payments.search.fill(family);
        await expect(page).toHaveURL(new RegExp(`[?&]search=${family}(&|$)`));
        await expect(payments.rows).toHaveCount(12);
        await expect(payments.rows.filter({ hasText: far.email })).toBeVisible();
        await expect(payments.summary).toHaveText(`12 of ${applications} vendors shown`);
        await expect(payments.listCount).toHaveCount(0);
        await expect(payments.showMore).toHaveCount(0);
        await page.reload();
        await expect(payments.search).toHaveValue(family);
        await expect(payments.rows).toHaveCount(12);
        await holdsItsLayout(page, width, 'a search');

        // Words that find nobody say what they said.
        await payments.search.fill('nobody by this name');
        await expect(payments.noneShown).toHaveText('No vendor matches "nobody by this name".');
        await expect(payments.summary).toHaveText(`0 of ${applications} vendors shown`);
        await expect(payments.listCount).toHaveCount(0);
        await holdsItsLayout(page, width, 'words that find nobody');
      });

      test('pages on with the focus, holds its place through a payment, and a new sort folds back', async ({
        authenticatedPage: page,
        request,
      }) => {
        test.setTimeout(120_000);
        const seed = await seedMarketAtScale(request, { pays: true });
        const payments = new PaymentsPage(page);
        const { applications } = seed.counts;
        const allPaid = seed.applicants.reduce((sum, { paysCents }) => sum + paysCents, 0);
        await payments.goto(seed.marketId);
        await expect(payments.rows).toHaveCount(50);

        // The focus goes on to the first new row, and Tab into it.
        await payments.showMore.focus();
        await page.keyboard.press('Enter');
        await expect(payments.rows).toHaveCount(100);
        await expect(payments.rows.nth(50)).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(payments.rows.nth(50).getByTestId('payments-row-open')).toBeFocused();
        await expect(payments.listCount).toHaveText(`Showing 100 of ${applications}`);
        await holdsItsLayout(page, width, 'two pages');

        // A payment recorded on a row past the first page: the read again holds the place.
        const row = payments.rows.nth(70);
        await row.scrollIntoViewIfNeeded();
        const scrolled = await page.evaluate(() => Math.round(window.scrollY));
        expect(scrolled).toBeGreaterThan(0);
        const email = await row.getAttribute('data-email');
        await row.getByTestId('payments-row-open').click();
        await payments.recordPayment('1');
        await expect(payments.total('paidCents')).toContainText(dollars(allPaid + 100));
        await expect(payments.listCount).toHaveText(`Showing 100 of ${applications}`);
        await expect(payments.rows).toHaveCount(100);
        await payments.closeDrawer();
        await expect(payments.rows.nth(70)).toHaveAttribute('data-email', email!);
        await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(scrolled);

        // A new sort starts from its first rows, the focus staying on the heading pressed.
        const paidSort = payments.sort('paid');
        await paidSort.focus();
        await page.keyboard.press('Enter');
        await expect(payments.rows).toHaveCount(50);
        await expect(paidSort).toBeFocused();
        await expect(payments.columnSortedBy('descending')).toContainText('Paid');
        await expect(payments.rows.first()).toHaveAttribute(
          'data-email',
          seed.applicants.at(-1)!.email,
        );
        await expect(payments.listCount).toHaveText(`Showing 50 of ${applications}`);

        // The other way round, too; the order's in the address, so a reload starts it the same.
        await payments.showMore.click();
        await expect(payments.rows).toHaveCount(100);
        await paidSort.click();
        await expect(payments.rows).toHaveCount(50);
        await expect(payments.columnSortedBy('ascending')).toContainText('Paid');
        await expect(payments.rows.first()).toHaveAttribute(
          'data-email',
          seed.applicants[0]!.email,
        );
        await page.reload();
        await expect(payments.columnSortedBy('ascending')).toContainText('Paid');
        await expect(payments.rows).toHaveCount(50);

        // New words fold back, and so does a filter.
        await payments.showMore.click();
        await expect(payments.rows).toHaveCount(100);
        await payments.search.fill('vendor');
        await expect(payments.rows).toHaveCount(50);
        await payments.search.fill('');
        await expect(payments.rows).toHaveCount(50);
        await payments.showMore.click();
        await expect(payments.rows).toHaveCount(100);
        await payments.filter('over').click();
        await expect(payments.rows).toHaveCount(50);
        await payments.filter('over').click();

        // A last page says nothing more, and offers nothing more.
        await payments.showMore.click();
        await payments.showMore.click();
        await expect(payments.rows).toHaveCount(applications);
        await expect(payments.showMore).toHaveCount(0);
        await expect(payments.listCount).toHaveCount(0);

        // A link to a vendor past the cap opens the drawer and leaves the list as it was.
        const far = seed.applicants[60]!;
        await payments.goto(seed.marketId, `?vendor=${encodeURIComponent(far.email)}`);
        await expect(page.getByTestId('vendors-detail-email')).toHaveText(far.email);
        await expect(payments.rows).toHaveCount(50);
        await expect(payments.rows.filter({ hasText: far.email })).toHaveCount(0);
        await payments.closeDrawer();
        await expect(page).not.toHaveURL(/vendor=/);
        await expect(payments.rows).toHaveCount(50);
      });
    });
  }
});

test.describe('The Assignments page', () => {
  const PAST_THE_FOLD = 25;

  /** The market, its two sections, and the page open on them with their tables read. */
  async function openTheTables(page: Page, request: APIRequestContext) {
    const seed = await seedMarketAtScale(request);
    const tables = new TablesPage(page);
    await page.goto(marketScreenPath(seed.marketId, 'assignments'));
    const [gold, silver] = seed.sections as [
      MarketAtScaleSeed['sections'][number],
      MarketAtScaleSeed['sections'][number],
    ];
    const whole = gold.count + silver.count;
    await expect(tables.showAll).toHaveText(`Show all ${whole} tables`);
    return {
      tables,
      whole,
      gold: { ...gold, ...tables.section(seed.date, gold.name) },
      silver: { ...silver, ...tables.section(seed.date, silver.name) },
    };
  }

  for (const width of [1280, 390, 320]) {
    test.describe(`at ${width}`, () => {
      test.use({ viewport: { width, height: 844 } });

      test("each section shows 20, one unfolds alone, and the page's button unfolds them all", async ({
        authenticatedPage: page,
        request,
        expectAccessible,
      }) => {
        test.setTimeout(120_000);
        const { tables, whole, gold, silver } = await openTheTables(page, request);

        // Each section names itself, where it is and its tier, in the page's outline.
        await expect(page.getByRole('heading', { level: 3, name: gold.name })).toBeVisible();
        await expect(gold.heading).toContainText('Indoors');
        await expect(gold.heading).toContainText('Gold');
        await expect(silver.heading).toContainText('Silver');
        await expect(gold.rows).toHaveCount(20);
        await expect(silver.rows).toHaveCount(20);
        await expect(tables.tableRows).toHaveCount(40);
        await expect(gold.fold).toHaveText(`Show all ${gold.count} in ${gold.name}`);
        await expect(silver.fold).toHaveText(`Show all ${silver.count} in ${silver.name}`);
        // The page's count is of its tables, not of what is unfolded.
        await expect(page.locator('.counts-primary')).toHaveText(`${whole} of ${whole} tables`);
        await holdsItsLayout(page, width, 'the sections folded');
        await expectAccessible('the sections folded');
        await readsAtAA(page, 'the sections folded');

        await gold.fold.click();
        await expect(gold.rows).toHaveCount(gold.count);
        await expect(gold.rows.nth(20), 'the first new row has the focus').toBeFocused();
        await expect(gold.rows.nth(20).getByTestId('tables-table-row')).toHaveAttribute(
          'data-table-code',
          `${gold.name} 21`,
        );
        await expect(gold.fold).toHaveText(`Show fewer in ${gold.name}`);
        await expect(silver.rows, 'the other section stays folded').toHaveCount(20);
        await expect(tables.showAll).toHaveText(`Show all ${whole} tables`);
        await holdsItsLayout(page, width, 'a section unfolded');
        await expectAccessible('a section unfolded');
        await readsAtAA(page, 'a section unfolded');

        // The page's button reflects sections unfolded one at a time, and one folded again.
        await silver.fold.click();
        await expect(silver.rows).toHaveCount(silver.count);
        await expect(tables.showAll).toHaveText('Show fewer');
        await gold.fold.scrollIntoViewIfNeeded();
        await gold.fold.click();
        await expect(gold.rows).toHaveCount(20);
        await expect(gold.fold).toBeFocused();
        await expect(tables.showAll).toHaveText(`Show all ${whole} tables`);

        // It unfolds what is left, keeps the focus and stays where it stood.
        await tables.showAll.scrollIntoViewIfNeeded();
        const stood = await tables.showAll.boundingBox();
        await tables.showAll.click();
        await expect(tables.tableRows).toHaveCount(whole);
        await expect(tables.showAll).toHaveText('Show fewer');
        await expect(tables.showAll).toBeFocused();
        await expect(gold.fold).toHaveText(`Show fewer in ${gold.name}`);
        await expect(silver.fold).toHaveText(`Show fewer in ${silver.name}`);
        expect((await tables.showAll.boundingBox())!.y).toBe(stood!.y);
        await holdsItsLayout(page, width, 'the page unfolded');
        await expectAccessible('the page unfolded');
        await readsAtAA(page, 'the page unfolded');

        await tables.showAll.click();
        await expect(tables.tableRows).toHaveCount(40);
        await expect(tables.showAll).toHaveText(`Show all ${whole} tables`);
        await expect(tables.showAll).toBeFocused();
        expect((await tables.showAll.boundingBox())!.y).toBe(stood!.y);
      });

      test('a seat freed, placed and swapped past the fold leaves every fold as it was', async ({
        authenticatedPage: page,
        request,
      }) => {
        test.setTimeout(120_000);
        const { tables, gold, silver } = await openTheTables(page, request);
        const far = `${gold.name} ${PAST_THE_FOLD}`;
        await expect(tables.row(far), 'folded away').toHaveCount(0);

        await gold.fold.click();
        const seat = tables.occupiedSeat(far);
        await expect(seat).toBeVisible();
        const holder = await tables.occupantOf(seat);

        await tables.change(seat);
        await tables.freeSeat();
        await expect(tables.vacantSeat(far)).toBeVisible();
        await expect(gold.rows).toHaveCount(gold.count);
        await expect(silver.rows).toHaveCount(20);

        await tables.vacantSeat(far).click();
        await tables.placeVendor(holder);
        await expect(tables.seatIn(far, holder)).toBeVisible();
        await expect(gold.rows).toHaveCount(gold.count);
        await expect(gold.fold).toHaveText(`Show fewer in ${gold.name}`);
        await expect(silver.rows).toHaveCount(20);

        const other = `${gold.name} ${PAST_THE_FOLD + 1}`;
        const swapped = await tables.occupantOf(tables.occupiedSeat(other));
        await tables.change(tables.seatIn(far, holder));
        await tables.swapWith(swapped);
        await expect(tables.seatIn(far, swapped)).toBeVisible();
        await expect(tables.seatIn(other, holder)).toBeVisible();
        await expect(gold.rows).toHaveCount(gold.count);
        await expect(silver.rows).toHaveCount(20);
        await holdsItsLayout(page, width, 'after a swap past the fold');

        // A fold lasts until the page is left, and the page objects reach past one.
        await page.reload();
        await expect(tables.showAll).toBeVisible();
        await expect(gold.rows).toHaveCount(20);
        await expect(tables.row(far)).toHaveCount(0);
        await expect(await tables.unfoldTo(far)).toBeVisible();
        await page.reload();
        await expect(tables.showAll).toBeVisible();
        await expect(tables.row(far)).toHaveCount(0);
        expect(await new ResultPage(page).placementsFor(swapped)).toEqual([far]);
      });

      test('a filter under the fold shows every match and no button, and leaves the folds as they were', async ({
        authenticatedPage: page,
        request,
      }) => {
        test.setTimeout(120_000);
        const { tables, whole, gold, silver } = await openTheTables(page, request);
        await gold.fold.click();
        await expect(gold.rows).toHaveCount(gold.count);

        // One family of the seed's ten, so a few tables of each section at most.
        await tables.search('Ashgrove');
        await expect(page.locator('.counts-primary')).not.toHaveText(`${whole} of ${whole} tables`);
        const matches = Number(
          /^\d+/.exec((await page.locator('.counts-primary').textContent())!.trim())![0],
        );
        expect(matches).toBeGreaterThan(0);
        expect(matches).toBeLessThanOrEqual(20);
        await expect(tables.tableRows).toHaveCount(matches);
        await expect(tables.showAll).toHaveCount(0);
        await expect(gold.fold).toHaveCount(0);
        await expect(silver.fold).toHaveCount(0);
        await holdsItsLayout(page, width, 'the tables narrowed');

        await tables.search('');
        await expect(gold.rows, 'the words leave the fold as it was').toHaveCount(gold.count);
        await expect(silver.rows).toHaveCount(20);

        // A filter that leaves a section past the fold: the button speaks for what is on the page.
        await tables.setFilter('section', silver.name);
        await expect(tables.tableRows).toHaveCount(20);
        await expect(gold.rows).toHaveCount(0);
        await expect(tables.showAll).toHaveText(`Show all ${silver.count} tables`);
        await tables.showAll.click();
        await expect(tables.tableRows).toHaveCount(silver.count);
        await expect(tables.showAll).toHaveText('Show fewer');
        await tables.showAll.click();
        await expect(tables.tableRows).toHaveCount(20);

        await tables.clearAllFilters();
        await expect(gold.rows, 'what the filter hid comes back as it was').toHaveCount(gold.count);
        await expect(silver.rows).toHaveCount(20);
      });
    });
  }
});

test.describe("The import's lists of rows", () => {
  const HEADERS = [
    'Timestamp',
    'Email Address',
    'Full Legal Name',
    'Which days can you attend?',
    'How many days do you want?',
    'Which tiers will you accept?',
    'Full or half table?',
    'Rank the sections',
    'Business name',
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

  const row = (email: string, name: string, table = 'full', minute = 0) =>
    `2026/05/02 9:${String(minute).padStart(2, '0')}:00,${email},${name},2099-08-01,1,Gold,${table},"Garden, Main Hall",Example Stall,Pottery`;

  const numbered = (count: number, make: (at: number) => string) =>
    Array.from({ length: count }, (_, at) => make(at + 1));

  /**
   * A bad file: rows 2 to 31 refused, 24 for their address and 6 for a missing name, then 25 earlier
   * submissions each replaced by a later row, 25 of those rows rejected by the market's rule, and a
   * row that imports as it should.
   */
  const BAD_FILE = [
    HEADERS.join(','),
    ...numbered(24, (at) => row(`broken-${at}`, `Broken ${at}`)),
    ...numbered(6, (at) => row(`nameless${at}@fixture.test`, '')),
    ...numbered(25, (at) => row(`twice${at}@fixture.test`, `Twice ${at}`, 'half', 1)),
    ...numbered(25, (at) => row(`twice${at}@fixture.test`, `Twice ${at}`, 'half', 2)),
    row('fine@fixture.test', 'Fine Vendor'),
  ].join('\n');

  async function preview(page: Page): Promise<CsvImportPage> {
    const seed = await seedApplicantMarket(
      page.request,
      APP_API,
      TEST_USER.email,
      TEST_USER.password,
      { setupObject: planSetupObject(), intakeMode: 'csv' },
    );
    const rule = await page.request.put(`${APP_API}/markets/${seed.marketId}/rejection-rules`, {
      data: { rules: [{ key: 'essential_table_choice', answers: ['half'] }] },
    });
    expect(rule.ok(), await rule.text()).toBeTruthy();
    const importer = new CsvImportPage(page);
    await page.goto(marketScreenPath(seed.marketId, 'import'));
    await expect(importer.view).toBeVisible({ timeout: 15000 });
    await importer.chooseFile(BAD_FILE);
    await importer.mapColumns(HEADERS, MAPPING);
    await importer.clickPreview();
    await expect(importer.previewCounts).toBeVisible();
    return importer;
  }

  test.describe('at 1280', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('a file refusing 30 rows shows 20, found by a reason, shown whole, then fewer', async ({
      authenticatedPage: page,
    }) => {
      const importer = await preview(page);
      const { previewFailures: list, previewFailureRows: rows } = importer;

      await expect(page.getByTestId('import-preview-failures').locator('h3')).toHaveText(
        '30 rows will be skipped',
      );
      await expect(rows).toHaveCount(20);
      await expect(rows.first()).toHaveText("Row 2: 'broken-1' is not an email address.");
      await expect(list.count).toHaveText('Showing 20 of 30');
      await expect(list.more).toHaveText('Show all 30');
      await holdsItsLayout(page, 1280, 'the preview, capped');

      // By a word of a reason, by a row number, and by an address.
      await list.find.fill('REQUIRED');
      await expect(list.count).toHaveText('6 of 30 match "REQUIRED"');
      await expect(rows).toHaveCount(6);
      await expect(list.more).toHaveCount(0);
      await list.find.fill('row 31');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('nameless6@fixture.test');
      await list.find.fill('broken-17');
      await expect(rows).toHaveText(["Row 18: 'broken-17' is not an email address."]);

      // Enter does nothing to the step: no read, no write, the same rows.
      let asked = 0;
      page.on('request', (sent) => {
        if (sent.method() === 'POST') asked += 1;
      });
      await list.find.press('Enter');
      await expect(rows).toHaveCount(1);
      await expect(importer.preview).toBeVisible();
      await expect(importer.resultSummary).toHaveCount(0);
      expect(asked).toBe(0);
      await list.find.fill('');
      await expect(rows).toHaveCount(20);

      // Whole, with the focus on the first new row, so Tab goes on from there.
      await list.more.click();
      await expect(rows).toHaveCount(30);
      await expect(list.count).toHaveText('30 rows');
      await expect(rows.nth(20)).toBeFocused();
      await expect(list.more).toHaveText('Show fewer');
      await holdsItsLayout(page, 1280, 'the preview, whole');
      await readsAtAA(page, 'the preview, whole');

      // Back to the first page, keeping the focus, with the button in view.
      await list.more.focus();
      await page.keyboard.press('Enter');
      await expect(rows).toHaveCount(20);
      await expect(list.more).toBeFocused();
      await expect(list.more).toHaveText('Show all 30');
      await expect(list.more).toBeInViewport();
    });

    test('the replaced rows and the rows a rule rejects stop at 20 the same way', async ({
      authenticatedPage: page,
    }) => {
      const importer = await preview(page);

      const replaced = importer.repeatNote.getByRole('listitem');
      await expect(importer.repeatNote.locator('> p')).toContainText(
        '25 earlier submissions will be replaced',
      );
      await expect(replaced).toHaveCount(20);
      await expect(importer.repeats.more).toHaveText('Show all 25');
      await importer.repeats.find.fill('twice7@');
      await expect(replaced).toHaveCount(1);
      await expect(replaced.first()).toHaveText(
        'Row 38 (twice7@fixture.test) is replaced by row 63',
      );
      await importer.repeats.find.fill('row 63');
      await expect(replaced).toHaveCount(1);
      await importer.repeats.find.fill('');
      await importer.repeats.more.click();
      await expect(replaced).toHaveCount(25);
      await expect(replaced.nth(20)).toBeFocused();

      const { rejected, rejectedRows, rejectedCount } = importer;
      await expect(rejectedCount).toHaveText('25');
      await expect(rejectedRows).toHaveCount(20);
      await expect(rejected.more).toHaveText('Show all 25');
      await rejected.find.fill('TWICE 19');
      await expect(rejected.count).toHaveText('1 of 25 matches "TWICE 19"');
      await expect(rejectedRows.getByTestId('import-row-name')).toHaveText(['Twice 19']);
      await rejected.find.fill('twice2@');
      await expect(rejectedRows.getByTestId('import-row-email')).toHaveText([
        'twice2@fixture.test',
      ]);
      await rejected.find.fill('');
      await rejected.more.click();
      await expect(rejectedRows).toHaveCount(25);
      await expect(rejectedRows.nth(20)).toBeFocused();
      // The first new row still opens by its heading, and reads its reason.
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await expect(rejectedRows.nth(20)).toHaveJSProperty('open', true);
      await expect(rejectedRows.nth(20).getByTestId('import-row-reason')).toBeVisible();
      await expect(rejectedRows.first()).toHaveJSProperty('open', false);

      // The samples check the mapping: not a frame, and their first row open as it was.
      await expect(importer.sampleRows).toHaveCount(1);
      await expect(importer.sampleRows.first()).toHaveJSProperty('open', true);
      await holdsItsLayout(page, 1280, 'the replaced and rejected rows, whole');
      await readsAtAA(page, 'the replaced and rejected rows, whole');
    });

    test('the done step stops its skipped rows at 20 too', async ({ authenticatedPage: page }) => {
      const importer = await preview(page);
      await importer.clickConfirm();
      await expect(importer.resultSummary).toBeVisible();

      const { failures: list, failureRows: rows } = importer;
      await expect(page.getByTestId('import-failures').locator('h3')).toHaveText('30 rows skipped');
      await expect(rows).toHaveCount(20);
      await expect(list.more).toHaveText('Show all 30');
      await list.find.fill('required');
      await expect(rows).toHaveCount(6);
      await list.find.press('Enter');
      await expect(rows).toHaveCount(6);
      await list.find.fill('');
      await list.more.click();
      await expect(rows).toHaveCount(30);
      await expect(rows.nth(20)).toBeFocused();
      await holdsItsLayout(page, 1280, 'the done step, whole');
      await readsAtAA(page, 'the done step, whole');
    });
  });

  test.describe('at 390, on the desk floor', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('nothing of a list is clipped: the desk layout scrolls sideways, as it did', async ({
      authenticatedPage: page,
    }) => {
      const importer = await preview(page);
      for (const list of [importer.previewFailures, importer.repeats, importer.rejected]) {
        await expect(list.find).toBeVisible();
        const clippedBy = await list.root.evaluate((root) => {
          const box = root.getBoundingClientRect();
          const clips: string[] = [];
          for (let at = root.parentElement; at; at = at.parentElement) {
            const held = at.getBoundingClientRect();
            const hides = getComputedStyle(at).overflowX !== 'visible';
            if (hides && at !== document.body && at !== document.documentElement) {
              if (box.left < held.left || box.right > held.right) clips.push(at.className);
            }
          }
          return clips;
        });
        expect(clippedBy).toEqual([]);
      }
    });
  });
});
