import type { Locator } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { SEED_MARKET_DATE, seedMarketWithVendors } from './helpers/seeds';
import { seedApplication, seedApprovedVendor } from './helpers/seedApplication';
import { seedApplicantMarket } from './helpers/seedApplicantMarket';
import { savePlan } from './helpers/savePlan';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';

/**
 * Result and review read cleanly (items 5, 6 and 7 of bug 43; E26/F10/S01).
 *
 * On Result each occupant's box was as wide as their name, an empty table was badged "FULL TABLE",
 * and the date filter's chip read "2026-10-10". On the review card a highlighted essential label
 * was grey beside a black custom one, and the Skip key's "S" had no box. In the reviewed list the
 * status and the opposite action were both filled pills in the same colours.
 */
test.use({ viewport: { width: 1440, height: 900 } });

const GOLD = { id: 1, name: 'Gold' };

const width = (locator: Locator) =>
  locator.evaluate((el) => Math.round(el.getBoundingClientRect().width));

test('every seat is one width, an empty table claims no size, and the date chip reads as a date', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const answers = { dates: [SEED_MARKET_DATE], tiers: ['Gold'] };
  seedApprovedVendor(marketId, 'carol@example.com', { ...answers, tableChoice: 'half' });
  seedApprovedVendor(marketId, 'dan@example.com', {
    ...answers,
    tableChoice: 'half',
    fullName: 'Daniela Montgomery-Featherstonehaugh',
  });
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
    priority: [],
    marketDates: [{ date: SEED_MARKET_DATE }],
    tiers: [GOLD],
    locations: [{ name: 'Main Hall' }],
    sections: [{ name: 'Hall A', location: { name: 'Main Hall' }, tier: GOLD, count: 5 }],
    assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: 50 },
  });
  for (const toPhase of ['applications_open', 'applications_closed', 'review', 'assignment']) {
    const res = await request.post(`${BACKEND_URL}/markets/${marketId}/transition`, {
      data: { toPhase },
    });
    expect(res.ok(), `to ${toPhase}: ${await res.text()}`).toBeTruthy();
  }
  const run = await request.post(`${BACKEND_URL}/markets/${marketId}/assignment`);
  expect(run.ok(), await run.text()).toBeTruthy();

  await page.goto(marketScreenPath(marketId, 'result'));
  const rows = page.getByTestId('tables-table-row');
  await expect(rows).toHaveCount(5);

  // A seat is as wide as its place on the table, never as its occupant's name.
  const half = rows.filter({ has: page.locator('[data-vendor-email="carol@example.com"]') });
  const halves = half.getByTestId('tables-seat-occupied');
  await expect(halves).toHaveCount(2);
  expect(await width(halves.nth(0))).toBe(await width(halves.nth(1)));
  const whole = [
    page.locator('[data-vendor-email="alice@example.com"]'),
    page.locator('[data-vendor-email="bob@example.com"]'),
  ];
  expect(await width(whole[0])).toBe(await width(whole[1]));

  // Nobody has chosen a size for a table nobody is at; a taken one says its size in a chip.
  const empty = rows.filter({ has: page.getByTestId('tables-seat-empty') });
  await expect(empty.getByTestId('tables-table-choice')).toHaveCount(0);
  const taken = half.getByTestId('tables-table-choice');
  await expect(taken).toHaveText('Half Table');
  expect(await taken.evaluate((el) => getComputedStyle(el).textTransform)).not.toBe('uppercase');

  await page.getByTestId('tables-filter-date').selectOption(SEED_MARKET_DATE);
  await expect(page.getByTestId('tables-filter-chip-date')).toContainText(
    'Date: Friday, May 1, 2026',
  );
});

test('the review card reads as one card, and a verdict is not drawn like the action beside it', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  for (const email of ['nadia@ember.test', 'rafi@kiln.test', 'theo@thistle.test']) {
    seedApplication(marketId, email, {
      business_name: 'Ember Ceramics',
      product_type: 'Stoneware',
      essential_full_name: 'Nadia Ember',
    });
  }
  const highlighted = await request.put(`${BACKEND_URL}/markets/${marketId}/review-highlights`, {
    data: { keys: ['product_type', 'essential_full_name'] },
  });
  expect(highlighted.ok(), await highlighted.text()).toBeTruthy();

  await page.goto(marketSetupPath(marketId, 'applications'));
  const monitor = new ApplicationMonitorPage(page);
  await monitor.waitForLoaded();

  const labels = await page
    .getByTestId('app-monitor-leading')
    .locator('dt')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
  expect(labels).toHaveLength(2);
  expect(new Set(labels).size, 'an essential and a custom label are drawn alike').toBe(1);

  // Each key hint is a key, boxed against its own button.
  const keyBorder = (button: Locator) =>
    button.locator('kbd').evaluate((el) => {
      const kbd = getComputedStyle(el);
      const ground = getComputedStyle(el.parentElement!).backgroundColor;
      return { border: kbd.borderTopColor, ground };
    });
  const skip = await keyBorder(monitor.skipButton);
  expect(skip.border).not.toBe(skip.ground);
  expect(skip.border).not.toMatch(/rgba\(255, 255, 255/);

  await monitor.approveButton.click();
  await monitor.rejectButton.click();
  await monitor.decidedToggle.click();
  const verdict = (label: string) =>
    monitor.decidedRows.filter({
      has: page.getByTestId('app-monitor-decided-status').getByText(label, { exact: true }),
    });
  const rejected = verdict('Rejected');
  const status = rejected.getByTestId('app-monitor-decided-status');
  const instead = rejected.getByTestId('app-monitor-decided-approve-button');
  const fill = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor);
  // A verdict is a tinted chip; the action beside it is a button, and neither wears the other's fill.
  await expect(status).toHaveClass(/chip--destructive/);
  expect(await fill(status)).not.toBe(await fill(instead));
  await expect(verdict('Approved').getByTestId('app-monitor-decided-status')).toHaveClass(
    /chip--positive/,
  );
});
