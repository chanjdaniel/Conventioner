import fs from 'fs';
import { randomBytes } from 'crypto';
import { crc32, deflateSync } from 'zlib';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { LayoutPage } from './pages/LayoutPage';
import { LAYOUT_FLOORPLAN_PATH, seedLayout, type SeededLayout } from './helpers/seeds';

/**
 * A location's layout begins with its floorplan (T257 ticket 02): opened from Section Setup, the
 * venue's plan is taken on the app's one drop zone (T205, F11 of the 2026-11-02 walk), as the
 * import and the start from a Google Form do, held to the upload's limits, and its scale set by a
 * line drawn over it. Every step here is a person's: a click, a file chosen or dropped, a drag.
 */
const LABEL = "Drop the floorplan's image or PDF here, or choose a file";
const STALE = 'This layout changed elsewhere. Reload to see the latest.';

/** A PDF of `pages` pages, printed by the browser itself, so the suite holds no binary fixture. */
async function printedPdf(
  browser: import('@playwright/test').Browser,
  pages: number,
): Promise<Buffer> {
  const printer = await browser.newPage();
  await printer.setContent(
    Array.from(
      { length: pages },
      (_, i) =>
        `<div style="${i ? 'break-before: page; ' : ''}height: 900px; border: 4px solid">` +
        `Hall ${i + 1}</div>`,
    ).join(''),
  );
  const pdf = await printer.pdf({ format: 'A4' });
  await printer.close();
  return pdf;
}

/** A PNG of random colours, which no encoder can pack small: about 5.8 MB at 1600 x 1200. */
function noisePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits a channel, RGB
  const rows = Buffer.concat(
    Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), randomBytes(width * 3)])),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The width the page's floorplan image is drawn from, once it has been fetched and decoded. */
async function drawnWidth(layout: LayoutPage): Promise<number> {
  const image = layout.calibrationMap.locator('image');
  await expect(image).toHaveAttribute('href', /^blob:/);
  return Number(
    await layout.calibrationMap.evaluate((svg) => (svg as SVGSVGElement).viewBox.baseVal.width),
  );
}

test.describe("A location's floorplan", () => {
  let seeded: SeededLayout;

  test.beforeEach(async ({ request }) => {
    seeded = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('Section Setup lays out each named location, and the layout opens on its drop zone', async ({
    authenticatedPage: page,
  }) => {
    await page.goto(`/markets/${seeded.marketId}/setup`);
    const layouts = page.getByTestId('plan-layouts');
    // The location with no name offers nothing.
    await expect(layouts.getByRole('listitem')).toHaveText([
      'Lay out Upper Hall',
      'Lay out Lower Hall',
    ]);

    await layouts.getByRole('button', { name: 'Lay out Upper Hall' }).click();

    await page.waitForURL(`**/markets/${seeded.marketId}/layout/${seeded.upper.id}`);
    const layout = new LayoutPage(page);
    await expect(layout.uploadDropzone).toContainText(LABEL);
    await expect(page.getByTestId('layout-panel-start')).toHaveText(
      "Upload the venue's floorplan for Upper Hall to start.",
    );
    await expect(layout.location('Upper Hall')).toHaveAttribute('aria-current', 'page');
    // It stands under the Market Setup tab.
    await expect(page.getByTestId('market-bar-tab-setup')).toHaveClass(/\bactive\b/);
  });

  test("the beta's old address lands on the market's first layout", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(`/markets/${seeded.marketId}/floorplan`);

    await page.waitForURL(`**/markets/${seeded.marketId}/layout/${seeded.upper.id}`);
    await expect(new LayoutPage(page).uploadDropzone).toBeVisible();
  });

  test('a PNG uploads, busy while it does, shows, and survives a reload', async ({
    authenticatedPage: page,
  }) => {
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);

    // Held at the server, so the zone is seen while the plan uploads.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/floorplans/upload', async (route) => {
      await held;
      await route.continue();
    });
    await layout.uploadFileInput.setInputFiles(LAYOUT_FLOORPLAN_PATH);
    await expect(layout.uploadDropzone).toHaveAttribute('aria-busy', 'true');
    await expect(layout.uploadFileInput).toBeDisabled();
    await expect(layout.uploadProgress).toHaveText('Uploading…');
    release();

    await expect(layout.calibrationMap).toBeVisible();
    await expect(layout.saveState).toHaveText('Saved');
    await expect(layout.scale).toHaveText('Not calibrated');
    expect(await drawnWidth(layout)).toBe(800);

    await page.reload();
    await expect(layout.calibrationMap).toBeVisible();
    expect(await drawnWidth(layout)).toBe(800);
  });

  test('a plan dropped on the zone uploads', async ({ authenticatedPage: page }) => {
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);

    const bytes = fs.readFileSync(LAYOUT_FLOORPLAN_PATH).toString('base64');
    const dataTransfer = await page.evaluateHandle((base64) => {
      const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([binary], 'hall.png', { type: 'image/png' }));
      return transfer;
    }, bytes);
    await layout.uploadDropzone.dispatchEvent('dragenter', { dataTransfer });
    await expect(layout.uploadDropzone).toHaveAttribute('data-dragging', 'true');
    await layout.uploadDropzone.dispatchEvent('drop', { dataTransfer });

    await expect(layout.calibrationMap).toBeVisible();
  });

  test("a PDF's page chosen is the location's, and each location shows its own", async ({
    authenticatedPage: page,
    browser,
  }) => {
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);
    await layout.uploadFileInput.setInputFiles(LAYOUT_FLOORPLAN_PATH);
    await expect(layout.calibrationMap).toBeVisible();

    await layout.location('Lower Hall').click();
    await page.waitForURL(`**/layout/${seeded.lower.id}`);
    await layout.uploadFileInput.setInputFiles({
      name: 'halls.pdf',
      mimeType: 'application/pdf',
      buffer: await printedPdf(browser, 2),
    });
    // The preview is the page the server drew: a browser draws no PDF in an image.
    const preview = page.getByAltText('Page 1 of the PDF');
    await expect
      .poll(() => preview.evaluate((i: HTMLImageElement) => i.naturalWidth))
      .toBeGreaterThan(0);
    await page.getByRole('radio', { name: '2' }).check();
    await expect(layout.usePage).toHaveText('Use page 2');
    await layout.usePage.click();

    await expect(layout.calibrationMap).toBeVisible();
    // An A4 page at the server's 200 dpi, about 1,654 px across, not the PNG's 800.
    const pageWidth = await drawnWidth(layout);
    expect(pageWidth).toBeGreaterThan(1640);
    expect(pageWidth).toBeLessThan(1670);

    await page.reload();
    expect(await drawnWidth(layout)).toBe(pageWidth);
    await layout.location('Upper Hall').click();
    await page.waitForURL(`**/layout/${seeded.upper.id}`);
    expect(await drawnWidth(layout)).toBe(800);
  });

  test('a line drawn across the plan sets its scale, a reload keeps it, and Recalibrate draws it again', async ({
    authenticatedPage: page,
  }) => {
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);
    await layout.uploadFileInput.setInputFiles(LAYOUT_FLOORPLAN_PATH);
    await expect(layout.calibrationMap).toBeVisible();
    await expect(
      page.getByText('Drag across something whose length you know, like a wall or a door.'),
    ).toBeVisible();

    // No line yet, then no length: each refused with its sentence.
    await layout.setScale.click();
    await expect(layout.calibrationError).toHaveText(
      'Draw a line across something whose length you know first.',
    );
    await layout.drawLine([0, 300], [800, 300]);
    await layout.setScale.click();
    await expect(layout.calibrationError).toHaveText("Type the line's length as a number.");

    const saved = page.waitForResponse('**/floorplans/save-to-market');
    await layout.length.fill('30');
    await layout.setScale.click();
    expect((await saved).status()).toBe(200);

    await expect(layout.scale).toHaveText('30.0 m across');
    await expect(layout.image).toBeVisible();
    await expect(page.getByTestId('layout-panel-floorplan')).toContainText(
      "Upper Hall's floorplan reads 30.0 m across.",
    );

    await page.reload();
    await expect(layout.scale).toHaveText('30.0 m across');

    await layout.recalibrate.click();
    // The stored line, from edge to edge (a level line has no height, so it is read, not seen).
    await expect(layout.calibrationLine).toHaveAttribute('x2', '800');
    await expect(layout.length).toHaveValue('30');
    // A new line, edge to edge where the image's edge holds its ends (a line ending mid-image reads
    // a pixel or two either way), drawn clear of the stored line, whose ends a press would drag.
    await layout.drawLine([0, 150], [800, 150]);
    await layout.length.fill('60');
    await layout.setScale.click();
    await expect(layout.scale).toHaveText('60.0 m across');
  });

  test('the scale is set by keyboard too', async ({ authenticatedPage: page }) => {
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);
    await layout.uploadFileInput.setInputFiles(LAYOUT_FLOORPLAN_PATH);
    await expect(layout.calibrationMap).toBeVisible();

    await layout.calibrationMap.focus();
    // From the centre (400, 300), 80 px a Shift press: to the left edge, then the right.
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Enter');
    for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Line drawn. Type its length.')).toBeAttached();
    await layout.length.fill('36');
    await layout.setScale.click();

    await expect(layout.scale).toHaveText('36.0 m across');
  });
});

test.describe("A floorplan is held to the upload's limits", () => {
  let seeded: SeededLayout;

  test.beforeEach(async ({ request }) => {
    seeded = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('a file of another type is refused with the type sentence, read as an alert', async ({
    authenticatedPage: page,
  }) => {
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);

    await layout.uploadFileInput.setInputFiles({
      name: 'hall.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a plan'),
    });

    await expect(page.getByRole('alert')).toHaveText('This file is not a PNG, JPG, WebP or PDF.');
    await expect(layout.uploadDropzone).toBeVisible();
  });

  test('a PDF over 4 MB is refused in the browser and nothing is sent', async ({
    authenticatedPage: page,
  }) => {
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);
    const sent: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/floorplans/upload')) sent.push(request.url());
    });

    await layout.uploadFileInput.setInputFiles({
      name: 'venue.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5_000_000, 32)]),
    });

    await expect(page.getByRole('alert')).toHaveText(
      'This PDF is larger than 4 MB. Export the page with the plan on it as a PNG or a smaller PDF.',
    );
    expect(sent).toEqual([]);
  });

  test('a PNG over 4 MB is made smaller and uploads', async ({ authenticatedPage: page }) => {
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);
    const png = noisePng(1600, 1200);
    expect(png.length).toBeGreaterThan(4_000_000);

    const answered = page.waitForResponse('**/floorplans/upload');
    await layout.uploadFileInput.setInputFiles({
      name: 'venue.png',
      mimeType: 'image/png',
      buffer: png,
    });
    const upload = await answered;

    expect(upload.status()).toBe(201);
    expect(Number(upload.request().headers()['content-length'] ?? 0)).toBeLessThan(4_064_000);
    await expect(layout.calibrationMap).toBeVisible();
  });

  test('a PDF of more than 20 pages is refused by the server with its sentence', async ({
    authenticatedPage: page,
    browser,
  }) => {
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);

    await layout.uploadFileInput.setInputFiles({
      name: 'venue.pdf',
      mimeType: 'application/pdf',
      buffer: await printedPdf(browser, 21),
    });

    await expect(page.getByRole('alert')).toHaveText(
      'This PDF has more than 20 pages. Send the page with the plan on it.',
    );
    await expect(layout.uploadDropzone).toBeVisible();
  });

  test('a damaged PDF is refused by the server naming the file', async ({
    authenticatedPage: page,
  }) => {
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);

    await layout.uploadFileInput.setInputFiles({
      name: 'Venue plan.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nthis is no PDF at all'),
    });

    await expect(page.getByRole('alert')).toHaveText('Venue plan.pdf could not be read as a PDF.');
  });
});

test.describe('A layout is saved once', () => {
  test("a second start of a location's layout is refused", async ({ request }) => {
    const seeded = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
      layout: true,
    });

    const again = await request.post(`${BACKEND_URL}/floorplans/save-to-market`, {
      data: {
        market_id: seeded.marketId,
        revision: 0,
        floorplan: {
          id: 'fp-another',
          locationId: seeded.upper.id,
          revision: 0,
          tables: [],
          zones: [],
          sectionStyles: [],
          startingCounts: [],
        },
      },
    });

    expect(again.status()).toBe(409);
    expect(await again.json()).toEqual({ error: STALE });
  });

  test('a save from a tab that read an older layout says so, and Reload shows the latest', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seeded = await seedLayout(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
      layout: true,
    });
    const layout = new LayoutPage(page);
    await layout.goto(seeded.marketId, seeded.upper.id);
    await expect(layout.calibrationMap).toBeVisible();

    // Another tab sets the scale meanwhile.
    const market = await (await request.get(`${BACKEND_URL}/markets/${seeded.marketId}`)).json();
    const stored = market.market.setupObject.floorplans[0];
    const elsewhere = await request.post(`${BACKEND_URL}/floorplans/save-to-market`, {
      data: {
        market_id: seeded.marketId,
        revision: stored.revision,
        floorplan: { ...stored, scalePxPerUnit: 800 / 40_000 },
      },
    });
    expect(elsewhere.ok()).toBeTruthy();

    await layout.calibrate([0, 300], [800, 300], '30');

    await expect(page.getByRole('alert')).toContainText(STALE);
    await expect(layout.scale).toHaveText('Not calibrated');
    await page.getByTestId('layout-save-reload').click();
    await expect(layout.scale).toHaveText('40.0 m across');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
