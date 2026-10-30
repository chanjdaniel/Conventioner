import { test, expect, TEST_USER, BACKEND_URL, ApplicantLoginPage } from './fixtures';
import type { Browser, Page } from '@playwright/test';
import { ApplyPage } from './pages/ApplyPage';
import { marketSetupPath, oneByOnePath } from './helpers/marketScreens';
import {
  createApplicantLoginChallenge,
  planSetupObject,
  seedApplicantMarket,
} from './helpers/seedApplicantMarket';

/**
 * An organizer stops taking applications, and takes them again, inside the Applications phase
 * (E38/F04/S02).
 *
 * Stopping is a fact about the market's application page, not a phase: from the rail's More…, the
 * page then refuses a new application with the words a closed market used, and reviewing goes on;
 * "Take applications again" opens it, and the market never left Applications.
 */
const DATE = '2099-08-01';
const VENDOR = 'late-vendor@example.com';
const CODE = '135790';

/** The vendor, in a browser of their own, signed in and on the apply page. */
async function vendorOnTheApplyPage(browser: Browser, marketId: string, slug: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const login = new ApplicantLoginPage(page);
  await page.goto(`/${slug}/applicant-login?redirect=apply`);
  await login.requestCode(VENDOR);
  await expect(login.codeInput).toBeVisible();
  createApplicantLoginChallenge(marketId, VENDOR, CODE);
  await login.enterCode(CODE);
  await page.waitForURL(new RegExp(`/${slug}/apply`));
  return { context, page };
}

async function chooseFromTheMenu(page: Page, action: string): Promise<void> {
  await page.getByTestId('phase-rail-menu-button').click();
  await page.getByTestId(`phase-rail-action-${action}`).click();
}

test('an organizer stops taking applications, a vendor is refused, and taking them resumes', async ({
  authenticatedPage: page,
  browser,
  request,
}) => {
  const market = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject([DATE]) },
  );
  await page.goto(marketSetupPath(market.marketId, 'applications'));
  await expect(page.getByTestId('phase-rail-current')).toHaveText('Applications', {
    timeout: 15000,
  });

  // Stopped from the rail's menu: the market stays in Applications, and says what is so.
  await chooseFromTheMenu(page, 'stop-applications');
  await expect(page.getByTestId('phase-rail-next')).toContainText(
    'Your application page is not taking applications.',
  );
  await expect(page.getByTestId('phase-rail-current')).toHaveText('Applications');
  await expect(page.getByTestId('market-setup-applications-condition')).toContainText(
    'This market is not taking applications.',
  );

  // The vendor meets a closed page, in the words a closed market used, and no form.
  const vendor = await vendorOnTheApplyPage(browser, market.marketId, market.marketSlug);
  const apply = new ApplyPage(vendor.page);
  await expect(vendor.page.getByTestId('apply-closed')).toContainText('Applications Closed', {
    timeout: 30000,
  });
  await expect(apply.form).toHaveCount(0);

  // Taken again, and the page takes them.
  await chooseFromTheMenu(page, 'take-applications');
  await expect(page.getByTestId('phase-rail-next')).toContainText(
    'Applications are open on your application page',
  );
  await page.getByTestId('phase-rail-menu-button').click();
  await expect(page.getByTestId('phase-rail-action-stop-applications')).toBeVisible();
  await page.getByTestId('phase-rail-menu-button').click();

  await vendor.page.reload();
  await expect(apply.form).toBeVisible({ timeout: 30000 });
  await apply.fullNameInput.fill('Lena Late');
  await apply.tierCheckbox(DATE, 'Gold').check();
  await apply.maxDatesInput.fill('1');
  await apply.tableChoiceRadio('full').check();
  await apply.fillField('business_name', 'Late Bloom Prints');
  await apply.fillField('product_type', 'Cards');
  await apply.submit();
  await vendor.page.waitForURL(new RegExp(`/${market.marketSlug}/applicant/dashboard`));
  await expect(vendor.page.getByTestId('applicant-dashboard-status')).toContainText('Submitted');
  await vendor.context.close();

  // And it is reviewed where the market stands, which never moved: One by one, its card up.
  await page.goto(oneByOnePath(market.marketId));
  await expect(page.getByTestId('app-monitor-email')).toHaveText(VENDOR, { timeout: 15000 });
});
