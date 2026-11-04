import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ManageMarketPage } from './pages/ManageMarketPage';
import { seedApplicantMarket } from './helpers/seedApplicantMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';

/**
 * Changing a market role asks first, and says what it changes on this market (T211).
 *
 * A slip of a role select in Manage market changed someone's access at once, while Remove and a
 * permission row's change both ask first. Choosing a role now opens a confirmation naming the
 * person, the role they hold and the role chosen, with what they gain or lose read from this
 * market's own table; nothing is sent until "Change role".
 */
const PASSWORD = 'e2erolechange123';
const COLLEAGUE = 'e2e-role-change-colleague@example.com';
const EDITOR = 'e2e-role-change-editor@example.com';

test.beforeAll(() => {
  for (const email of [COLLEAGUE, EDITOR]) ensureVerifiedUser(email, PASSWORD);
});

/** A market of the test user's, with `email` holding `role` on it. */
async function seed(request: APIRequestContext, email: string, role: string) {
  const { marketId, marketName } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const added = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: email, role },
  });
  expect(added.ok(), await added.text()).toBeTruthy();
  return { marketId, marketName };
}

async function openManage(page: Page, marketName: string): Promise<ManageMarketPage> {
  await page.goto(`/markets?q=${encodeURIComponent(marketName)}`);
  await page.getByTestId('market-card-manage-button').click();
  const manage = new ManageMarketPage(page);
  await manage.waitForOverlay();
  return manage;
}

const person = (page: Page, email: string) =>
  page.getByTestId('manage-market-person').filter({ hasText: email });
const roleSelect = (page: Page, email: string) =>
  person(page, email).getByTestId('manage-market-role-select');

/** Every write of a role this page sends, from here on. */
function roleWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && /\/markets\/[^/]+\/roles\//.test(request.url())) {
      writes.push(request.postData() ?? '');
    }
  });
  return writes;
}

/** Choosing as a person does: the select holds focus when its value changes. */
async function choose(select: Locator, role: string) {
  await select.focus();
  await select.selectOption(role);
}

const ON_A_PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
};

test.describe('at a desk', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('choosing a role sends nothing, and the confirmation names them and both roles', async ({
    authenticatedPage: page,
    request,
    expectAccessible,
  }) => {
    const { marketName } = await seed(request, COLLEAGUE, 'viewer');
    const writes = roleWrites(page);
    const manage = await openManage(page, marketName);
    const select = roleSelect(page, COLLEAGUE);

    await choose(select, 'editor');

    await expect(page.getByRole('dialog', { name: `Make ${COLLEAGUE} an Editor?` })).toBeVisible();
    await expect(manage.roleChangeWas).toHaveText(`They are a Viewer on ${marketName} now.`);
    await expect(manage.roleChangeGains).toContainText('As an Editor they could also:');
    await expect(manage.roleChangeConfirmButton).toHaveText('Change role');
    await expect(manage.roleChangeCancelButton).toBeFocused();
    await expect(select).toHaveValue('editor');
    await expectAccessible('the confirmation of changing a market role');
    expect(writes).toEqual([]);
  });

  for (const { how, close } of [
    { how: 'Cancel', close: (manage: ManageMarketPage) => manage.roleChangeCancelButton.click() },
    { how: 'Escape', close: (manage: ManageMarketPage) => manage.page.keyboard.press('Escape') },
    {
      how: 'the backdrop',
      close: (manage: ManageMarketPage) =>
        manage.roleChangeBackdrop.click({ position: { x: 5, y: 5 } }),
    },
  ]) {
    test(`${how} closes only the confirmation, sends nothing, and puts the select back`, async ({
      authenticatedPage: page,
      request,
    }) => {
      const { marketName } = await seed(request, COLLEAGUE, 'viewer');
      const writes = roleWrites(page);
      const manage = await openManage(page, marketName);
      const select = roleSelect(page, COLLEAGUE);

      await choose(select, 'admin');
      await expect(manage.roleChangeConfirm).toBeVisible();
      await close(manage);

      await expect(manage.roleChangeConfirm).toHaveCount(0);
      await expect(manage.window).toBeVisible();
      await expect(select).toHaveValue('viewer');
      await expect(select).toBeFocused();
      expect(writes).toEqual([]);
    });
  }

  test('"Change role" sends one write, re-reads in place with the dialog open, and keeps focus on the select', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId, marketName } = await seed(request, COLLEAGUE, 'viewer');
    const writes = roleWrites(page);
    const manage = await openManage(page, marketName);
    const select = roleSelect(page, COLLEAGUE);

    await choose(select, 'editor');
    await manage.roleChangeConfirmButton.click();

    await expect(manage.roleChangeConfirm).toHaveCount(0);
    await expect(manage.window).toBeVisible();
    await expect(select).toHaveValue('editor');
    await expect(select).toBeFocused();
    expect(writes).toEqual([JSON.stringify({ role: 'editor' })]);

    // It landed: a fresh read says so.
    const read = await request.get(`${BACKEND_URL}/markets/${marketId}`);
    const { market } = await read.json();
    const held = market.peopleWithAccess.find((p: { email: string }) => p.email === COLLEAGUE);
    expect(held.role).toBe('editor');

    // Moving back down says what they would lose.
    await choose(select, 'viewer');
    await expect(page.getByRole('dialog', { name: `Make ${COLLEAGUE} a Viewer?` })).toBeVisible();
    await expect(manage.roleChangeWas).toHaveText(`They are an Editor on ${marketName} now.`);
    await expect(manage.roleChangeLoses).toContainText('As a Viewer they could no longer:');
  });

  test("what they gain is read from this market's own table, after its owner moved a row", async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId, marketName } = await seed(request, COLLEAGUE, 'viewer');
    const read = await request.get(`${BACKEND_URL}/markets/${marketId}`);
    const table = (await read.json()).market.permissionTable as Array<{
      id: string;
      label: string;
      role: string;
      fixed: boolean;
    }>;
    const moved = table.find((row) => row.role === 'admin' && !row.fixed)!;
    const lowered = await request.put(
      `${BACKEND_URL}/markets/${marketId}/permissions/${moved.id}`,
      {
        data: { role: 'editor' },
      },
    );
    expect(lowered.ok(), await lowered.text()).toBeTruthy();

    const manage = await openManage(page, marketName);
    await choose(roleSelect(page, COLLEAGUE), 'editor');

    await expect(
      manage.roleChangeGains.getByRole('listitem').filter({ hasText: moved.label }),
    ).toHaveCount(1);
  });

  test("a refusal closes the confirmation and is said beneath the person's row", async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketName } = await seed(request, COLLEAGUE, 'viewer');
    const manage = await openManage(page, marketName);
    const select = roleSelect(page, COLLEAGUE);
    await page.route('**/api/markets/*/roles/*', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 403, json: { error: 'You cannot make that change.' } })
        : route.continue(),
    );

    await choose(select, 'editor');
    await manage.roleChangeConfirmButton.click();

    await expect(manage.roleChangeConfirm).toHaveCount(0);
    await expect(person(page, COLLEAGUE).getByTestId('manage-market-user-error')).toHaveText(
      'You cannot make that change.',
    );
    await expect(select).toHaveValue('viewer');
    await expect(select).toBeFocused();
    await expect(page.getByTestId('manage-market-error')).toHaveCount(0);
  });

  test('a write refused because someone was removed meanwhile keeps its words, and the list goes true', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId, marketName } = await seed(request, COLLEAGUE, 'viewer');
    const manage = await openManage(page, marketName);
    const select = roleSelect(page, COLLEAGUE);
    await choose(select, 'editor');

    const colleagueId = await select
      .getAttribute('name')
      .then((name) => name!.replace('role-', ''));
    const removed = await request.delete(`${BACKEND_URL}/markets/${marketId}/roles/${colleagueId}`);
    expect(removed.ok(), await removed.text()).toBeTruthy();
    await manage.roleChangeConfirmButton.click();

    await expect(manage.roleChangeConfirm).toHaveCount(0);
    await expect(person(page, COLLEAGUE)).toHaveCount(0);
    const people = page.getByTestId('manage-market-people');
    await expect(people.getByTestId('manage-market-user-error')).toHaveText(
      `${COLLEAGUE}: User does not have a role in this market`,
    );
    await expect(people).toBeFocused();
  });

  test('adding back someone whose write was refused brings their row back without the words', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId, marketName } = await seed(request, COLLEAGUE, 'viewer');
    const manage = await openManage(page, marketName);
    const select = roleSelect(page, COLLEAGUE);
    await choose(select, 'editor');

    const colleagueId = await select
      .getAttribute('name')
      .then((name) => name!.replace('role-', ''));
    const removed = await request.delete(`${BACKEND_URL}/markets/${marketId}/roles/${colleagueId}`);
    expect(removed.ok(), await removed.text()).toBeTruthy();
    await manage.roleChangeConfirmButton.click();
    await expect(page.getByTestId('manage-market-user-error')).toBeVisible();

    await manage.addUser(COLLEAGUE, 'viewer');

    await expect(roleSelect(page, COLLEAGUE)).toHaveValue('viewer');
    await expect(page.getByTestId('manage-market-user-error')).toHaveCount(0);
  });

  test('a write refused because the role moved meanwhile states the role they hold now', async ({
    request,
    browser,
  }) => {
    const { marketId, marketName } = await seed(request, COLLEAGUE, 'viewer');
    const added = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
      data: { user_email: EDITOR, role: 'admin' },
    });
    expect(added.ok(), await added.text()).toBeTruthy();

    await withUser(browser, EDITOR, PASSWORD, async (page) => {
      const manage = await openManage(page, marketName);
      const select = roleSelect(page, COLLEAGUE);
      await choose(select, 'editor');

      // The owner makes them an Admin, a role only the owner may take.
      const colleagueId = (await select.getAttribute('name'))!.replace('role-', '');
      const moved = await request.put(`${BACKEND_URL}/markets/${marketId}/roles/${colleagueId}`, {
        data: { role: 'admin' },
      });
      expect(moved.ok(), await moved.text()).toBeTruthy();
      await manage.roleChangeConfirmButton.click();

      await expect(manage.roleChangeConfirm).toHaveCount(0);
      const row = person(page, COLLEAGUE);
      await expect(row.getByTestId('manage-market-role')).toHaveText('Admin');
      await expect(row.getByTestId('manage-market-user-error')).not.toHaveText('');
      await expect(page.getByTestId('manage-market-people')).toBeFocused();
    });
  });

  test('the arrow keys on the closed select open its list, rather than stepping into a question', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketName } = await seed(request, COLLEAGUE, 'viewer');
    const manage = await openManage(page, marketName);
    const select = roleSelect(page, COLLEAGUE);

    await select.focus();
    await page.keyboard.press('ArrowDown');

    await expect(select).toHaveValue('viewer');
    await expect(manage.roleChangeConfirm).toHaveCount(0);
  });

  test('someone who changes their own role away finds focus on the people list', async ({
    request,
    browser,
  }) => {
    const { marketId, marketName } = await seed(request, EDITOR, 'editor');
    // An Editor gives and takes Editor and Viewer roles only once the owner lowers that row to them.
    const lowered = await request.put(
      `${BACKEND_URL}/markets/${marketId}/permissions/manage-editors-and-viewers`,
      { data: { role: 'editor' } },
    );
    expect(lowered.ok(), await lowered.text()).toBeTruthy();

    await withUser(browser, EDITOR, PASSWORD, async (page) => {
      const manage = await openManage(page, marketName);
      await choose(roleSelect(page, EDITOR), 'viewer');
      await expect(page.getByRole('dialog', { name: `Make ${EDITOR} a Viewer?` })).toBeVisible();
      await manage.roleChangeConfirmButton.click();

      await expect(manage.roleChangeConfirm).toHaveCount(0);
      await expect(roleSelect(page, EDITOR)).toHaveCount(0);
      await expect(page.getByTestId('manage-market-people')).toBeFocused();
    });
  });
});

for (const { name, use } of [
  { name: 'at a desk', use: { viewport: { width: 1280, height: 800 } } },
  { name: 'on a phone', use: ON_A_PHONE },
]) {
  test.describe(name, () => {
    test.use(use);

    test('Viewer to Admin keeps the question and "Change role" in sight, its list scrolling inside', async ({
      authenticatedPage: page,
      request,
    }) => {
      const { marketName } = await seed(request, COLLEAGUE, 'viewer');
      const manage = await openManage(page, marketName);

      await choose(roleSelect(page, COLLEAGUE), 'admin');
      await expect(manage.roleChangeGains).toBeVisible();
      await expect(manage.roleChangeGains.getByRole('listitem').first()).toBeVisible();

      const title = page.getByRole('heading', { name: `Make ${COLLEAGUE} an Admin?` });
      const viewport = page.viewportSize()!;
      const inSight = async (what: Locator, label: string) => {
        const box = (await what.boundingBox())!;
        expect(box.x, `${label} starts inside the window`).toBeGreaterThanOrEqual(0);
        expect(box.y, `${label} starts inside the window`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${label} ends inside the window`).toBeLessThanOrEqual(
          viewport.width,
        );
        expect(box.y + box.height, `${label} ends inside the window`).toBeLessThanOrEqual(
          viewport.height,
        );
      };

      await inSight(title, 'the question');
      await inSight(manage.roleChangeConfirmButton, 'Change role');

      // What is long scrolls in the body, and neither of the pinned parts moves with it.
      const scrolls = await manage.roleChangeBody.evaluate((el) => {
        const reach = el.scrollHeight - el.clientHeight;
        el.scrollTop = reach;
        return reach;
      });
      expect(scrolls, 'the list is longer than its body').toBeGreaterThan(0);
      await inSight(title, 'the question, scrolled');
      await inSight(manage.roleChangeConfirmButton, 'Change role, scrolled');
      await inSight(manage.roleChangeGains.getByRole('listitem').last(), 'the last row, scrolled');
    });
  });
}
