import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { LayoutPage } from './pages/LayoutPage';
import { TablesPage } from './pages/TablesPage';
import { LoginPage } from './pages/LoginPage';
import { grantMarketRole } from './helpers/grantMarketRole';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import {
  publishResults,
  seedLayout,
  seedSettledLayout,
  storedLayoutTables,
  UPPER_HALL_SECTIONED_TABLES,
  type SeededLayout,
} from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * A layout after Draft (T257 ticket 11). Past Draft, until the market is archived, where a table
 * stands still changes: a move saves and a reload keeps it. What would move a seat does not: Add
 * table, Row of tables, Fill an area, Duplicate, Remove, the Section and Table type fields and
 * Renumber are disabled under the setup-settled sentence, and the server refuses a save that adds
 * a table. An archived market's layout and a Viewer's read only, with no toolbar; and a market
 * whose results are published keeps every vendor's table through a move and a turn.
 */
const VIEWER = { email: 'e2e-layout-viewer@example.com', password: 'e2epassword123' };

const SECTIONED = UPPER_HALL_SECTIONED_TABLES;
const GOLD_1 = 'Gold row 1, Standard 6 ft';

const aLaidOutMarketIn = (request: APIRequestContext, phase: 'applications' | 'archived') =>
  seedSettledLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, phase);

async function openTheLayout(page: Page, seeded: SeededLayout): Promise<LayoutPage> {
  const layout = new LayoutPage(page);
  await layout.goto(seeded.marketId, seeded.upper.id);
  await expect(layout.tables).toHaveCount(SECTIONED.length);
  return layout;
}

/** The layout reads only: the map and its legend, no tool, no card that edits. */
async function readsOnly(layout: LayoutPage) {
  await expect(layout.map).toBeVisible();
  await expect(layout.toolbar).toHaveCount(0);
  await expect(layout.editor).toHaveCount(0);
  await expect(layout.selection).toHaveCount(0);
  await expect(layout.typesCard).toHaveCount(0);
  await expect(layout.zonesCard).toHaveCount(0);
  await expect(layout.replaceImage).toHaveCount(0);
  await expect(layout.recalibrate).toHaveCount(0);
  // Saves are the writer's to be told of.
  await expect(layout.saveState).toHaveCount(0);
  await expect(layout.sections).toBeVisible();
}

test.describe('A layout after Draft', () => {
  test('a move saves and a reload keeps it; what would move a seat is disabled', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seeded = await aLaidOutMarketIn(request, 'applications');
    const layout = await openTheLayout(page, seeded);

    await expect(page.getByTestId('layout-setup-settled')).toContainText('The setup is settled');
    await expect(layout.toolAdd).toBeDisabled();
    await expect(layout.toolRow).toBeDisabled();
    await expect(layout.toolFill).toBeDisabled();
    await expect(layout.toolSelect).toBeEnabled();
    await expect(layout.toolZone).toBeEnabled();

    // The selection's card: what moves a table stays, what changes its seat is disabled.
    await layout.table(GOLD_1).click();
    await expect(layout.selectionTitle).toHaveText('Gold row 1');
    await expect(layout.selectionSection).toBeDisabled();
    await expect(layout.selectionType).toBeDisabled();
    await expect(layout.selectionDuplicate).toBeDisabled();
    await expect(layout.selectionRow).toBeDisabled();
    await expect(layout.selectionRemove).toBeDisabled();
    await expect(layout.selectionTurn).toBeEnabled();
    // Renumber, in each section's menu, and the market's types.
    await expect(page.getByTestId('layout-panel-section-menu-sec-gold-button')).toBeDisabled();
    await expect(layout.typesAdd).toBeDisabled();
    await expect(layout.typesUseSaved).toBeDisabled();
    await expect(layout.typeRows.getByRole('button', { name: /Edit or remove/ })).toBeDisabled();
    await expect(layout.typesSave).toBeEnabled();
    // The keys that would add or remove a table do nothing, and are not listed.
    await layout.keyboardSummary.click();
    await expect(layout.keyboard).not.toContainText('Remove it');
    await expect(layout.keyboard).not.toContainText('With Row of tables on');
    await layout.table(GOLD_1).focus();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+d');
    await expect(layout.tables).toHaveCount(SECTIONED.length);

    // Dragged across the hall, Gold row 1 saves where it was let go, and keeps its number.
    // It may snap to a neighbour's line within 8 px, as any drag does.
    await layout.saved(() => layout.drag([1200, 4500], [6000, 8000]));
    await expect(layout.selectionPosition).not.toHaveText('1.2 m, 4.5 m');
    const where = (await layout.selectionPosition.textContent())!;
    await layout.saved(() => layout.selectionTurn.click());
    const moved = (await storedLayoutTables(request, BACKEND_URL, seeded.marketId)).find(
      (table) => table.sectionId === 'sec-gold' && table.number === 1,
    )!;
    expect(Math.abs(moved.xMm - 6000)).toBeLessThan(300);
    expect(Math.abs(moved.yMm - 8000)).toBeLessThan(300);
    // Seeded a quarter turned, down the west wall.
    expect(moved.rotation).toBe(180);

    await page.reload();
    await expect(layout.tables).toHaveCount(SECTIONED.length);
    await layout.table(GOLD_1).click();
    await expect(layout.selectionPosition).toHaveText(where);
  });

  test('a save that adds, removes or renumbers a table is refused with the settled sentence', async ({
    request,
  }) => {
    const seeded = await aLaidOutMarketIn(request, 'applications');
    const read = await request.get(`${BACKEND_URL}/markets/${seeded.marketId}`);
    const { market } = (await read.json()) as {
      market: {
        setupLockReason: string;
        setupObject: { floorplans: { revision: number; tables: { number: number | null }[] }[] };
      };
    };
    const [stored] = market.setupObject.floorplans;
    const [first, second, ...rest] = stored.tables;
    const changes = {
      added: [...stored.tables, { ...first, id: 'table-new', number: SECTIONED.length + 1 }],
      removed: [first, ...rest],
      renumbered: [
        { ...first, number: second.number },
        { ...second, number: first.number },
        ...rest,
      ],
    };

    for (const [change, tables] of Object.entries(changes)) {
      const saved = await request.post(`${BACKEND_URL}/floorplans/save-to-market`, {
        data: {
          market_id: seeded.marketId,
          floorplan: { ...stored, tables },
          revision: stored.revision,
        },
      });
      expect(saved.status(), change).toBe(409);
      expect(await saved.json(), change).toEqual({ error: market.setupLockReason });
    }
    expect(market.setupLockReason).toContain('The setup is settled');
  });

  test("an archived market's layout reads only, with no toolbar", async ({
    authenticatedPage: page,
    request,
  }) => {
    const seeded = await aLaidOutMarketIn(request, 'archived');
    const layout = await openTheLayout(page, seeded);

    // The rail says the market is archived, so the page says nothing of a settled setup.
    await expect(page.getByTestId('phase-rail-frozen')).toContainText('archived');
    await expect(page.getByTestId('layout-setup-settled')).toHaveCount(0);
    await readsOnly(layout);
  });

  test("a Viewer's layout reads only, in Draft and past it", async ({ page, request }) => {
    ensureVerifiedUser(VIEWER.email, VIEWER.password);
    const draft = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
      metresAcross: 30,
      tables: SECTIONED,
    });
    await grantMarketRole(request, draft.marketId, VIEWER, 'viewer');
    const settled = await aLaidOutMarketIn(request, 'applications');
    await grantMarketRole(request, settled.marketId, VIEWER, 'viewer');

    const login = new LoginPage(page);
    await login.login(VIEWER.email, VIEWER.password);
    await login.waitForMarkets();
    for (const seeded of [draft, settled]) {
      const layout = await openTheLayout(page, seeded);
      await expect(page.getByTestId('market-read-only')).toBeVisible();
      await readsOnly(layout);
    }
  });

  test('a market whose results are published keeps every table through a move and a turn', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { laidOut: true },
    );
    await publishResults(request, BACKEND_URL, TEST_USER.email, marketId);
    const vendors = ['alice@example.com', 'bob@example.com'];

    const tables = new TablesPage(page);
    const codesNow = async () => {
      await tables.goto(marketId);
      const codes: string[] = [];
      for (const vendor of vendors) {
        await expect(tables.seatOf(vendor)).toBeVisible({ timeout: 15000 });
        codes.push(await tables.tableCodeOf(tables.seatOf(vendor)));
      }
      return codes;
    };
    /** What the server keeps of the assignment, and what it says changed since its run. */
    const assignmentNow = async () => {
      const read = await request.get(`${BACKEND_URL}/markets/${marketId}`);
      const { market } = (await read.json()) as {
        market: {
          assignmentObject: { vendorAssignments: unknown[] };
          assignmentOutOfDate: string[];
        };
      };
      return [market.assignmentObject.vendorAssignments, market.assignmentOutOfDate];
    };
    const before = await codesNow();
    expect(before.every((code) => /^Hall A \d$/.test(code))).toBe(true);
    const stored = await assignmentNow();
    expect(stored[1]).toEqual([]);

    const layout = new LayoutPage(page);
    await layout.goto(marketId);
    await expect(layout.tables).toHaveCount(5);
    await layout.saved(() => layout.drag([3000, 5000], [6000, 12_000]));
    await layout.table('Hall A 2, Standard 6 ft').click();
    await layout.saved(() => layout.selectionTurn.click());

    expect(await codesNow()).toEqual(before);
    expect(await assignmentNow()).toEqual(stored);
  });
});
