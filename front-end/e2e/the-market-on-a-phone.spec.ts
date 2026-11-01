import type { APIRequestContext, Locator } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketScreenPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { inTheWindow, PHONE_AND_DESK, widths } from './helpers/phoneWindow';
import { savePlan } from './helpers/savePlan';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import {
  SEED_MARKET_DATE,
  seedMarketWithVendors,
  seedPublishedMarketWithAssignments,
} from './helpers/seeds';

/**
 * The organizer's market on the phone in their hand, and at a desk (T180).
 *
 * At the November market an organizer runs the door from a phone (T142), then turns to the
 * Assignment tab's pages to see who still owes. Each of them opened as a desk's 1000px layout in a
 * 390px window, and under a phone's own emulation the layout viewport widened to 1001px and zoomed
 * out, so the vendor drawer opened off screen. A leg per place that fits a phone; each also runs at
 * a desk, where nothing may move.
 *
 * Vendors is one tap from the door's own list: the organizer looks a vendor up, reads every tab of
 * their drawer, takes their payment, and an Editor corrects an answer with Update info.
 */

const OWES = 'alice@example.com';
const PAID = 'bob@example.com';
/** An Editor of the market, who corrects a vendor's answers at the door. */
const EDITOR = { email: 'e2e-phone-editor@example.com', password: 'e2epassword123' };
/** The vendor drawer's tabs, in its order. */
const DRAWER_TABS = ['application', 'assignments', 'payment', 'history'] as const;

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
 * A priced market in assignment: Alice and Bob each hold a Gold table ($35); Bob has paid, Alice
 * still owes.
 */
async function aMarketThatIsOwed(request: APIRequestContext): Promise<string> {
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  mongoEval(
    `db.applications.updateMany({ market_id: ${JSON.stringify(marketId)} },
      { $set: { 'form_data.essential_section_ranking': ['North Wing'] } })`,
  );
  const gold = { id: 1, name: 'Gold' };
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
    priority: [],
    marketDates: [{ date: SEED_MARKET_DATE }],
    tiers: [gold],
    locations: [{ name: 'Main Hall' }],
    sections: [{ name: 'North Wing', location: { name: 'Main Hall' }, tier: gold, count: 2 }],
    assignmentOptions: { maxAssignmentsPerVendor: 1, maxHalfTableProportionPerSection: 50 },
    pricing: {
      currency: 'CAD',
      halfTablePercent: 50,
      everyoneElse: [{ tier: 'Gold', cents: 3500 }],
    },
  });
  for (const toPhase of ['applications', 'assignment']) {
    await call(request, 'post', `/markets/${marketId}/transition`, { toPhase });
  }
  for (const [email, table] of [
    [OWES, 'North Wing 1'],
    [PAID, 'North Wing 2'],
  ]) {
    await call(request, 'put', `/markets/${marketId}/placements`, {
      email,
      date: SEED_MARKET_DATE,
      table_code: table,
      table_choice: 'Full Table',
    });
  }
  await call(request, 'post', `/markets/${marketId}/payments/${PAID}`, {
    cents: 3500,
    method: 'e-transfer',
    paidOn: '2099-04-01',
    note: '',
  });
  return marketId;
}

for (const size of PHONE_AND_DESK) {
  test.describe(size.name, () => {
    test.use(size.use);
    const width = size.use.viewport.width;
    const { expectFits, expectInside, press } = inTheWindow(size);

    /** A box that starts and ends inside the window's width, wherever it stands down the page. */
    async function expectAcross(locator: Locator, what: string): Promise<void> {
      const box = await locator.boundingBox();
      expect(box, `${what} is drawn`).not.toBeNull();
      expect(box!.x, `${what} starts inside the window`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${what} ends inside the window`).toBeLessThanOrEqual(width);
    }

    /** On a phone, each of `targets` is one a thumb can hit. */
    async function expectTargets(targets: Locator, what: string): Promise<void> {
      if (!size.phone) return;
      for (const target of await targets.all()) {
        const box = (await target.boundingBox())!;
        expect(box.height, `${what} is a 44px target`).toBeGreaterThanOrEqual(44);
        expect(box.x + box.width, `${what} ends inside the window`).toBeLessThanOrEqual(width);
      }
    }

    test('Payments: who still owes, and their drawer', async ({
      authenticatedPage: page,
      request,
    }) => {
      const marketId = await aMarketThatIsOwed(request);

      // From the Assignments page by the Assignment tab's page row, which stands in the window.
      await page.goto(marketScreenPath(marketId, 'assignments'));
      const pages = page.getByTestId('market-pages');
      await expect(pages).toBeVisible({ timeout: 15000 });
      await expectAcross(pages, 'the page row');
      await press(page.getByTestId('market-pages-payments'));
      await page.waitForURL(/\/payments$/);
      const row = page.locator(`[data-email="${OWES}"]`);
      await expect(row.getByTestId('payments-row-balance')).toHaveText(/^Owes/, {
        timeout: 15000,
      });
      await expectFits(page, 'Payments');
      await expectAcross(pages, 'the page row on Payments');

      // The search and its filters wrap in the window, each a thumb's target.
      await expectTargets(page.getByTestId('payments-search'), 'the search');
      await expectTargets(page.getByTestId('payments-shown').getByRole('button'), 'a filter');

      // The figures, and every table, read inside the window.
      for (const figure of await page.getByTestId('payments-totals').locator('> div').all()) {
        await expectAcross(figure, `the figure "${await figure.innerText()}"`);
      }
      for (const table of await page.getByRole('table').all()) {
        await expectAcross(table, 'a table');
        expect(
          await table.evaluate((el) => el.scrollWidth - el.clientWidth),
          'a table runs past itself',
        ).toBe(0);
      }

      // The vendor who owes opens their Payment tab in the drawer, inside the window.
      await press(row.getByTestId('payments-row-open'));
      const drawer = page.getByTestId('vendors-detail-panel');
      await expect(drawer.getByTestId('payment-tab')).toBeVisible();
      await expect(drawer).toBeInViewport({ ratio: 1 });
      await expectInside(drawer, 'the drawer');
      expect(
        await drawer
          .getByTestId('vendors-detail-content')
          .evaluate((el) => el.scrollWidth - el.clientWidth),
        'the Payment tab scrolls sideways',
      ).toBe(0);
      await expectFits(page, 'Payments, the drawer open');
    });

    test('Vendors: a vendor looked up, paid and corrected', async ({
      authenticatedPage: page,
      request,
      browser,
    }) => {
      const marketId = await aMarketThatIsOwed(request);
      ensureVerifiedUser(EDITOR.email, EDITOR.password);
      const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
        data: { user_email: EDITOR.email, role: 'editor' },
      });
      expect(granted.ok(), await granted.text()).toBeTruthy();

      // From Payments by the Assignment tab's page row.
      await page.goto(marketScreenPath(marketId, 'payments'));
      const pages = page.getByTestId('market-pages');
      await expect(pages).toBeVisible({ timeout: 15000 });
      await press(page.getByTestId('market-pages-vendors'));
      await page.waitForURL(/\/vendors$/);
      const rows = page.getByTestId('vendors-list-item');
      await expect(rows).toHaveCount(2, { timeout: 15000 });
      await expectFits(page, 'Vendors');
      await expectAcross(pages, 'the page row on Vendors');

      // The search takes its row, and the filters, Export and Add a vendor wrap beneath it, each a
      // thumb's target.
      await expectTargets(page.getByTestId('vendors-search-input'), 'the search');
      await expectTargets(page.getByTestId('vendors-shown').getByRole('button'), 'a filter');
      await expectTargets(page.getByTestId('vendors-export-button'), 'Export');
      await expectTargets(page.getByTestId('vendors-add-button'), 'Add a vendor');
      await expectAcross(page.getByTestId('vendors-summary'), 'the count');
      for (const row of await rows.all()) {
        await expectAcross(row, 'a vendor row');
        await expectAcross(row.getByTestId('vendor-date-count'), "a vendor row's date count");
      }

      // Every tab of the drawer stands inside the window, and scrolls only down.
      await press(rows.filter({ hasText: OWES }));
      const drawer = page.getByTestId('vendors-detail-panel');
      await expect(drawer.getByTestId('vendors-detail-email')).toBeVisible();
      await expect(drawer.getByRole('tab')).toHaveCount(DRAWER_TABS.length);
      for (const tab of DRAWER_TABS) {
        await press(drawer.getByTestId(`vendor-drawer-tab-${tab}`));
        await expect(drawer.getByTestId(`vendor-drawer-tab-${tab}`)).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await expectInside(drawer, `the drawer on its ${tab} tab`);
        expect(
          await drawer
            .getByTestId('vendors-detail-content')
            .evaluate((el) => el.scrollWidth - el.clientWidth),
          `the drawer's ${tab} tab scrolls sideways`,
        ).toBe(0);
        await expectTargets(
          drawer.getByTestId('vendors-detail-content').getByRole('button'),
          `a button on the ${tab} tab`,
        );
      }

      // Back on the Payment tab, the payment is taken in its dialog, inside the window.
      await press(drawer.getByTestId('vendor-drawer-tab-payment'));
      await press(drawer.getByTestId('payment-record'));
      const recording = page.getByTestId('record-payment-window');
      await expect(recording).toBeVisible();
      await expectInside(recording, 'the record-payment dialog');
      await page.getByTestId('record-payment-amount').fill('35');
      await press(page.getByTestId('record-payment-submit-button'));
      await expect(recording).toHaveCount(0);
      await expect(drawer.getByTestId('payment-paid')).toContainText('35');
      await expectFits(page, 'Vendors, the drawer open');

      // An Editor at the door corrects an answer: Update info opens inside the window, its answer
      // and Save and Cancel inside it, and saves.
      await withUser(
        browser,
        EDITOR.email,
        EDITOR.password,
        async (editor) => {
          const { expectInside: inside, press: tap } = inTheWindow(size);
          await editor.goto(marketScreenPath(marketId, 'vendors'));
          const vendor = editor.getByTestId('vendors-list-item').filter({ hasText: OWES });
          await expect(vendor).toBeVisible({ timeout: 15000 });
          await tap(vendor);
          await tap(editor.getByTestId('vendors-detail-update-info'));
          const updating = editor.getByTestId('update-info-window');
          await expect(updating).toBeVisible();
          await inside(updating, 'Update info');
          const field = editor.getByTestId('update-info-input-business_name');
          const answer = await editor.getByTestId('update-info-answer-business_name').boundingBox();
          expect(
            answer!.x + answer!.width,
            'the answer ends inside the window',
          ).toBeLessThanOrEqual(width);
          await field.fill('Alice Ceramics');
          const save = editor.getByTestId('update-info-submit-button');
          await save.scrollIntoViewIfNeeded();
          await inside(save, 'Save');
          await inside(editor.getByTestId('update-info-cancel-button'), 'Cancel');
          await tap(save);
          await expect(updating).toHaveCount(0);
          await expect(editor.getByTestId('vendors-detail-answer-business_name')).toContainText(
            'Alice Ceramics',
          );
          expect(await widths(editor), 'Vendors keeps the window for an Editor').toEqual({
            layout: width,
            sideways: 0,
            zoom: 1,
          });
        },
        size.use,
      );
    });
  });
}

/**
 * Between a phone and a desk (T142, T180): every market place that fits a phone lifts the desktop
 * floor at every width under it, so a tablet lays it out at its own width. At 768 the market's name
 * drew 0px wide and the tabs ran past the window, so the page scrolled sideways.
 */
test.describe('between a phone and a desk', () => {
  for (const width of [720, 768]) {
    test(`each market place that fits a phone keeps the window's width at ${width}`, async ({
      authenticatedPage: page,
      request,
    }) => {
      await page.setViewportSize({ width, height: 1024 });
      const seed = await seedPublishedMarketWithAssignments(
        request,
        BACKEND_URL,
        TEST_USER.email,
        TEST_USER.password,
        { intakeMode: 'form' },
      );
      for (const where of ['attendance', 'tools', 'assignments', 'vendors', 'payments'] as const) {
        await page.goto(marketScreenPath(seed.marketId, where));
        await expect(page.getByTestId('phase-rail-checkin')).toBeVisible({ timeout: 15000 });
        expect((await widths(page)).sideways, `${where} scrolls sideways`).toBe(0);
        // The name keeps room to be read, and the tabs stay inside the window.
        const title = await page.getByTestId('market-bar-title').boundingBox();
        expect(title!.width, `${where}: the market's name is drawn`).toBeGreaterThanOrEqual(100);
        const tabs = await page.getByTestId('market-bar-tabs').boundingBox();
        expect(
          tabs!.x + tabs!.width,
          `${where}: the tabs end inside the window`,
        ).toBeLessThanOrEqual(width);
      }
    });
  }
});
