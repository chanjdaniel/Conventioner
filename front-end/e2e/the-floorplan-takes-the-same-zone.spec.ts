import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { FloorplanWorkflowPage } from './pages/FloorplanWorkflowPage';
import { ensureTestOrg } from './helpers/seeds';

/**
 * The floorplan wizard takes its plan on the app's one drop zone (T205, F11 of the 2026-11-02
 * walk), as the import and the start from a Google Form do: it had drawn a third design, with a
 * "Browse Files" button, no hint of its own words and no busy state.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOORPLAN_PATH = path.resolve(__dirname, 'fixtures', 'test-floorplan.png');
const LABEL = 'Drop a floorplan image or PDF here, or choose a file';

test.describe('The floorplan upload step', () => {
  let marketId: string;

  test.beforeEach(async ({ request }) => {
    const orgId = await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const created = await request.post(`${BACKEND_URL}/markets`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        name: `Floorplan Drop Zone ${Date.now()}`,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    ({ market_id: marketId } = (await created.json()) as { market_id: string });
  });

  test('offers the shared drop zone, refuses another type, and is busy while a chosen plan uploads', async ({
    authenticatedPage: page,
  }) => {
    const floorplan = new FloorplanWorkflowPage(page);
    await floorplan.goto(marketId);
    await floorplan.waitForWizard();

    const zone = floorplan.uploadDropzone;
    await expect(zone).toContainText(LABEL);
    await expect(zone).toContainText('PNG, JPG, WebP or PDF.');
    await expect(page.getByLabel(LABEL)).toHaveAttribute(
      'accept',
      'image/png,image/jpeg,image/webp,application/pdf',
    );
    await expect(page.getByRole('button', { name: 'Browse Files' })).toHaveCount(0);

    await floorplan.uploadFileInput.setInputFiles({
      name: 'hall.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a plan'),
    });
    await expect(floorplan.uploadError).toHaveText(
      'Unsupported file type. Please use PNG, JPG, WebP, or PDF.',
    );
    await expect(zone).toBeVisible();

    // Held at the server, so the step is seen while the plan uploads.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/floorplans/upload', async (route) => {
      await held;
      await route.continue();
    });

    await floorplan.uploadFloorplanImage(FLOORPLAN_PATH);
    await expect(zone).toHaveAttribute('aria-busy', 'true');
    await expect(floorplan.uploadFileInput).toBeDisabled();
    await expect(floorplan.uploadProgress).toBeVisible();
    await expect(floorplan.uploadError).toHaveCount(0);

    release();
    await floorplan.waitForUploadComplete();
    await expect(page.getByAltText('Floorplan preview')).toBeVisible();
    await expect(zone).toHaveCount(0);
    await expect(floorplan.uploadProgress).toHaveCount(0);
  });

  test('uploads a plan dropped on the zone', async ({ authenticatedPage: page }) => {
    const floorplan = new FloorplanWorkflowPage(page);
    await floorplan.goto(marketId);
    await floorplan.waitForWizard();

    const bytes = fs.readFileSync(FLOORPLAN_PATH).toString('base64');
    const dataTransfer = await page.evaluateHandle((base64) => {
      const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([binary], 'hall.png', { type: 'image/png' }));
      return transfer;
    }, bytes);

    await floorplan.uploadDropzone.dispatchEvent('dragenter', { dataTransfer });
    await expect(floorplan.uploadDropzone).toHaveAttribute('data-dragging', 'true');
    await floorplan.uploadDropzone.dispatchEvent('drop', { dataTransfer });

    await floorplan.waitForUploadComplete();
    await expect(page.getByAltText('Floorplan preview')).toBeVisible();
  });

  test('draws each page of a real PDF, and previews the page chosen', async ({
    authenticatedPage: page,
    browser,
  }) => {
    // A two-page plan, printed by the browser itself, so the suite holds no binary fixture. Every PDF
    // answered 500 while the back end drew its pages with poppler, which nothing installed.
    const printer = await browser.newPage();
    await printer.setContent(
      '<div style="height: 900px; border: 4px solid">Hall A</div>' +
        '<div style="break-before: page; height: 900px; border: 4px solid">Hall B</div>',
    );
    const pdf = await printer.pdf({ format: 'A4' });
    await printer.close();

    const floorplan = new FloorplanWorkflowPage(page);
    await floorplan.goto(marketId);
    await floorplan.waitForWizard();
    const answered = page.waitForResponse('**/floorplans/upload');
    await floorplan.uploadFileInput.setInputFiles({
      name: 'halls.pdf',
      mimeType: 'application/pdf',
      buffer: pdf,
    });
    expect((await answered).status()).toBe(201);

    // The preview is the page the server drew: the file itself draws nothing in an image.
    const preview = page.getByAltText('Floorplan preview');
    const drawn = () => preview.evaluate((image: HTMLImageElement) => image.naturalWidth);
    await expect.poll(drawn).toBeGreaterThan(0);
    const first = await preview.getAttribute('src');
    await expect(page.getByRole('radio')).toHaveCount(2);
    await floorplan.waitForUploadComplete();

    await page.getByRole('radio').nth(1).check();
    await expect(preview).not.toHaveAttribute('src', first ?? '');
    await expect.poll(drawn).toBeGreaterThan(0);
  });
});
