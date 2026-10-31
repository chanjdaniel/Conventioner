import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect, BACKEND_URL, LoginPage } from './fixtures';
import { loginViaApi } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { OrganizationsPage } from './pages/OrganizationsPage';

/**
 * Organizations and its dialogs fit a phone (T148).
 *
 * An organizer on a phone lands on the dashboard, whose other place is Organizations. Under a
 * phone's own emulation a page wider than the window does not scroll sideways: it widens the layout
 * viewport and zooms out, and a dialog opens off screen. The 1000px floor did exactly that here.
 *
 * Its own owner, so the list holds one organization, and its member's address is long: on a phone
 * it takes a line of its own. Fixture data.
 */

const PHONE = { width: 390, height: 844 };
const OWNER = { email: 'e2e-organizations-on-a-phone@example.com', password: 'e2epassword123' };
const MEMBER = 'e2e-organizations-on-a-phone-member@example.com';
const NAME = 'The Harbour Makers and Artisans Collective, on a phone';

/** The owner's organization, found by name on a later run, with `MEMBER` its member. */
async function ensureTheOrganization(request: APIRequestContext): Promise<void> {
  ensureVerifiedUser(OWNER.email, OWNER.password);
  ensureVerifiedUser(MEMBER, OWNER.password);
  await loginViaApi(request, BACKEND_URL, OWNER.email, OWNER.password);
  type Listed = { id: string; name: string; memberEmails?: string[] };
  const mine = async () => {
    const res = await request.get(`${BACKEND_URL}/organizations`);
    expect(res.ok(), await res.text()).toBe(true);
    const { organizations = [] } = (await res.json()) as { organizations?: Listed[] };
    return organizations.find((o) => o.name === NAME);
  };
  let org = await mine();
  if (!org) {
    const made = await request.post(`${BACKEND_URL}/organizations`, { data: { name: NAME } });
    expect(made.ok(), await made.text()).toBe(true);
    org = (await mine())!;
  }
  if (!org.memberEmails?.includes(MEMBER)) {
    const added = await request.post(`${BACKEND_URL}/organizations/${org.id}/members`, {
      data: { user_email: MEMBER },
    });
    expect(added.ok(), await added.text()).toBe(true);
  }
}

test.beforeAll(async ({ request }) => {
  await ensureTheOrganization(request);
});

test.describe('on a phone', () => {
  test.use({
    viewport: PHONE,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });

  /** The window as the page lays itself out in it, the page's own width, and the zoom. */
  const widths = (page: Page) =>
    page.evaluate(() => ({
      layout: window.innerWidth,
      page: document.documentElement.scrollWidth,
      zoom: window.visualViewport?.scale ?? 1,
    }));

  /** A box wholly inside the 390px window. */
  async function expectInside(locator: Locator, what: string): Promise<void> {
    const box = await locator.boundingBox();
    expect(box, `${what} is drawn`).not.toBeNull();
    expect(box!.x, `${what} starts inside the window`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${what} ends inside the window`).toBeLessThanOrEqual(PHONE.width);
  }

  const box = async (locator: Locator) => (await locator.boundingBox())!;

  test("the list keeps the phone's width, and its dialogs open inside it", async ({ page }) => {
    const login = new LoginPage(page);
    await login.login(OWNER.email, OWNER.password);
    await login.waitForDashboardRedirect();
    await page.getByTestId('dashboard-organizations-button').tap();
    await page.waitForURL('**/organizations');

    const orgs = new OrganizationsPage(page);
    const card = orgs.orgCards.filter({ hasText: NAME });
    await expect(card).toBeVisible();
    expect(await widths(page)).toEqual({ layout: 390, page: 390, zoom: 1 });
    for (const each of await orgs.orgCards.all()) await expectInside(each, 'a card');
    await expectInside(orgs.createButton, 'New organization');
    expect((await box(orgs.createButton)).height, 'New organization is one line').toBeLessThan(48);

    // Manage organization: the member's address on a line of its own, Remove beneath it.
    await card.getByTestId('organizations-manage-button').tap();
    await expect(orgs.manageWindow).toBeVisible();
    await expectInside(orgs.manageWindow, 'Manage organization');
    const address = orgs.memberEmails.filter({ hasText: MEMBER });
    await expect(address).toBeVisible();
    const remove = orgs.removeMemberButtons.first();
    const addressBox = await box(address);
    expect((await box(remove)).y, 'Remove is beneath the address').toBeGreaterThanOrEqual(
      addressBox.y + addressBox.height,
    );

    // Its add row: the field takes the row, Add and Cancel beneath it.
    await orgs.addMemberButton.tap();
    await expect(orgs.addMemberInput).toBeVisible();
    const field = await box(orgs.addMemberInput);
    const add = await box(orgs.addMemberSubmit);
    expect(add.y, 'Add is beneath the field').toBeGreaterThanOrEqual(field.y + field.height);
    expect(field.width, 'the field takes the row').toBeGreaterThan(250);
    await expectInside(orgs.addMemberInput, 'the email field');
    await expectInside(page.getByTestId('manage-org-add-member-cancel'), 'Cancel');
    expect(await widths(page)).toEqual({ layout: 390, page: 390, zoom: 1 });

    // Delete organization, opened over it and closed again: never confirmed.
    await orgs.deleteButton.tap();
    await expect(orgs.deleteWindow).toBeVisible();
    await expect(page.getByTestId('delete-org-no-markets')).toBeVisible();
    await expectInside(orgs.deleteWindow, 'Delete organization');
    expect(await widths(page)).toEqual({ layout: 390, page: 390, zoom: 1 });
    await orgs.deleteCancelButton.tap();
    await expect(orgs.deleteWindow).toBeHidden();
    await orgs.manageCloseButton.tap();
    await expect(orgs.manageWindow).toBeHidden();

    await orgs.createButton.tap();
    const create = page.getByTestId('organizations-create-window');
    await expect(create).toBeVisible();
    await expectInside(create, 'New organization');
    expect(await widths(page)).toEqual({ layout: 390, page: 390, zoom: 1 });
  });
});

// Between a phone and a desk the list narrows with the window rather than holding a desk's width.
test('Organizations fits a window between a phone and a desk', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const login = new LoginPage(page);
  await login.login(OWNER.email, OWNER.password);
  await login.waitForDashboardRedirect();
  await page.goto('/organizations');
  const card = page.getByTestId('organization-card').filter({ hasText: NAME });
  await expect(card).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'Organizations scrolls sideways at 768px').toBeLessThanOrEqual(0);
  // The card is too narrow here for its name, its facts and Manage side by side: Manage ran 21px
  // past the card's edge, and the list scrolled sideways within itself.
  const cardBox = (await card.boundingBox())!;
  const manage = (await card.getByTestId('organizations-manage-button').boundingBox())!;
  expect(manage.x + manage.width, 'Manage ends inside its card').toBeLessThanOrEqual(
    cardBox.x + cardBox.width,
  );
  const list = await page.evaluate(() => {
    const block = document.querySelector('.content-block')!;
    return block.scrollWidth - block.clientWidth;
  });
  expect(list, 'the list scrolls sideways within itself at 768px').toBeLessThanOrEqual(0);
});
