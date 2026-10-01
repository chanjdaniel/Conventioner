import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { StartFromCsvPage } from './pages/StartFromCsvPage';
import { CsvImportPage } from './pages/CsvImportPage';
import { transitionMarket } from './helpers/seedPhaseMarket';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { marketSetupPath } from './helpers/marketScreens';

/**
 * Starting a draft from its Google Form's responses (E24/F03/S01): upload one of the five
 * anonymised exports, answer the year, and read the ledger - from the draft's own address.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '..', '..', 'back-end', 'tests', 'test_data', 'google_forms');
const FIXTURES: Record<string, number> = {
  'fall-2023': 2023,
  'spring-2024': 2024,
  'spring-2025': 2025,
  'fall-2025': 2025,
  'spring-2026': 2026,
};

/** The ledger's rows, from the file itself: a run of bracketed columns under one stem is one. */
function expectedRows(file: string): number {
  const text = readFileSync(join(CORPUS, `${file}.csv`), 'utf8');
  const headers: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      headers.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      headers.push(cell);
      break;
    } else cell += c;
  }
  let rows = 0;
  let lastStem: string | null = null;
  for (const header of headers) {
    const stem = header.trim().match(/^([\s\S]+?)\s*\[[^\]]+\]$/)?.[1];
    const collapsed = stem ? stem.replace(/\s+/g, ' ') : null;
    if (collapsed && collapsed === lastStem) continue;
    lastStem = collapsed;
    rows++;
  }
  return rows;
}

async function marketState(request: import('@playwright/test').APIRequestContext, id: string) {
  const res = await request.get(`${BACKEND_URL}/markets/${id}`);
  const market = await res.json();
  return JSON.stringify({
    form: market.applicationForm ?? null,
    setup: market.setupObject ?? null,
    mapping: market.importMapping ?? null,
    intake: market.intakeMode ?? null,
  });
}

test.describe('Start from your Google Form', () => {
  for (const [file, year] of Object.entries(FIXTURES)) {
    test(`${file}: the ledger shows every column once, and nothing is written`, async ({
      authenticatedPage: page,
      request,
    }) => {
      const { marketId } = await seedDraftMarket(
        request,
        BACKEND_URL,
        TEST_USER.email,
        TEST_USER.password,
      );
      const before = await marketState(request, marketId);
      const flow = new StartFromCsvPage(page);
      await flow.open(marketId);
      await flow.chooseFile(join(CORPUS, `${file}.csv`));

      await expect(flow.yearDialog).toBeVisible();
      await expect(flow.yearInput).toHaveValue(String(year));
      await flow.answerYear();

      await expect(flow.ledger).toBeVisible();
      await expect(flow.rows).toHaveCount(expectedRows(file));
      const planChecked = await page
        .locator('[data-testid="proposal-plan-ceiling"].checking')
        .count();
      await expect(flow.toCheck).toHaveText(String((await flow.checkedRows.count()) + planChecked));

      await flow.cancel.click();
      await expect(page).toHaveURL(marketSetupPath(marketId));
      expect(await marketState(request, marketId)).toBe(before);
    });
  }

  // Three of the five exports never asked how many days an applicant wants (bug 24). They used to
  // stop at the mapping with "Still unmapped: Number of dates you want" and no way through.
  for (const file of ['fall-2023', 'spring-2024', 'spring-2025']) {
    test(`${file}: a form that never asked how many days is imported with no personal limit`, async ({
      authenticatedPage: page,
      request,
    }) => {
      const { marketId } = await seedDraftMarket(
        request,
        BACKEND_URL,
        TEST_USER.email,
        TEST_USER.password,
      );
      const flow = new StartFromCsvPage(page);
      await flow.open(marketId);
      await flow.chooseFile(join(CORPUS, `${file}.csv`));
      await flow.answerYear();

      // Said on the proposal, where the organizer decides - not discovered at the import.
      const limit = flow.notAsked.filter({ hasText: 'Number of dates you want' });
      await expect(limit).toContainText('No personal limit');
      await page.getByTestId('proposal-confirm').click();
      await expect(page).toHaveURL(marketSetupPath(marketId, 'form'));

      await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_open');
      const importer = new CsvImportPage(page);
      await importer.open({ id: marketId });
      await importer.chooseFile(readFileSync(join(CORPUS, `${file}.csv`), 'utf8'));
      await expect(importer.allMapped).toBeVisible();
      await importer.clickPreview();
      await expect(importer.previewCounts).toBeVisible();
      const counts = (await importer.previewCounts.innerText()).match(/(\d+) of (\d+) rows/);
      const imported = Number(counts![1]);
      expect(imported).toBeGreaterThan(0);

      await importer.clickConfirm();
      await expect(importer.resultSummary).toContainText(`Imported ${imported} new applications`);
      const res = await request.get(`${BACKEND_URL}/markets/${marketId}/applications`);
      const { applications } = (await res.json()) as {
        applications: { formData: Record<string, unknown> }[];
      };
      expect(applications).toHaveLength(imported);
      expect(applications.every((a) => a.formData.essential_max_dates == null)).toBe(true);
    });
  }

  test('a file with no dates asks no year', async ({ authenticatedPage: page, request }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const flow = new StartFromCsvPage(page);
    await flow.open(marketId);
    await flow.fileInput.setInputFiles({
      name: 'responses.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Timestamp,Email Address,Business name\n' +
          [1, 2, 3, 4].map((i) => `1/${i}/2026 9:00:00,p${i}@mail.test,Shop ${i}`).join('\n'),
      ),
    });
    await expect(flow.ledger).toBeVisible();
    await expect(flow.yearDialog).toBeHidden();
  });

  test('a reload keeps the address and asks for the file again', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const flow = new StartFromCsvPage(page);
    await flow.open(marketId);
    await flow.chooseFile(join(CORPUS, 'fall-2025.csv'));
    await flow.answerYear();
    await expect(flow.ledger).toBeVisible();
    await page.reload();
    await expect(flow.upload).toBeVisible();
  });

  test('the organizer corrects the proposal, and the rail follows', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const flow = new StartFromCsvPage(page);
    await flow.open(marketId);
    await flow.chooseFile(join(CORPUS, 'spring-2026.csv'));
    await flow.answerYear();
    const toCheck = await flow.count('to-check');
    const custom = await flow.count('custom');
    const leftOut = await flow.count('left-out');

    // A left-out column brought back as a question.
    const status = flow.row('STATUS');
    await status.getByTestId('proposal-row-fate').selectOption('custom');
    await expect(page.getByTestId('proposal-count-custom')).toHaveText(String(custom + 1));
    await expect(page.getByTestId('proposal-count-left-out')).toHaveText(String(leftOut - 1));
    await expect(flow.toCheck).toHaveText(String(toCheck - 1));

    // One choice turned into several: the clubs question the rules read as one choice.
    const clubs = flow.row('Which clubs are you a member of?');
    await expect(
      clubs.getByTestId('proposal-check').filter({ hasText: 'Could allow several answers' }),
    ).toHaveCount(1);
    await clubs.getByTestId('proposal-row-type').selectOption('multi_select');
    await expect(clubs.getByTestId('proposal-check')).toHaveCount(0);
    await expect(flow.toCheck).toHaveText(String(toCheck - 2));

    // A rare option kept.
    const student = flow.row('Are you a UBC student or alumni?');
    const rare = student.getByTestId('proposal-option').filter({ hasText: 'keep?' }).first();
    await rare.locator('input').check();
    await expect(rare.locator('input')).toBeChecked();
    await expect(student.getByTestId('proposal-check')).toHaveCount(0);
    await expect(flow.toCheck).toHaveText(String(toCheck - 3));
  });

  test('the seam: confirm, open applications, and the import of the same file asks nothing', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const flow = new StartFromCsvPage(page);
    await flow.open(marketId);
    await flow.chooseFile(join(CORPUS, 'fall-2025.csv'));
    await flow.answerYear();
    await page.getByTestId('proposal-confirm').click();

    // Landed on the form, with the organizer's own questions in the file's order.
    await expect(page).toHaveURL(marketSetupPath(marketId, 'form'));
    await expect(page.getByText('Are you a UBC student or alumni?').first()).toBeVisible();

    await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_open');
    const importer = new CsvImportPage(page);
    await importer.open({ id: marketId });
    await importer.chooseFile(readFileSync(join(CORPUS, 'fall-2025.csv'), 'utf8'));
    await expect(importer.restoredBanner).toBeVisible();
    await expect(importer.allMapped).toBeVisible();
    await expect(importer.restoredNew).toHaveCount(0);
    await expect(importer.valueFixes).toHaveCount(0);
    await expect(importer.unresolvedWarning).toHaveCount(0);

    // And through Preview and Confirm, where it used to import nothing (bugs 2 and 3): Google
    // exports a ticked certification box as the box's own text, and "Full table" and "Half table"
    // name two of the three table choices. Neither may cost an applicant their application.
    await importer.clickPreview();
    await expect(importer.previewCounts).toBeVisible();
    const failures = await importer.previewFailureRows.allInnerTexts();
    expect(failures.filter((f) => /I certify|I understand/.test(f))).toEqual([]);
    expect(failures.filter((f) => f.includes("'Table choice' is required"))).toEqual([]);
    // The 30 still refused are one row with no name and 29 whose every answer was an option too
    // rare to keep (bug 4).
    await expect(importer.previewCounts).toContainText('207 of 237 rows');
    const imported = 207;

    await importer.clickConfirm();
    await expect(importer.resultSummary).toContainText(`Imported ${imported} new applications`);

    const res = await request.get(`${BACKEND_URL}/markets/${marketId}/applications`);
    const { applications } = (await res.json()) as {
      applications: { formData: Record<string, unknown> }[];
    };
    expect(applications).toHaveLength(imported);
    const choices = new Set(applications.map((a) => a.formData.essential_table_choice));
    expect([...choices].sort()).toEqual(['either', 'full', 'half']);

    // Nothing the organizer did not choose to leave out is saved as ignored.
    const body = await (await request.get(`${BACKEND_URL}/markets/${marketId}`)).json();
    const saved = (body.market ?? body).importMapping.resolutions ?? {};
    expect(saved.essential_table_choice ?? {}).toEqual({});
  });
});
