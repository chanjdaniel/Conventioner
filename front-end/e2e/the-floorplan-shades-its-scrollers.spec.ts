import path from 'path';
import { fileURLToPath } from 'url';
import type { Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { FloorplanWorkflowPage } from './pages/FloorplanWorkflowPage';
import { ensureTestOrg } from './helpers/seeds';
import { savePlan } from './helpers/savePlan';

/**
 * The floorplan's scrollers follow the one rule on scrolling (T217).
 *
 * Its three that really scroll, the Sections panel, the save dialog's body and the section dialog,
 * are each a `ScrollBox`, so each shades the edge with more beyond it. The wizard's steps never
 * scrolled, in any window, since the page gives them no height to outgrow, so they are not scrollers
 * at all: a short window scrolls the page, and each canvas keeps the height it had.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOORPLAN_PATH = path.resolve(__dirname, 'fixtures', 'test-floorplan.png');

const DESK = { width: 1440, height: 900 };
const SHORT = { width: 1280, height: 500 };
const VERY_SHORT = { width: 1280, height: 300 };

async function shadesShown(page: Page, prefix: string): Promise<string[]> {
  const shown: string[] = [];
  for (const edge of ['top', 'bottom', 'left', 'right']) {
    if (await page.getByTestId(`${prefix}-shade-${edge}`).isVisible()) shown.push(edge);
  }
  return shown;
}

/** A real wheel over the box, then each shade as the place it has reached says it should be. */
async function expectShadesFollowTheScroll(page: Page, scroller: Locator, prefix: string) {
  await expect.poll(() => shadesShown(page, prefix), 'at the top').toEqual(['bottom']);

  await scroller.hover();
  await page.mouse.wheel(0, 100);
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop), 'the wheel moves it')
    .toBeGreaterThan(0);
  await expect.poll(() => shadesShown(page, prefix), 'part way').toEqual(['top', 'bottom']);

  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect.poll(() => shadesShown(page, prefix), 'at the end').toEqual(['top']);
}

/** Nothing in the wizard's card scrolls by itself: a scroller there would be outside the rule. */
function scrollersInTheWizard(page: Page): Promise<string[]> {
  return page.getByTestId('floorplan-workflow').evaluate((wizard) =>
    [wizard, ...wizard.querySelectorAll('*')]
      .filter((el) => {
        const style = getComputedStyle(el);
        const scrollable = (overflow: string) => overflow === 'auto' || overflow === 'scroll';
        return (
          (scrollable(style.overflowY) && el.scrollHeight > el.clientHeight + 1) ||
          (scrollable(style.overflowX) && el.scrollWidth > el.clientWidth + 1)
        );
      })
      .map((el) => el.className.toString()),
  );
}

test('the floorplan shades what scrolls, and its steps leave scrolling to the page', async ({
  authenticatedPage: page,
  request,
  expectAccessible,
}) => {
  test.setTimeout(120_000);
  const orgId = await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const created = await request.post(`${BACKEND_URL}/markets`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: {
      name: `Floorplan Scrollers ${Date.now()}`,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      roles: { [TEST_USER.email]: 'owner' },
      modificationList: [],
      assignmentObject: {},
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { market_id: marketId } = (await created.json()) as { market_id: string };
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
    priority: [],
    marketDates: [{ date: '2026-07-15' }],
    tiers: [],
    locations: [],
    sections: [],
    assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
  });

  await page.setViewportSize(DESK);
  const wizard = new FloorplanWorkflowPage(page);
  await wizard.goto(marketId);
  await wizard.waitForWizard();
  await wizard.uploadFloorplanImage(FLOORPLAN_PATH);
  await wizard.waitForUploadComplete();
  await wizard.clickNext();

  await test.step('the calibration canvas keeps its height, and a short window scrolls the page', async () => {
    await wizard.calibrateStage.waitFor({ state: 'visible', timeout: 10000 });
    // 65% of the window, the floor `ScaleCalibration` sets, less its two borders.
    await expect.poll(() => heightOf(wizard.calibrateStage)).toBe(581);
    await page.setViewportSize(SHORT);
    await expect.poll(() => pageOverflows(page)).toBe(true);
    expect(await scrollersInTheWizard(page)).toEqual([]);
    await page.setViewportSize(DESK);
    await wizard.calibrateStage.scrollIntoViewIfNeeded();
    await wizard.drawCalibrationLine();
    await expect(
      page.getByTestId('scale-calibration-length-input'),
      'focus goes into the dialog',
    ).toBeFocused();
    await page.getByTestId('scale-calibration-btn-redraw').click();
    await wizard.drawCalibrationLine();
    await expect(
      page.getByTestId('scale-calibration-length-input'),
      'and again on a redraw',
    ).toBeFocused();

    // Enter does what the focused control says: Redraw redraws, with nothing sent.
    const posted: string[] = [];
    page.on('request', (sent) => {
      if (sent.method() === 'POST' && sent.url().includes('/floorplans/calibrate')) {
        posted.push(sent.url());
      }
    });
    await page.keyboard.press('Enter');
    await expect(page.getByText('Please enter a length.'), 'Enter in the field').toBeVisible();
    expect(posted, 'an empty length sends no calibration').toEqual([]);
    await wizard.calibrateLengthInput.fill('30');
    await page.getByTestId('scale-calibration-btn-redraw').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Click & drag to draw a reference line')).toBeVisible();
    await expect(page.getByTestId('scale-calibration-result')).toBeHidden();
    expect(posted, 'Redraw sends no calibration').toEqual([]);
    await wizard.drawCalibrationLine();
    await expect(wizard.calibrateLengthInput).toBeFocused();

    await wizard.calibrateLengthInput.fill('30');
    await page.keyboard.press('Enter');
    await expect(
      page.getByTestId('scale-calibration-result'),
      'the result takes focus, and the Enter that confirmed the length leaves it open',
    ).toBeFocused();
    await wizard.calibrateBtnDone.click();
    await wizard.tableTypeAddBtn.waitFor({ state: 'visible', timeout: 5000 });
  });

  await test.step('the placed preview keeps its height', async () => {
    await wizard.addTableType('6ft Table', '1800', '900');
    await wizard.setAutoPlaceCount(4);
    await wizard.autoPlaceTables();
    await wizard.waitForNextEnabled();
    const preview = page.getByTestId('floorplan-place-preview');
    await expect.poll(() => heightOf(preview)).toBe(804);
    await page.setViewportSize(SHORT);
    await expect.poll(() => pageOverflows(page)).toBe(true);
    expect(await scrollersInTheWizard(page)).toEqual([]);
    await page.setViewportSize(DESK);
    await wizard.clickNext();
    await wizard.sectionGroupToggle.waitFor({ state: 'visible', timeout: 10000 });
    await expect.poll(() => heightOf(wizard.editorStage)).toBe(804);
  });

  await test.step('the Sections panel shades its edges, over a canvas that still takes a press', async () => {
    await wizard.listManySections(14);
    await page.setViewportSize(SHORT);
    const sections = page.getByRole('button', { name: /^Sections/ });
    await sections.click();
    const panel = page.getByTestId('floorplan-sections-panel');
    const scroller = page.getByTestId('floorplan-sections-list');
    await expect(scroller).toBeVisible();
    await scroller.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expectShadesFollowTheScroll(page, scroller, 'floorplan-sections-list');

    const ground = await panel.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        background: style.backgroundColor,
        filter: style.backdropFilter,
        pointerEvents: style.pointerEvents,
        radius: style.borderTopLeftRadius,
      };
    });
    expect(ground).toEqual({
      background: 'rgba(255, 255, 255, 0.96)',
      filter: 'blur(12px)',
      pointerEvents: 'all',
      radius: '10px',
    });

    const box = (await panel.boundingBox())!;
    const beside = { x: box.x + box.width + 24, y: box.y + box.height / 2 };
    const under = (x: number, y: number) =>
      page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.tagName, [x, y]);
    expect(await under(beside.x, beside.y), 'a press beside the panel').toBe('CANVAS');
    const over = await page.evaluate(
      ([px, py]) =>
        document.elementFromPoint(px, py)?.closest('[data-testid="floorplan-sections-panel"]') !==
        null,
      [box.x + box.width / 2, box.y + box.height - 2],
    );
    expect(over, 'a press on the panel, the shade taking no pointer').toBe(true);
    await expectAccessible('the Sections panel, scrolled');
    await sections.click();
  });

  await test.step('the section dialog shades its edges in a very short window', async () => {
    await page.setViewportSize(DESK);
    await wizard.sectionGroupToggle.click();
    await wizard.editorStage.scrollIntoViewIfNeeded();
    // A real lasso, on the part of the canvas in view: the market's sticky frame covers its top.
    const box = (await wizard.editorStage.boundingBox())!;
    const inView = { top: Math.max(box.y, 200), bottom: Math.min(box.y + box.height, DESK.height) };
    await page.mouse.move(box.x + 8, inView.top);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 8, inView.bottom - 60, { steps: 8 });
    await page.mouse.up();
    await expect(wizard.sectionDialogNameInput).toBeVisible();
    await expect(wizard.sectionDialogNameInput, 'focus goes into the dialog').toBeFocused();

    await page.setViewportSize(VERY_SHORT);
    const scroller = page.getByTestId('floorplan-section-dialog-body');
    await expectShadesFollowTheScroll(page, scroller, 'floorplan-section-dialog-body');
    await expectAccessible('the section dialog, in a very short window');
    await wizard.sectionDialogCancelBtn.click();
    await expect(wizard.sectionDialogNameInput).toBeHidden();
    await wizard.sectionGroupToggle.click();
  });

  await test.step("the save dialog's body shades its edges", async () => {
    await page.setViewportSize(DESK);
    await wizard.clickNext();
    await wizard.openSaveDialog();
    await expect(page.getByTestId('floorplan-save-dialog-body')).toBeVisible();
    await expect(
      page.getByTestId('floorplan-save-section-name').first(),
      'focus goes into the dialog',
    ).toBeFocused();
    await expectShadesFollowTheScroll(
      page,
      page.getByTestId('floorplan-save-dialog-body'),
      'floorplan-save-dialog-body',
    );
    expect(
      await page
        .getByTestId('floorplan-save-dialog')
        .evaluate((el) => getComputedStyle(el).borderTopLeftRadius),
    ).toBe('14px');
    // "1 table" beside "0 tables" must not narrow a row's fields, or the column of them does not line up.
    const names = page.getByTestId('floorplan-save-section-name');
    expect(await names.count()).toBeGreaterThan(1);
    const widths = await names.evaluateAll((all) =>
      all.map((el) => el.getBoundingClientRect().width),
    );
    expect(new Set(widths).size, `the name fields' widths: ${widths.join(', ')}`).toBe(1);
    await expectAccessible('the save dialog, scrolled');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('floorplan-save-dialog')).toBeHidden();
    await expect(wizard.saveOpenBtn, 'focus goes back to what opened it').toBeFocused();
  });
});

function heightOf(box: Locator): Promise<number> {
  return box.evaluate((el) => Math.round(el.getBoundingClientRect().height));
}

function pageOverflows(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
  );
}
