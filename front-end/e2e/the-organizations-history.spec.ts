import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, LoginPage, OrganizationsPage } from './fixtures';
import { loginViaApi } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { hideDevToolsPanel } from './helpers/hideDevToolsPanel';

/**
 * The organization's own changes, read in Manage organization's History section (E40/F02/S01).
 *
 * The owner adds an admin and renames the organization in Manage organization, as they would;
 * the section reads both back, newest first, each saying who and when, and a member of the
 * organization opens the same History from their own Organizations page. A long history, and a
 * long record of changes to the default, each stand in a box and bring more as their end scrolls
 * into view.
 */
test.use({ viewport: { width: 1440, height: 900 } });

const ADMIN = { email: 'e2e-org-history-admin@example.com', password: 'e2epassword123' };
const MEMBER = { email: 'e2e-org-history-member@example.com', password: 'e2epassword123' };
/** What the server answers at a time, and the list shows at a time. */
const PAGE = 25;
/** Enough that the first page ends before the last of them. */
const CHANGES = PAGE + 5;
/** The box's maximum: `28rem`, at the app's 16px. */
const BOX_MOST = 28 * 16;

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
  await (await orgs.findCard(name)).getByTestId('organizations-manage-button').click();
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
  await hideDevToolsPanel(context);
  const page = await context.newPage();
  const login = new LoginPage(page);
  await login.goto();
  await login.fillEmail(who.email);
  await login.fillPassword(who.password);
  await login.clickSubmit();
  await login.waitForMarkets();
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
    await expect(when).toHaveText(new RegExp(`^${day} at \\d{1,2}:\\d{2}\\s[AP]M$`));
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

test('a long history opens on one page in its box, and the box’s end brings the rest beneath', async ({
  authenticatedPage: page,
  request,
}) => {
  const org = await makeOrganization(request);
  for (let n = 1; n <= CHANGES; n++) {
    await ok(
      await request.put(`${BACKEND_URL}/organizations/${org.id}`, {
        data: { name: `${org.name} ${n}` },
      }),
    );
  }
  const orgs = await openManage(page, `${org.name} ${CHANGES}`);
  await orgs.openHistory();

  await expect(orgs.historySentences).toHaveCount(PAGE);
  const first = await orgs.historySentences.allInnerTexts();
  const height = await orgs.historyBox.evaluate((box) => box.clientHeight);
  expect(height).toBeLessThanOrEqual(BOX_MOST);
  await expect(orgs.historyBoxShadeBottom).toBeVisible();
  await expect(orgs.history).not.toContainText('Load more');

  await orgs.scrollHistoryToEnd();
  await expect(orgs.historySentences).toHaveCount(CHANGES);

  // The rest came beneath the same entries, in order, and the box did not grow to take them.
  const all = await orgs.historySentences.allInnerTexts();
  expect(all.slice(0, PAGE)).toEqual(first);
  expect(all.at(-1)).toBe(
    `${TEST_USER.email} renamed the organization from "${org.name}" to "${org.name} 1"`,
  );
  expect(await orgs.historyBox.evaluate((box) => box.clientHeight)).toBe(height);
  await expect(orgs.historySentinel).toHaveCount(0);

  await orgs.scrollHistoryToEnd();
  await expect(orgs.historyBoxShadeBottom).toHaveCount(0);
});

test('a long record of changes to the default scrolls by the keys alone, a box with no control in it', async ({
  authenticatedPage: page,
  request,
}) => {
  const org = await makeOrganization(request);
  for (let n = 0; n < CHANGES; n++) {
    await ok(
      await request.put(`${BACKEND_URL}/organizations/${org.id}/default-permissions/check-in`, {
        data: { role: n % 2 ? 'editor' : 'admin' },
      }),
    );
  }
  const orgs = await openManage(page, org.name);
  await orgs.showDefaults();

  await expect(orgs.defaultChanges).toHaveCount(PAGE);
  await expect(page.getByRole('region', { name: 'Changes' })).toHaveAttribute('tabindex', '0');
  const height = await orgs.defaultChangesBox.evaluate((box) => box.clientHeight);
  expect(height).toBeLessThanOrEqual(BOX_MOST);

  await orgs.defaultChangesBox.focus();
  await expect(orgs.defaultChangesBox).toBeFocused();
  await expect(async () => {
    await page.keyboard.press('End');
    await expect(orgs.defaultChanges).toHaveCount(CHANGES, { timeout: 250 });
  }).toPass({ timeout: 15_000 });

  await expect(orgs.defaultChangesBox).toBeFocused();
  expect(await orgs.defaultChangesBox.evaluate((box) => box.clientHeight)).toBe(height);
  await expect(orgs.defaultsWindow).not.toContainText('Load more');
});
