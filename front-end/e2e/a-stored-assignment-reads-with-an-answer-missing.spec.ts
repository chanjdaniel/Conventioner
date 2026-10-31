import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { Page } from '@playwright/test';
import { marketScreenPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';
import { TablesPage } from './pages/TablesPage';

/**
 * A stored assignment reads with an approved application's answer missing (T139).
 *
 * The statistics and the tables grid read the approved applications through the run's own check,
 * so one approved application missing an answer refused both reads: on a published market the
 * Assignments page held its figures with no grid, and the door showed a vendor's seat while their
 * drawer could not.
 * Only a new run needs every answer; a read describes what is stored, and before an assignment
 * exists, nobody placed.
 */

/** Every answer of the two assignment reads, as the page asks them. */
function assignmentReads(page: Page): number[] {
  const statuses: number[] = [];
  page.on('response', (response) => {
    if (
      /\/markets\/[^/]+\/(assignment-statistics|tables)$/.test(new URL(response.url()).pathname)
    ) {
      statuses.push(response.status());
    }
  });
  return statuses;
}

test('a published market shows its stored seats when an approved answer goes missing', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  // Alice is seated; her application then loses the dates she can attend, as an update or an
  // import may leave it.
  mongoEval(
    `db.applications.updateOne({market_id: '${seed.marketId}', applicant_email: 'alice@example.com'}, {$unset: {'form_data.essential_available_dates': ''}})`,
  );
  const reads = assignmentReads(page);

  // Assignments: its summary and the grid, Alice in her seat.
  const tables = new TablesPage(page);
  await tables.goto(seed.marketId);
  await expect(page.getByTestId('result-approved-assigned')).toContainText('2 of 2', {
    timeout: 15000,
  });
  await expect(tables.tableRows).toHaveCount(3);
  await expect(
    page.locator('[data-testid="tables-seat-occupied"][data-vendor-email="alice@example.com"]'),
  ).toHaveCount(1);

  // The door lists her, and her drawer says where she sits.
  const attendance = new AttendanceStatusPage(page);
  await attendance.goto(seed.marketId);
  await expect(attendance.row('alice@example.com')).toBeVisible({ timeout: 15000 });
  await attendance.vendor('alice@example.com').click();
  await expect(page.getByTestId('vendors-detail-email')).toHaveText('alice@example.com');
  await expect(page.getByTestId('vendors-detail-load-error')).toHaveCount(0);
  await page.getByTestId('vendor-drawer-tab-assignments').click();
  await expect(page.getByTestId('vendors-detail-assignment-item').first()).toContainText('A ');

  expect(reads.length).toBeGreaterThan(0);
  expect(
    reads.every((status) => status === 200),
    `the reads answered ${reads}`,
  ).toBe(true);
});

test('before an assignment, a drawer from the All view reads nobody placed, with no refusal', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  // Approved without the dates the market asks, as an imported row may arrive.
  seedApplicationWithStatus(marketId, 'reviewer_approved', 'nadia@ember.test');
  const reads = assignmentReads(page);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const all = new ApplicationsAllPage(page);
  await page.goto(marketScreenPath(marketId, 'applications'));
  await expect(all.rows).toHaveCount(1, { timeout: 15000 });
  await all.open('nadia@ember.test');
  await expect(all.drawer).toBeVisible();
  await expect(page.getByTestId('vendors-detail-load-error')).toHaveCount(0);

  await expect.poll(() => reads.length).toBe(2);
  expect(reads).toEqual([200, 200]);
  expect(consoleErrors).toEqual([]);
});
