import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { StartFromCsvPage } from './pages/StartFromCsvPage';
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
});
