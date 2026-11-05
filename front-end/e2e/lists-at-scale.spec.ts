import type { Page } from '@playwright/test';
import { test, expect, BACKEND_URL } from './fixtures';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
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
import { seedMarketAtScale } from './helpers/seedMarketAtScale';

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
