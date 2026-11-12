import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, NewMarketPage, OrganizationsPage } from './fixtures';
import { loginViaApi } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ManageMarketPage } from './pages/ManageMarketPage';

/**
 * The organization's default table, copied into each new market (E39/F02/S01).
 *
 * An admin of the organization raises "Check vendors in" to Admin in Manage organization, after a
 * confirmation saying it reaches only markets created from now on. A market the owner creates
 * afterwards starts with that row at Admin, marked as copied; the market created before keeps
 * Editor until its owner copies the organization's defaults again. A member reads the default and
 * changes nothing. The rows open in a dialog over Manage organization (T217).
 */
test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'e2e-org-default-admin@example.com', password: 'e2epassword123' };
const MEMBER = { email: 'e2e-org-default-member@example.com', password: 'e2epassword123' };

const RUN = Date.now();
const ORG_NAME = `E2E Default Org ${RUN}`;
const OLDER_MARKET = `E2E Default Older ${RUN}`;
const NEWER_MARKET = `E2E Default Newer ${RUN}`;

let orgId = '';

async function ok(response: Awaited<ReturnType<APIRequestContext['post']>>) {
  expect(response.ok(), await response.text()).toBeTruthy();
}

test.beforeAll(async ({ request }) => {
  ensureVerifiedUser(ADMIN.email, ADMIN.password);
  ensureVerifiedUser(MEMBER.email, MEMBER.password);
  await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  await ok(await request.post(`${BACKEND_URL}/organizations`, { data: { name: ORG_NAME } }));
  const listed = await request.get(`${BACKEND_URL}/organizations`);
  const { organizations } = (await listed.json()) as {
    organizations: Array<{ id: string; name: string }>;
  };
  orgId = organizations.find((org) => org.name === ORG_NAME)!.id;
  await ok(
    await request.post(`${BACKEND_URL}/organizations/${orgId}/admins`, {
      data: { user_email: ADMIN.email },
    }),
  );
  await ok(
    await request.post(`${BACKEND_URL}/organizations/${orgId}/members`, {
      data: { user_email: MEMBER.email },
    }),
  );
  // The market created before the default changes.
  await ok(
    await request.post(`${BACKEND_URL}/markets`, {
      data: {
        name: OLDER_MARKET,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
      },
    }),
  );
});

async function openManage(page: Page): Promise<OrganizationsPage> {
  const orgs = new OrganizationsPage(page);
  await orgs.goto();
  await orgs.waitForLoaded();
  await (await orgs.findCard(ORG_NAME)).getByTestId('organizations-manage-button').click();
  await orgs.waitForManageOverlay();
  await expect(orgs.defaultsSummary).toBeVisible();
  return orgs;
}

async function openOrganization(page: Page): Promise<OrganizationsPage> {
  const orgs = await openManage(page);
  await orgs.showDefaults();
  return orgs;
}

async function openMarketPermissions(page: Page, name: string): Promise<ManageMarketPage> {
  await page.goto(`/markets?q=${encodeURIComponent(name)}`);
  await page.getByTestId('market-card-manage-button').click();
  const manage = new ManageMarketPage(page);
  await manage.waitForOverlay();
  await manage.showPermissions();
  return manage;
}

test("an organization admin raises check-in to Admin for the organization's new markets", async ({
  browser,
}) => {
  await withUser(browser, ADMIN.email, ADMIN.password, async (page) => {
    const orgs = await openOrganization(page);
    await expect(orgs.defaultsReadOnly).toHaveCount(0);
    await expect(orgs.defaultSource('check-in')).toHaveText('Built-in default');
    await expect(orgs.defaultSelect('check-in')).toHaveAccessibleName('Check vendors in');
    await expect(orgs.defaultRow('manage-editors-and-viewers')).toContainText(
      'any Viewer can make themself an Editor',
    );

    await orgs.chooseDefault('check-in', 'admin');
    await expect(orgs.defaultConfirm).toContainText('Change “Check vendors in” for new markets?');
    await expect(orgs.defaultConfirm).toContainText(
      'Markets created from now on start with this. The markets it already holds keep their own.',
    );
    await orgs.confirmDefault();
    await expect(orgs.defaultConfirm).toHaveCount(0);
    await expect(orgs.defaultSelect('check-in')).toHaveValue('admin');
    await expect(orgs.defaultSource('check-in')).toContainText(
      `Set for this organization by ${ADMIN.email}`,
    );

    // Listed in the dialog, and in the organization's History: who, when, before and after.
    const change = orgs.defaultChanges.first();
    await expect(change).toContainText('Check vendors in');
    await expect(change).toContainText('Editor to Admin');
    await expect(change).toContainText(ADMIN.email);
    await expect(change).toContainText(String(new Date().getFullYear()));
    await orgs.defaultsClose.click();
    await orgs.openHistory();
    await expect(orgs.historySentences.first()).toHaveText(
      `${ADMIN.email} changed Check vendors in for new markets from Editor to Admin`,
    );
  });
});

test('a member reads the default and changes nothing', async ({ browser }) => {
  await withUser(browser, MEMBER.email, MEMBER.password, async (page) => {
    const orgs = await openOrganization(page);
    await expect(orgs.defaultsReadOnly).toHaveText(
      "Only the organization's owner and its admins change these.",
    );
    await expect(orgs.defaultSelects).toHaveCount(0);
    await expect(orgs.defaultRole('check-in')).toHaveText('Admin and above');
    await expect(orgs.defaultChanges.first()).toContainText('Editor to Admin');
    await expect(orgs.defaultsWindow.locator('footer')).toHaveCount(0);

    // With no control to focus, the keys scroll the body.
    await expect(orgs.defaultsBody).toBeFocused();
    const scrollTop = () => orgs.defaultsBody.evaluate((box) => box.scrollTop);
    await page.keyboard.press('ArrowDown');
    await expect.poll(scrollTop).toBeGreaterThan(0);
  });
});

test('a member opens it a second time where the first opened', async ({ browser }) => {
  await withUser(browser, MEMBER.email, MEMBER.password, async (page) => {
    // More changes than a page of them, so that the dialog draws their box with more to come.
    await page.route(`**/organizations/${orgId}/default-permission-history`, (route) =>
      route.fulfill({
        json: {
          entries: Array.from({ length: 30 }, (_, n) => ({
            id: `entry-${n}`,
            actor: 'owner@example.com',
            at: '2026-11-05T10:00:00+00:00',
            action: 'change-organization-default',
            kind: 'permission_set',
            subject: { action: 'check-in' },
            detail: {
              before: { role: 'editor', source: 'built-in' },
              after: { role: 'admin', source: 'organization' },
            },
          })),
        },
      }),
    );
    const orgs = await openOrganization(page);
    await expect(orgs.defaultChangesBox).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(orgs.defaultsBody).toHaveCount(0);

    await orgs.showDefaults();

    await expect(orgs.defaultChangesBox).toBeVisible();
    await expect(orgs.defaultsBody).toBeFocused();
    expect(await orgs.defaultsBody.evaluate((box) => box.scrollTop)).toBe(0);
    await expect(orgs.defaultsReadOnly).toBeInViewport();
  });
});

test('a market created afterwards starts with the row copied, and one created before keeps Editor', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/markets');
  await page.getByTestId('markets-create-button').click();
  const newMarket = new NewMarketPage(page);
  await newMarket.waitForOverlay();
  await newMarket.orgSelect.and(page.locator(':enabled')).waitFor();
  await newMarket.orgSelect.selectOption({ label: ORG_NAME });
  await newMarket.fillMarketName(NEWER_MARKET);
  await newMarket.choosePath('form');
  await newMarket.clickSubmit();
  await newMarket.waitForSetupRedirect();

  const newer = await openMarketPermissions(page, NEWER_MARKET);
  await expect(newer.permissionSelect('check-in')).toHaveValue('admin');
  await expect(newer.permissionSource('check-in')).toHaveText('Copied from the organization');
  await expect(newer.permissionsSummary).toContainText('1 row differs');

  const older = await openMarketPermissions(page, OLDER_MARKET);
  await expect(older.permissionSelect('check-in')).toHaveValue('editor');
  await expect(older.permissionSource('check-in')).toHaveText('Built-in default');
});

test("the older market's owner copies the organization's defaults again", async ({
  authenticatedPage: page,
}) => {
  const older = await openMarketPermissions(page, OLDER_MARKET);

  await older.copyOrganizationDefaults();
  await expect(older.copyConfirm).toContainText("Copy the organization's defaults again?");
  await expect(older.copyConfirm).toContainText('Rows changed on this market are replaced.');
  await older.confirmCopy();
  await expect(older.copyConfirm).toHaveCount(0);

  await expect(older.permissionSelect('check-in')).toHaveValue('admin');
  await expect(older.permissionSource('check-in')).toHaveText('Copied from the organization');
  const change = older.permissionChanges.first();
  await expect(change).toContainText("Copied the organization's defaults");
  await expect(change).toContainText('Check vendors in: Editor to Admin');
  await expect(change).toContainText(TEST_USER.email);
});

test.describe('a section, and a dialog over Manage organization', () => {
  test('Manage organization keeps its length, and the dialog is at most 80% of the window', async ({
    authenticatedPage: page,
  }) => {
    const orgs = await openManage(page);
    const scrolled = page.getByTestId('manage-org-body');
    const before = await scrolled.evaluate((box) => box.scrollHeight);
    await expect(orgs.defaultsOpen).not.toHaveAttribute('aria-expanded');
    await expect(orgs.defaultsOpen).toHaveAccessibleName('Show default permissions');
    await expect(orgs.defaultsOpen.locator('.visually-hidden')).toHaveText('default permissions');
    await expect(orgs.defaultSelects).toHaveCount(0);

    await orgs.showDefaults();
    await expect(orgs.defaultSelects.first()).toBeVisible();
    expect(await scrolled.evaluate((box) => box.scrollHeight)).toBe(before);

    const frame = (await orgs.defaultsWindow.boundingBox())!;
    expect(frame.height).toBeLessThanOrEqual(900 * 0.8 + 1);
    expect(frame.width).toBeCloseTo(608, 0);
    expect(await orgs.defaultsBody.evaluate((box) => box.scrollHeight > box.clientHeight)).toBe(
      true,
    );

    // Its title and its foot stay as the body scrolls beneath them.
    const title = orgs.defaultsWindow.getByRole('heading', {
      name: 'Default permissions for new markets',
    });
    const titleTop = (await title.boundingBox())!.y;
    const footTop = (await orgs.defaultsReset.boundingBox())!.y;
    await expect(page.getByTestId('manage-org-permissions-shade-top')).toHaveCount(0);
    await orgs.defaultsBody.evaluate((box) => box.scrollTo(0, box.scrollHeight));
    await expect(page.getByTestId('manage-org-permissions-shade-top')).toBeVisible();
    await expect(page.getByTestId('manage-org-permissions-shade-bottom')).toHaveCount(0);
    expect((await title.boundingBox())!.y).toBe(titleTop);
    expect((await orgs.defaultsReset.boundingBox())!.y).toBe(footTop);
  });

  test('a row asks first over the dialog, and Escape, Cancel and the backdrop close only that', async ({
    authenticatedPage: page,
  }) => {
    const orgs = await openOrganization(page);
    const value = await orgs.defaultSelect('check-in').inputValue();
    const other = value === 'admin' ? 'editor' : 'admin';

    for (const close of [
      () => page.keyboard.press('Escape'),
      () => page.getByTestId('manage-org-permission-confirm-cancel-button').click(),
      // Its corner, where no window lies over it.
      () =>
        page
          .getByTestId('manage-org-permission-confirm-background')
          .click({ position: { x: 4, y: 4 } }),
    ]) {
      await orgs.chooseDefault('check-in', other);
      await expect(orgs.defaultConfirm).toBeVisible();
      // Above the dialog that asked, and taking the press there.
      const box = (await orgs.defaultConfirm.boundingBox())!;
      expect(
        await page.evaluate(
          ([x, y]) =>
            !!document
              .elementFromPoint(x, y)
              ?.closest('[data-testid="manage-org-permission-confirm-window"]'),
          [box.x + box.width / 2, box.y + box.height / 2],
        ),
      ).toBe(true);
      await close();
      await expect(orgs.defaultConfirm).toHaveCount(0);
      await expect(orgs.defaultsWindow).toBeVisible();
      await expect(orgs.defaultSelect('check-in')).toHaveValue(value);
      await expect(orgs.defaultSelect('check-in')).toBeFocused();
    }
  });

  test('closing gives focus back to its button, with Manage organization where it was, whichever way', async ({
    authenticatedPage: page,
  }) => {
    const orgs = await openManage(page);
    const body = page.getByTestId('manage-org-body');
    await orgs.defaultsOpen.scrollIntoViewIfNeeded();
    await body.evaluate((box) => box.scrollBy(0, 40));
    const scrolledTo = await body.evaluate((box) => box.scrollTop);
    expect(scrolledTo, 'Manage organization has somewhere to hold').toBeGreaterThan(0);

    for (const close of [
      () => page.keyboard.press('Escape'),
      () => orgs.defaultsClose.click(),
      () =>
        page.getByTestId('manage-org-permissions-background').click({ position: { x: 4, y: 4 } }),
    ]) {
      await orgs.defaultsOpen.focus();
      await orgs.showDefaults();
      await close();
      await expect(orgs.defaultsWindow).toHaveCount(0);
      await expect(orgs.manageWindow).toBeVisible();
      await expect(orgs.defaultsOpen).toBeFocused();
      expect(await body.evaluate((box) => box.scrollTop)).toBe(scrolledTo);
    }
  });

  for (const { name, use } of [
    {
      name: 'on a phone',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
    { name: 'in a window split short', use: { viewport: { width: 1280, height: 600 } } },
  ]) {
    test.describe(name, () => {
      test.use(use);

      test('the dialog is the window less the gutter, its foot in view', async ({
        authenticatedPage: page,
      }) => {
        const orgs = await openOrganization(page);
        const windowHeight = page.viewportSize()!.height;
        const frame = (await orgs.defaultsWindow.boundingBox())!;
        expect(frame.height).toBeCloseTo(windowHeight - 48, 0);
        expect(frame.y + frame.height).toBeLessThanOrEqual(windowHeight);
        await expect(orgs.defaultsReset).toBeInViewport({ ratio: 1 });
      });
    });
  }

  // Last, since it takes the row the older tests set back.
  test('a reset asks first, saying what it reaches, and leaves focus inside the dialog', async ({
    authenticatedPage: page,
  }) => {
    const orgs = await openOrganization(page);
    await expect(orgs.defaultsSummary).toContainText('1 row differs');
    await orgs.defaultsReset.focus();
    await orgs.defaultsReset.click();
    await expect(orgs.defaultsResetConfirm).toContainText(
      'Check vendors in: Admin and above to Editor and above',
    );
    await expect(orgs.defaultsResetConfirm).toContainText(
      'Markets created from now on start with this. The markets it already holds keep their own.',
    );

    await page.keyboard.press('Escape');
    await expect(orgs.defaultsResetConfirm).toHaveCount(0);
    await expect(orgs.defaultsWindow).toBeVisible();
    await expect(orgs.defaultsReset).toBeFocused();

    await orgs.defaultsReset.click();
    await page.getByTestId('manage-org-permissions-reset-confirm-submit-button').click();
    await expect(orgs.defaultsResetConfirm).toHaveCount(0);

    await expect(orgs.defaultSelect('check-in')).toHaveValue('editor');
    await expect(orgs.defaultsSummary).toContainText('Every row is at its built-in default.');
    await expect(orgs.defaultsReset).toBeDisabled();
    // Not on <body>: the disabled button cannot take focus back, so the dialog's first control does.
    await expect(orgs.defaultsWindow).toBeVisible();
    await expect(orgs.defaultSelects.first()).toBeFocused();

    await orgs.defaultsClose.click();
    await expect(orgs.defaultsOpen).toBeFocused();
  });
});
