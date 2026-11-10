import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { expectWholeAddress } from './helpers/addressBreaks';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import { SEED_MARKET_DATE } from './helpers/seeds';
import { seedTheScreens } from './helpers/seedTheScreens';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { ManageMarketPage } from './pages/ManageMarketPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { ReviewersPanel } from './pages/ReviewersPanel';
import { TablesPage } from './pages/TablesPage';
import { VendorsPage } from './pages/VendorsPage';

/**
 * An address in a review sentence breaks only before its "@" or at a dot, never at its hyphen
 * (T181), as the history table's already did (T137 review note 7).
 *
 * On the screens seed's divided-review market every open application is dealt to
 * `e2e-screens-reviewer@example.com`, an address with hyphens in its local part. At 390 the dealt
 * warning on One by one's card and in the All view's drawer, the reviewer line, and a history
 * sentence naming whose share a verdict was each lay it out; no line inside it may end at a hyphen.
 *
 * The Applications page fits a phone (its route names it in `meta.fitsAPhone`, T180), so at 390
 * One by one's card and the All view's rows are a phone's width, and the drawer is too; but each
 * of those lines is still wider than the seed's address, which may then move whole to a line of
 * its own. So each sentence is also drawn in a line narrower than the address, where the address
 * has to break somewhere.
 */

const SIZES = [
  { name: 'on a phone', viewport: { width: 390, height: 844 } },
  { name: 'at a desk', viewport: { width: 1440, height: 900 } },
] as const;

let dealtMarketId: string;
let dealtMarketName: string;
let reviewer: string;
let organizationName: string;

test.beforeAll(async ({ request }) => {
  test.setTimeout(120_000);
  ({
    dealt: { marketId: dealtMarketId, marketName: dealtMarketName, reviewer },
    organization: { name: organizationName },
  } = await seedTheScreens(request, BACKEND_URL, TEST_USER.email, TEST_USER.password));
});

for (const size of SIZES) {
  test(`One by one's card keeps the reviewer's address whole, ${size.name}`, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize(size.viewport);
    const monitor = new ApplicationMonitorPage(page);
    await monitor.goto(dealtMarketId);
    await monitor.helpOthersButton.click();
    await expect(monitor.dealtWarning).toBeVisible();

    await expectWholeAddress(monitor.dealtWarning, reviewer);
    await expectWholeAddress(monitor.reviewer, reviewer);
  });

  test(`the All view's drawer and its history keep the reviewer's address whole, ${size.name}`, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize(size.viewport);
    const all = new ApplicationsAllPage(page);
    const drawer = new VendorsPage(page);
    const vendor = `applicant${size.viewport.width === 390 ? 0 : 1}@example.com`;
    await all.goto(dealtMarketId, 'anyone');
    await expectWholeAddress(all.reviewerOf(vendor), reviewer);
    await all.open(vendor);

    await expectWholeAddress(all.drawerDealtWarning, reviewer);
    await expectWholeAddress(all.drawerReviewer, reviewer);

    // Deciding someone else's share writes ", dealt to <address>" into the entry's sentence.
    await all.drawerButton('approve').click();
    await expect(all.drawerDealtWarning).toHaveCount(0);
    await drawer.openTab('history');
    const sentence = drawer.detailHistorySentences.filter({ hasText: `dealt to ${reviewer}` });
    await expectWholeAddress(sentence, reviewer);
  });
}

test('Manage organization\'s rows break an address only before its "@" or a dot', async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const orgs = new OrganizationsPage(page);
  await orgs.goto();
  await (await orgs.findCard(organizationName)).getByTestId('organizations-manage-button').click();
  await expect(orgs.manageWindow).toBeVisible();

  // A row's address takes what the row leaves it, so it is freed to take the width it is given.
  const admin = orgs.adminEmails.filter({ hasText: reviewer });
  const member = orgs.memberEmails.first();
  for (const cell of [admin, member]) {
    await cell.evaluate((element) => (element.style.flex = 'none'));
    await expectWholeAddress(cell, (await cell.textContent())!, true);
  }
});

test('Manage market\'s rows break an address only before its "@" or a dot', async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/markets?q=${encodeURIComponent(dealtMarketName)}`);
  await page.getByTestId('market-card-manage-button').click();
  const manage = new ManageMarketPage(page);
  await manage.waitForOverlay();

  // A row's address takes what the row leaves it, so it is freed to take the width it is given.
  const cell = manage.personEmail(reviewer);
  await cell.evaluate((element) => (element.style.flex = 'none'));
  await expectWholeAddress(cell, reviewer, true);
});

test('a chooser of a market\'s team, its rows and chips, breaks an address only before its "@" or a dot', async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const monitor = new ApplicationMonitorPage(page);
  await monitor.goto(dealtMarketId);
  const reviewers = new ReviewersPanel(page);
  await reviewers.change.click();
  await reviewers.dialog.waitFor();
  await reviewers.chooser.field.click();

  const row = reviewers.chooser.option(reviewer).locator('.search-picker-option-label');
  const chip = reviewers.chooser.chip(reviewer).locator('.search-picker-chip-label');
  // As the phone draws them, then in a line narrower than the address, where it must break.
  for (const words of [row, chip]) {
    await expectWholeAddress(words, reviewer);
    await expectWholeAddress(words, reviewer, true);
  }
});

test('the Reviewers panel\'s line breaks an address only before its "@" or a dot', async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const monitor = new ApplicationMonitorPage(page);
  await monitor.goto(dealtMarketId);
  const { line } = new ReviewersPanel(page);
  await expectWholeAddress(line, reviewer);
  await expectWholeAddress(line, reviewer, true);
});

test('"Assigned to", which offers reviewers of its own, breaks an address only before its "@" or a dot', async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const all = new ApplicationsAllPage(page);
  await all.goto(dealtMarketId, 'anyone');
  await all.assignedTo.field.click();

  const row = all.assignedTo.options
    .filter({ hasText: reviewer })
    .locator('.search-picker-option-label');
  await expectWholeAddress(row, reviewer);
  await expectWholeAddress(row, reviewer, true);
});

test('"Who sits here" and "Swap them with" break an address only before its "@" or a dot', async ({
  authenticatedPage: page,
  request,
}) => {
  const seated = 'e2e-seated-vendor@example.com';
  const waiting = 'e2e-waiting-vendor@example.com';
  const { marketId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { run: false },
  );
  seedApprovedVendor(marketId, seated, {
    dates: [SEED_MARKET_DATE],
    tiers: ['Gold'],
    fullName: 'Sam Seated',
  });
  const run = await request.post(`${BACKEND_URL}/markets/${marketId}/assignment`);
  expect(run.ok()).toBe(true);
  // Applied after the run, so the seat's list has someone with no table to offer.
  seedApprovedVendor(marketId, waiting, {
    dates: [SEED_MARKET_DATE],
    tiers: ['Gold'],
    fullName: 'Wren Waiting',
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const tables = new TablesPage(page);
  await tables.goto(marketId);
  const words = (email: string, which: 'vendor' | 'swap-target') =>
    tables.pickerOption(which, email).locator('.search-picker-option-label');

  await page.getByTestId('tables-seat-empty').first().click();
  await tables.openPicker('vendor');
  await expectWholeAddress(words(waiting, 'vendor'), waiting);
  await expectWholeAddress(words(waiting, 'vendor'), waiting, true);
  await tables.cancel();

  await tables.change(tables.seatOf('alice@example.com'));
  await tables.openPicker('swap-target');
  await expectWholeAddress(words(seated, 'swap-target'), seated);
  await expectWholeAddress(words(seated, 'swap-target'), seated, true);
});

test('in a line narrower than the address, each sentence breaks it only before its "@" or a dot', async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const monitor = new ApplicationMonitorPage(page);
  await monitor.goto(dealtMarketId);
  await monitor.helpOthersButton.click();
  await expectWholeAddress(monitor.dealtWarning, reviewer, true);
  await expectWholeAddress(monitor.reviewer, reviewer, true);

  const all = new ApplicationsAllPage(page);
  const drawer = new VendorsPage(page);
  const vendor = 'applicant2@example.com';
  await all.goto(dealtMarketId, 'anyone');
  await expectWholeAddress(all.reviewerOf(vendor), reviewer, true);
  await all.open(vendor);
  await expectWholeAddress(all.drawerDealtWarning, reviewer, true);
  await expectWholeAddress(all.drawerReviewer, reviewer, true);

  await all.drawerButton('approve').click();
  await expect(all.drawerDealtWarning).toHaveCount(0);
  await drawer.openTab('history');
  const sentence = drawer.detailHistorySentences.filter({ hasText: `dealt to ${reviewer}` });
  await expectWholeAddress(sentence, reviewer, true);
});
