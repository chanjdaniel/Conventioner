import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
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
    //
    // A market left in `assignment`, not a published one: Assign is an operation of that phase
    // and refuses everywhere else (E10/F03/S02), and this test needs to run it again against a
    // smaller plan. A published market is past the point where re-running is the right move -
    // the answer there is to change one placement from the Tables view.
    const seed = await seedAssignedMarket(
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

    // Assign again against the smaller plan. Shrinking it is not on its own enough: every view
    // describes the STORED assignment now (E11/F03/S01), so nobody is unplaced until the run
    // that leaves them unplaced actually happens.
    const rerun = await request.post(`${BACKEND_URL}/markets/${seed.marketId}/assignment`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    expect(rerun.ok(), await rerun.text()).toBeTruthy();

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

  /**
   * The vendor drawer says `role="dialog" aria-modal="true"`, which tells a screen reader that
   * everything outside it is out of play, and the scrim stops the mouse from reaching it. Nothing
   * stopped the keyboard: fourteen controls behind the drawer stayed in the tab order, "Publish
   * Market" among them, so a keyboard user could tab onto it and press Enter (E14/F02/S02).
   *
   * QC finding F13 read this as an appearance problem - a rail that "keeps its full green and looks
   * live". It does not: the scrim dims everything behind it to 60%, measured, the rail no more
   * brightly than the Back button beside it. What actually presented itself as available was the
   * focus ring.
   */
  test('while the vendor drawer is open, nothing behind it can be tabbed to', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const marketRes = await request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market } = (await marketRes.json()) as { market: Record<string, unknown> };
    await page.evaluate((m) => {
      localStorage.setItem('market', JSON.stringify(m));
      localStorage.setItem('user', JSON.stringify('e2e@example.com'));
    }, market);

    const vendorsPage = new VendorsPage(page);
    await vendorsPage.goto();
    await expect(vendorsPage.vendorListItems.first()).toBeVisible({ timeout: 10000 });

    // The rail's forward action is reachable before the drawer opens - otherwise the assertion
    // below would hold for the wrong reason.
    const publish = page.getByTestId('phase-rail').getByRole('button').first();
    await expect(publish).toBeVisible();
    await publish.focus();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON');

    await vendorsPage.clickVendor(0);
    await expect(vendorsPage.detailCloseButton).toBeVisible({ timeout: 5000 });

    // Twenty tabs is more than the whole page holds, so if anything behind the drawer were still
    // reachable this would land on it.
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab');
      const escaped = await page.evaluate(() => {
        const panel = document.querySelector('.detail-panel');
        const active = document.activeElement;
        if (!panel || !active || active === document.body) return null;
        return panel.contains(active)
          ? null
          : (active.textContent || active.tagName).trim().slice(0, 40);
      });
      expect(escaped, `tab ${i + 1} reached "${escaped}" behind the modal`).toBeNull();
    }

    // AC3: the scrim still dismisses on click, which is the behaviour that was already right.
    await page.locator('.detail-overlay').click({ position: { x: 20, y: 20 } });
    await expect(vendorsPage.detailCloseButton).toBeHidden({ timeout: 5000 });

    // And the rail comes back when it does.
    await publish.focus();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON');
  });
});
