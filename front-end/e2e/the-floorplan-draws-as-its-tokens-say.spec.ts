import path from 'path';
import { fileURLToPath } from 'url';
import type { Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { FloorplanWorkflowPage } from './pages/FloorplanWorkflowPage';
import { sweep } from './helpers/contrastSweep';
import { DESKTOP, LAPTOP, PHONE } from './helpers/screens';
import { ensureTestOrg } from './helpers/seeds';
import { settle } from './helpers/settle';

/**
 * What the floorplan beta's move onto tokens leans on (T221), measured where a reading of the CSS
 * could not settle it: the ground a hover is really drawn on, and the boxes whose radius a pill
 * draws the same as the raw value it replaced.
 */
const FLOORPLAN_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'test-floorplan.png',
);

/** Two lines of a step label stand about 50px tall, where a pill's corner is no longer 20px's. */
const ONE_LINE_AT_MOST = 40;

test.describe('The floorplan beta on its tokens', () => {
  let marketId: string;

  test.beforeEach(async ({ request }) => {
    const orgId = await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const created = await request.post(`${BACKEND_URL}/markets`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        name: `Floorplan Tokens ${Date.now()}`,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
        roles: { [TEST_USER.email]: 'owner' },
        modificationList: [],
        assignmentObject: {},
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    ({ market_id: marketId } = (await created.json()) as { market_id: string });
  });

  /** The Edit Layout step, with a section of all its tables. */
  async function reachEditLayout(page: Page) {
    const wizard = new FloorplanWorkflowPage(page);
    await wizard.goto(marketId);
    await wizard.reachTableTypes(FLOORPLAN_PATH);
    await wizard.addTableType('6ft Table', '1800', '900');
    await wizard.setAutoPlaceCount(4);
    await wizard.autoPlaceTables();
    await wizard.waitForNextEnabled();
    await wizard.clickNext();
    await wizard.sectionGroupToggle.waitFor({ state: 'visible', timeout: 10000 });
    await wizard.groupAllTablesIntoSection('Main', 'Main Hall');
  }

  test("a section's row and its delete button read AA on the fill they hover", async ({
    authenticatedPage: page,
  }) => {
    await reachEditLayout(page);
    await page.getByRole('button', { name: /^Sections/ }).click();

    for (const target of [
      page.getByText('Main Hall'),
      page.getByRole('button', { name: 'Delete section' }),
    ]) {
      await target.hover();
      // The row and the button both fade in their hover, and the sweep reads where it ends.
      await settle(page);

      const { failures, checked } = await sweep(page);
      expect(checked).toBeGreaterThan(0);
      expect(failures).toEqual([]);
    }
  });

  test('a wall toolbar separator is 1px wide, so its radius draws the same at any size', async ({
    authenticatedPage: page,
  }) => {
    await reachEditLayout(page);
    await page.getByLabel('Wall Editor').check();

    const separators = page.getByTestId('floorplan-wall-toolbar-separator');
    await expect(separators).toHaveCount(3);
    for (const separator of await separators.all()) {
      expect((await separator.boundingBox())?.width).toBe(1);
    }
  });

  for (const size of [DESKTOP, LAPTOP, PHONE]) {
    test(`a step label stays on one line at ${size.width}, so a pill draws its 20px corner`, async ({
      authenticatedPage: page,
    }) => {
      await page.setViewportSize(size);
      const wizard = new FloorplanWorkflowPage(page);
      await wizard.goto(marketId);
      await wizard.waitForWizard();

      const steps = page.getByRole('progressbar', { name: 'Floorplan steps' }).locator('span');
      await expect(steps).toHaveCount(5);
      for (const step of await steps.all()) {
        const box = await step.boundingBox();
        expect(box?.height, await step.innerText()).toBeLessThanOrEqual(ONE_LINE_AT_MOST);
      }
    });
  }
});
