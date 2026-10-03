import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { FloorplanWorkflowPage } from './pages/FloorplanWorkflowPage';
import { marketSetupPath } from './helpers/marketScreens';
import { ensureTestOrg } from './helpers/seeds';
import { savePlan } from './helpers/savePlan';

/**
 * The floorplan beta places the tables it is asked for, and says what it did (bug 38, E26/F09/S01).
 *
 * Auto-Place placed one table per table type, with no way to ask for more and nothing to say it
 * had worked. The calibration result read its scale upside down ("1 px = 0.0145 mm" for what is
 * 1 px = 69 mm). A reference line drew only from a drag that started on the image. The choice
 * dialog promised what the wizard does not do. And a new table type seated one.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOORPLAN_PATH = path.resolve(__dirname, 'fixtures', 'test-floorplan.png');

function numberIn(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  if (!match) throw new Error(`no ${pattern} in "${text}"`);
  return Number(match[1].replace(/,/g, ''));
}

test('a floorplan is calibrated the right way round and Auto-Place places what it is asked', async ({
  authenticatedPage: page,
  request,
}) => {
  const orgId = await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const created = await request.post(`${BACKEND_URL}/markets`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: {
      name: `Floorplan Places ${Date.now()}`,
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

  // The choice makes no claim the wizard does not deliver.
  await page.goto(marketSetupPath(marketId));
  await page.getByTestId('market-setup-choose-path-button').click({ timeout: 15000 });
  const floorplanCard = page.getByTestId('choose-path-floorplan');
  await expect(floorplanCard).not.toContainText(/auto-detect|\bAI\b/i);
  await expect(page.getByTestId('choose-path-manual')).not.toContainText('step-by-step');
  await floorplanCard.click();
  await page.waitForURL(/\/markets\/[^/]+\/floorplan$/);

  const floorplan = new FloorplanWorkflowPage(page);
  await floorplan.uploadFloorplanImage(FLOORPLAN_PATH);
  await floorplan.waitForUploadComplete();
  await floorplan.clickNext();

  // A drag that starts in the empty canvas beside the image still draws, from the image's edge.
  await floorplan.calibrateStage.waitFor({ state: 'visible', timeout: 15000 });
  await floorplan.drawCalibrationLine(0.005, 0.005, 0.6, 0.5);
  await expect(floorplan.calibrateLengthInput).toBeVisible({ timeout: 5000 });
  await floorplan.calibrateLengthInput.fill('30');
  await floorplan.calibrateBtnCalibrate.click();

  // The scale reads the right way round: 30 m over N px is 30000/N mm a pixel, and N/30 px a metre.
  const reference = await page.getByTestId('floorplan-calibrate-reference').innerText();
  const pixels = numberIn(reference, /([\d,.]+)\s*px/);
  const mmPerPx = numberIn(
    await page.getByTestId('floorplan-calibrate-scale').innerText(),
    /1 px ≈ ([\d,.]+) mm/,
  );
  const pxPerM = numberIn(
    await page.getByTestId('floorplan-calibrate-inverse').innerText(),
    /1 m ≈ ([\d,.]+) px/,
  );
  expect(mmPerPx).toBeCloseTo(30000 / pixels, 0);
  expect(pxPerM).toBeCloseTo(pixels / 30, 0);
  await floorplan.calibrateBtnDone.click();

  // A new table type seats two, as a table does everywhere else.
  await floorplan.tableTypeAddBtn.click();
  await expect(
    page.getByTestId('floorplan-table-type-capacity').getByRole('button', { pressed: true }),
  ).toHaveText('2');
  await floorplan.tableTypeCancelBtn.click();
  await floorplan.addTableType('Six-foot', '1800', '750');

  // Asked for twenty, it places twenty, and says so.
  await page.getByTestId('floorplan-auto-place-count').fill('20');
  await floorplan.autoPlaceBtn.click();
  await expect(page.getByTestId('floorplan-auto-place-result')).toContainText('Placed 20', {
    timeout: 30000,
  });
});
