import type { Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketScreenPath } from './helpers/marketScreens';
import { transitionMarket } from './helpers/seedPhaseMarket';
import { SEED_MARKET_DATE, seedPublishedMarketWithAssignments } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ManageMarketPage } from './pages/ManageMarketPage';

/**
 * The Permissions section in Manage market (E39/F01/S04), and its dialog (T217).
 *
 * The market's table of who may do what was the server's alone, changed only through its routes.
 * The owner now sets each row in a dialog over Manage market, after a confirmation naming who may
 * after it, and resets them all; everyone who reads the market reads the table and every change to
 * it, with the owner-only line. A change reaches every screen at its next read of the market.
 */
const PEOPLE = {
  admin: { email: 'e2e-perms-admin@example.com', password: 'e2epassword123' },
  editor: { email: 'e2e-perms-editor@example.com', password: 'e2epassword123' },
  viewer: { email: 'e2e-perms-viewer@example.com', password: 'e2epassword123' },
} as const;

let marketId = '';
let marketName = '';

test.beforeAll(async ({ request }) => {
  for (const person of Object.values(PEOPLE)) ensureVerifiedUser(person.email, person.password);
  // A market on its day, so Attendance offers check-in to whoever may.
  ({ marketId, marketName } = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  ));
  for (const [role, person] of Object.entries(PEOPLE)) {
    const res = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
      data: { user_email: person.email, role },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
});

async function openManage(page: Page): Promise<ManageMarketPage> {
  await page.goto(`/markets?q=${encodeURIComponent(marketName)}`);
  await page.getByTestId('market-card-manage-button').click();
  const manage = new ManageMarketPage(page);
  await manage.waitForOverlay();
  await expect(manage.permissionsSummary).toBeVisible();
  return manage;
}

/** More changes than a page of them, so that the dialog draws their box with more to come. */
async function routeManyChanges(page: Page): Promise<void> {
  await page.route(`**/markets/${marketId}/permission-history`, (route) =>
    route.fulfill({
      json: {
        entries: Array.from({ length: 30 }, (_, n) => ({
          id: `entry-${n}`,
          actor: 'owner@example.com',
          at: '2026-11-05T10:00:00+00:00',
          action: 'change-the-table',
          kind: 'permission_set',
          subject: { action: 'check-in' },
          detail: {
            before: { role: 'editor', source: 'built-in' },
            after: { role: 'admin', source: 'market' },
          },
        })),
      },
    }),
  );
}

async function openPermissions(page: Page): Promise<ManageMarketPage> {
  const manage = await openManage(page);
  await manage.showPermissions();
  return manage;
}

test.describe.configure({ mode: 'serial' });

test('the owner raises check-in to Admin, and an Editor is offered it nowhere', async ({
  authenticatedPage: page,
  browser,
  playwright,
}) => {
  const manage = await openPermissions(page);
  await expect(manage.permissionsReadOnly).toHaveCount(0);
  await expect(manage.permissionSource('check-in')).toHaveText('Built-in default');
  // Named by the row's own words.
  await expect(manage.permissionSelect('check-in')).toHaveAccessibleName('Check vendors in');
  await expect(manage.permissionSelect('check-in')).toHaveValue('editor');

  // Escape closes the confirmation alone, and gives focus back to the row's select.
  await manage.choosePermission('check-in', 'admin');
  await expect(manage.permissionConfirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(manage.permissionConfirm).toHaveCount(0);
  await expect(manage.permissionsWindow).toBeVisible();
  await expect(manage.window).toBeVisible();
  await expect(manage.permissionSelect('check-in')).toBeFocused();
  await expect(manage.permissionSelect('check-in')).toHaveValue('editor');

  // Cancelling the confirmation leaves the row as it was.
  await manage.choosePermission('check-in', 'admin');
  await expect(manage.permissionConfirm).toContainText(
    'Let only Admins and the owner check vendors in at this market?',
  );
  await expect(manage.permissionConfirm).toContainText('Editors lose this.');
  await manage.cancelPermission();
  await expect(manage.permissionConfirm).toHaveCount(0);
  await expect(manage.permissionSelect('check-in')).toHaveValue('editor');

  await manage.choosePermission('check-in', 'admin');
  await manage.confirmPermission();
  await expect(manage.permissionConfirm).toHaveCount(0);
  // The write leaves the dialog open.
  await expect(manage.permissionsWindow).toBeVisible();
  await expect(manage.permissionSelect('check-in')).toHaveValue('admin');
  await expect(manage.permissionSource('check-in')).toContainText(
    `Changed on this market by ${TEST_USER.email}`,
  );

  // Under Changes: who, when, the row, before and after.
  const change = manage.permissionChanges.first();
  await expect(change).toContainText('Check vendors in');
  await expect(change).toContainText('Editor to Admin');
  await expect(change).toContainText(TEST_USER.email);
  await expect(change).toContainText(String(new Date().getFullYear()));

  // An Editor's Attendance offers no check-in, and the server refuses one.
  await withUser(browser, PEOPLE.editor.email, PEOPLE.editor.password, async (editorPage) => {
    await editorPage.goto(marketScreenPath(marketId, 'attendance'));
    await expect(editorPage.getByTestId('attendance-row').first()).toBeVisible({ timeout: 15000 });
    await expect(editorPage.getByTestId('attendance-check-in')).toHaveCount(0);
  });
  const editorApi = await playwright.request.newContext({
    baseURL: BACKEND_URL,
    ignoreHTTPSErrors: true,
  });
  try {
    await editorApi.post('/login', { data: PEOPLE.editor });
    const refused = await editorApi.post(`/markets/${marketId}/attendance`, {
      data: { vendorEmail: 'ana@example.com', date: SEED_MARKET_DATE },
    });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).error).toBe(
      'Only an Admin or the owner may check vendors in at this market.',
    );
  } finally {
    await editorApi.dispose();
  }
});

test('an Admin and a Viewer read the dialog and its changes, and change nothing', async ({
  browser,
}) => {
  for (const person of [PEOPLE.admin, PEOPLE.viewer]) {
    await withUser(browser, person.email, person.password, async (page) => {
      const manage = await openPermissions(page);
      await expect(manage.permissionsReadOnly).toHaveText("Only the market's owner changes these.");
      await expect(manage.permissionSelects).toHaveCount(0);
      await expect(manage.permissionsReset).toHaveCount(0);
      await expect(manage.permissionsWindow.locator('footer')).toHaveCount(0);
      await expect(manage.permissionRole('check-in')).toHaveText('Admin and above');
      await expect(manage.permissionChanges.first()).toContainText('Editor to Admin');
    });
  }
});

test('a fixed row shows its role and Always, with no control', async ({
  authenticatedPage: page,
}) => {
  const manage = await openPermissions(page);
  for (const id of ['read', 'manage-admins', 'delete-market', 'change-the-table']) {
    await expect(manage.permissionSelect(id)).toHaveCount(0);
    await expect(manage.permissionSource(id)).toHaveText('Always');
  }
  await expect(manage.permissionRole('delete-market')).toHaveText('Owner only');
});

test('the owner resets every row to its built-in default, and the reset is recorded', async ({
  authenticatedPage: page,
}) => {
  const manage = await openPermissions(page);
  await expect(manage.permissionsSummary).toContainText(
    '1 row differs from the built-in defaults.',
  );
  await manage.permissionsReset.focus();
  await manage.resetPermissions();
  await expect(page.getByTestId('manage-market-permissions-reset-confirm-body')).toBeVisible();
  await expect(manage.resetConfirm).toContainText(
    'Check vendors in: Admin and above to Editor and above',
  );
  await manage.confirmReset();
  await expect(manage.resetConfirm).toHaveCount(0);

  await expect(manage.permissionSelect('check-in')).toHaveValue('editor');
  await expect(manage.permissionSources.first()).toBeVisible();
  for (const source of await manage.permissionSources.all()) {
    await expect(source).toHaveText(/^(Built-in default|Always)$/);
  }
  await expect(manage.permissionsReset).toBeDisabled();
  // Not on <body>: the disabled button cannot take focus back, so the dialog's first control does.
  await expect(manage.permissionsWindow).toBeVisible();
  await expect(manage.permissionSelects.first()).toBeFocused();
  const reset = manage.permissionChanges.first();
  await expect(reset).toContainText('Reset to built-in defaults');
  await expect(reset).toContainText('Check vendors in: Admin to Editor');
  await expect(reset).toContainText(TEST_USER.email);
});

const ON_A_PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
};

/** The window's edges, and what the body holds against what it shows. */
function shape(manage: ManageMarketPage) {
  return manage.permissionsBody.evaluate((body) => {
    const frame = body.closest('[role="dialog"]')!.getBoundingClientRect();
    return {
      top: frame.top,
      bottom: frame.bottom,
      height: frame.height,
      width: frame.width,
      windowHeight: window.innerHeight,
      scrolls: body.scrollHeight > body.clientHeight,
    };
  });
}

test.describe('a section, and a dialog over Manage market', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Manage market keeps its length, and the dialog is at most 80% of the window', async ({
    authenticatedPage: page,
  }) => {
    const manage = await openManage(page);
    const scrolled = page.getByTestId('manage-market-scrolled');
    const before = await scrolled.evaluate((box) => box.scrollHeight);
    await expect(manage.permissionsOpen).not.toHaveAttribute('aria-expanded');
    await expect(manage.permissionsOpen).toHaveAccessibleName('Show permissions');
    await expect(manage.permissionsOpen.locator('.visually-hidden')).toHaveText('permissions');
    await expect(manage.permissionSelects).toHaveCount(0);

    await manage.showPermissions();
    await expect(manage.permissionSources.first()).toBeVisible();
    expect(await scrolled.evaluate((box) => box.scrollHeight)).toBe(before);

    const dialog = await shape(manage);
    expect(dialog.height).toBeLessThanOrEqual(dialog.windowHeight * 0.8 + 1);
    expect(dialog.width).toBeCloseTo(608, 0);
    expect(dialog.scrolls, 'the rows outgrow it').toBe(true);

    // Its title and its foot stay as the body scrolls beneath them.
    const title = page.getByRole('heading', { name: 'Permissions', exact: true }).last();
    const titleTop = (await title.boundingBox())!.y;
    const footTop = (await manage.permissionsReset.boundingBox())!.y;
    await expect(page.getByTestId('manage-market-permissions-shade-top')).toHaveCount(0);
    await manage.permissionsBody.evaluate((body) => body.scrollTo(0, body.scrollHeight));
    await expect(page.getByTestId('manage-market-permissions-shade-top')).toBeVisible();
    await expect(page.getByTestId('manage-market-permissions-shade-bottom')).toHaveCount(0);
    expect((await title.boundingBox())!.y).toBe(titleTop);
    expect((await manage.permissionsReset.boundingBox())!.y).toBe(footTop);
  });

  test('a row asks first over the dialog, and Escape, Cancel and the backdrop close only that', async ({
    authenticatedPage: page,
  }) => {
    const manage = await openPermissions(page);
    const backdrop = page.getByTestId('manage-market-permission-confirm-background');
    const value = await manage.permissionSelect('check-in').inputValue();
    const other = value === 'admin' ? 'editor' : 'admin';

    for (const close of [
      () => page.keyboard.press('Escape'),
      () => manage.cancelPermission(),
      // Its corner, where no window lies over it.
      () => backdrop.click({ position: { x: 4, y: 4 } }),
    ]) {
      await manage.choosePermission('check-in', other);
      await expect(manage.permissionConfirm).toBeVisible();
      // Above the dialog that asked, and taking the press there.
      const box = (await manage.permissionConfirm.boundingBox())!;
      expect(
        await page.evaluate(
          ([x, y]) =>
            !!document
              .elementFromPoint(x, y)
              ?.closest('[data-testid="manage-market-permission-confirm-window"]'),
          [box.x + box.width / 2, box.y + box.height / 2],
        ),
      ).toBe(true);
      await close();
      await expect(manage.permissionConfirm).toHaveCount(0);
      await expect(manage.permissionsWindow).toBeVisible();
      await expect(manage.permissionSelect('check-in')).toHaveValue(value);
      await expect(manage.permissionSelect('check-in')).toBeFocused();
    }
  });

  test('closing gives focus back to its button, with Manage market where it was, whichever way', async ({
    authenticatedPage: page,
  }) => {
    const manage = await openManage(page);
    const body = page.getByTestId('manage-market-body');
    await manage.permissionsOpen.scrollIntoViewIfNeeded();
    await body.evaluate((box) => box.scrollBy(0, 40));
    const scrolledTo = await body.evaluate((box) => box.scrollTop);
    expect(scrolledTo, 'Manage market has somewhere to hold').toBeGreaterThan(0);

    for (const close of [
      () => page.keyboard.press('Escape'),
      () => manage.permissionsClose.click(),
      () =>
        page
          .getByTestId('manage-market-permissions-background')
          .click({ position: { x: 4, y: 4 } }),
    ]) {
      await manage.permissionsOpen.focus();
      await manage.showPermissions();
      await close();
      await expect(manage.permissionsWindow).toHaveCount(0);
      await expect(manage.window).toBeVisible();
      await expect(manage.permissionsOpen).toBeFocused();
      expect(await body.evaluate((box) => box.scrollTop)).toBe(scrolledTo);
    }
  });

  test('someone who may only read scrolls it by the keys, and changes arriving take nothing from that', async ({
    browser,
  }) => {
    await withUser(browser, PEOPLE.viewer.email, PEOPLE.viewer.password, async (page) => {
      // More changes than a page, so their box arrives after the dialog has placed its focus.
      await routeManyChanges(page);
      const manage = await openPermissions(page);
      await expect(manage.permissionChangesBox).toBeVisible();
      await expect(manage.permissionsBody).toBeFocused();

      const scrollTop = () => manage.permissionsBody.evaluate((box) => box.scrollTop);
      await page.keyboard.press('ArrowDown');
      await expect.poll(scrollTop).toBeGreaterThan(0);

      // The keys reach the box, and the next changes land with the focus still on it.
      const changes = page.getByTestId('manage-market-permission-change');
      await expect(changes).toHaveCount(25);
      await page.keyboard.press('Tab');
      await expect(manage.permissionChangesBox).toBeFocused();
      await page.keyboard.press('End');
      await expect(changes).toHaveCount(30);
      await expect(manage.permissionChangesBox).toBeFocused();
    });
  });

  test('someone who may only read opens it a second time where the first opened', async ({
    browser,
  }) => {
    await withUser(browser, PEOPLE.viewer.email, PEOPLE.viewer.password, async (page) => {
      await routeManyChanges(page);
      const manage = await openPermissions(page);
      await expect(manage.permissionChangesBox).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(manage.permissionsBody).toHaveCount(0);

      await manage.showPermissions();

      await expect(manage.permissionChangesBox).toBeVisible();
      await expect(manage.permissionsBody).toBeFocused();
      expect(await manage.permissionsBody.evaluate((box) => box.scrollTop)).toBe(0);
      await expect(manage.permissionsReadOnly).toBeInViewport();
    });
  });

  test('an archived market reads its own line, and offers nothing to change', async ({
    authenticatedPage: page,
    request,
  }) => {
    const archived = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await transitionMarket(request, BACKEND_URL, TEST_USER.email, archived.marketId, 'archived');
    await page.goto(`/markets?q=${encodeURIComponent(archived.marketName)}`);
    await page.getByTestId('market-card-manage-button').click();
    const manage = new ManageMarketPage(page);
    await manage.waitForOverlay();
    await manage.showPermissions();

    await expect(manage.permissionsReadOnly).toContainText('archived');
    await expect(manage.permissionSources.first()).toBeVisible();
    await expect(manage.permissionSelects).toHaveCount(0);
    await expect(manage.permissionsWindow.locator('footer')).toHaveCount(0);
  });
});

test.describe('on a phone, and in a short window', () => {
  for (const { name, use } of [
    { name: 'a phone', use: ON_A_PHONE },
    { name: 'a window split short', use: { viewport: { width: 1280, height: 600 } } },
  ]) {
    test.describe(name, () => {
      test.use(use);

      test('the dialog is the window less the gutter, its foot in view', async ({
        authenticatedPage: page,
      }) => {
        const manage = await openPermissions(page);
        const dialog = await shape(manage);
        expect(dialog.height).toBeCloseTo(dialog.windowHeight - 48, 0);
        expect(dialog.bottom).toBeLessThanOrEqual(dialog.windowHeight);
        await expect(manage.permissionsReset).toBeInViewport({ ratio: 1 });
      });
    });
  }
});

/**
 * A group's title belongs to its own rows (T211): it stood as far from them as from the group above,
 * so the groups blurred. What a reader sees of the row above is its lowest part, the caption at a
 * desk and the select where a phone wraps it, so that is what the far gap is measured from.
 */
for (const { name, use } of [
  { name: 'at a desk', use: { viewport: { width: 1280, height: 800 } } },
  { name: 'on a phone', use: ON_A_PHONE },
]) {
  test.describe(name, () => {
    test.use(use);

    test("a group's title sits at most half as far from its rows as from the group above", async ({
      authenticatedPage: page,
    }) => {
      const manage = await openPermissions(page);
      const edges = await manage.permissionGroupEdges();
      expect(edges.length, 'a table of several groups').toBeGreaterThan(1);
      for (const [index, group] of edges.entries()) {
        if (index === 0) continue;
        const toItsRows = group.firstLabelTop - group.titleBottom;
        const fromTheGroupAbove = group.titleTop - edges[index - 1].lastRowBottom;
        expect(toItsRows, `group ${index + 1}, against the group above`).toBeLessThanOrEqual(
          fromTheGroupAbove / 2,
        );
      }
      // The first starts where the body does, its padding beneath the dialog's title.
      await expect(manage.permissionGroupTitles.first()).toHaveCSS('margin-top', '0px');
    });
  });
}

test.describe('a row on a phone', () => {
  test.use(ON_A_PHONE);

  test('it keeps its label above and its select beneath', async ({ authenticatedPage: page }) => {
    const manage = await openPermissions(page);
    const label = (await manage.permissionLabel('check-in').boundingBox())!;
    const select = (await manage.permissionSelect('check-in').boundingBox())!;
    expect(select.y).toBeGreaterThanOrEqual(label.y + label.height);
  });
});
