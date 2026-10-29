import { test, expect, BACKEND_URL, ApplicantLoginPage } from './fixtures';
import { ApplyPage } from './pages/ApplyPage';
import { runBackendScript } from './helpers/backendScript';
import { mongoEval } from './helpers/mongo';
import { createApplicantLoginChallenge } from './helpers/seedApplicantMarket';
import { loginViaApi, marketNameToSlug } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * Production's test markets, as an operator seeds them (E32/F03/S03).
 *
 * The test markets were cleared after the dry run, so a check in production had nothing to run
 * against. `back-end/seed_test_markets.py` makes one market of each intake path in a test
 * organization; an operator runs it, and runs it again, so it must make each once. Its owner here
 * is an account of its own, so the test organization never joins another spec's lists, and each
 * run starts with none of it, as a database the seeder has never seen.
 */
const OWNER = 'e2e-seeder@example.com';
const PASSWORD = 'e2epassword123';
const ORGANIZATION = 'Conventioner Test Organization';
const ONLINE = 'Conventioner Test - Online Applications';
const GOOGLE_FORM = 'Conventioner Test - Google Form';
const NAMES = JSON.stringify([ONLINE, GOOGLE_FORM]);

const seed = () => runBackendScript('seed_test_markets.py', '--owner', OWNER);

function marketsNamed(name: string): number {
  return Number(mongoEval(`db.markets.countDocuments({ name: ${JSON.stringify(name)} })`));
}

function marketId(name: string): string {
  return mongoEval(`db.markets.findOne({ name: ${JSON.stringify(name)} }).id`);
}

function removeMarket(name: string): void {
  mongoEval(`
    const market = db.markets.findOne({ name: ${JSON.stringify(name)} });
    if (market) {
      db.applications.deleteMany({ market_id: market.id });
      db.organizations.updateOne({ id: market.organizationId }, { $pull: { markets: market.id } });
      db.markets.deleteOne({ id: market.id });
    }`);
}

test.describe.configure({ mode: 'serial' });

test.describe('The test markets', () => {
  test.beforeAll(() => {
    ensureVerifiedUser(OWNER, PASSWORD);
    removeMarket(ONLINE);
    removeMarket(GOOGLE_FORM);
    mongoEval(`
      const org = db.organizations.findOne({ name: ${JSON.stringify(ORGANIZATION)} });
      if (org) {
        db.users.updateMany({}, { $pull: { organizations: org.id } });
        db.organizations.deleteOne({ id: org.id });
      }`);
  });

  test('are made once however often the seeder runs, one of each path', async ({ page }) => {
    const first = seed();
    expect(first).toContain(`${ONLINE} (form): applications, /${marketNameToSlug(ONLINE)}`);
    // Its first import is its way into Review (E38/F04/S01), so it waits as a draft.
    expect(first).toContain(`${GOOGLE_FORM} (csv): draft`);
    expect(seed()).toBe(first);
    expect([marketsNamed(ONLINE), marketsNamed(GOOGLE_FORM)]).toEqual([1, 1]);
    // Nobody has applied to either.
    expect(
      mongoEval(`db.applications.countDocuments({ market_id: { $in:
        db.markets.find({ name: { $in: ${NAMES} } }).toArray().map((m) => m.id) } })`),
    ).toBe('0');

    // The online market takes a vendor's sign-in; the Google Form market reads as no market.
    await page.goto(`/${marketNameToSlug(ONLINE)}/applicant-login`);
    await expect(page.getByTestId('applicant-login-market')).toHaveText(ONLINE);
    await page.goto(`/${marketNameToSlug(GOOGLE_FORM)}/applicant-login`);
    await expect(page.getByTestId('page-not-found')).toBeVisible();
  });

  test('a market a failed run left in draft is finished by the next', async ({ request }) => {
    // What a run that stopped after creating the market leaves behind: a draft, nothing more.
    removeMarket(ONLINE);
    await loginViaApi(request, BACKEND_URL, OWNER, PASSWORD);
    const created = await request.post(`${BACKEND_URL}/markets`, {
      data: {
        name: ONLINE,
        creationDate: new Date().toISOString(),
        organizationId: mongoEval(`db.organizations.findOne({ name: "${ORGANIZATION}" }).id`),
        modificationList: [],
        assignmentObject: {},
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();

    expect(seed()).toContain(`${ONLINE} (form): applications`);
    expect(marketsNamed(ONLINE)).toBe(1);
  });

  test('a vendor can apply to the online market', async ({ page }) => {
    const vendor = 'seeded-market-vendor@example.com';
    const code = '975310';
    const firstDate = mongoEval(
      `db.markets.findOne({ name: ${JSON.stringify(ONLINE)} }).setupObject.marketDates[0].date`,
    );
    const slug = marketNameToSlug(ONLINE);

    const login = new ApplicantLoginPage(page);
    await page.goto(`/${slug}/applicant-login?redirect=apply`);
    await login.requestCode(vendor);
    createApplicantLoginChallenge(marketId(ONLINE), vendor, code);
    await login.enterCode(code);

    const apply = new ApplyPage(page);
    await page.waitForURL(new RegExp(`/${slug}/apply`));
    await expect(apply.form).toBeVisible({ timeout: 30000 });
    await apply.fullNameInput.fill('Test Vendor');
    await apply.tierCheckbox(firstDate, 'Gold').check();
    await apply.maxDatesInput.fill('1');
    await apply.tableChoiceRadio('full').check();
    await apply.fillField('business_name', 'Test Stall');
    await apply.fillField('product_type', 'Test goods');
    await apply.submit();

    await page.waitForURL(new RegExp(`/${slug}/applicant/dashboard`));
    await expect(page.getByTestId('applicant-dashboard-status')).toContainText('Submitted');
  });
});
