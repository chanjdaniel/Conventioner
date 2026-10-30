import { readFileSync } from 'node:fs';
import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { TablesPage } from './pages/TablesPage';
import { SEED_MARKET_DATE, seedMarketWithVendors } from './helpers/seeds';
import { seedApprovedVendor } from './helpers/seedApplication';
import { savePlan } from './helpers/savePlan';
import { mongoEval } from './helpers/mongo';
import { marketScreenPath } from './helpers/marketScreens';

/**
 * Anyone may be seated by hand, warned (E36/F02/S02).
 *
 * The review and the automatic rules govern the run, never the organizer's hand: a rejected
 * applicant is offered in the place dialog under "Not approved", the warning says who rejected
 * them, and the seat is a pin the next run keeps - nobody else is put in it.
 */
const GOLD = { id: 1, name: 'Gold' };

/**
 * Alice and Bob approved, Reza rejected by a reviewer, three Gold tables, assigned: so one table is
 * free, and the run seats Alice and Bob and never Reza.
 */
async function aMarketWithARejectedApplicant(request: APIRequestContext): Promise<string> {
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  seedApprovedVendor(marketId, 'reza@example.com', { dates: [SEED_MARKET_DATE], tiers: ['Gold'] });
  mongoEval(
    `db.applications.updateOne({ market_id: ${JSON.stringify(marketId)}, applicant_email: 'reza@example.com' },
      { $set: { status: 'reviewer_rejected', verdict_at: '2026-10-19T10:00:00',
                verdict_by: { kind: 'person', user_id: 'u-reviewer', email: 'alex@market.test' } } })`,
  );
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
    priority: [],
    marketDates: [{ date: SEED_MARKET_DATE }],
    tiers: [GOLD],
    locations: [{ name: 'Main Hall' }],
    sections: [{ name: 'Hall A', location: { name: 'Main Hall' }, tier: GOLD, count: 3 }],
    assignmentOptions: { maxAssignmentsPerVendor: 1, maxHalfTableProportionPerSection: 50 },
  });
  for (const toPhase of ['applications_open', 'applications_closed', 'review', 'assignment']) {
    const res = await request.post(`${BACKEND_URL}/markets/${marketId}/transition`, {
      data: { toPhase },
    });
    expect(res.ok(), `to ${toPhase}: ${await res.text()}`).toBeTruthy();
  }
  const run = await request.post(`${BACKEND_URL}/markets/${marketId}/assignment`);
  expect(run.ok(), await run.text()).toBeTruthy();
  return marketId;
}

test('a rejected applicant is offered apart, warned about, and kept by the next run', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await aMarketWithARejectedApplicant(request);

  const tables = new TablesPage(page);
  await tables.goto(marketId);
  await tables.vacantSeat('Hall A 3').click();
  const who = await tables.openPicker('vendor');
  await expect(who.getByTestId('placement-dialog-not-approved').getByRole('option')).toHaveText([
    /Reza Example/,
  ]);

  await tables.pick('vendor', 'reza@example.com');
  await expect(tables.dialogWarning).toContainText('Not approved: Rejected by alex@market.test');
  // Said, never refused.
  await tables.dialog.getByTestId('placement-dialog-confirm').click();
  await expect(tables.dialog).toBeHidden();
  await expect(tables.occupiedSeat('Hall A 3')).toHaveAttribute(
    'data-vendor-email',
    'reza@example.com',
  );

  // The next run keeps the seat they were given, and puts nobody else in it.
  const again = await request.post(`${BACKEND_URL}/markets/${marketId}/assignment`);
  expect(again.ok(), await again.text()).toBeTruthy();
  await page.reload();
  await expect(tables.occupiedSeat('Hall A 3')).toHaveAttribute(
    'data-vendor-email',
    'reza@example.com',
  );
  await expect(page.locator('[data-vendor-email="reza@example.com"]')).toHaveCount(1);

  // Marked wherever the other overrides show (E36/F02/S03): the seat, the drawer, the download.
  const seat = tables.occupiedSeat('Hall A 3');
  await expect(seat.getByTestId('tables-seat-not-approved')).toHaveText('Not approved');
  await seat.getByTestId('tables-seat-vendor').click();
  await expect(page.getByTestId('vendors-detail-giver')).toContainText(
    'Rejected by alex@market.test',
  );
  await page.getByTestId('vendor-drawer-tab-assignments').click();
  await expect(page.getByTestId('vendor-date-card-override')).toContainText(
    'Assigned by hand, though not approved',
  );
  await page.getByTestId('vendors-detail-close').click();

  const download = page.waitForEvent('download');
  await page.getByTestId('result-download-csv-button').click();
  const text = readFileSync((await (await download).path()) as string, 'utf8');
  expect(text).toMatch(/reza@example\.com,Not approved,/);
  expect(text).toMatch(/alice@example\.com,Approved,/);
});

/**
 * The Vendors page lists every applicant (E36/F02/S04): Reza with his verdict, "Rejected only"
 * beside "Unassigned only" and kept by a refresh, and the count still of who needs a table, so it
 * agrees with Assignments.
 */
test('the Vendors page lists the rejected too, and counts only the run', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await aMarketWithARejectedApplicant(request);

  await page.goto(marketScreenPath(marketId, 'vendors'));
  const rows = page.getByTestId('vendors-list-item');
  await expect(rows).toHaveCount(3);
  await expect(
    rows.filter({ hasText: 'Reza Example' }).getByTestId('vendors-list-status'),
  ).toHaveText('Rejected');
  await expect(page.getByTestId('vendors-summary')).toHaveText(/2\s+of\s+2\s+vendors assigned/);

  await page.getByTestId('vendors-filter-rejected').click();
  await expect(page).toHaveURL(/show=rejected/);
  await page.reload();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Reza Example');

  // Unassigned is a vendor who needs a table and has none: Reza needs none, and nobody else is unseated.
  await page.getByTestId('vendors-filter-unassigned').click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByText('Every vendor has a table.')).toBeVisible();
});
