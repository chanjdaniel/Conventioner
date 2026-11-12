import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, MarketSetupPage } from './fixtures';
import { LayoutPage } from './pages/LayoutPage';
import { seedLayout, storedLayoutTables } from './helpers/seeds';

/**
 * A layout saves itself, and no save erases another (T257 ticket 04): a change still waiting its
 * 600 ms is not lost to a reload; a tab holding an older layout is told so, keeps what it shows
 * and reloads to the latest; and Market Setup's autosave from a copy read before a layout save is
 * refused in the one sentence (ADR 0024), never erasing a table, and lands once made again.
 */
const GOLD_1 = 'Gold row 1, Standard 6 ft';
const GOLD_2 = 'Gold row 2, Standard 6 ft';
const STALE = 'This layout changed elsewhere. Reload to see the latest.';

const storedTables = (request: APIRequestContext, marketId: string) =>
  storedLayoutTables(request, BACKEND_URL, marketId);

async function seeded(request: APIRequestContext) {
  return seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    metresAcross: 30,
    tables: [{ section: 'sec-gold', at: [6000, 6000] }],
  });
}

test.describe('A layout saves once', () => {
  test('a tab holding an older layout is told so, keeps what it shows, and reloads to the latest', async ({
    authenticatedPage: page,
    request,
  }) => {
    const market = await seeded(request);
    const first = new LayoutPage(page);
    await first.goto(market.marketId, market.upper.id);
    await expect(first.tables).toHaveCount(1);
    const second = new LayoutPage(await page.context().newPage());
    await second.goto(market.marketId, market.upper.id);
    await expect(second.tables).toHaveCount(1);

    // The first tab moves Gold row 1 down the hall, and it is saved.
    await first.saved(() => first.drag([6000, 6000], [6000, 15_000]));
    const theirs = (await storedTables(request, market.marketId))[0];
    expect(theirs.yMm).toBeGreaterThan(14_000);

    // The second tab, which read the layout before that, adds a table: its save is refused.
    await second.toolAdd.click();
    await second.clickAt([20_000, 6000]);
    await expect(second.saveState).toContainText(STALE);
    await expect(second.saveReload).toBeVisible();
    await expect(second.saveRetry).toHaveCount(0);
    // Nothing is lost from what the tab shows: its new table still stands, the first where it was.
    await expect(second.table(GOLD_2)).toBeVisible();
    await expect(second.selectionPosition).toHaveText('20.0 m, 6.0 m');
    // And nothing of it reached the server: the first tab's layout stands.
    expect(await storedTables(request, market.marketId)).toEqual([theirs]);

    // Reload takes the latest: one table, where the first tab dropped it.
    await second.saveReload.click();
    await expect(second.tables).toHaveCount(1);
    await expect(second.saveState).toHaveText('Saved');
    const at = await second.onScreen([theirs.xMm, theirs.yMm]);
    const top = (await second.tableTop(GOLD_1).boundingBox())!;
    expect(top.y + top.height / 2).toBeCloseTo(at.y, 0);

    // From there the second tab saves again.
    await second.saved(() => second.clickAt([20_000, 6000]));
    expect(await storedTables(request, market.marketId)).toHaveLength(2);
  });

  test("Market Setup's autosave from before a layout edit is refused, never erasing a table, and lands made again", async ({
    authenticatedPage: page,
    request,
  }) => {
    const market = await seeded(request);
    // Market Setup is open first, holding the plan with the layout of one table.
    await page.goto(`/markets/${encodeURIComponent(market.marketId)}/setup`);
    await expect(page.getByTestId('setup-section-count-0')).toHaveText('1');
    const lowerCount = page.getByTestId('setup-section-count-input-2');
    const countAsRead = await lowerCount.inputValue();

    // In another tab the editor places two more tables.
    const layout = new LayoutPage(await page.context().newPage());
    await layout.goto(market.marketId, market.upper.id);
    await layout.toolAdd.click();
    await layout.saved(async () => {
      await layout.clickAt([12_000, 9000]);
      await layout.clickAt([18_000, 9000]);
    });
    expect(await storedTables(request, market.marketId)).toHaveLength(3);

    // Market Setup, still holding the plan from before the layout's save, saves an edit of its
    // own: Lower Hall's count. Every write of the plan counts its revision (ADR 0024), so the save
    // from the older copy is refused in the one sentence, and the page shows the plan as stored.
    const planPut = () =>
      page.waitForResponse(
        (response) =>
          response.url().includes(`/markets/${market.marketId}/plan`) &&
          response.request().method() === 'PUT',
      );
    const refused = planPut();
    await page.bringToFront();
    await lowerCount.fill('9');
    expect((await refused).status()).toBe(409);
    const setup = new MarketSetupPage(page);
    await expect(setup.planRefused).toContainText(
      'This market changed while you were working on it, so your change was not saved. ' +
        'Reload to see the latest, then make your change again.',
    );
    await expect(lowerCount).toHaveValue(countAsRead);
    expect(await storedTables(request, market.marketId)).toHaveLength(3);

    // Made again on the plan as now read, the edit lands.
    const saved = planPut();
    await lowerCount.fill('9');
    expect((await saved).ok()).toBe(true);

    // The layout's three tables stand, and the plan's own edit landed.
    const tables = await storedTables(request, market.marketId);
    expect(tables.map((table) => table.number)).toEqual([1, 2, 3]);
    const read = await request.get(`${BACKEND_URL}/markets/${market.marketId}`);
    const { market: stored } = (await read.json()) as {
      market: { setupObject: { sections: { name: string; count: number }[] } };
    };
    expect(stored.setupObject.sections.map((section) => [section.name, section.count])).toEqual([
      ['Gold row', 3],
      ['Silver aisle', 0],
      ['Bronze corner', 9],
    ]);
    // The editor, moving a table after that, still saves.
    await layout.page.bringToFront();
    await layout.toolSelect.click();
    await layout.saved(() => layout.drag([12_000, 9000], [12_000, 14_000]));
    expect(await storedTables(request, market.marketId)).toHaveLength(3);
  });
});

test.describe('A layout whose save did not land', () => {
  test('keeps what is on screen with Retry, and asks before a move in the app drops it', async ({
    authenticatedPage: page,
    request,
  }) => {
    const market = await seeded(request);
    const layout = new LayoutPage(page);
    await layout.goto(market.marketId, market.upper.id);
    await expect(layout.tables).toHaveCount(1);

    // The connection drops, and a table is added.
    await page.route('**/floorplans/save-to-market', (route) => route.abort());
    await layout.toolAdd.click();
    await layout.clickAt([15_000, 12_000]);
    await expect(layout.saveState).toContainText(
      'You seem to be offline. Check the connection and try again.',
    );
    await expect(layout.saveRetry).toBeVisible();
    await expect(layout.table(GOLD_2)).toBeVisible();

    // Another location's layout would drop it: the app asks first, and Stay keeps the table.
    await layout.location('Lower Hall').click();
    await expect(page.getByTestId('unsaved-work-sentence')).toHaveText(
      "This layout's last changes are not saved. Leaving drops them.",
    );
    await page.getByTestId('unsaved-work-cancel-button').click();
    await expect(layout.location('Upper Hall')).toHaveAttribute('aria-current', 'page');
    await expect(layout.table(GOLD_2)).toBeVisible();
    expect(await storedTables(request, market.marketId)).toHaveLength(1);

    // The connection is back, and Retry sends it; then a move asks nothing.
    await page.unroute('**/floorplans/save-to-market');
    await layout.saved(() => layout.saveRetry.click());
    expect(await storedTables(request, market.marketId)).toHaveLength(2);
    await layout.location('Lower Hall').click();
    await expect(layout.location('Lower Hall')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('unsaved-work-window')).toHaveCount(0);
  });
});

test.describe('A layout on the way out of the page', () => {
  // The browser's own User-Agent, not the Desktop Chrome device's: Playwright sets the device's
  // through DevTools, which does not reach a request a page sends from `pagehide`, and the back
  // end's "strong" session protection refuses a request from another browser with a 401
  // (`the-plan-saves-one-at-a-time.spec.ts` meets the same). A person's browser sends one.
  test.use({
    userAgent: async ({ browser }, use) => {
      const cdp = await browser.newBrowserCDPSession();
      const { userAgent } = await cdp.send('Browser.getVersion');
      await cdp.detach();
      await use(userAgent);
    },
  });

  test('a reload inside the wait is asked by the browser, and keeps the last table placed', async ({
    authenticatedPage: page,
    request,
  }) => {
    const market = await seeded(request);
    const layout = new LayoutPage(page);
    await layout.goto(market.marketId, market.upper.id);
    await expect(layout.tables).toHaveCount(1);

    const asked: string[] = [];
    page.on('dialog', (dialog) => {
      asked.push(dialog.type());
      void dialog.accept();
    });

    // A table is placed and the page reloaded at once, inside the 600 ms the save waits.
    await layout.toolAdd.click();
    await layout.clickAt([15_000, 12_000]);
    await expect(layout.table(GOLD_2)).toBeVisible();
    await page.reload();

    // The browser asked first; they went, and the table was sent as the page left.
    expect(asked).toEqual(['beforeunload']);
    await expect.poll(async () => (await storedTables(request, market.marketId)).length).toBe(2);
    await page.reload();
    await expect(layout.tables).toHaveCount(2);
    await expect(layout.table(GOLD_2)).toBeVisible();
    // Nothing unsaved the second time: the browser did not ask again.
    expect(asked).toEqual(['beforeunload']);
  });
});
