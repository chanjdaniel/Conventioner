import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ManageMarketPage } from './pages/ManageMarketPage';
import { VendorsPage } from './pages/VendorsPage';
import { completePlan } from './helpers/seeds';
import { savePlan } from './helpers/savePlan';
import { approvedVendorApplication, insertApplications } from './helpers/seedApplication';
import { seedPhaseMarket, transitionMarket } from './helpers/seedPhaseMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * Every change on a market, read in Manage market's History section (E40/F01/S03).
 *
 * The changes are made the way the screens make them, through the API, on a fixture market: a
 * setup change and a run of renames in draft, a verdict in review, a table assigned by hand in
 * assignment, and a colleague given a role and then a different one. The section reads them back
 * newest first, each a sentence, a page at a time.
 */
test.use({ viewport: { width: 1440, height: 900 } });

const COLLEAGUE = { email: 'e2e-history-colleague@example.com', password: 'e2epassword123' };
const VENDOR = 'e2e-history-vendor@example.com';
const VENDOR_NAME = 'Hollis Vendor';
const OTHER_VENDOR = 'e2e-history-other@example.com';
const OTHER_NAME = 'Odette Other';
/** Enough renames that the first page of 25 ends before the setup change. */
const RENAMES = 20;
/** The form, the review setup's two decisions, the setup change, the renames, two phase moves, the
 * verdict, the assignment, two roles. */
const WHOLE_HISTORY = 1 + 2 + 1 + RENAMES + 2 + 1 + 1 + 2;
const PAGE = 25;

test.beforeAll(() => ensureVerifiedUser(COLLEAGUE.email, COLLEAGUE.password));

async function ok(response: Awaited<ReturnType<APIRequestContext['put']>>) {
  expect(response.ok(), await response.text()).toBeTruthy();
}

/** A market with every kind of change the story names, and its name as it ended. */
async function seedAHistory(request: APIRequestContext) {
  const seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const plan = completePlan();
  await savePlan(request, BACKEND_URL, TEST_USER.email, seed.marketId, {
    ...plan,
    sections: plan.sections.map((section) => ({ ...section, count: 6 })),
  });
  let marketName = seed.marketName;
  for (let n = 1; n <= RENAMES; n++) {
    marketName = `${seed.marketName} ${n}`;
    await ok(
      await request.put(`${BACKEND_URL}/markets/${seed.marketId}/name`, {
        data: { name: marketName },
      }),
    );
  }
  // As an import leaves it, which a Google Form market's stage waits for, with the essential
  // answers the Vendors page reads, so the drawer a vendor link opens has a vendor to show.
  const application = {
    ...approvedVendorApplication(seed.marketId, VENDOR, {
      dates: [plan.marketDates[0].date],
      tiers: ['Gold'],
      fullName: VENDOR_NAME,
    }),
    status: 'open',
  };
  insertApplications([application]);
  const applicationId = application.id;
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, 'applications');
  await ok(
    await request.put(
      `${BACKEND_URL}/markets/${seed.marketId}/applications/${applicationId}/review`,
      { data: { status: 'reviewer_approved' } },
    ),
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, 'assignment');
  await ok(
    await request.put(`${BACKEND_URL}/markets/${seed.marketId}/placements`, {
      data: {
        email: VENDOR,
        date: plan.marketDates[0].date,
        table_code: 'Hall A 1',
        table_choice: 'Full Table',
      },
    }),
  );
  await ok(
    await request.post(`${BACKEND_URL}/markets/${seed.marketId}/roles`, {
      data: { user_email: COLLEAGUE.email, role: 'editor' },
    }),
  );
  const colleagueId = await request
    .get(`${BACKEND_URL}/markets/${seed.marketId}`)
    .then(async (response) => {
      const { market } = (await response.json()) as {
        market: { peopleWithAccess: Array<{ userId: string; email: string }> };
      };
      return market.peopleWithAccess.find((person) => person.email === COLLEAGUE.email)?.userId;
    });
  await ok(
    await request.put(`${BACKEND_URL}/markets/${seed.marketId}/roles/${colleagueId}`, {
      data: { role: 'viewer' },
    }),
  );
  return { marketId: seed.marketId, marketName };
}

async function openManage(page: Page, marketName: string): Promise<ManageMarketPage> {
  await page.goto(`/markets?q=${encodeURIComponent(marketName)}`);
  await page.getByTestId('market-card-manage-button').click();
  const manage = new ManageMarketPage(page);
  await manage.waitForOverlay();
  await expect(manage.history).toBeVisible();
  // Closed until opened, its heading in sight, so the sections after it stay in reach.
  await expect(manage.historySentences).toHaveCount(0);
  await manage.openHistory();
  return manage;
}

test('every kind of change reads as a sentence, newest first, and older ones come as the list ends', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketName } = await seedAHistory(request);
  const manage = await openManage(page, marketName);
  const me = TEST_USER.email;

  await expect(manage.historySentences).toHaveCount(PAGE);
  const first = await manage.historySentences.allInnerTexts();
  expect(first.slice(0, 5)).toEqual([
    `${me} changed ${COLLEAGUE.email} from Editor to Viewer`,
    `${me} gave ${COLLEAGUE.email} the Editor role`,
    expect.stringMatching(
      new RegExp(
        `^${me} assigned ${VENDOR_NAME} ${VENDOR} at Hall A 1 \\(Full Table\\) on May 1, 2099$`,
      ),
    ),
    // A Google Form market's stage is its Review, as its other screens name it.
    `${me} moved the market from Review to Assignment`,
    `${me} set ${VENDOR_NAME} ${VENDOR} to Approved`,
  ]);
  expect(first).not.toContain(`${me} changed Market Setup: sections`);

  // Older entries come beneath the newest, in the same open dialog, with nothing to press.
  await expect(page.getByText('Load more')).toHaveCount(0);
  await manage.scrollHistoryToEnd();
  await expect(manage.historySentences).toHaveCount(WHOLE_HISTORY);
  const all = await manage.historySentences.allInnerTexts();
  expect(all.slice(0, PAGE)).toEqual(first);
  expect(all.slice(-4)).toEqual([
    `${me} changed Market Setup: sections`,
    `${me} decided no automatic rejections`,
    `${me} decided nothing leads the card`,
    `${me} changed the application form`,
  ]);
  await expect(page.getByTestId('market-history-sentinel')).toHaveCount(0);
  await expect(manage.window).toBeVisible();

  // An entry opens to show what it was before and after.
  const roleChange = await manage.openHistoryEntry(0);
  await expect(roleChange).toContainText('Role');
  await expect(roleChange).toContainText('Editor');
  await expect(roleChange).toContainText('Viewer');
});

test('the list stands in a box one height, its shade says there is more, and the dialog stays', async ({
  authenticatedPage: page,
  request,
}) => {
  // A laptop's height, the lowest the filters are held in sight beside the whole box at.
  await page.setViewportSize({ width: 1280, height: 800 });
  const { marketName } = await seedAHistory(request);
  const manage = await openManage(page, marketName);
  await expect(manage.historySentences).toHaveCount(PAGE);

  const height = await manage.historyBox.evaluate((box) => box.clientHeight);
  expect(height).toBeLessThanOrEqual(28 * 16);
  await expect(manage.historyBoxShadeBottom).toBeVisible();
  // A box below the dialog's fold is scrolled into sight first, as a reader's wheel carries on to it.
  await manage.historyBox.evaluate((box) => box.scrollIntoView({ block: 'nearest' }));
  const windowBefore = await manage.window.boundingBox();
  const filter = page.getByTestId('market-history-kind');
  const filterBefore = await filter.boundingBox();

  await manage.scrollHistoryToEnd();
  await expect(manage.historySentences).toHaveCount(WHOLE_HISTORY);

  // The box did not grow as the page landed, the dialog did not move, and the filters stayed put.
  expect(await manage.historyBox.evaluate((box) => box.clientHeight)).toBe(height);
  expect(await manage.window.boundingBox()).toEqual(windowBefore);
  expect(await filter.boundingBox()).toEqual(filterBefore);
  await expect(filter).toBeInViewport({ ratio: 1 });
  await expect(manage.historyWho.field).toBeInViewport({ ratio: 1 });
  await expect(manage.historyBox).toBeInViewport({ ratio: 1 });

  // The shade goes only at the very end, which says the rest; the top's says where the reader was.
  await manage.scrollHistoryToEnd();
  await expect(manage.historyBoxShadeBottom).toHaveCount(0);
  await expect(page.getByTestId('market-history-box-shade-top')).toBeVisible();
});

test('a scroll past the end of the box carries on to the dialog', async ({
  authenticatedPage: page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { marketName } = await seedAHistory(request);
  const manage = await openManage(page, marketName);
  await manage.scrollHistoryToEnd();
  await expect(manage.historySentences).toHaveCount(WHOLE_HISTORY);
  await manage.scrollHistoryToEnd();
  await expect(manage.historyBoxShadeBottom).toHaveCount(0);

  const body = page.getByTestId('manage-market-body');
  const scrolled = () => body.evaluate((element) => element.scrollTop);
  const before = await scrolled();
  await manage.historyBox.hover();

  // One wheel alone did not always carry on at a fractional box height, and the next did: a box can
  // stop a fraction short of its end, and the first spends itself there.
  await expect(async () => {
    await page.mouse.wheel(0, 200);
    expect(await scrolled()).toBeGreaterThan(before);
  }).toPass({ timeout: 10_000 });
});

test('a short history is only as tall as it is, with no shade and nothing to fetch', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
  });
  const manage = await openManage(page, seed.marketName);
  await expect(manage.historySentences.first()).toBeVisible();

  const { clientHeight, scrollHeight } = await manage.historyBox.evaluate((box) => ({
    clientHeight: box.clientHeight,
    scrollHeight: box.scrollHeight,
  }));
  expect(clientHeight).toBe(scrollHeight);
  expect(clientHeight).toBeLessThan(28 * 16);
  await expect(manage.historyBoxShadeBottom).toHaveCount(0);
  await expect(page.getByTestId('market-history-sentinel')).toHaveCount(0);
});

test('a page too short to fill the box still leads to the next one', async ({
  authenticatedPage: page,
  request,
}) => {
  // Tall enough that the whole box stands in the dialog's sight, so only the observer can stall it.
  await page.setViewportSize({ width: 1280, height: 1600 });
  const { marketId, marketName } = await seedAHistory(request);
  const whole = (await (
    await request.get(`${BACKEND_URL}/markets/${marketId}/history`)
  ).json()) as { entries: unknown[]; vendorNames: unknown };

  // The market's own first page, two entries at a time, each naming the next as its cursor.
  const asked: string[] = [];
  await page.route(/\/markets\/[^/]+\/history(\?|$)/, async (route) => {
    const before = new URL(route.request().url()).searchParams.get('before');
    asked.push(before ?? '');
    const from = Number(before ?? 0);
    await route.fulfill({
      json: {
        entries: whole.entries.slice(from, from + 2),
        next: from + 2 < whole.entries.length ? String(from + 2) : null,
        vendorNames: whole.vendorNames,
        actors: [],
        groups: [],
      },
    });
  });
  const manage = await openManage(page, marketName);

  // Each short page leaves the sentinel in view, which fires no more by itself. It goes on asking
  // until the box is full and its end has left the sentinel's reach, then stops.
  await expect
    .poll(() => manage.historyBox.evaluate((box) => box.scrollHeight > box.clientHeight))
    .toBe(true);
  await expect(manage.historyBoxShadeBottom).toBeVisible();
  await expect.poll(() => manage.historySentences.count()).toBeLessThan(whole.entries.length);
});

test('a filter changed on the second page starts again at the top', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketName } = await seedAHistory(request);
  const manage = await openManage(page, marketName);
  await manage.scrollHistoryToEnd();
  await expect(manage.historySentences).toHaveCount(WHOLE_HISTORY);
  await expect(manage.historyBox.evaluate((box) => box.scrollTop)).resolves.toBeGreaterThan(0);

  await manage.historyKind.selectOption('People');
  await expect(manage.historySentences).toHaveCount(2);
  await manage.historyKind.selectOption('');

  await expect(manage.historySentences).toHaveCount(PAGE);
  await expect(manage.historyBox.evaluate((box) => box.scrollTop)).resolves.toBe(0);
});

test('tabbing through the entries brings the next page, with the focus kept', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketName } = await seedAHistory(request);
  const manage = await openManage(page, marketName);
  await expect(manage.historySentences).toHaveCount(PAGE);

  await manage.historyEntries.nth(14).getByTestId('market-history-toggle').focus();
  await expect(manage.historySentences).toHaveCount(PAGE);

  const focused = page.locator(':focus');
  await expect(async () => {
    await page.keyboard.press('Tab');
    await expect(manage.historySentences).toHaveCount(WHOLE_HISTORY, { timeout: 250 });
  }).toPass({ timeout: 15_000 });

  // Still on a toggle of the first page, and the next stop is the one after it.
  await expect(focused).toHaveAttribute('data-testid', 'market-history-toggle');
  const at = await focused.evaluate((toggle) =>
    [...document.querySelectorAll('[data-testid="market-history-toggle"]')].indexOf(toggle),
  );
  expect(at).toBeGreaterThan(14);
  expect(at).toBeLessThan(PAGE);
  await page.keyboard.press('Tab');
  await expect(manage.historyEntries.nth(at + 1).locator(':focus')).toHaveCount(1);
});

test('a page that fails says so at the end of the list, and Try again brings it', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketName } = await seedAHistory(request);
  const manage = await openManage(page, marketName);
  await expect(manage.historySentences).toHaveCount(PAGE);

  await page.route(/\/history\?.*before=/, (route) => route.abort());
  await manage.scrollHistoryToEnd();
  const failed = page.getByTestId('market-history-read-failed');
  await expect(failed).toBeVisible();
  await expect(manage.historySentences).toHaveCount(PAGE);
  await manage.scrollHistoryToEnd();
  await expect(failed).toBeInViewport();
  await page.unroute(/\/history\?.*before=/);

  // Held on its way, so what it says meanwhile can be read, and the focus has somewhere to wait.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/history\?.*before=/, async (route) => {
    await held;
    await route.continue();
  });
  await page.getByTestId('market-history-retry').click();
  await expect(page.getByTestId('market-history-loading')).toHaveText('Loading…');
  await expect(page.getByTestId('market-history-loading')).toHaveRole('status');
  await expect(failed).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  release();

  await expect(manage.historySentences).toHaveCount(WHOLE_HISTORY);
  await expect(manage.historyEntries.nth(PAGE).getByTestId('market-history-toggle')).toBeFocused();
  await expect(page.getByTestId('market-history-loading')).toHaveText('');
});

test('a closed section asks for nothing, and opening it again keeps what it read and its filters', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketName } = await seedAHistory(request);
  const manage = await openManage(page, marketName);
  await expect(manage.historySentences).toHaveCount(PAGE);
  await manage.scrollHistoryToEnd();
  await expect(manage.historySentences).toHaveCount(WHOLE_HISTORY);
  await manage.historyKind.selectOption('People');
  await expect(manage.historySentences).toHaveCount(2);

  const asked: string[] = [];
  page.on('request', (sent) => {
    if (sent.url().includes('/history')) asked.push(sent.url());
  });
  await manage.historyToggle.click();
  await expect(manage.historySentences.first()).toBeHidden();
  await manage.historyToggle.click();

  await expect(manage.historySentences).toHaveCount(2);
  await expect(manage.historyKind).toHaveValue('People');
  expect(asked).toEqual([]);
});

test('each filter narrows the list, and a vendor links to their drawer', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId, marketName } = await seedAHistory(request);
  const manage = await openManage(page, marketName);
  await expect(manage.historySentences).toHaveCount(PAGE);

  await manage.historyKind.selectOption('People');
  await expect(manage.historySentences).toHaveCount(2);

  await manage.historyKind.selectOption('');
  await manage.historyVendor.field.fill(VENDOR);
  await expect(manage.historySentences).toHaveCount(2);
  await expect(manage.historySentences.first()).toContainText(`assigned ${VENDOR_NAME}`);
  await expect(manage.historySentences.last()).toContainText('to Approved');

  await manage.historyVendor.field.press('Escape');

  // Who may be narrowed to is whoever changed something here: the colleague only received.
  await manage.historyWho.field.click();
  await expect(manage.historyWho.options).toHaveCount(2);
  await expect(manage.historyWho.options.first()).toHaveText('Anyone');
  await expect(manage.historyWho.option(TEST_USER.email)).toBeVisible();
  await manage.historyWho.field.press('Escape');

  await manage.historyVendorLinks.first().click();
  await expect(page).toHaveURL(`/markets/${marketId}/vendors?vendor=${VENDOR}`);
  await expect(new VendorsPage(page).detailPanel).toContainText(VENDOR);
});

test('the vendor filter finds a vendor by name or address, by words or from its list', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId, marketName } = await seedAHistory(request);
  const other = approvedVendorApplication(marketId, OTHER_VENDOR, {
    dates: [completePlan().marketDates[0].date],
    tiers: ['Gold'],
    fullName: OTHER_NAME,
  });
  insertApplications([other]);
  const manage = await openManage(page, marketName);
  await expect(manage.historySentences).toHaveCount(PAGE);
  const vendor = manage.historyVendor;

  // A list of its own, on every browser, each vendor's name beside their address.
  await vendor.field.click();
  await expect(vendor.option(VENDOR)).toHaveText(`${VENDOR_NAME} (${VENDOR})`);
  await expect(vendor.option(OTHER_VENDOR)).toHaveText(`${OTHER_NAME} (${OTHER_VENDOR})`);
  await vendor.field.press('Escape');
  await expect(vendor.list).toBeHidden();
  await expect(manage.window).toBeVisible();

  // Words that fit several narrow nothing yet, and say so.
  await vendor.field.fill('e2e-history');
  await expect(manage.historyVendorHint).toHaveText('2 vendors match. Keep typing, or choose one.');
  const hintId = await manage.historyVendorHint.getAttribute('id');
  await expect(vendor.field).toHaveAttribute('aria-describedby', hintId!);
  await expect(manage.historySentences).toHaveCount(PAGE);

  // Words that fit one narrow to them as they are typed, and stay as typed.
  await vendor.field.fill(VENDOR_NAME.toLowerCase());
  await expect(manage.historyVendorHint).toHaveCount(0);
  await expect(manage.historySentences).toHaveCount(2);
  await vendor.field.press('Escape');
  await page.getByTestId('market-history-from').focus();
  await expect(vendor.field).toHaveValue(VENDOR_NAME.toLowerCase());
  await expect(manage.historySentences).toHaveCount(2);

  // Words that fit nobody narrow to nothing, and an address typed whole is asked for all the same.
  await vendor.field.fill('nobody at all');
  await expect(page.getByTestId('market-history-empty')).toHaveText(
    'No change matches these filters.',
  );
  await vendor.field.fill('never-seen@example.com');
  await expect(page.getByTestId('market-history-empty')).toHaveText(
    'No change matches these filters.',
  );
  await expect(vendor.field).toHaveValue('never-seen@example.com');

  // Chosen from the list, the field names them and the history narrows to them.
  await vendor.field.fill('hollis');
  await vendor.option(VENDOR).click();
  await expect(vendor.list).toBeHidden();
  await expect(vendor.field).toHaveValue(`${VENDOR_NAME} (${VENDOR})`);
  await expect(manage.historySentences).toHaveCount(2);

  await page.getByTestId('market-history-clear').click();
  await expect(vendor.field).toHaveValue('');
  await expect(manage.historySentences).toHaveCount(PAGE);
});

for (const width of [1280, 390]) {
  test(`the filters keep their columns at ${width}, and the vendor's list moves nothing`, async ({
    authenticatedPage: page,
    request,
    expectAccessible,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const { marketName } = await seedAHistory(request);
    const manage = await openManage(page, marketName);
    await expect(manage.historySentences).toHaveCount(PAGE);
    const vendor = manage.historyVendor;
    const from = page.getByTestId('market-history-from');
    const to = page.getByTestId('market-history-to');
    const others = [manage.historyWho.field, manage.historyKind, from, to];
    const where = () =>
      Promise.all(
        [...others, manage.historySentences.first()].map((item) =>
          item.evaluate((element) => {
            const scroller = element.closest('[data-testid="manage-market-body"]');
            const { x, y, width } = element.getBoundingClientRect();
            return { x, y: y + (scroller?.scrollTop ?? 0), width };
          }),
        ),
      );
    const before = await where();

    // Who and Kind side by side, the vendor across both, then From and To side by side.
    const [whoBox, kindBox, fromBox, toBox] = before;
    expect(whoBox!.y).toBeCloseTo(kindBox!.y, 0);
    expect(fromBox!.y).toBeCloseTo(toBox!.y, 0);
    expect(whoBox!.width).toBeCloseTo(kindBox!.width, 0);
    const fieldBox = (await vendor.field.boundingBox())!;
    expect(fieldBox.x).toBeCloseTo(whoBox!.x, 0);
    expect(fieldBox.x + fieldBox.width).toBeCloseTo(kindBox!.x + kindBox!.width, 0);

    await vendor.field.click();
    await expect(vendor.list).toBeVisible();
    expect(await where()).toEqual(before);
    await expect(vendor.list.evaluate((list) => list.getBoundingClientRect().width)).resolves.toBe(
      fieldBox.width,
    );
    await expectAccessible('the vendor list open');

    // Words bring "Clear filters" under the filters, as any filter does, and the filters stay.
    await vendor.field.fill('hollis');
    expect((await where()).slice(0, others.length)).toEqual(before.slice(0, others.length));
  });
}

test('a market whose vendors apply on its page names its stage Applications', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
  });
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, 'applications');

  const manage = await openManage(page, seed.marketName);

  await expect(manage.historySentences.first()).toHaveText(
    `${TEST_USER.email} moved the market from Draft to Applications`,
  );
});
