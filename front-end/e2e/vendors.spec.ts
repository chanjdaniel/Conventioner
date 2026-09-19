import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { VendorsPage } from './pages/VendorsPage';

test.describe('Vendor browsing and search', () => {
  test('search filters vendors by email, detail panel shows per-date assignments', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );

    const marketRes = await request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    expect(marketRes.ok()).toBeTruthy();
    const { market: marketData } = (await marketRes.json()) as { market: Record<string, unknown> };

    await page.evaluate((data) => {
      const m = { ...(data as Record<string, unknown>) };
      delete (m as Record<string, unknown>)._id;
      localStorage.setItem('market', JSON.stringify(m));
      localStorage.setItem('user', JSON.stringify('e2e@example.com'));
    }, marketData);

    const vendorsPage = new VendorsPage(page);
    await vendorsPage.goto();

    await expect(vendorsPage.vendorListItems.first()).toBeVisible({ timeout: 10000 });
    await expect(vendorsPage.vendorListItems).toHaveCount(2);

    await vendorsPage.search('alice');
    await expect(vendorsPage.vendorListItems).toHaveCount(1);

    await vendorsPage.search('nonexistent@example.com');
    await expect(vendorsPage.vendorListItems).toHaveCount(0);

    await vendorsPage.search('');
    await expect(vendorsPage.vendorListItems).toHaveCount(2);

    await vendorsPage.clickVendor(0);
    await expect(vendorsPage.detailCloseButton).toBeVisible({ timeout: 5000 });

    await expect(vendorsPage.detailAssignmentItems.first()).toBeVisible({ timeout: 5000 });
    await expect(vendorsPage.detailAssignmentItems).toHaveCount(1);
  });

  test('an unplaced vendor is opened from the payoff screen and told why', async ({
    authenticatedPage: page,
    request,
  }) => {
    // The finding: the payoff screen listed unassigned vendors by email under a heading and said
    // nothing else, beside a summary reporting nineteen free tables (E12).
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );

    // One table for two approved vendors, so exactly one of them cannot be placed.
    const marketRes = await request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market } = (await marketRes.json()) as { market: Record<string, unknown> };
    const setup = market.setupObject as { sections: Array<Record<string, unknown>> };
    setup.sections = setup.sections.map((section) => ({ ...section, count: 1 }));
    await request.put(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: market,
    });

    await page.evaluate((m) => {
      localStorage.setItem('market', JSON.stringify(m));
      localStorage.setItem('user', JSON.stringify('e2e@example.com'));
    }, market);

    await page.goto('/market-setup?tab=assignment');
    const unplaced = page.getByTestId('assignment-results-unassigned-vendor').first();
    await expect(unplaced).toBeVisible({ timeout: 15000 });
    await unplaced.click();

    // It leads to that vendor's panel, where the date card says why rather than showing an
    // em dash on a card the same colour as a placed one.
    await page.waitForURL('**/vendors?vendor=**', { timeout: 10000 });
    const card = page.getByTestId('vendors-detail-assignment-item').first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card).toHaveAttribute('data-state', 'unplaced');
    await expect(page.getByTestId('vendor-date-card-reason').first()).toContainText(/taken|free/);

    // And closes on Escape, per E09/F03/S03.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('vendors-detail-close')).toBeHidden({ timeout: 5000 });
  });

  test('a vendor is named, with their address beside it, and found by either', async ({
    authenticatedPage: page,
    request,
  }) => {
    // A market of 232 vendors was a list of 232 gmail addresses (E13/F02/S01). The address stays
    // on every row: two vendors can share a name, and the address is what check-in matches on.
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );

    const marketRes = await request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market: marketData } = (await marketRes.json()) as { market: Record<string, unknown> };
    await page.evaluate((data) => {
      const m = { ...(data as Record<string, unknown>) };
      delete (m as Record<string, unknown>)._id;
      localStorage.setItem('market', JSON.stringify(m));
      localStorage.setItem('user', JSON.stringify('e2e@example.com'));
    }, marketData);

    const vendorsPage = new VendorsPage(page);
    await vendorsPage.goto();
    await expect(vendorsPage.vendorListItems.first()).toBeVisible({ timeout: 10000 });

    const alice = vendorsPage.vendorListItems.filter({ hasText: 'alice@example.com' });
    await expect(alice).toContainText('Alice Example');
    await expect(alice).toContainText('alice@example.com');

    // The box read "Filter by email" and matched only that, so finding someone by name meant
    // already knowing their address.
    await expect(page.getByTestId('vendors-search-input')).toHaveAttribute(
      'placeholder',
      /name or email/i,
    );
    await vendorsPage.search('Alice Example');
    await expect(vendorsPage.vendorListItems).toHaveCount(1);

    await vendorsPage.search('');
    await vendorsPage.clickVendor(0);
    await expect(page.getByTestId('vendors-detail-email')).toBeVisible({ timeout: 5000 });
  });
});
