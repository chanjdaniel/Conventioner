import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { LoginPage } from './pages/LoginPage';
import { settle } from './helpers/settle';
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

/**
 * What axe checks: every WCAG 2.0, 2.1 and 2.2 rule at levels A and AA (axe tags no 2.2 rule at A).
 *
 * `color-contrast` is off because `contrast-sweep.spec.ts` owns contrast, measuring every text node
 * on the ground it is composited onto, so one defect fails one check rather than two. The two
 * `main` landmark rules are axe best practices, not WCAG, and are on because the app shell keeps
 * exactly one `<main>` on every route.
 */
const AXE_OPTIONS = {
  runOnly: {
    type: 'tag' as const,
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  },
  rules: {
    'color-contrast': { enabled: false },
    'landmark-one-main': { enabled: true },
    'landmark-no-duplicate-main': { enabled: true },
  },
};

/**
 * Fails on any violation axe finds on the page as it stands, one line per element:
 * `rule (impact) target`, never the whole result, so a failure reads as what to fix and where.
 */
async function expectAccessible(page: Page, state: string): Promise<void> {
  await settle(page);
  const { violations } = await new AxeBuilder({ page }).options(AXE_OPTIONS).analyze();
  expect(
    violations.flatMap((v) =>
      v.nodes.map((node) => `${v.id} (${v.impact}) ${node.target.join(' ')}`),
    ),
    `${state} has accessibility violations`,
  ).toEqual([]);
}

export const test = base.extend<{
  authenticatedPage: Page;
  expectAccessible: (state: string) => Promise<void>;
}>({
  page: async ({ page }, use, testInfo) => {
    // The dev server ships vite-plugin-vue-devtools, whose floating panel overlays the app and
    // intercepts clicks aimed at it. It is a developer tool, not the app, so the tests hide it
    // rather than race its button for the corner it hovers over.
    await page.addInitScript(() => {
      const inject = () => {
        const style = document.createElement('style');
        style.textContent = '#__vue-devtools-container__ { display: none !important; }';
        document.head.appendChild(style);
      };
      if (document.head) inject();
      else document.addEventListener('DOMContentLoaded', inject, { once: true });
    });
    await withBrowserDiagnostics(page, use, testInfo);
  },
  authenticatedPage: async ({ page }, use) => {
    await login(page, TEST_USER.email, TEST_USER.password);
    await use(page);
  },
  expectAccessible: async ({ page }, use) => {
    await use((state) => expectAccessible(page, state));
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
