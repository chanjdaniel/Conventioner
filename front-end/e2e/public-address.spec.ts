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

  /** The name is the address, so past draft it is fixed, and Manage Market says so (E21/F03/S04). */
  test('past draft, Manage Market says why the name is fixed and offers no rename', async ({
    authenticatedPage: page,
  }) => {
    const name = `Address Fixed ${Date.now()}`;
    const created = await page.request.post(`${BACKEND_URL}/markets`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: {
        name,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
        roles: { [TEST_USER.email]: 'owner' },
        modificationList: [],
        assignmentObject: {},
        setupObject: {
          priority: [],
          marketDates: [{ date: '2099-05-01' }],
          tiers: [],
          locations: [],
          sections: [],
          assignmentOptions: {},
        },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { market_id: marketId } = (await created.json()) as { market_id: string };
    const opened = await page.request.post(`${BACKEND_URL}/markets/${marketId}/transition`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { toPhase: 'applications_open' },
    });
    expect(opened.ok(), await opened.text()).toBe(true);

    await page.goto('/markets');
    const card = page.getByTestId('market-card').filter({ hasText: name });
    await card.getByTestId('market-card-manage-button').click();

    await expect(page.getByTestId('manage-market-rename-fixed')).toContainText(
      'already been shared',
    );
    await expect(page.getByTestId('manage-market-rename-input')).toHaveCount(0);

    // And the server holds the same line, whatever a client sends.
    const refused = await page.request.put(`${BACKEND_URL}/markets/${marketId}/name`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { name: `${name} renamed` },
    });
    expect(refused.status()).toBe(400);
  });
});
