import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { SEED_MARKET_DATE, seedMarketWithVendors } from './helpers/seeds';
import { seedApprovedVendor } from './helpers/seedApplication';
import { savePlan } from './helpers/savePlan';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { marketScreenPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { VendorsPage } from './pages/VendorsPage';
import { VendorExportDialog } from './pages/VendorExportDialog';

/**
 * The Payments page (E44/F02/S01), the Assignment tab's fourth page.
 *
 * The market's money at a glance: what is owed, paid, still owed and paid more than owed, also by
 * tier and by date, matching the sum of the vendors' own Payment tabs; and every vendor with a
 * line or a payment, filtered to who owes and to whose refund is to be issued (Q26), each row
 * opening their Payment tab. Filter and sort are in the address, so a reload keeps them.
 */
const VIEWER = { email: 'e2e-payments-viewer@example.com', password: 'e2epassword123' };
const SECOND_DATE = '2099-05-08';
const GOLD = { id: 1, name: 'Gold' };
const SILVER = { id: 2, name: 'Silver' };
const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const CAROL = 'carol@example.com';
const DAN = 'dan@example.com';

const PRICING = {
  currency: 'CAD',
  halfTablePercent: 50,
  everyoneElse: [
    { tier: 'Gold', cents: 3500 },
    { tier: 'Silver', cents: 3000 },
  ],
};

function plan(pricing: typeof PRICING | null) {
  return {
    priority: [],
    marketDates: [{ date: SEED_MARKET_DATE }, { date: SECOND_DATE }],
    tiers: [GOLD, SILVER],
    locations: [{ name: 'Main Hall' }],
    sections: [
      { name: 'North Wing', location: { name: 'Main Hall' }, tier: GOLD, count: 2 },
      { name: 'Landing', location: { name: 'Main Hall' }, tier: SILVER, count: 2 },
    ],
    assignmentOptions: { maxAssignmentsPerVendor: 2, maxHalfTableProportionPerSection: 50 },
    pricing,
  };
}

async function call(
  request: APIRequestContext,
  method: 'put' | 'post',
  path: string,
  data: Record<string, unknown>,
) {
  const res = await request[method](`${BACKEND_URL}${path}`, { data });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
}

/**
 * The fixture market, priced, in assignment: Alice on Gold both days ($70) has paid $35, Bob on
 * Silver one day ($30) has paid $30, and Carol on half a Gold table one day ($17.50) has paid $25.
 */
async function threeVendorsPaying(
  request: APIRequestContext,
  pricing: typeof PRICING | null = PRICING,
): Promise<string> {
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { dates: [SEED_MARKET_DATE, SECOND_DATE] },
  );
  seedApprovedVendor(marketId, CAROL, {
    dates: [SEED_MARKET_DATE, SECOND_DATE],
    tiers: ['Gold'],
    fullName: 'Carol Example',
  });
  mongoEval(
    `db.applications.updateMany({ market_id: ${JSON.stringify(marketId)} },
      { $set: { 'form_data.essential_section_ranking': ['North Wing', 'Landing'] } })`,
  );
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, plan(pricing));
  await call(request, 'post', `/markets/${marketId}/roles`, {
    user_email: VIEWER.email,
    role: 'viewer',
  });
  for (const toPhase of ['applications', 'assignment']) {
    await call(request, 'post', `/markets/${marketId}/transition`, { toPhase });
  }
  for (const [email, date, table, choice] of [
    [ALICE, SEED_MARKET_DATE, 'North Wing 1', 'Full Table'],
    [ALICE, SECOND_DATE, 'North Wing 1', 'Full Table'],
    [BOB, SEED_MARKET_DATE, 'Landing 1', 'Full Table'],
    [CAROL, SECOND_DATE, 'North Wing 2', 'Half Table (Left)'],
  ]) {
    await call(request, 'put', `/markets/${marketId}/placements`, {
      email,
      date,
      table_code: table,
      table_choice: choice,
    });
  }
  for (const [email, cents] of [
    [ALICE, 3500],
    [BOB, 3000],
    [CAROL, 2500],
  ] as const) {
    await call(request, 'post', `/markets/${marketId}/payments/${email}`, {
      cents,
      method: 'e-transfer',
      paidOn: '2099-04-01',
      note: '',
    });
  }
  return marketId;
}

async function paymentsPage(page: Page, marketId: string, query = '') {
  await page.goto(`${marketScreenPath(marketId, 'payments')}${query}`);
  await expect(page.getByTestId('payments-row').first()).toBeVisible({ timeout: 15000 });
}

const rows = (page: Page) => page.getByTestId('payments-row');

async function listedEmails(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((found) =>
    found.map((row) => row.getAttribute('data-email') ?? ''),
  );
}

/** "$117.50" from 11750 cents, as the page writes CAD, always to the cent. */
function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

test.describe('the Payments page', () => {
  test.beforeAll(() => {
    ensureVerifiedUser(VIEWER.email, VIEWER.password);
  });

  test("its totals match the sum of the vendors' Payment tabs", async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await threeVendorsPaying(request);
    let owed = 0;
    let paid = 0;
    let still = 0;
    let more = 0;
    for (const email of [ALICE, BOB, CAROL]) {
      const res = await request.get(`${BACKEND_URL}/markets/${marketId}/payments/${email}`);
      const tab = (await res.json()) as { owedCents: number; paidCents: number };
      owed += tab.owedCents;
      paid += tab.paidCents;
      still += Math.max(tab.owedCents - tab.paidCents, 0);
      more += Math.max(tab.paidCents - tab.owedCents, 0);
    }
    expect([owed, paid, still, more]).toEqual([11750, 9000, 3500, 750]);

    await paymentsPage(page, marketId);
    await expect(page.getByTestId('market-pages-payments')).toHaveClass(/active/);
    const totals = page.getByTestId('payments-totals');
    await expect(totals.getByTestId('payments-total-owedCents')).toContainText(dollars(owed));
    await expect(totals.getByTestId('payments-total-paidCents')).toContainText(dollars(paid));
    await expect(totals.getByTestId('payments-total-stillOwedCents')).toContainText(dollars(still));
    await expect(totals.getByTestId('payments-total-paidMoreCents')).toContainText(dollars(more));

    // By tier: Alice's $35 shared across her two Gold days, Carol's $25 all on hers.
    const cells = (testid: string) =>
      page
        .getByTestId(testid)
        .evaluateAll((found) =>
          found.map((row) =>
            Array.from(row.querySelectorAll<HTMLElement>('th, td')).map((cell) =>
              cell.innerText.trim(),
            ),
          ),
        );
    await expect
      .poll(() => cells('payments-by-tier-row'))
      .toEqual([
        ['Gold', '$87.50', '$60.00', '$35.00', '$7.50'],
        ['Silver', '$30.00', '$30.00', '$0.00', '$0.00'],
      ]);
    await expect
      .poll(() => cells('payments-by-date-row'))
      .toEqual([
        ['Friday, May 1, 2099', '$65.00', '$47.50', '$17.50', '$0.00'],
        ['Friday, May 8, 2099', '$52.50', '$42.50', '$17.50', '$7.50'],
      ]);

    // A payment recorded in the drawer is read here again.
    await page.locator(`[data-email="${ALICE}"]`).getByTestId('payments-row-open').click();
    await expect(page.getByTestId('payment-tab')).toBeVisible();
    await page.getByTestId('payment-record').click();
    const dialog = page.getByTestId('record-payment-window');
    await dialog.getByLabel('Amount (CAD)').fill('35');
    await dialog.getByLabel('Cash').check();
    await dialog.getByRole('button', { name: 'Record payment' }).click();
    await expect(dialog).toBeHidden();
    await expect(totals.getByTestId('payments-total-stillOwedCents')).toContainText('$0.00');
    await expect(totals.getByTestId('payments-total-paidCents')).toContainText('$125.00');
  });

  test('"Owes" and "Paid more than owed" list exactly who is in each, and a reload keeps them', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await threeVendorsPaying(request);
    await paymentsPage(page, marketId);
    expect((await listedEmails(page)).sort()).toEqual([ALICE, BOB, CAROL]);

    await page.getByTestId('payments-show-owes').click();
    await expect(rows(page)).toHaveCount(1);
    expect(await listedEmails(page)).toEqual([ALICE]);
    await expect(rows(page).first().getByTestId('payments-row-balance')).toHaveText('Owes $35.00');
    await expect(page).toHaveURL(/[?&]show=owes/);
    await page.reload();
    await expect(rows(page)).toHaveCount(1, { timeout: 15000 });
    expect(await listedEmails(page)).toEqual([ALICE]);
    await expect(page.getByTestId('payments-show-owes')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('payments-show-paid').click();
    await expect(rows(page)).toHaveCount(1);
    expect(await listedEmails(page)).toEqual([BOB]);

    await page.getByTestId('payments-show-over').click();
    await expect(rows(page)).toHaveCount(1);
    expect(await listedEmails(page)).toEqual([CAROL]);
    const carol = rows(page).first();
    await expect(carol.getByTestId('payments-row-balance')).toHaveText('Paid $7.50 more than owed');

    // The row opens their Payment tab, and the filter stays under it.
    await carol.click();
    await expect(page.getByRole('tab', { name: 'Payment' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('payment-balance')).toHaveText('Paid $7.50 more than owed');
    await expect(page).toHaveURL(/[?&]show=over/);
    await expect(page).toHaveURL(/[?&]vendorTab=payment/);
  });

  test('a vendor who owes nothing and paid nothing is not "Paid in full"', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Dan is seated, then freed with the seat taken off what he owes: his line stays, at $0,
    // and he has paid nothing, so his tab says "Nothing owed" and he is in no filter.
    const marketId = await threeVendorsPaying(request);
    seedApprovedVendor(marketId, DAN, {
      dates: [SEED_MARKET_DATE],
      tiers: ['Silver'],
      fullName: 'Dan Example',
    });
    await call(request, 'put', `/markets/${marketId}/placements`, {
      email: DAN,
      date: SEED_MARKET_DATE,
      table_code: 'Landing 2',
      table_choice: 'Full Table',
    });
    const freed = await request.delete(`${BACKEND_URL}/markets/${marketId}/placements`, {
      data: { email: DAN, date: SEED_MARKET_DATE, deductOwed: true },
    });
    expect(freed.ok(), await freed.text()).toBeTruthy();

    await paymentsPage(page, marketId);
    const dan = page.locator(`[data-email="${DAN}"]`);
    await expect(dan.getByTestId('payments-row-balance')).toHaveText('Nothing owed');
    await expect(page.getByTestId('payments-show-paid')).toHaveText('Paid in full (1)');

    await page.getByTestId('payments-show-paid').click();
    await expect(rows(page)).toHaveCount(1);
    expect(await listedEmails(page)).toEqual([BOB]);
  });

  test('a sort is in the address, and a reload keeps it', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await threeVendorsPaying(request);
    await paymentsPage(page, marketId);

    await page.getByTestId('payments-sort-owed').click();
    await expect(page).toHaveURL(/[?&]sort=owed&order=desc/);
    await expect.poll(() => listedEmails(page)).toEqual([ALICE, BOB, CAROL]);
    await page.getByTestId('payments-sort-difference').click();
    await page.getByTestId('payments-sort-difference').click();
    // Ascending: who paid more than owed first, then who is square, then who owes.
    await expect.poll(() => listedEmails(page)).toEqual([CAROL, BOB, ALICE]);
    await page.reload();
    await expect(rows(page)).toHaveCount(3, { timeout: 15000 });
    expect(await listedEmails(page)).toEqual([CAROL, BOB, ALICE]);
    await expect(page.getByRole('columnheader', { name: 'Difference' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  test('a Viewer reads the page, and a market without prices says pricing is off, with no filter', async ({
    browser,
    request,
  }) => {
    const priced = await threeVendorsPaying(request);
    const unpriced = await threeVendorsPaying(request, null);

    await withUser(browser, VIEWER.email, VIEWER.password, async (page) => {
      await paymentsPage(page, priced);
      await expect(
        page.getByTestId('payments-totals').getByTestId('payments-total-owedCents'),
      ).toContainText('$117.50');
      // Only a market without prices may hold payments that compare with nothing (finding 15).
      await expect(page.getByTestId('payments-unpriced-caption')).toHaveCount(0);

      await paymentsPage(page, unpriced);
      await expect(page.getByTestId('payments-unpriced')).toContainText('Pricing is off');
      // Nobody owes there, so the market's money is not drawn: every figure would be what was paid.
      await expect(page.getByRole('heading', { name: "The market's money" })).toHaveCount(0);
      await expect(page.getByTestId('payments-totals')).toHaveCount(0);
      // Nobody owes there, so no payment filter is offered (the refunds one would be everyone),
      // and one in the address narrows nothing; the search stays.
      await expect(page.getByRole('group', { name: 'Show only' })).toHaveCount(0);
      await expect(page.getByTestId('payments-search')).toBeVisible();
      await paymentsPage(page, unpriced, '?show=over');
      await expect(rows(page)).toHaveCount(3);
      await expect(page.getByTestId('payments-summary')).toHaveText(/^\s*3\s+vendors\s*$/);
      await page.getByTestId('payments-pricing-link').click();
      await expect(page).toHaveURL(new RegExp(`/markets/${unpriced}/setup$`));
      await expect(page.getByTestId('plan-card-pricing')).toBeVisible({ timeout: 15000 });
    });
  });

  test('on a market without prices a payment reads what was paid, and the export offers no payment filter', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Nothing is priced there, so nobody paid "more than owed" (finding 8): not on the page, not
    // on the Payment tab, and not as a list to export.
    const unpriced = await threeVendorsPaying(request, null);

    await paymentsPage(page, unpriced);
    const balances = await rows(page).evaluateAll((found) =>
      found.map((row) => [
        row.getAttribute('data-email'),
        row.querySelector('[data-testid="payments-row-balance"]')?.textContent?.trim(),
      ]),
    );
    expect(Object.fromEntries(balances)).toEqual({
      [ALICE]: 'Paid $35.00',
      [BOB]: 'Paid $30.00',
      [CAROL]: 'Paid $25.00',
    });
    await page.locator(`[data-email="${ALICE}"]`).getByTestId('payments-row-open').click();
    await expect(page.getByTestId('payment-tab').getByTestId('payment-balance')).toHaveText(
      'Paid $35.00',
    );

    const vendors = new VendorsPage(page);
    await vendors.goto(unpriced);
    await vendors.exportButton.click();
    const dialog = new VendorExportDialog(page);
    await expect(dialog.window).toBeVisible();
    await expect(dialog.summary).toContainText('vendors');
    await expect(dialog.payment).toHaveCount(0);

    // The reading follows the account, not the market (finding 10): Alice set to owe $20 by hand
    // has paid $15 more than owed, a refund to issue, and the page and the export filter for it.
    await call(
      request,
      'put',
      `/markets/${unpriced}/payments/${encodeURIComponent(ALICE)}/owed/${SEED_MARKET_DATE}`,
      { cents: 2000 },
    );
    await paymentsPage(page, unpriced, '?show=over');
    await expect.poll(() => listedEmails(page)).toEqual([ALICE]);
    await expect(
      page.locator(`[data-email="${ALICE}"]`).getByTestId('payments-row-balance'),
    ).toHaveText('Paid $15.00 more than owed');
    await expect(page.getByRole('group', { name: 'Show only' })).toBeVisible();
    await expect(page.getByTestId('payments-unpriced')).toContainText(
      'so a vendor owes only an amount set by hand on their Payment tab, or a refund beyond what they paid.',
    );
    // The figures are summed by the same rule as the rows (finding 12): Bob's $30 and Carol's $25,
    // owing nothing, count toward "Paid" but not "Paid more than owed", which is Alice's $15 alone.
    await expect(page.getByRole('heading', { name: "The market's money" })).toBeVisible();
    const totals = page.getByTestId('payments-totals');
    for (const [figure, shown] of [
      ['owedCents', '$20.00'],
      ['paidCents', '$90.00'],
      ['stillOwedCents', '$0.00'],
      ['paidMoreCents', '$15.00'],
    ]) {
      await expect(totals.getByTestId(`payments-total-${figure}`)).toContainText(shown);
    }
    await expect(page.getByTestId('payments-unpriced-caption')).toHaveText(
      '"Paid" includes what vendors who owe nothing paid; only a vendor who owes can pay more than owed.',
    );
    await vendors.goto(unpriced);
    await vendors.exportButton.click();
    await expect(dialog.window).toBeVisible();
    await expect(dialog.payment).toBeVisible();
    await dialog.payment.selectOption({ label: 'Paid more than owed' });
    await expect(dialog.summary).toHaveText(/^1 vendor,/);

    // Once every vendor who paid owes, "Paid" holds nothing that compares with no price, and the
    // caption goes (finding 15).
    for (const email of [BOB, CAROL]) {
      await call(
        request,
        'put',
        `/markets/${unpriced}/payments/${encodeURIComponent(email)}/owed/${email === BOB ? SEED_MARKET_DATE : SECOND_DATE}`,
        { cents: 1000 },
      );
    }
    await paymentsPage(page, unpriced);
    await expect(page.getByTestId('payments-total-paidMoreCents')).toContainText('$50.00');
    await expect(page.getByTestId('payments-unpriced-caption')).toHaveCount(0);
  });

  /**
   * Where each part of the frame starts, and a page's own title: the market's name, the rail's
   * stages, the first page link (its pill and its label) and the read-only note.
   */
  async function starts(page: Page, title: string) {
    return page.evaluate((titleSelector) => {
      const left = (el: Element | null | undefined) =>
        el ? Math.round(el.getBoundingClientRect().left) : null;
      const at = (selector: string) => left(document.querySelector(selector));
      const link = document.querySelector('[data-testid="market-pages"] a');
      const label = document.createRange();
      if (link?.firstChild) label.selectNodeContents(link.firstChild);
      return {
        name: at('[data-testid="market-bar-title"]'),
        rail: at('.phase-spine'),
        pageLink: left(link),
        pageLabel: link ? Math.round(label.getBoundingClientRect().left) : null,
        readOnly: at('[data-testid="market-read-only"]'),
        title: at(titleSelector),
      };
    }, title);
  }

  test("in a phone-sized window, a page that keeps the desktop floor keeps the frame on the page's inset", async ({
    browser,
    request,
  }) => {
    // Settings keeps the 1000px desktop floor, so at 390 it is a desk's layout scrolled sideways.
    // The frame's phone rules followed the window, so its name, rail, page row and read-only note
    // stood on the phone's 16px gutter there, 8px left of the page's own notes and titles; on
    // Payments, which kept the floor until T180.
    const unpriced = await threeVendorsPaying(request, null);

    await withUser(browser, VIEWER.email, VIEWER.password, async (page) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(marketScreenPath(unpriced, 'settings'));
      await expect(page.getByTestId('market-read-only')).toBeVisible({ timeout: 15000 });
      const desk = await starts(page, '[data-testid="assignment-settings-heading"]');
      const inset = desk.title;
      // As on a desk: the page link's pill stands on the inset, its label inside it.
      expect({ ...desk, pageLabel: undefined }).toEqual({
        name: inset,
        rail: inset,
        pageLink: inset,
        pageLabel: undefined,
        readOnly: inset,
        title: inset,
      });
      expect(desk.pageLabel).toBeGreaterThan(inset!);

      // Payments (T180) and Assignments (T142) fit a phone: there the frame keeps the phone's 16px
      // gutter, x 32, the page link's label on it and its pill reaching into it, and the page's
      // own notes and titles stand on it too.
      for (const [where, title] of [
        ['payments', 'payments-vendors-title'],
        ['assignments', 'tables-date-heading'],
      ] as const) {
        await page.goto(marketScreenPath(unpriced, where));
        await expect(page.getByTestId('market-read-only')).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId(title).first()).toBeVisible();
        const phone = await starts(page, `[data-testid="${title}"]`);
        expect({ ...phone, pageLink: undefined }, where).toEqual({
          name: 32,
          rail: 32,
          pageLink: undefined,
          pageLabel: 32,
          readOnly: 32,
          title: 32,
        });
      }
      await page.goto(marketScreenPath(unpriced, 'payments'));
      const unpricedNote = page.getByTestId('payments-unpriced');
      expect(await unpricedNote.evaluate((el) => Math.round(el.getBoundingClientRect().left))).toBe(
        32,
      );
    });
  });
});
