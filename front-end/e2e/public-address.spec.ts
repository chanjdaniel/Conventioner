import { test, expect, NewMarketPage, BACKEND_URL, TEST_USER } from './fixtures';
import { ensureTestOrg } from './helpers/seeds';

/**
 * A public address belongs to one market (E21/F03/S03).
 *
 * The name decides the slug, and the slug is the unauthenticated address a market's applicant
 * links and check-in page are served under. "Café" and "Cafe" are two names and one address, so
 * the second is refused - and the organizer is told why in those terms, where they typed the name,
 * rather than told that a market "with this name" exists when none does.
 */
test.describe('A public address belongs to one market', () => {
  let orgId: string;

  test.beforeAll(async ({ request }) => {
    orgId = await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('a name that folds onto a taken address is refused in the dialog', async ({
    authenticatedPage: page,
  }) => {
    const stamp = Date.now();
    const created = await page.request.post(`${BACKEND_URL}/markets`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: {
        name: `Café Address ${stamp}`,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
        roles: { [TEST_USER.email]: 'owner' },
        modificationList: [],
        assignmentObject: {},
      },
    });
    expect(created.ok()).toBe(true);

    await page.goto('/markets');
    await page.getByTestId('markets-create-button').click();
    const dialog = new NewMarketPage(page);
    await dialog.selectFirstOrg();
    await dialog.fillMarketName(`Cafe Address ${stamp}`);
    await dialog.clickSubmit();

    await expect(dialog.errorMessage).toContainText(`/cafe-address-${stamp}`);
    await expect(dialog.errorMessage).toContainText('web address');
    await expect(dialog.nameInput, 'the dialog closed on a refusal').toBeVisible();
  });
});
