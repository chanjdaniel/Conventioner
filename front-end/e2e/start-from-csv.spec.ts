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

  test('keeping every answer of a question keeps every applicant who gave one', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Bug 4 (E26/F02/S07): an option few applicants chose was left out, and an applicant whose
    // every answer was such an option lost their answer to a required question - and with it their
    // application. One-off answers past the first twenty could not be kept at all.
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

    const selling = flow.row('What will you be selling at the event?');
    // Said before it happens: how many applicants the left-out options would cost.
    await expect(selling.getByTestId('proposal-row-dropped')).toContainText(
      /\d+ applicants? answered only options that are left out/,
    );

    // Every answer can be seen and ticked, one-offs included.
    const listed = await selling.getByTestId('proposal-option').count();
    await selling.getByTestId('proposal-row-show-all').click();
    expect(await selling.getByTestId('proposal-option').count()).toBeGreaterThan(listed + 50);

    // And one click keeps them all.
    await selling.getByTestId('proposal-row-keep-all').click();
    await expect(selling.getByTestId('proposal-row-dropped')).toHaveCount(0);
    await expect(
      selling.locator('[data-testid="proposal-option"] input:not(:checked)'),
    ).toHaveCount(0);

    await page.getByTestId('proposal-confirm').click();
    await expect(page).toHaveURL(marketSetupPath(marketId, 'form'));
    await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_open');
    const importer = new CsvImportPage(page);
    await importer.open({ id: marketId });
    await importer.chooseFile(readFileSync(join(CORPUS, 'fall-2025.csv'), 'utf8'));
    await importer.clickPreview();
    await expect(importer.previewCounts).toBeVisible();
    const refusals = await importer.previewFailureRows.allInnerTexts();
    expect(refusals.filter((r) => r.includes('What will you be selling'))).toEqual([]);
  });

  test('an applicant whose every answer was left out is skipped for that, not as unanswered', async ({
    authenticatedPage: page,
    request,
  }) => {
    // E26 re-walk: left out on the proposal, their answers are ignored by the import, and the
    // preview said "'What will you be selling at the event?' is required" - sending the organizer to
    // a cell in their file that was filled in, when the fix is on the import's previous step.
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
    await expect(
      flow.row('What will you be selling at the event?').getByTestId('proposal-row-dropped'),
    ).toBeVisible();
    await page.getByTestId('proposal-confirm').click();
    await expect(page).toHaveURL(marketSetupPath(marketId, 'form'));
    await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_open');

    const importer = new CsvImportPage(page);
    await importer.open({ id: marketId });
    await importer.chooseFile(readFileSync(join(CORPUS, 'fall-2025.csv'), 'utf8'));
    await importer.clickPreview();
    await expect(importer.previewCounts).toBeVisible();
    const selling = (await importer.previewFailureRows.allInnerTexts()).filter((r) =>
      r.includes('What will you be selling'),
    );
    expect(selling.length).toBeGreaterThan(0);
    for (const refusal of selling) {
      expect(refusal).toContain(
        "Every answer to 'What will you be selling at the event?' is one you chose to ignore",
      );
      expect(refusal).not.toContain("'What will you be selling at the event?' is required");
    }
    await expect(page.getByTestId('import-preview-failures')).toContainText(
      'with Back for an answer you chose to ignore',
    );
  });

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
    // Nothing to ask - but what the proposal decided about the file's values is on the page, in
    // the row it belongs to, where a wrong decision can be changed (bug 28).
    await expect(importer.decidedValues.first()).toBeVisible();

    // And through Preview and Confirm, where it used to import nothing (bugs 2 and 3): Google
    // exports a ticked certification box as the box's own text, and "Full table" and "Half table"
    // name two of the three table choices. Neither may cost an applicant their application.
    await importer.clickPreview();
    await expect(importer.previewCounts).toBeVisible();
    const failures = await importer.previewFailureRows.allInnerTexts();
    expect(failures.filter((f) => /I certify|I understand/.test(f))).toEqual([]);
    expect(failures.filter((f) => f.includes("'Table choice' is required"))).toEqual([]);
    // The 16 still refused are one row with no name and 15 whose every answer was an option too
    // rare to keep (bug 4).
    await expect(importer.previewCounts).toContainText('221 of 237 rows');
    const imported = 221;

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

    // An option with a comma of its own is one answer (bug 27). It was split into "Woven (crochet"
    // and "etc)", both saved as ignored, so everyone who chose only it lost their answer.
    const WOVEN = 'Woven (crochet, knitting, etc)';
    const fragments = Object.values(saved).flatMap((byValue) => Object.keys(byValue as object));
    expect(fragments.filter((v) => v.startsWith('Woven (') || v === 'etc)')).toEqual([]);
    const chose = applications.filter((a) =>
      Object.values(a.formData).some((answer) => Array.isArray(answer) && answer.includes(WOVEN)),
    );
    expect(chose.length).toBeGreaterThan(30);
  });
});
