import { execFileSync } from 'node:child_process';
import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { TablesPage } from './pages/TablesPage';
import { SEED_MARKET_DATE, seedMarketWithVendors } from './helpers/seeds';
import { seedApprovedVendor } from './helpers/seedApplication';
import { savePlan } from './helpers/savePlan';
import { mongoContainer } from './helpers/containerNames';

/**
 * What a hand change overrides, said before it is made (bugs 18 and 32, E26/F05/S03; settles
 * claims-and-room 05).
 *
 * Placing warned about availability and table size only, and swapping warned about nothing - so a
 * vendor who accepted only Gold could be moved into Silver, which sets their price, or given a
 * second date against their own limit and the market's ceiling, with no word. And the place
 * dialog offered every unseated applicant in one list, so the one vendor who said they could not
 * come could be the only name in it, unmarked.
 */
const D1 = SEED_MARKET_DATE;
const D2 = '2026-05-08';
const GOLD = { id: 1, name: 'Gold' };
const SILVER = { id: 2, name: 'Silver' };

function mongoEval(script: string): void {
  execFileSync('docker', [
    'exec',
    mongoContainer(),
    'mongosh',
    'mongodb://admin:secret@localhost:27017/conventioner?authSource=admin',
    '--quiet',
    '--eval',
    script,
  ]);
}

async function call(
  request: APIRequestContext,
  method: 'put' | 'delete',
  path: string,
  data: object,
) {
  return request[method](`${BACKEND_URL}${path}`, { data });
}

test('placing and swapping warn about every answer they override, and never block', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  // Alice takes only Gold. Bob takes only Silver and wants to share. Carol takes only Gold, on two
  // dates, but wants one. Dana takes Silver and either size, so a free Silver table fits her.
  mongoEval(
    `db.applications.updateOne({ market_id: ${JSON.stringify(marketId)}, applicant_email: 'bob@example.com' },
      { $set: { 'form_data.essential_tier_preference': { ${JSON.stringify(D1)}: ['Silver'] },
                'form_data.essential_table_choice': 'half' } })`,
  );
  seedApprovedVendor(marketId, 'carol@example.com', {
    dates: [D1, D2],
    tiers: ['Gold'],
    maxDates: 1,
  });
  seedApprovedVendor(marketId, 'dana@example.com', {
    dates: [D1],
    tiers: ['Silver'],
    tableChoice: 'either',
  });
  // Two sections, so every applicant ranks them.
  mongoEval(
    `db.applications.updateMany({ market_id: ${JSON.stringify(marketId)} },
      { $set: { 'form_data.essential_section_ranking': ['Hall A', 'Hall B'] } })`,
  );
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
    priority: [],
    marketDates: [{ date: D1 }, { date: D2 }],
    tiers: [GOLD, SILVER],
    locations: [{ name: 'Main Hall' }],
    sections: [
      { name: 'Hall A', location: { name: 'Main Hall' }, tier: GOLD, count: 2 },
      { name: 'Hall B', location: { name: 'Main Hall' }, tier: SILVER, count: 2 },
    ],
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

  // Seat everyone by hand, so the dialogs open on a known room.
  for (const email of ['alice', 'bob', 'carol', 'dana'].map((name) => `${name}@example.com`)) {
    for (const date of [D1, D2]) {
      await call(request, 'delete', `/markets/${marketId}/placements`, { email, date });
    }
  }
  for (const [email, date, table_code, table_choice] of [
    ['alice@example.com', D1, 'Hall A 1', 'Full Table'],
    ['bob@example.com', D1, 'Hall B 1', 'Half Table (Left)'],
    ['carol@example.com', D2, 'Hall A 1', 'Full Table'],
  ]) {
    const res = await call(request, 'put', `/markets/${marketId}/placements`, {
      email,
      date,
      table_code,
      table_choice,
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  const tables = new TablesPage(page);
  await tables.goto(marketId);
  await tables.setFilter('date', D1);

  // The free Silver table: Dana fits it as she answered; Carol is still offered, but apart.
  await tables.vacantSeat('Hall B 2').click();
  const who = tables.dialog.getByTestId('placement-dialog-vendor');
  await expect(who.getByTestId('placement-dialog-fits').locator('option')).toHaveText([
    /Dana Example/,
  ]);
  await expect(who.getByTestId('placement-dialog-overrides').locator('option')).toHaveText([
    /Carol Example/,
  ]);

  await who.selectOption('dana@example.com');
  await expect(tables.dialogWarning).toHaveCount(0);

  // Placing Carol overrides her tier and her own limit, and crosses the market's ceiling.
  await who.selectOption('carol@example.com');
  await expect(tables.dialogWarning).toContainText(
    'They did not accept the Silver tier on this date, which sets their price.',
  );
  await expect(tables.dialogWarning).toContainText(
    'This gives them 2 dates; they asked for at most 1.',
  );
  await expect(tables.dialogWarning).toContainText(
    'This gives them 2 dates; the market allows at most 1 per vendor.',
  );
  // Said, never refused: the organizer can still make the change.
  await tables.dialog.getByTestId('placement-dialog-confirm').click();
  await expect(tables.dialog).toBeHidden();
  await expect(tables.occupiedSeat('Hall B 2')).toHaveAttribute(
    'data-vendor-email',
    'carol@example.com',
  );

  // Swapping Alice and Bob overrides answers of both, and says which are whose.
  await tables.occupiedSeat('Hall A 1').click();
  await tables.dialog.getByTestId('placement-dialog-swap-target').selectOption('bob@example.com');
  const swapping = tables.dialog.getByTestId('placement-dialog-swap-warning');
  const forAlice = swapping.locator('[data-vendor-email="alice@example.com"]');
  await expect(forAlice).toContainText('Alice Example');
  await expect(forAlice).toContainText('They did not accept the Silver tier on this date');
  await expect(forAlice).toContainText(
    'They asked for a whole table. This gives them half of one.',
  );
  const forBob = swapping.locator('[data-vendor-email="bob@example.com"]');
  await expect(forBob).toContainText('Bob Example');
  await expect(forBob).toContainText('They did not accept the Gold tier on this date');
  await expect(forBob).toContainText('They asked to share a table. This gives them a whole one.');
  // A swap trades tables on one date, so it never changes how many dates anyone holds.
  await expect(swapping).not.toContainText('dates');

  await tables.dialog.getByTestId('placement-dialog-swap').click();
  await expect(tables.dialog).toBeHidden();
  await expect(tables.occupiedSeat('Hall A 1')).toHaveAttribute(
    'data-vendor-email',
    'bob@example.com',
  );
  await expect(tables.occupiedSeat('Hall B 1')).toHaveAttribute(
    'data-vendor-email',
    'alice@example.com',
  );
});
