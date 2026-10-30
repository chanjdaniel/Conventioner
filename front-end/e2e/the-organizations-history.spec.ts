import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, LoginPage, OrganizationsPage } from './fixtures';
import { loginViaApi } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * The organization's own changes, read in Manage organization's History section (E40/F02/S01).
 *
 * The owner adds an admin and renames the organization in Manage organization, as they would;
 * the section reads both back, newest first, each saying who and when, and a member of the
 * organization opens the same History from their own Organizations page.
 */
test.use({ viewport: { width: 1440, height: 900 } });

const ADMIN = { email: 'e2e-org-history-admin@example.com', password: 'e2epassword123' };
const MEMBER = { email: 'e2e-org-history-member@example.com', password: 'e2epassword123' };

test.beforeAll(() => {
  ensureVerifiedUser(ADMIN.email, ADMIN.password);
  ensureVerifiedUser(MEMBER.email, MEMBER.password);
});

async function ok(response: Awaited<ReturnType<APIRequestContext['post']>>) {
  expect(response.ok(), await response.text()).toBeTruthy();
}

/** A new organization of the test user's, by a name no other run holds, and its id. */
async function makeOrganization(request: APIRequestContext): Promise<{ id: string; name: string }> {
  await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const name = `E2E History Org ${Date.now()}`;
  await ok(await request.post(`${BACKEND_URL}/organizations`, { data: { name } }));
  const listed = await request.get(`${BACKEND_URL}/organizations`);
  const { organizations } = (await listed.json()) as {
    organizations: Array<{ id: string; name: string }>;
  };
  return { id: organizations.find((org) => org.name === name)!.id, name };
}

async function openManage(page: Page, name: string): Promise<OrganizationsPage> {
  const orgs = new OrganizationsPage(page);
  await orgs.goto();
  await orgs.waitForLoaded();
  await page
    .getByTestId('organization-card')
    .filter({ hasText: name })
    .getByTestId('organizations-manage-button')
    .click();
  await orgs.waitForManageOverlay();
  return orgs;
}

/** The day as the History names it, in the browser's own timezone: "Nov 21, 2026". */
function today(page: Page): Promise<string> {
  return page.evaluate(() =>
    new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  );
}

async function signedIn(browser: Browser, who: { email: string; password: string }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const login = new LoginPage(page);
  await login.goto();
  await login.fillEmail(who.email);
  await login.fillPassword(who.password);
  await login.clickSubmit();
  await page.waitForURL('**/dashboard', { timeout: 10000 });
  return { context, page };
}

test('an admin added and the organization renamed each read back with who and when', async ({
  authenticatedPage: page,
  request,
}) => {
  const org = await makeOrganization(request);
  const renamed = `${org.name} Renamed`;
  const me = TEST_USER.email;
  const orgs = await openManage(page, org.name);

  await orgs.addAdmin(ADMIN.email);
  await expect(orgs.adminEmails.filter({ hasText: ADMIN.email })).toBeVisible();
  await orgs.renameOrg(renamed);
  await expect(orgs.manageWindow.getByText(renamed, { exact: true })).toBeVisible();

  // Closed until opened, its heading in sight, so the sections after it stay in reach.
  await expect(orgs.history).toBeVisible();
  await expect(orgs.historySentences).toHaveCount(0);
  await orgs.openHistory();

  await expect(orgs.historySentences).toHaveText([
    `${me} renamed the organization from "${org.name}" to "${renamed}"`,
    `${me} gave ${ADMIN.email} the Admin role`,
  ]);
  const day = await today(page);
  for (const when of await orgs.historyEntries.getByTestId('org-history-when').all()) {
    await expect(when).toHaveText(new RegExp(`^${day} at \\d{1,2}:\\d{2} [AP]M$`));
  }

  const rename = await orgs.openHistoryEntry(0);
  await expect(rename).toContainText('Name');
  await expect(rename).toContainText(org.name);
  await expect(rename).toContainText(renamed);

  // A change made with the History open shows in it, without reopening the dialog.
  await orgs.addMember(MEMBER.email);
  await expect(orgs.historySentences.first()).toHaveText(
    `${me} gave ${MEMBER.email} the Member role`,
  );
  await expect(orgs.historySentences).toHaveCount(3);
});

test('a member opens the organization and reads its History', async ({ browser, request }) => {
  const org = await makeOrganization(request);
  await ok(
    await request.post(`${BACKEND_URL}/organizations/${org.id}/members`, {
      data: { user_email: MEMBER.email },
    }),
  );

  const { context, page } = await signedIn(browser, MEMBER);
  try {
    const orgs = await openManage(page, org.name);

    // A member reads; the people and the controls the owner and admins manage are not theirs.
    await expect(orgs.addMemberButton).toHaveCount(0);
    await expect(orgs.renameInput).toHaveCount(0);
    await orgs.openHistory();
    await expect(orgs.historySentences).toHaveText([
      `${TEST_USER.email} gave ${MEMBER.email} the Member role`,
    ]);
  } finally {
    await context.close();
  }
});
