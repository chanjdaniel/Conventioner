import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, ManageMarketPage } from './fixtures';
import { ensureTestOrg, loginViaApi } from './helpers/seeds';
import { seedApplicantMarket } from './helpers/seedApplicantMarket';
import { seedApplication } from './helpers/seedApplication';
import { mongoEval } from './helpers/mongo';

/**
 * A market's records go with it (bug 47).
 *
 * Deleting a market - on its own, or with its organization - removed the market document and left
 * its applications (each vendor's name, email and answers), its check-ins and its applicant
 * sign-in codes behind for ever, and deleting an organization left the placement trail too: records
 * describing a market nobody can reach any more. Its vendors' payments and amounts owed
 * (E44/F01/S01) go with it too.
 */

const KEPT_WITH_A_MARKET = [
  'applications',
  'attendance',
  'history',
  'applicant_login_challenges',
  'payments',
  'amounts_owed',
];

/** One record of every kind a market keeps beside itself. */
function seedRecords(marketId: string): void {
  seedApplication(marketId, 'kept@example.test');
  const at = new Date().toISOString();
  mongoEval(`
    db.attendance.insertOne({ market_id: ${JSON.stringify(marketId)}, email: 'kept@example.test',
      date: '2099-08-01', checked_in_at: ${JSON.stringify(at)} });
    db.history.insertOne({ market_id: ${JSON.stringify(marketId)}, at: ${JSON.stringify(at)} });
    db.applicant_login_challenges.insertOne({ market_id: ${JSON.stringify(marketId)},
      email: 'kept@example.test', expires_at: new Date(Date.now() + 3600 * 1000) });
    db.payments.insertOne({ market_id: ${JSON.stringify(marketId)},
      vendor_email: 'kept@example.test', cents: 3500, method: 'cash', paid_on: '2099-07-01' });
    db.amounts_owed.insertOne({ market_id: ${JSON.stringify(marketId)},
      vendor_email: 'kept@example.test', date: '2099-08-01',
      set_by_hand: { cents: 0, by: 'org@example.test', at: ${JSON.stringify(at)} } });
  `);
}

function recordsLeft(marketId: string): Record<string, number> {
  return JSON.parse(
    mongoEval(
      `print(JSON.stringify(Object.fromEntries(${JSON.stringify(KEPT_WITH_A_MARKET)}.map(` +
        `(name) => [name, db[name].countDocuments({ market_id: ${JSON.stringify(marketId)} })]))))`,
    ),
  );
}

const NOTHING_LEFT = Object.fromEntries(KEPT_WITH_A_MARKET.map((name) => [name, 0]));

async function makeOrg(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post(`${BACKEND_URL}/organizations`, { data: { name } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const listed = await request.get(`${BACKEND_URL}/organizations`);
  const { organizations } = (await listed.json()) as {
    organizations: Array<{ id: string; name: string }>;
  };
  return organizations.find((o) => o.name === name)!.id;
}

test.beforeAll(async ({ request }) => {
  await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
});

test('deleting a market deletes its applications, check-ins and history', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId, marketName } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  seedRecords(marketId);
  expect(recordsLeft(marketId)).not.toEqual(NOTHING_LEFT);

  await page.goto('/markets');
  const card = page.getByTestId('market-card').filter({ hasText: marketName });
  await card.getByTestId('market-card-manage-button').click();
  const manage = new ManageMarketPage(page);
  await manage.waitForOverlay();
  await manage.deleteButton.click();
  // Said before it happens, now that it is true.
  await expect(page.getByTestId('manage-market-delete-consequence')).toContainText(
    'with its applications, its assignments, its check-in records',
  );
  await manage.deleteConfirmButton.click();
  await expect(card).toHaveCount(0);

  expect(recordsLeft(marketId)).toEqual(NOTHING_LEFT);
});

test('deleting an organization deletes the records of the markets it held', async ({ request }) => {
  await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const orgId = await makeOrg(request, `E2E Records Org ${Date.now()}`);
  const created = await request.post(`${BACKEND_URL}/markets`, {
    data: {
      name: `E2E Records Draft ${Date.now()}`,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      modificationList: [],
      assignmentObject: {},
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { market_id: marketId } = (await created.json()) as { market_id: string };
  seedRecords(marketId);

  const deleted = await request.delete(`${BACKEND_URL}/organizations/${orgId}`);
  expect(deleted.ok(), await deleted.text()).toBeTruthy();

  expect(recordsLeft(marketId)).toEqual(NOTHING_LEFT);
});
