import type { Page } from '@playwright/test';
import { test, expect, BACKEND_URL } from './fixtures';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { VendorExportDialog } from './pages/VendorExportDialog';
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
