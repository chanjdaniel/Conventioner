import { execFileSync } from 'node:child_process';
import { test, expect } from './fixtures';
import { backendContainer } from './helpers/containerNames';
import { mongoEval } from './helpers/mongo';
import { marketNameToSlug } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * Production's test markets, as an operator seeds them (E32/F03/S03).
 *
 * The test markets were cleared after the dry run, so a check in production had nothing to run
 * against. `back-end/seed_test_markets.py` makes one market of each intake path in a test
 * organization; an operator runs it, and runs it again, so it must make each once. Its owner here
 * is an account of its own, so the test organization never joins another spec's lists.
 */
const OWNER = 'e2e-seeder@example.com';
const ONLINE = 'Conventioner Test - Online Applications';
const GOOGLE_FORM = 'Conventioner Test - Google Form';

function seed(): string {
  return execFileSync(
    'docker',
    ['exec', backendContainer(), 'python', '/app/seed_test_markets.py', '--owner', OWNER],
    { encoding: 'utf-8', timeout: 60_000 },
  );
}

function marketsNamed(name: string): number {
  return Number(mongoEval(`db.markets.countDocuments({ name: ${JSON.stringify(name)} })`));
}

test.describe('The test markets', () => {
  test.beforeAll(() => {
    ensureVerifiedUser(OWNER, 'e2epassword123');
  });

  test('are made once however often the seeder runs, one of each path', async ({ page }) => {
    const first = seed();
    expect(first).toContain(`${ONLINE} (form): applications_open`);
    expect(first).toContain(`${GOOGLE_FORM} (csv): applications_open`);
    expect(seed()).toBe(first);
    expect([marketsNamed(ONLINE), marketsNamed(GOOGLE_FORM)]).toEqual([1, 1]);

    // Nobody has applied to either.
    expect(
      Number(
        mongoEval(
          `db.applications.countDocuments({ market_id: { $in: db.markets.find({ name: { $in: ${JSON.stringify(
            [ONLINE, GOOGLE_FORM],
          )} } }).toArray().map(m => m.id) } })`,
        ),
      ),
    ).toBe(0);

    // The online market takes a vendor's sign-in; the Google Form market reads as no market.
    await page.goto(`/${marketNameToSlug(ONLINE)}/applicant-login`);
    await expect(page.getByTestId('applicant-login-market')).toHaveText(ONLINE);
    await page.goto(`/${marketNameToSlug(GOOGLE_FORM)}/applicant-login`);
    await expect(page.getByTestId('page-not-found')).toBeVisible();
  });
});
