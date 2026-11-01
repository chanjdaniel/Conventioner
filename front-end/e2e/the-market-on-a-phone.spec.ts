import type { APIRequestContext, Locator } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketScreenPath, oneByOnePath } from './helpers/marketScreens';
import { planSetupObject, seedApplicantMarket } from './helpers/seedApplicantMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { mongoEval } from './helpers/mongo';
import { grantMarketRole } from './helpers/grantMarketRole';
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
 *
 * On the Applications page a reviewer works the queue One by one, the organizer deals the review
 * to a chosen reviewer who then decides their share, and results are published, each at the
 * phone's own width.
 *
 * Stats tells how the day stands, its headlines each a link to the page that shows the figure, for
 * the organizer and for a Viewer who only reads the market.
 */

const OWES = 'alice@example.com';
const PAID = 'bob@example.com';
/** An Editor of the market, who corrects a vendor's answers at the door. */
const EDITOR = { email: 'e2e-phone-editor@example.com', password: 'e2epassword123' };
/** A Viewer of the market, who reads the review from their phone. */
const VIEWER = { email: 'e2e-phone-viewer@example.com', password: 'e2epassword123' };
/** The one application of the Applications leg's market, still open. */
const APPLICANT = 'phone-applicant@example.com';
/** The One by one leg's queue, in the order it arrives, and the follow-up waiting beside it. */
const QUEUE = [
  'phone-queue-1@example.com',
  'phone-queue-2@example.com',
  'phone-queue-3@example.com',
];
const FOLLOW_UP = 'phone-follow-up@example.com';
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

/** A market taking applications on its own form, with one application still open. */
async function aMarketInReview(request: APIRequestContext): Promise<string> {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  seedApplicationWithStatus(marketId, 'open', APPLICANT, {
    name: 'Alexandria Montgomery-Featherstonehaugh',
    category: 'Ceramics',
  });
  return marketId;
}

/**
 * A market taking applications on its own form, with a queue of three open applications, a
 * follow-up waiting on its applicant, and the Editor and Viewer the review may be dealt to.
 */
async function aQueueToReview(request: APIRequestContext): Promise<string> {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  for (const [i, email] of QUEUE.entries()) {
    seedApplicationWithStatus(marketId, 'open', email, {
      name: `Bartholomew Featherstonehaugh-Montgomery ${i + 1}`,
      category: 'Ceramics',
    });
  }
  seedApplicationWithStatus(marketId, 'needs_follow_up', FOLLOW_UP);
  ensureVerifiedUser(EDITOR.email, EDITOR.password);
  await grantMarketRole(request, marketId, EDITOR, 'editor');
  ensureVerifiedUser(VIEWER.email, VIEWER.password);
  await grantMarketRole(request, marketId, VIEWER, 'viewer');
  return marketId;
}

/** A form market in assignment with a current run, so its results wait to be published. */
async function aMarketToPublish(request: APIRequestContext): Promise<string> {
  const date = '2099-08-01';
  const { marketId } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject([date]) },
  );
  seedApprovedVendor(marketId, 'phone-seated@example.com', {
    dates: [date],
    tiers: ['Gold'],
    sections: ['Main Hall', 'Garden'],
  });
  await call(request, 'post', `/markets/${marketId}/transition`, { toPhase: 'assignment' });
  await call(request, 'post', `/markets/${marketId}/assignment`, {});
  return marketId;
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

/**
 * The owed market's form asks a choice question too, answered by both vendors, so Stats has a
 * chart and its switch. The form locked at the first application, so the question is written.
 */
function askWhatTheySell(marketId: string): void {
  const filter = `{ id: ${JSON.stringify(marketId)} }`;
  const field = {
    key: 'selling',
    label: 'What will you sell?',
    type: 'select',
    required: false,
    options: ['Prints', 'Ceramics'],
    order: 1,
  };
  mongoEval(
    `const m = db.markets.findOne(${filter}); ` +
      `const fields = ((m.applicationForm || {}).fields || []).concat([${JSON.stringify(field)}]); ` +
      `db.markets.updateOne(${filter}, { $set: { 'applicationForm.fields': fields } }); ` +
      `db.applications.updateMany({ market_id: ${JSON.stringify(marketId)} }, ` +
      `{ $set: { 'form_data.selling': 'Ceramics' } })`,
  );
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

    /** On a phone, a checkbox's label is the target a thumb taps, the box inside it. */
    async function expectLabelTarget(box: Locator, what: string): Promise<void> {
      if (!size.phone) return;
      const label = await box.evaluate((el) => {
        const r = (el as HTMLInputElement).labels?.[0]?.getBoundingClientRect();
        return r ? { width: r.width, height: r.height, right: r.right } : null;
      });
      expect(label, `${what} has a label`).not.toBeNull();
      expect(label!.width, `${what} is 44px wide`).toBeGreaterThanOrEqual(44);
      expect(label!.height, `${what} is a 44px target`).toBeGreaterThanOrEqual(44);
      expect(label!.right, `${what} ends inside the window`).toBeLessThanOrEqual(width);
    }

    /** On a phone, each of `targets` is at least as wide as a thumb's target is tall. */
    async function expectWide(targets: Locator, what: string): Promise<void> {
      if (!size.phone) return;
      for (const target of await targets.all()) {
        const box = (await target.boundingBox())!;
        expect(box.width, `${what} is 44px wide`).toBeGreaterThanOrEqual(44);
      }
    }

    /**
     * An All-view row read down on a phone, the applicant's name over their status; at a desk the
     * status stands beside the name, as it always has.
     */
    async function expectNameOverStatus(row: Locator): Promise<void> {
      const name = (await row.getByTestId('applications-all-name').boundingBox())!;
      const status = (await row.getByTestId('applications-all-status').boundingBox())!;
      if (size.phone) {
        expect(name.y + name.height, 'the name stands over the status').toBeLessThanOrEqual(
          status.y,
        );
      } else {
        expect(status.x, 'the status stands right of the name').toBeGreaterThanOrEqual(
          name.x + name.width,
        );
      }
      await expectAcross(row.getByTestId('applications-all-status'), 'the status');
    }

    /**
     * The review card in the window: on a phone it is the window less the frame's and the page's
     * gutters, 32px a side as every page that fits a phone, and its verdicts wrap inside it rather
     * than run past it.
     */
    async function expectCard(card: Locator): Promise<void> {
      const box = (await card.boundingBox())!;
      if (size.phone) {
        expect(box.x, 'the card starts at the gutter').toBe(32);
        expect(box.width, 'the card is the window less its gutters').toBe(width - 64);
      }
      await expectAcross(card, 'the card');
      for (const verdict of await card.getByTestId(/^app-monitor-.*-button$/).all()) {
        const v = (await verdict.boundingBox())!;
        expect(v.x, 'a verdict starts inside the card').toBeGreaterThanOrEqual(box.x);
        expect(v.x + v.width, 'a verdict ends inside the card').toBeLessThanOrEqual(
          box.x + box.width,
        );
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
      const row = page.getByTestId('payments-row').filter({ hasText: OWES });
      await expect(row.getByTestId('payments-row-balance')).toHaveText(/^Owes/, {
        timeout: 15000,
      });
      await expectFits(page, 'Payments');
      await expectAcross(pages, 'the page row on Payments');

      // The search and its filters wrap in the window, each a thumb's target.
      await expectTargets(page.getByTestId('payments-search'), 'the search');
      await expectTargets(page.getByTestId('payments-shown').getByRole('button'), 'a filter');

      // The figures, and every table, read inside the window.
      const figures = page.getByTestId('payments-totals').getByTestId(/^payments-total-/);
      await expect(figures).toHaveCount(4);
      for (const figure of await figures.all()) {
        await expectAcross(figure, `the figure "${await figure.innerText()}"`);
      }
      for (const table of await page.getByRole('table').all()) {
        await expectAcross(table, 'a table');
        expect(
          await table.evaluate((el) => el.scrollWidth - el.clientWidth),
          'a table runs past itself',
        ).toBe(0);
      }

      // Laid out as blocks on a phone, each table still reads as a table to a screen reader: its
      // column headings, a row heading per tier, and a value in each cell, as at a desk.
      const byTier = page.getByTestId('payments-by-tier').getByRole('table');
      await expect(byTier.getByRole('columnheader')).toHaveText([
        'Tier',
        'Owed',
        'Paid',
        'Still owed',
        'Paid more than owed',
      ]);
      await expect(byTier.getByRole('rowheader')).toHaveText(['Gold']);
      const gold = byTier.getByRole('row').filter({ has: page.getByRole('rowheader') });
      await expect(gold.getByRole('cell')).toHaveCount(4);
      const goldValues = ['$70', '$35', '$35', '$0'];
      for (const [i, cell] of (await gold.getByRole('cell').all()).entries()) {
        await expect(cell, 'a Gold value').toHaveAccessibleName(
          new RegExp(`^\\S*\\${goldValues[i]}\\b`),
        );
      }
      const vendorsTable = page
        .getByRole('table')
        .filter({ has: page.getByTestId('payments-row') });
      await expect(vendorsTable.getByRole('columnheader')).toHaveCount(4);
      for (const [i, name] of ['Vendor', 'Owed', 'Paid', 'Difference'].entries()) {
        await expect(vendorsTable.getByRole('columnheader').nth(i)).toHaveAccessibleName(
          new RegExp(`^${name}`),
        );
      }
      await expect(
        vendorsTable.getByRole('row').filter({ hasText: OWES }).getByRole('cell'),
      ).toHaveCount(4);
      await expect(
        vendorsTable.getByRole('row').filter({ hasText: PAID }).getByRole('cell'),
      ).toHaveCount(4);

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
      await grantMarketRole(request, marketId, EDITOR, 'editor');

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

    test('Applications: an Editor reviews, and a Viewer reads, at the window', async ({
      browser,
      request,
    }) => {
      const marketId = await aMarketInReview(request);
      ensureVerifiedUser(EDITOR.email, EDITOR.password);
      await grantMarketRole(request, marketId, EDITOR, 'editor');
      ensureVerifiedUser(VIEWER.email, VIEWER.password);
      await grantMarketRole(request, marketId, VIEWER, 'viewer');

      // T166 note 10: an Editor on a phone saw the page laid out 1001px wide and zoomed out.
      await withUser(
        browser,
        EDITOR.email,
        EDITOR.password,
        async (editor) => {
          const { expectFits: fits, expectInside: inside, press: tap } = inTheWindow(size);
          await editor.goto(marketScreenPath(marketId, 'applications'));
          const row = editor.getByTestId('applications-all-row').first();
          await expect(row).toBeVisible({ timeout: 15000 });
          await fits(editor, 'the Applications page, for an Editor');
          await expectAcross(row, 'the row');
          await expectNameOverStatus(row);

          // The views switch, the filters, Mine, the count and Export wrap in the window, each a
          // thumb's target; so is the row's tick.
          await expectTargets(editor.getByTestId(/^applications-view-/), 'a view');
          await expectWide(editor.getByTestId(/^applications-view-/), 'a view');
          await expectTargets(editor.getByTestId(/^applications-all-filter-/), 'a filter');
          await expectWide(editor.getByTestId(/^applications-all-filter-/), 'a filter');
          await expectTargets(editor.getByTestId('applications-all-export-button'), 'Export');
          await expectAcross(editor.getByTestId('applications-all-count'), 'the count');
          await expectLabelTarget(editor.getByTestId('applications-all-mine'), 'Mine');
          await expectLabelTarget(row.getByTestId('applications-all-tick'), "the row's tick");
          await tap(row.getByTestId('applications-all-tick'));
          await expect(row.getByTestId('applications-all-tick')).toBeChecked();
          await expect(editor.getByTestId('applications-all-selection')).toBeVisible();
          await expectAcross(editor.getByTestId('applications-all-selection'), 'the selection');
          await tap(editor.getByTestId('applications-all-selection-clear'));

          // The drawer opens inside the window, its verdicts inside it, and Update info over it.
          await tap(row.getByTestId('applications-all-name'));
          const drawer = editor.getByTestId('vendors-detail-panel');
          await expect(drawer.getByTestId('applications-all-drawer-verdict')).toBeVisible();
          await expect(drawer).toBeInViewport({ ratio: 1 });
          await inside(drawer, 'the drawer');
          await inside(drawer.getByTestId('applications-all-approve'), 'Approve');
          await tap(drawer.getByTestId('vendors-detail-update-info'));
          const updating = editor.getByTestId('update-info-window');
          await expect(updating).toBeVisible();
          await inside(updating, 'Update info');
          const save = editor.getByTestId('update-info-submit-button');
          await save.scrollIntoViewIfNeeded();
          await inside(save, 'Save');
          await tap(editor.getByTestId('update-info-cancel-button'));
          await expect(updating).toHaveCount(0);
          await fits(editor, 'the Applications page, the drawer open');
        },
        size.use,
      );

      // A Viewer reads the same page at the same width.
      await withUser(
        browser,
        VIEWER.email,
        VIEWER.password,
        async (viewer) => {
          const { expectFits: fits } = inTheWindow(size);
          await viewer.goto(marketScreenPath(marketId, 'applications'));
          const row = viewer.getByTestId('applications-all-row').first();
          await expect(row).toBeVisible({ timeout: 15000 });
          await fits(viewer, 'the Applications page, for a Viewer');
          await expectAcross(row, 'the row');
          await expectNameOverStatus(row);
        },
        size.use,
      );
    });

    test('One by one: a verdict, the next card, and the review dealt to a reviewer', async ({
      authenticatedPage: page,
      browser,
      request,
    }) => {
      test.slow();
      const marketId = await aQueueToReview(request);
      await page.goto(oneByOnePath(marketId));
      const card = page.getByTestId('app-monitor-card');
      await expect(card).toBeVisible({ timeout: 15000 });
      await expectFits(page, 'One by one');
      await expectCard(card);

      // The queue's own controls are a thumb's targets: the follow-ups' label, the highlights.
      await expectLabelTarget(
        page.getByTestId('app-monitor-include-follow-ups'),
        'Include the follow-up',
      );
      await expectTargets(page.getByTestId('app-monitor-choose-highlights'), 'Choose highlights');
      await expectAcross(page.getByTestId('applications-refresh'), 'Refresh');

      // The follow-up dialog opens inside the window, and is put away.
      await press(page.getByTestId('app-monitor-follow-up-button'));
      const followUp = page.getByTestId('follow-up-window');
      await expect(followUp).toBeVisible();
      await expectInside(followUp, 'the follow-up dialog');
      await expectInside(page.getByTestId('follow-up-submit-button'), "the follow-up's confirm");
      await press(page.getByTestId('follow-up-cancel-button'));
      await expect(followUp).toHaveCount(0);

      // A verdict: the next card stands in the window, the undo line over it, and the reviewed
      // list's toggle beside the counts; the list opens inside the window.
      const first = await page.getByTestId('app-monitor-email').innerText();
      await press(page.getByTestId('app-monitor-approve-button'));
      await expect(page.getByTestId('app-monitor-email')).not.toHaveText(first);
      await expectCard(card);
      await expectAcross(page.getByTestId('app-monitor-undo'), 'the undo line');
      const toggle = page.getByTestId('app-monitor-decided-toggle');
      await expectTargets(toggle, "the reviewed list's toggle");
      await press(toggle);
      for (const row of await page.getByTestId('app-monitor-decided-row').all()) {
        await expectAcross(row, 'a reviewed row');
      }
      await expectFits(page, 'One by one, a verdict given');

      // The organizer deals the review to the Editor from the reviewers dialog, every choice a
      // thumb's target.
      await press(page.getByTestId('reviewers-change'));
      const dealing = page.getByTestId('reviewers-dialog-window');
      await expect(dealing).toBeVisible();
      await expectInside(dealing, 'the reviewers dialog');
      for (const choice of await dealing.getByTestId(/^reviewer-picker-/).all()) {
        await expectLabelTarget(choice, 'a reviewer');
      }
      await press(dealing.getByTestId(`reviewer-picker-${EDITOR.email}`));
      const save = page.getByTestId('reviewers-dialog-submit-button');
      await expectInside(save, 'Save reviewers');
      await press(save);
      await expect(dealing).toHaveCount(0);
      await expect(page.getByTestId('reviewers-person')).toHaveText([EDITOR.email]);
      await expectFits(page, 'One by one, the review dealt');

      // The chosen reviewer reads their share, then decides it One by one, at the window.
      await withUser(
        browser,
        EDITOR.email,
        EDITOR.password,
        async (editor) => {
          const { expectFits: fits, press: tap } = inTheWindow(size);
          await editor.goto(marketScreenPath(marketId, 'applications'));
          await expect(editor.getByTestId('applications-all-row')).toHaveCount(2, {
            timeout: 15000,
          });
          await fits(editor, "the reviewer's share");
          for (const row of await editor.getByTestId('applications-all-row').all()) {
            await expectAcross(row, 'a row of the share');
          }
          await editor.goto(oneByOnePath(marketId));
          const theirs = editor.getByTestId('app-monitor-card');
          await expect(theirs).toBeVisible({ timeout: 15000 });
          await fits(editor, "One by one, the reviewer's share");
          await expectCard(theirs);
          await tap(editor.getByTestId('app-monitor-approve-button'));
          // The share's last card is open on the organizer's page, so the reviewer reads that.
          await expect(editor.getByTestId('app-monitor-all-held')).toBeVisible();
          await expectAcross(editor.getByTestId('app-monitor-undo'), 'the undo line');
          await expectAcross(editor.getByTestId('app-monitor-look-again'), 'Look again');
          await fits(editor, "One by one, the reviewer's share decided");
        },
        size.use,
      );
    });

    test('Publish Results: its dialog opens inside the window', async ({
      authenticatedPage: page,
      request,
    }) => {
      const marketId = await aMarketToPublish(request);
      await page.goto(marketScreenPath(marketId, 'applications'));
      const publish = page.getByTestId('applications-publish-button');
      await expect(publish).toBeEnabled({ timeout: 15000 });
      await expectFits(page, 'the Applications page in assignment');
      await expectTargets(publish, 'Publish Results');
      await press(publish);
      const confirm = page.getByTestId('publish-results-window');
      await expect(confirm).toBeVisible();
      await expectInside(confirm, 'the publish results dialog');
      await expectInside(page.getByTestId('publish-results-submit-button'), 'its confirm');
      await expectInside(page.getByTestId('publish-results-cancel-button'), 'its cancel');
      await press(page.getByTestId('publish-results-submit-button'));
      await expect(confirm).toHaveCount(0);
      await expect(page.getByTestId('applications-published-badge')).toBeVisible();
      await expectFits(page, 'the Applications page, results published');
    });

    test('Stats: the market at a glance, for an organizer and a Viewer', async ({
      authenticatedPage: page,
      request,
      browser,
    }) => {
      const marketId = await aMarketThatIsOwed(request);
      askWhatTheySell(marketId);
      ensureVerifiedUser(VIEWER.email, VIEWER.password);
      await grantMarketRole(request, marketId, VIEWER, 'viewer');

      await page.goto(marketScreenPath(marketId, 'stats'));
      const headlines = page.getByTestId('stats-headlines');
      await expect(headlines.getByTestId('stats-headline-stillOwed')).toHaveText('$35 still owed', {
        timeout: 15000,
      });
      await expectFits(page, 'Stats');

      // The headlines wrap in the window, each link a thumb's target on its own line.
      await expectAcross(headlines, 'the headlines');
      await expect(headlines.getByRole('listitem')).toHaveCount(6);
      for (const headline of await headlines.getByRole('listitem').all()) {
        await expectAcross(headline, `the headline "${await headline.innerText()}"`);
      }
      await expectTargets(headlines.getByRole('link'), "a headline's link");

      // The answer groups' switch is a row of targets, and the ledgers read inside the window.
      const among = page.getByRole('group', { name: 'Count the answers of' }).getByRole('button');
      await expect(among).toHaveText(['All', 'Approved', 'Assigned']);
      await expectWide(among, 'a group');
      await expectTargets(among, 'a group');
      const ledgers = page.getByTestId(/^stats-(by-status|by-day|question)$/);
      expect(await ledgers.count(), 'the ledgers are drawn').toBeGreaterThanOrEqual(3);
      for (const ledger of await ledgers.all()) {
        await expectAcross(ledger, 'a ledger');
      }
      await press(among.filter({ hasText: 'Assigned' }));
      await expect(among.filter({ hasText: 'Assigned' })).toHaveAttribute('aria-pressed', 'true');
      await expectFits(page, 'Stats, counting the assigned');

      // A headline's link lands on the page it names, at the window's width.
      await press(headlines.getByTestId('stats-headline-stillOwed').getByRole('link'));
      await page.waitForURL(/\/payments\?show=owes$/);
      await expect(page.getByTestId('payments-show-owes')).toHaveAttribute('aria-pressed', 'true', {
        timeout: 15000,
      });
      await expect(page.getByTestId('payments-row')).toHaveCount(1);
      await expectFits(page, 'Payments, from a headline');

      // A Viewer reads the same figures at the window.
      await withUser(
        browser,
        VIEWER.email,
        VIEWER.password,
        async (viewer) => {
          await viewer.goto(marketScreenPath(marketId, 'stats'));
          await expect(viewer.getByTestId('stats-headline-stillOwed')).toHaveText(
            '$35 still owed',
            { timeout: 15000 },
          );
          await expect(viewer.getByTestId('stats-among-all')).toBeVisible();
          expect(await widths(viewer), 'Stats keeps the window for a Viewer').toEqual({
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
 * floor at every width under it, so a tablet lays it out at its own width, and a page of the same
 * view that does not, the plan, keeps it. At 768 the market's name
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
      for (const where of [
        'attendance',
        'tools',
        'assignments',
        'vendors',
        'payments',
        'applications',
        'stats',
      ] as const) {
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
      // The plan, a page of the same view as Applications, is built at a desk and keeps its floor.
      await page.goto(marketScreenPath(seed.marketId, 'setup'));
      await expect(page.getByTestId('phase-rail-checkin')).toBeVisible({ timeout: 15000 });
      expect((await widths(page)).sideways, 'the plan keeps the desktop floor').toBeGreaterThan(0);
    });
  }
});

/**
 * The narrowest phone (T180 review): 320px is WCAG 1.4.10's reflow width. Stats' cards kept an
 * 18rem floor there, so in a 256px column they ran past the frame's card to the window's edge,
 * which no sideways scroll showed.
 */
test('Stats keeps its headlines and cards inside the frame at 320', async ({
  authenticatedPage: page,
  request,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const marketId = await aMarketThatIsOwed(request);
  askWhatTheySell(marketId);
  await page.goto(marketScreenPath(marketId, 'stats'));
  await expect(page.getByTestId('stats-headline-stillOwed')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('stats-question')).toHaveCount(1);
  expect((await widths(page)).sideways, 'Stats scrolls sideways').toBe(0);
  const frame = (await page.getByTestId('market-frame-card').boundingBox())!;
  const parts = [
    page.getByTestId('stats-headlines'),
    ...(await page.getByTestId(/^stats-(by-status|by-day|question)$/).all()),
  ];
  for (const part of parts) {
    const box = (await part.boundingBox())!;
    expect(
      box.x + box.width,
      `${await part.getAttribute('data-testid')} ends inside the frame`,
    ).toBeLessThanOrEqual(frame.x + frame.width);
  }
});
