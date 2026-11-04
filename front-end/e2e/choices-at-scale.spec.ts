import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { StartFromCsvPage } from './pages/StartFromCsvPage';
import { CsvImportPage } from './pages/CsvImportPage';
import { finishStartedPlan, UPCOMING_YEAR } from './helpers/finishStartedPlan';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { decideReviewSetup } from './helpers/decideReviewSetup';
import { marketSetupPath } from './helpers/marketScreens';

/**
 * The app's choices at a real market's size (T223), on the committed synthetic exports: a choice
 * from a set that can grow is a field past 12, found by typing, and a select at 12 or fewer.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '..', '..', 'back-end', 'tests', 'test_data', 'google_forms');
const exportOf = (file: string) => readFileSync(join(CORPUS, `${file}.csv`), 'utf8');

const SELLING_ON_FIVE_DAY = 'What do you plan to sell at the fair?';
const SELLING_ON_FOUR_DAY = 'What kinds of work will you sell?';

/** Start a draft from the five-day export, with `keepAll` keeping every answer to its selling. */
async function startFromFiveDay(
  page: Page,
  request: APIRequestContext,
  { keepAll }: { keepAll: boolean },
): Promise<string> {
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const flow = new StartFromCsvPage(page);
  await flow.open(marketId);
  await flow.chooseFile(join(CORPUS, 'five-day-grid.csv'));
  await flow.answerYear(UPCOMING_YEAR['five-day-grid']);
  if (keepAll) await flow.row(SELLING_ON_FIVE_DAY).getByTestId('proposal-row-keep-all').click();
  await flow.confirm.click();
  await expect(page).toHaveURL(marketSetupPath(marketId, 'form'));
  await finishStartedPlan(request, BACKEND_URL, TEST_USER.email, marketId);
  await decideReviewSetup(request, BACKEND_URL, marketId);
  return marketId;
}

/** The key the started form gave its selling question. */
async function sellingKey(request: APIRequestContext, marketId: string): Promise<string> {
  const res = await request.get(`${BACKEND_URL}/markets/${marketId}`);
  const { market } = (await res.json()) as {
    market: { applicationForm: { fields: Array<{ key: string; label: string }> } };
  };
  const field = market.applicationForm.fields.find((candidate) =>
    candidate.label.startsWith(SELLING_ON_FIVE_DAY),
  );
  return field!.key;
}

/** An export's header row, by its column order, as the view addresses its columns. */
function headersOf(csv: string): string[] {
  const headers: string[] = [];
  let cell = '';
  let quoted = false;
  for (let at = 0; at < csv.length; at++) {
    const c = csv[at];
    if (quoted) {
      if (c === '"' && csv[at + 1] === '"') {
        cell += '"';
        at++;
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
  return headers;
}

test.describe('the import, on a later file', () => {
  test('finds a fix by typing among 129, with every waiting value a field', async ({
    authenticatedPage: page,
    request,
    expectAccessible,
  }) => {
    const marketId = await startFromFiveDay(page, request, { keepAll: true });
    const key = await sellingKey(request, marketId);

    const importer = new CsvImportPage(page);
    await importer.open({ id: marketId });
    const csv = exportOf('four-day-grid');
    await importer.chooseFile(csv);
    const headers = headersOf(csv);
    await importer.mapColumns(headers, {
      [SELLING_ON_FOUR_DAY]: key,
      'Full Name': 'essential_full_name',
      [headers.find((header) => header.startsWith('Would you like a half table'))!]:
        'essential_table_choice',
    });
    await importer.mapGroup(
      headers,
      headers.find((header) => header.startsWith('For each day of the fair'))!,
      'essential_tier_preference',
    );
    await importer.clickPreview();

    // All the work left is in view, and not one native list is drawn for it.
    const selling = importer.columnRow(SELLING_ON_FOUR_DAY);
    const fixes = selling.getByTestId('import-value-fixes');
    const waiting = fixes.getByTestId('import-unmatched-value');
    await expect(waiting).toHaveCount(142);
    await expect(importer.fixFields(fixes)).toHaveCount(142);
    await expect(fixes.locator('option')).toHaveCount(0);
    await expect(fixes.locator('select')).toHaveCount(0);

    // The grid's four day headings stay selects: the plan has five days to offer.
    const days = importer.groupRows.getByTestId('import-value-fixes');
    await expect(days.locator('select')).toHaveCount(4);
    await expect(importer.unresolvedWarning).toContainText('146 values still need');

    const values = await waiting.allInnerTexts();
    const [found, ignored, below] = values as [string, string, string];
    const fix = importer.valueFix(found);

    // The column of fields is one column.
    const lefts = await importer
      .fixFields(fixes)
      .evaluateAll((fields) => fields.map((field) => field.getBoundingClientRect().left));
    expect(new Set(lefts).size).toBe(1);

    // The list lies over what follows: no row moves, and it reads wider than the column.
    const nextField = importer.valueFix(below).field;
    await fix.field.scrollIntoViewIfNeeded();
    const nextBefore = await nextField.boundingBox();
    await fix.field.click();
    await expect(fix.options).toHaveCount(50);
    await expect(fix.more).toHaveText('80 more, type to narrow');
    await expect(fix.options.first()).toHaveText('Ignore this value');
    expect(await nextField.boundingBox()).toEqual(nextBefore);

    const field = (await fix.field.boundingBox())!;
    const list = (await fix.list.boundingBox())!;
    // 22rem, on the root's 16px.
    expect(list.width).toBeGreaterThanOrEqual(352);
    expect(list.x + list.width).toBeCloseTo(field.x + field.width, 0);
    const covering = await nextField.evaluate((element) => {
      const { left, top, width, height } = element.getBoundingClientRect();
      return document
        .elementFromPoint(left + width / 2, top + height / 2)
        ?.closest('[role="listbox"]')
        ?.getAttribute('data-testid');
    });
    expect(covering).toBe(`import-fix-${found}-list`);

    await expectAccessible('a value fix open among 129');

    // Words that name no answer offer no row, and clear on leaving: a fix must be offered.
    await fix.field.fill('Nothing anyone sells');
    await expect(fix.options).toHaveCount(0);
    await expect(fix.none).toHaveText('Nothing matches "Nothing anyone sells".');
    await fix.field.press('Tab');
    await expect(fix.field).toHaveValue('');
    await expect(importer.unresolvedWarning).toContainText('146 values still need');

    // One answer, found by typing a word of it; the first rows only hold the first answers.
    await fix.field.click();
    const answer = (await fix.options.last().getAttribute('data-value'))!;
    await fix.choose(answer);
    await expect(fix.field).toHaveValue(answer);
    await expect(importer.unresolvedWarning).toContainText('145 values still need');

    // "Ignore this value", which the cap never hides.
    await importer.ignoreValue(ignored);
    await expect(importer.valueFix(ignored).field).toHaveValue('Ignore this value');
    await expect(importer.unresolvedWarning).toContainText('144 values still need');

    // The rest by the keys alone: the first row is "Ignore this value", one Enter away.
    for (const value of values.slice(2)) {
      const other = importer.valueFix(value);
      await other.field.focus();
      await other.field.press('ArrowDown');
      await other.field.press('Enter');
    }
    // Each its own market day, past "Choose…" and "Ignore this value".
    const dayFixes = days.locator('select');
    for (let at = 0; at < 4; at++) {
      await dayFixes.nth(at).selectOption({ index: at + 2 });
    }
    await expect(importer.unresolvedWarning).toHaveCount(0);

    // Both reach the preview, as what the organizer chose.
    const asked = page.waitForRequest(
      (request) =>
        request.method() === 'POST' && request.url().endsWith('/applications/import/preview'),
    );
    await importer.clickPreview();
    const { resolutions } = (await asked).postDataJSON() as {
      resolutions: Record<string, Record<string, string | null>>;
    };
    expect(resolutions[key]![found]).toBe(answer);
    expect(resolutions[key]![ignored]).toBeNull();
    await expect(importer.previewCounts).toContainText('rows will be imported');
    const refusals = await importer.previewFailureRows.allInnerTexts();
    expect(refusals.filter((refusal) => refusal.includes('must be one of'))).toEqual([]);

    // Back on the columns they are decisions, each still a field naming what was chosen.
    await importer.backButton.click();
    await expect(importer.unmatchedValues).toHaveCount(0);
    await expect(selling.getByTestId('import-decided-title')).toHaveText(
      /^142 values already decided/,
    );
    await expect(importer.decidedFix(found).field).toHaveValue(answer);
    await expect(importer.decidedFix(ignored).field).toHaveValue('Ignore this value');
  });

  test('a market started as proposed keeps its selects, six decided then "Show all"', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await startFromFiveDay(page, request, { keepAll: false });
    const importer = new CsvImportPage(page);
    await importer.open({ id: marketId });
    await importer.chooseFile(exportOf('five-day-grid'));

    const box = importer.decidedBoxes.first();
    await expect(box.getByTestId('import-decided-title')).toContainText('122 values set aside');
    await expect(box.getByTestId('import-decided-unmatched-value')).toHaveCount(6);
    await expect(box.locator('select')).toHaveCount(6);
    await expect(importer.fixFields(box)).toHaveCount(0);

    const showAll = box.getByTestId('import-decided-show-all');
    await expect(showAll).toHaveText('Show all 122');
    await showAll.click();
    await expect(box.getByTestId('import-decided-unmatched-value')).toHaveCount(122);
    await expect(showAll).toHaveText('Show fewer');

    // The start's 123 decisions stand by the column they belong to: one more, on the clubs.
    const clubs = importer.decidedBoxes.nth(1);
    await expect(clubs.getByTestId('import-decided-unmatched-value')).toHaveCount(1);
    await expect(clubs.locator('select')).toHaveCount(1);
    await expect(clubs.getByTestId('import-decided-show-all')).toHaveCount(0);
  });
});

test.describe('"Maps to", on a file of 30 columns', () => {
  test('finds a question by a word of its long label, and says which column holds it', async ({
    authenticatedPage: page,
    request,
    expectAccessible,
  }) => {
    test.setTimeout(120_000);
    const marketId = await startFromFiveDay(page, request, { keepAll: false });
    const res = await request.get(`${BACKEND_URL}/markets/${marketId}`);
    const { market } = (await res.json()) as {
      market: { applicationForm: { fields: Array<{ key: string; label: string }> } };
    };
    const question = market.applicationForm.fields.find((field) =>
      field.label.startsWith('I confirm that everything I sell'),
    )!;

    const importer = new CsvImportPage(page);
    await importer.open({ id: marketId });
    const csv = exportOf('four-day-grid');
    await importer.chooseFile(csv);
    const headers = headersOf(csv);
    const at = (start: string) => headers.findIndex((header) => header.startsWith(start));
    const certify = at('I certify');
    const certifyHeader = headers[certify]!.replace(/\s+/g, ' ').trim();
    const holder = importer.targetSelectAt(certify);
    const other = importer.targetSelectAt(at('Business Twitter'));
    const below = importer.targetSelectAt(at('Are you an Example College student'));

    // One field a row, with no native list of what it offers.
    await expect(holder.field).toBeVisible();
    await expect(importer.map.locator('.ledger-select option')).toHaveCount(0);
    await expect(other.field).toHaveValue('Ignore this column');

    // Grouped, and opening it moves nothing: it lies over the rows below.
    await holder.field.scrollIntoViewIfNeeded();
    const tableBefore = await page.locator('.ledger-table').boundingBox();
    const belowBefore = await below.field.boundingBox();
    await holder.field.click();
    await expect(holder.list.getByRole('group')).toHaveCount(3);
    const inGroup = (name: string) => holder.list.getByRole('group', { name, exact: true });
    await expect(inGroup('Essential').getByRole('option').first()).toContainText(
      'Applicant email *',
    );
    await expect(inGroup('Essential').getByRole('option')).toContainText(['Submitted at']);
    await expect(inGroup('Your questions').getByRole('option')).toContainText([
      'From your sheet',
      question.label,
    ]);
    await expect(inGroup('Ignore').getByRole('option')).toHaveText([
      'Ignore this column',
      'This column has nowhere to go…',
    ]);
    expect(await below.field.boundingBox()).toEqual(belowBefore);
    expect(await page.locator('.ledger-table').boundingBox()).toEqual(tableBefore);
    await expectAccessible('"Maps to" open, grouped');

    // A word from the middle of a long label finds it, read whole on as many lines as it takes.
    await holder.field.fill('designed and made');
    const row = holder.option(question.key);
    await expect(holder.options).toHaveCount(1);
    await expect(row).toHaveText(question.label);
    expect((await row.boundingBox())!.height).toBeGreaterThan(44);
    await row.click();
    await expect(holder.list).toHaveCount(0);

    // The field holds it, and shows what fits.
    await expect(holder.field).toHaveValue(question.label);
    await expect(importer.columnRow('Business Twitter')).toBeVisible();

    // Another row finds it too, taken, and by which column; a press takes nothing.
    await other.field.fill('designed and made');
    const taken = other.option(question.key);
    await expect(taken).toHaveAttribute('aria-disabled', 'true');
    await expect(taken).toContainText(`Mapped from "${certifyHeader}"`);
    // Forced, since Playwright itself will not press what is `aria-disabled`; a person can.
    await taken.click({ force: true });
    await expect(other.list).toBeVisible();
    await other.field.press('Enter');
    await other.field.press('Tab');
    await expect(other.field).toHaveValue('Ignore this column');

    // Free again once that column lets it go.
    await holder.pick('');
    await expect(holder.field).toHaveValue('Ignore this column');
    await other.field.fill('designed and made');
    await expect(other.option(question.key)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(other.option(question.key)).not.toContainText('Mapped from');
    await other.field.press('Escape');

    // A grid holds a target as a column does, and offers its one way out.
    const firstDay = at('For each day of the fair');
    const grid = importer.groupSelectAt(firstDay);
    await grid.field.click();
    await expect(grid.list.getByRole('group', { name: 'Ignore' }).getByRole('option')).toHaveText([
      'Ignore these columns',
    ]);
    await grid.field.press('Escape');
    await importer.mapGroup(headers, headers[firstDay]!, 'essential_tier_preference');
    await other.field.fill('tier');
    await expect(other.option('essential_tier_preference')).toContainText('Mapped from "For each');
    await other.field.press('Escape');

    // The way through for a column nothing answers.
    await other.pick('__needs_a_field__');
    await expect(
      importer.columnRow('Business Twitter').getByTestId('import-needs-a-field'),
    ).toBeVisible();
    await other.pick('');

    // A list on the last row is whole, by scrolling the page.
    const last = importer.targetSelectAt(headers.length - 1);
    await last.field.click();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const list = (await last.list.boundingBox())!;
    expect(list.y + list.height).toBeLessThanOrEqual(page.viewportSize()!.height + 0.5);
    const atFoot = await last.list.evaluate((element) => {
      const { left, bottom, width } = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(left + width / 2, bottom - 2));
    });
    expect(atFoot).toBe(true);
    await last.field.press('Escape');

    // The required list empties as the mapping completes.
    const waiting = page.locator('[data-testid="import-required-target"]:not(.served)');
    await expect(waiting).not.toHaveCount(0);
    await importer.mapColumns(headers, {
      'Full Name': 'essential_full_name',
      [SELLING_ON_FOUR_DAY]: await sellingKey(request, marketId),
      [headers.find((header) => header.startsWith('Would you like a half table'))!]:
        'essential_table_choice',
    });
    await expect(waiting).toHaveCount(0);
    await expect(importer.allMapped).toBeVisible();
    await expect(importer.unmappedWarning).toHaveCount(0);
  });
});
