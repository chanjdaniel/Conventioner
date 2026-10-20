import { test as base, type Page, type TestInfo } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { stack } from './helpers/stack';

export const TEST_USER = {
  email: 'e2e@example.com',
  password: 'e2epassword123',
};

/**
 * Verified, and deliberately in no organization - therefore reaching no market. Created by
 * `scripts/seed_fixture.sh` alongside `TEST_USER`, so the zero-market states have a real account
 * to be shown on rather than a mocked one.
 */
export const NO_ORG_USER = {
  email: 'e2e-noorg@example.com',
  password: 'e2enoorg123',
};

export const BACKEND_URL = process.env.BACKEND_URL || stack().backendURL;

async function login(page: Page, email: string, password: string) {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.fillEmail(email);
  await loginPage.fillPassword(password);
  await loginPage.clickSubmit();
  await page.waitForURL('**/dashboard', { timeout: 10000 });
}

/**
 * What the browser said, kept for a test that fails. The suite has twice failed on a page that
 * never painted, with nothing in the stack's logs to say why; a tab can run out of network
 * resources on the dev server's unbundled modules (`net::ERR_INSUFFICIENT_RESOURCES`), its route's
 * chunk then fails to import, and the app mounts with no page. Attached only on failure, so a
 * passing run carries nothing and a failing one names its cause.
 */
async function withBrowserDiagnostics(
  page: Page,
  use: (page: Page) => Promise<void>,
  testInfo: TestInfo,
): Promise<void> {
  const said: string[] = [];
  const at = () => new Date().toISOString();
  page.on('console', (message) => {
    if (message.type() === 'error') said.push(`${at()} console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => said.push(`${at()} pageerror: ${error.message}`));
  page.on('crash', () => said.push(`${at()} the page crashed`));
  page.on('requestfailed', (request) => {
    const why = request.failure()?.errorText ?? '';
    // A navigation cancels what the page it leaves was loading; that is not a failure.
    if (!why.includes('ERR_ABORTED')) {
      said.push(`${at()} requestfailed: ${request.method()} ${request.url()} ${why}`);
    }
  });
  await use(page);
  if (testInfo.status !== testInfo.expectedStatus && said.length) {
    await testInfo.attach('what the browser said', {
      body: said.join('\n'),
      contentType: 'text/plain',
    });
  }
}

export const test = base.extend<{ authenticatedPage: Page }>({
  page: async ({ page }, use, testInfo) => {
    await withBrowserDiagnostics(page, use, testInfo);
  },
  authenticatedPage: async ({ page }, use) => {
    await login(page, TEST_USER.email, TEST_USER.password);
    await use(page);
  },
});

export { expect } from '@playwright/test';
export { LoginPage } from './pages/LoginPage';
export { MarketSetupPage } from './pages/MarketSetupPage';
export { ResultPage } from './pages/ResultPage';
export { NewMarketPage } from './pages/NewMarketPage';
export { CheckinPage } from './pages/CheckinPage';
export { VendorsPage } from './pages/VendorsPage';
export { TablesPage } from './pages/TablesPage';
export { AttendanceStatusPage } from './pages/AttendanceStatusPage';
export { OrganizationsPage } from './pages/OrganizationsPage';
export { ManageMarketPage } from './pages/ManageMarketPage';
export { PasswordResetPage } from './pages/PasswordResetPage';
export { FloorplanWorkflowPage } from './pages/FloorplanWorkflowPage';
export { ApplicationFormPage } from './pages/ApplicationFormPage';
export { ApplicantDashboardPage } from './pages/ApplicantDashboardPage';
export { ApplicantLoginPage } from './pages/ApplicantLoginPage';
export { ApplyPage } from './pages/ApplyPage';
export { CsvImportPage } from './pages/CsvImportPage';
export { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
