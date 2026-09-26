import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { TablesPage } from './pages/TablesPage';
import { seedAssignedMarket, type AssignedSeedResult } from './helpers/seedAssignedMarket';
import { loginViaApi } from './helpers/seeds';

/**
 * Changing a placement from the Tables view (E11/F03/S01).
 *
 * The Tables view is the only screen that can answer "where can they go", which is why the two
 * operations live here. There are two and deliberately no third: a seat is filled, or two vendors
 * trade seats atomically. Nothing displaces an occupant, because that is how a vendor is silently
 * unassigned on market day.
 */
test.describe('Changing a placement on the Tables view', () => {
  let seed: AssignedSeedResult;

  test.beforeAll(async ({ request }) => {
    seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('an empty seat is filled, naming the side, and the change is warned about first', async ({
    authenticatedPage: page,
  }) => {
    const tables = new TablesPage(page);
    await tables.goto(seed.marketId);
    await expect(tables.tableRows.first()).toBeVisible({ timeout: 15000 });

    // Free a seat so there is somebody to place: every vendor this market has is already seated.
    const occupied = tables.occupiedSeat('Hall A 1');
    await expect(occupied).toBeVisible();
    const freedVendor = await tables.occupantOf(occupied);
    await occupied.click();
    await tables.freeSeat();
    await expect(tables.dialog).toBeHidden();
    await expect(tables.row('Hall A 1').getByTestId('tables-seat-empty')).toBeVisible();

    // Now put them into HALF of a different table, which is not what they asked for - and the
    // product says so before the change rather than rewriting their answer afterwards.
    await tables.vacantSeat('Hall A 4').click();
    await expect(tables.dialog).toBeVisible();
    await tables.dialog.getByTestId('placement-dialog-vendor').selectOption(freedVendor);
    await tables.dialog.getByTestId('placement-dialog-seat-Half Table (Left)').check();
    await expect(tables.dialogWarning).toContainText('whole table');

    await tables.dialog.getByTestId('placement-dialog-confirm').click();
    await expect(tables.dialog).toBeHidden();
    await expect(
      tables.row('Hall A 4').locator(`[data-vendor-email="${freedVendor}"]`),
    ).toBeVisible();
    await expect(tables.row('Hall A 4')).toContainText('Left');
  });

  test('two vendors trade seats in one action', async ({ authenticatedPage: page }) => {
    const tables = new TablesPage(page);
    await tables.goto(seed.marketId);
    await expect(tables.tableRows.first()).toBeVisible({ timeout: 15000 });

    const seats = page.getByTestId('tables-seat-occupied');
    await expect(seats.nth(1)).toBeVisible();
    const first = await tables.occupantOf(seats.nth(0));
    const second = await tables.occupantOf(seats.nth(1));
    const firstTable = await tables.tableCodeOf(seats.nth(0));
    const secondTable = await tables.tableCodeOf(seats.nth(1));

    await seats.nth(0).click();
    await tables.swapWith(second);
    await expect(tables.dialog).toBeHidden();

    // Either both changed or neither did: a half-finished trade is a vendor standing nowhere.
    await expect(tables.row(firstTable).locator(`[data-vendor-email="${second}"]`)).toBeVisible();
    await expect(tables.row(secondTable).locator(`[data-vendor-email="${first}"]`)).toBeVisible();
  });

  test('no control displaces a vendor without placing them', async ({
    authenticatedPage: page,
  }) => {
    const tables = new TablesPage(page);
    await tables.goto(seed.marketId);
    await expect(tables.tableRows.first()).toBeVisible({ timeout: 15000 });

    await page.getByTestId('tables-seat-occupied').first().click();
    await expect(tables.dialog).toBeVisible();

    // Trade or free. There is no "move them here" that leaves the occupant with nothing.
    await expect(tables.dialog.getByTestId('placement-dialog-swap')).toBeVisible();
    await expect(tables.dialog.getByTestId('placement-dialog-free')).toBeVisible();
    await expect(tables.dialog.getByTestId('placement-dialog-vendor')).toHaveCount(0);
  });

  test('the vendor panel opens the Tables view scoped to that vendor and leads back', async ({
    authenticatedPage: page,
  }) => {
    // The door (E11/F03/S02). The trigger for every change is a person, and the vendor panel is
    // where an organizer is looking at one; only the Tables view can answer "where can they go".
    await page.goto(`/markets/${seed.marketId}/vendors`);
    const firstRow = page.getByTestId('vendors-list-item').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    await firstRow.click();

    const card = page.getByTestId('vendors-detail-assignment-item').first();
    await expect(card).toBeVisible();
    const link = card.getByTestId('vendor-date-card-place-link');
    await expect(link).toHaveText(/Change placement|Place them/);
    await link.click();

    // Scoped to the date, which is what makes the Tables view's filters reachable at all.
    await page.waitForURL(/\/tables\?.*date=/, { timeout: 10000 });
    const tables = new TablesPage(page);
    await expect(tables.dateFilterChip).toBeVisible();

    // And back to the panel it came from, rather than to the results tab.
    await tables.clickBack();
    await page.waitForURL(/\/vendors\?vendor=/, { timeout: 10000 });
    await expect(page.getByTestId('vendors-detail-assignment-item').first()).toBeVisible();
  });

  test('a hand placement, a swap and a solver run each leave one entry', async ({
    authenticatedPage: page,
  }) => {
    // A placement that differs from what the solver produced is a fact someone will later ask
    // about, and a flag saying "hand-placed" cannot answer it (E11/F04/S01).
    const tables = new TablesPage(page);
    await tables.goto(seed.marketId);
    await expect(tables.tableRows.first()).toBeVisible({ timeout: 15000 });

    interface Entry {
      kind: string;
      actor: string;
      at: string;
      vendors: string[];
    }
    const trail = async (vendor?: string): Promise<Entry[]> => {
      const query = vendor ? `?vendor=${encodeURIComponent(vendor)}` : '';
      const res = await page.request.get(
        `${BACKEND_URL}/markets/${seed.marketId}/placement-history${query}`,
        { headers: { 'X-Owner-Email': TEST_USER.email } },
      );
      return ((await res.json()) as { entries: Entry[] }).entries;
    };

    // A delta, because the specs above share this market and have already changed placements on
    // it. What is being pinned is that ONE action leaves ONE entry.
    const before = await trail();

    const seats = page.getByTestId('tables-seat-occupied');
    const first = await tables.occupantOf(seats.nth(0));
    const second = await tables.occupantOf(seats.nth(1));

    await seats.nth(0).click();
    await tables.swapWith(second);
    await expect(tables.dialog).toBeHidden();

    const entries = await trail();
    expect(entries).toHaveLength(before.length + 1);
    expect(entries[0].kind).toBe('swapped');
    // The run that seeded this market is one entry too, not one per placement written.
    expect(entries.filter((entry) => entry.kind === 'assigned')).toHaveLength(1);

    // Each entry names the organizer, the change and the time.
    for (const entry of entries) {
      expect(entry.actor).toBe(TEST_USER.email);
      expect(entry.at).toBeTruthy();
    }

    // The vendor panel shows that vendor's entries; the market shows all of them.
    const theirs = await trail(first);
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.length).toBeLessThan(entries.length);
    for (const entry of theirs) {
      expect(entry.vendors).toContain(first);
    }
  });

  test('deleting a market takes its placement history with it', async ({ request }) => {
    // The trail names the organizers who made each change, so it must not outlive the market.
    await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const doomed = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );

    const before = await request.get(
      `${BACKEND_URL}/markets/${doomed.marketId}/placement-history`,
      { headers: { 'X-Owner-Email': TEST_USER.email } },
    );
    expect(((await before.json()) as { entries: unknown[] }).entries.length).toBeGreaterThan(0);

    const deleted = await request.delete(`${BACKEND_URL}/markets/${doomed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    expect(deleted.ok(), await deleted.text()).toBeTruthy();

    const after = await request.get(`${BACKEND_URL}/markets/${doomed.marketId}/placement-history`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    expect(after.status()).toBe(404);
  });

  test('the filters can be set from the page, not only cleared', async ({
    authenticatedPage: page,
  }) => {
    // The filter system was complete and unreachable: computed from the URL, clearable by chip,
    // and set by nothing (E09/F02/S01, E11/F03/S02).
    const tables = new TablesPage(page);
    await tables.goto(seed.marketId);
    await expect(tables.tableRows.first()).toBeVisible({ timeout: 15000 });

    await tables.setFilter('section', 'Hall A');
    await expect(page).toHaveURL(/section=Hall\+A|section=Hall%20A/);
    await expect(tables.sectionFilterChip).toBeVisible();

    await tables.setFilter('choice', 'full');
    await expect(tables.choiceFilterChip).toBeVisible();

    await tables.clearAllFilters();
    await expect(tables.sectionFilterChip).toBeHidden();
  });
});
