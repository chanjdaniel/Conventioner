import type { Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { mongoEval } from './helpers/mongo';
import { PHONE_AND_DESK } from './helpers/phoneWindow';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { settle } from './helpers/settle';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { VendorExportDialog } from './pages/VendorExportDialog';

/**
 * Export vendors folds its filters behind "Which vendors" (T217): one line saying which vendors are
 * in, naming what the page's filters brought, so the filters no longer take the dialog's height;
 * and a question's answers are a combobox, so hundreds of them no longer draw as a box each.
 */

const QUESTION = 'stall_kind';
const ANSWERS = Array.from({ length: 300 }, (_, at) => `Stall kind ${at + 1}`);

let marketId: string;

test.beforeAll(async ({ request }) => {
  ({ marketId } = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
  }));
  mongoEval(
    `db.markets.updateOne({ id: ${JSON.stringify(marketId)} }, { $push: { 'application_form.fields': ${JSON.stringify(
      {
        key: QUESTION,
        label: 'What kind of stall do you run?',
        type: 'select',
        required: false,
        order: 99,
        options: ANSWERS,
      },
    )} } })`,
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  seedApplicationWithStatus(marketId, 'reviewer_approved', 'ana@ember.test', {
    [QUESTION]: 'Stall kind 299',
  });
  seedApplicationWithStatus(marketId, 'reviewer_approved', 'ben@ember.test', {
    [QUESTION]: 'Stall kind 1',
  });
  seedApplicationWithStatus(marketId, 'reviewer_rejected', 'cy@ember.test', {
    [QUESTION]: 'Stall kind 2',
  });
});

async function openFromAll(
  page: Page,
  filter?: Parameters<ApplicationsAllPage['filter']>[0],
): Promise<VendorExportDialog> {
  const all = new ApplicationsAllPage(page);
  await all.goto(marketId);
  await expect(all.rows).toHaveCount(3);
  if (filter) await all.filter(filter);
  await all.exportButton.click();
  const dialog = new VendorExportDialog(page);
  await expect(dialog.summary).not.toBeEmpty();
  return dialog;
}

/** The address column of a downloaded file's rows, its header left out. */
function emailsIn(text: string): string[] {
  const lines = text.slice(1).trim().split(/\r?\n/);
  return lines.slice(1).map((line) => line.split(',')[1] ?? '');
}

/** Counts what asks for the file itself, not its preview, from here on. */
function countDownloads(page: Page): () => number {
  let asked = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/vendor-export$/.test(request.url())) asked += 1;
  });
  return () => asked;
}

for (const { name, use, phone } of PHONE_AND_DESK) {
  test.describe(name, () => {
    test.use(use);

    test('opens folded, the line naming what the page brought and the count already theirs', async ({
      authenticatedPage: page,
      expectAccessible,
    }) => {
      const dialog = await openFromAll(page, 'reviewer_rejected');

      await expect(dialog.filtersSummary).toHaveText('Status: Rejected');
      await expect(dialog.summary).toHaveText('1 vendor, 3 columns');
      await expect(dialog.filtersToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(dialog.filters).toHaveCount(0);
      await expect(dialog.filtersToggle, 'the first answer moves the focus here').toBeFocused();

      await dialog.showFilters();
      await expect(dialog.filtersToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(dialog.status('rejected')).toHaveAttribute('aria-pressed', 'true');
      await expectAccessible('the export dialog, its filters unfolded');

      // It forgets, as it forgets the words typed: every opening is folded.
      await dialog.cancelButton.click();
      await expect(dialog.window).toBeHidden();
      await new ApplicationsAllPage(page).exportButton.click();
      await expect(dialog.summary).toHaveText('1 vendor, 3 columns');
      await expect(dialog.filtersToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(dialog.filtersSummary).toHaveText('Status: Rejected');
    });

    test('unfolds in the body, with the buttons where they were, and scrolls under them', async ({
      authenticatedPage: page,
    }) => {
      const dialog = await openFromAll(page);
      await expect(dialog.filtersSummary).toHaveText('All vendors');
      const cancelAt = (await dialog.cancelButton.boundingBox())!;

      await dialog.showFilters();
      await settle(page);

      const bodyBox = (await dialog.body.boundingBox())!;
      const fieldsBox = (await dialog.filters.boundingBox())!;
      expect(fieldsBox.y, 'in the body').toBeGreaterThanOrEqual(bodyBox.y);
      expect(fieldsBox.x, 'in the body').toBeGreaterThanOrEqual(bodyBox.x);
      expect(fieldsBox.x + fieldsBox.width, 'in the body').toBeLessThanOrEqual(
        bodyBox.x + bodyBox.width,
      );

      // A dialog already at its cap holds its foot; one that grew to it can only move it down.
      await dialog.body.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await settle(page);
      const cancelNow = (await dialog.cancelButton.boundingBox())!;
      const trayAfter = (await dialog.tray.boundingBox())!;
      expect(await dialog.body.evaluate((el) => el.scrollTop), 'the body scrolls').toBeGreaterThan(
        0,
      );
      expect(cancelNow.y + cancelNow.height, 'Cancel stays in view').toBeLessThanOrEqual(
        page.viewportSize()!.height,
      );
      expect(trayAfter.y + trayAfter.height, 'the cart stays').toBeLessThanOrEqual(cancelNow.y);
      if (phone) expect(cancelNow.y, 'a phone holds its foot').toBe(cancelAt.y);
    });

    test('keeps the place filters until "Assigned" is chosen, and names them on the line', async ({
      authenticatedPage: page,
    }) => {
      const dialog = await openFromAll(page);
      await dialog.showFilters();

      const section = page.getByTestId('vendor-export-section');
      await expect(section).toHaveCount(0);
      await expect(page.getByTestId('vendor-export-date')).toHaveCount(0);

      await dialog.placed.selectOption('unplaced');
      await expect(page.getByTestId('vendor-export-date')).toBeVisible();
      await expect(section).toHaveCount(0);
      await expect(dialog.filtersSummary).toHaveText('Not assigned');

      await dialog.placed.selectOption('placed');
      await expect(section).toBeVisible();
      await expect(page.getByTestId('vendor-export-tier')).toBeVisible();
      await expect(page.getByTestId('vendor-export-size')).toBeVisible();
      await expect(dialog.filtersSummary).toHaveText('Assigned');
      await page.getByTestId('vendor-export-size').selectOption('half');
      await expect(dialog.filtersSummary).toHaveText('Assigned · Half table');

      await dialog.placed.selectOption('');
      await expect(dialog.filtersSummary).toHaveText('All vendors');
    });

    test('draws a question’s hundreds of answers as a capped combobox, and downloads what it finds', async ({
      authenticatedPage: page,
    }) => {
      const dialog = await openFromAll(page);
      await dialog.showFilters();
      const answer = dialog.answer(QUESTION);
      const input = page.getByTestId(`vendor-export-answer-${QUESTION}-input`);
      const options = page.getByTestId(`vendor-export-answer-${QUESTION}-option`);

      await expect(answer.getByRole('checkbox')).toHaveCount(0);
      await input.click();
      await expect(options).toHaveCount(50);
      await expect(page.getByTestId(`vendor-export-answer-${QUESTION}-more`)).toHaveText(
        '250 more, type to narrow',
      );

      await input.fill('Stall kind 299');
      await expect(options).toHaveCount(1);
      await options.first().click();
      await expect(page.getByTestId(`vendor-export-answer-${QUESTION}-chip`)).toContainText(
        'Stall kind 299',
      );
      await expect(dialog.summary).toHaveText('1 vendor, 3 columns');
      await expect(dialog.filtersSummary).toHaveText(
        'What kind of stall do you run?: Stall kind 299',
      );

      const { text } = await dialog.download();
      expect(emailsIn(text)).toEqual(['ana@ember.test']);
    });
  });
}

test.describe('Enter while choosing', () => {
  test('in a filter or on a tick downloads nothing, and leaves the dialog open', async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openFromAll(page);
    await dialog.showFilters();
    const downloads = countDownloads(page);
    const input = page.getByTestId(`vendor-export-answer-${QUESTION}-input`);

    for (const control of [dialog.search, dialog.mine, input, dialog.placed]) {
      await control.focus();
      await page.keyboard.press('Enter');
      await expect(dialog.window, String(control)).toBeVisible();
    }
    await expect(dialog.mine, 'Enter is not a press of the tick').not.toBeChecked();

    // A person's Enter comes after typing, and the combobox's open list keeps it for its own choice.
    await input.fill('Stall kind 2');
    await input.press('Enter');
    await expect(page.getByTestId(`vendor-export-answer-${QUESTION}-chip`)).toContainText(
      'Stall kind 2',
    );
    // Its list closed, Enter is the filter's again, and its words go.
    await input.press('Escape');
    await input.press('Enter');
    await expect(dialog.window).toBeVisible();

    await dialog.search.fill('nobody-at-all');
    await dialog.search.press('Enter');
    await expect(dialog.search).toHaveValue('nobody-at-all');

    // The answer to these words comes after any download those keys would have asked for.
    await expect(dialog.summary).toHaveText('0 vendors, 3 columns');
    expect(downloads(), 'what asked for the file').toBe(0);
  });

  test("on a toggle presses it, and on the fold's toggle unfolds it", async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openFromAll(page);
    const downloads = countDownloads(page);

    await dialog.filtersToggle.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.filtersToggle).toHaveAttribute('aria-expanded', 'true');

    await dialog.status('rejected').focus();
    await page.keyboard.press('Enter');
    await expect(dialog.status('rejected')).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.summary).toHaveText('1 vendor, 3 columns');
    await expect(dialog.window).toBeVisible();
    expect(downloads(), 'what asked for the file').toBe(0);
  });

  test('on Download CSV still downloads, so the counting above can see one', async ({
    authenticatedPage: page,
  }) => {
    const dialog = await openFromAll(page);
    const downloads = countDownloads(page);

    await dialog.downloadButton.focus();
    const download = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    await download;

    expect(downloads()).toBe(1);
    await expect(dialog.window).toBeHidden();
  });
});
