import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { oneByOnePath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';

/**
 * The next card deals what a dead deal left waiting (T270, ADR 0020).
 *
 * Ana and Ben, both Viewers, are chosen before anyone applies. Two vendors then apply while a deal
 * holds the market, so each application is marked as arriving and left to that deal; the host
 * ends it, its lease runs out, and nobody applies after. Planted as that leaves them: both open,
 * undealt and marked, and the lease run out. Ben, on his share alone, is handed the second, his
 * turn's, rather than told his share is done; the first is Ana's, and the deal is recorded as
 * each vendor's own arrival.
 */
const PASSWORD = 'e2epassword123';
const ANA = 'e2e-stranded-ana@example.com';
const BEN = 'e2e-stranded-ben@example.com';
const [FIRST, SECOND] = [1, 2].map((n) => `stranded-${n}@moss.test`);

test("a chosen reviewer's next card deals the applications a dead deal left waiting", async ({
  browser,
  request,
}) => {
  for (const email of [ANA, BEN]) ensureVerifiedUser(email, PASSWORD);
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  const api = `${BACKEND_URL}/markets/${marketId}`;
  for (const email of [ANA, BEN]) {
    const res = await request.post(`${api}/roles`, { data: { user_email: email, role: 'viewer' } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  const chosen = await request.put(`${api}/reviewers`, { data: { reviewers: [ANA, BEN] } });
  expect(chosen.ok(), await chosen.text()).toBeTruthy();

  // Seeded one after another, so they arrived in this order.
  const ids = [FIRST, SECOND].map((vendor) => seedApplicationWithStatus(marketId, 'open', vendor));
  for (const [id, vendor] of [
    [ids[0], FIRST],
    [ids[1], SECOND],
  ]) {
    mongoEval(
      `db.applications.updateOne({id: ${JSON.stringify(id)}}, ` +
        `{$set: {arriving: {actor: ${JSON.stringify(vendor)}, action: "apply"}}})`,
    );
  }
  const ranOut = new Date(Date.now() - 60_000).toISOString().replace('Z', '+00:00');
  mongoEval(
    `db.markets.updateOne({id: ${JSON.stringify(marketId)}}, ` +
      `{$set: {"reviewTeam.dealing": {by: "a-deal-the-host-ended", until: "${ranOut}"}}})`,
  );

  await withUser(browser, BEN, PASSWORD, async (page) => {
    const monitor = new ApplicationMonitorPage(page);
    await page.goto(oneByOnePath(marketId));
    await monitor.waitForLoaded();

    // His turn's, the second: the turn stood at 0, and Ana's address sorts first.
    await expect(monitor.email).toHaveText(SECOND);
    await expect(monitor.progress).toHaveText('1 of 1 in your share');
    await expect(monitor.dealtWarning).toHaveCount(0);
    await expect(monitor.shareDone).toHaveCount(0);
  });

  const stored = JSON.parse(
    mongoEval(
      `JSON.stringify(db.applications.find({market_id: ${JSON.stringify(marketId)}}, ` +
        `{_id: 0, applicant_email: 1, "reviewer.email": 1, arriving: 1}).sort({submitted_at: 1}).toArray())`,
    ),
  );
  expect(stored).toEqual([
    { applicant_email: FIRST, reviewer: { email: ANA } },
    { applicant_email: SECOND, reviewer: { email: BEN } },
  ]);
  const dealt = JSON.parse(
    mongoEval(
      `JSON.stringify(db.history.find({market_id: ${JSON.stringify(marketId)}, kind: "dealt", ` +
        `"detail.cause": "arrived"}, {_id: 0, actor: 1, action: 1}).sort({actor: 1}).toArray())`,
    ),
  );
  expect(dealt).toEqual([
    { actor: FIRST, action: 'apply' },
    { actor: SECOND, action: 'apply' },
  ]);
});
