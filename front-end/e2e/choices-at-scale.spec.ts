import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ApplicationFormPage } from './pages/ApplicationFormPage';
import { ChoiceField } from './pages/ChoiceField';
import { StartFromCsvPage } from './pages/StartFromCsvPage';
import { CsvImportPage } from './pages/CsvImportPage';
import { finishStartedPlan, UPCOMING_YEAR } from './helpers/finishStartedPlan';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { seedPhaseMarket } from './helpers/seedPhaseMarket';
import { decideReviewSetup } from './helpers/decideReviewSetup';
import { marketSetupPath } from './helpers/marketScreens';
import { grantMarketRole } from './helpers/grantMarketRole';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { sweep } from './helpers/contrastSweep';

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

test.describe('an automatic rejection, on the question of 129 answers', () => {
  const VIEWER = { email: 'e2e-choices-viewer@example.test', password: 'e2epassword123' };

  test.beforeAll(() => {
    ensureVerifiedUser(VIEWER.email, VIEWER.password);
  });

  async function openReviewSetup(page: Page, marketId: string) {
    await page.goto(marketSetupPath(marketId, 'form'));
    await page.getByTestId('form-step-review').click();
    await expect(page.getByTestId('automatic-rejections')).toBeVisible({ timeout: 15000 });
  }

  test('on a market of 13 choice questions, "Add a rule on" finds one by typing', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedPhaseMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'form' },
    );
    const fields = Array.from({ length: 13 }, (_, order) => ({
      key: `question_${order}`,
      label: `Question number ${order}`,
      type: 'select',
      required: false,
      options: ['Yes', 'No'],
      order,
    }));
    const form = await request.put(`${BACKEND_URL}/markets/${marketId}/application-form`, {
      data: { fields },
    });
    expect(form.ok(), await form.text()).toBeTruthy();

    await openReviewSetup(page, marketId);
    const question = new ChoiceField(page, 'rejection-rule-question');
    const add = page.getByTestId('rejection-rule-add');
    await expect(question.field).toBeVisible();
    await expect(add).toBeDisabled();

    // Words let the choice go, so Add never takes what the field does not show.
    await question.choose('question_11', 'number 11');
    await expect(add).toBeEnabled();
    await question.field.fill('number');
    await expect(add).toBeDisabled();
    await question.choose('question_11', 'number 11');

    await add.click();
    await expect(page.getByTestId('rejection-rule-question_11')).toContainText(
      'Question number 11',
    );
    await expect(question.field).toHaveValue('');
    // Twelve are left, and it stays the field it was: it counts every question.
    await expect(question.field).toBeVisible();
    // Yes and No stay the boxes they are.
    await expect(
      page.getByTestId('rejection-rule-question_11').locator('input[type="checkbox"]'),
    ).toHaveCount(2);
  });

  test('finds answers by typing, keeps them as chips when read again, and shows a Viewer them', async ({
    authenticatedPage: page,
    request,
    browser,
    expectAccessible,
  }) => {
    test.setTimeout(120_000);
    const marketId = await startFromFiveDay(page, request, { keepAll: true });
    const key = await sellingKey(request, marketId);
    const read = await request.get(`${BACKEND_URL}/markets/${marketId}`);
    const { market } = (await read.json()) as {
      market: {
        rejectionQuestions: Array<{
          key: string;
          label: string;
          answers: Array<{ value: string; label: string }>;
        }>;
      };
    };
    const selling = market.rejectionQuestions.find((candidate) => candidate.key === key)!;
    const offered = selling.answers;
    expect(offered).toHaveLength(129);
    const [first, second] = [offered.at(-1)!, offered.at(-2)!];

    const saved = () =>
      page.waitForResponse(
        (r) => r.url().endsWith('/rejection-rules') && r.request().method() === 'PUT',
      );

    // The rule starts from the market's eight choice questions, a select: what passes 12 is its answers.
    await openReviewSetup(page, marketId);
    const question = new ChoiceField(page, 'rejection-rule-question');
    const add = page.getByTestId('rejection-rule-add');
    await expect(add).toBeDisabled();
    await question.choose(key);
    await Promise.all([saved(), add.click()]);
    await expect(question.root).toHaveValue('');

    // No wall of boxes: a field, and what a rule with no answer does.
    const rule = page.getByTestId(`rejection-rule-${key}`);
    const answers = new ChoiceField(page, `rejection-answers-${key}`);
    await expect(rule.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(rule).toContainText('this rule rejects nobody');
    await expect(page.getByLabel(`Answers to ${selling.label}`, { exact: true })).toBeVisible();

    // Fifty rows, and the rest behind a word; the list stays open for the next choice.
    await answers.field.click();
    await expect(answers.options).toHaveCount(50);
    await expect(answers.more).toHaveText('79 more, type to narrow');
    await answers.field.fill(first.label);
    await Promise.all([saved(), answers.option(first.value).click()]);
    await answers.field.fill(second.label);
    await Promise.all([saved(), answers.option(second.value).click()]);
    await expect(answers.list).toBeVisible();
    await expect(answers.chips).toHaveCount(2);
    await expect(rule).not.toContainText('this rule rejects nobody');
    // From the top, or axe reads a tick that has passed under the pinned bar as too near its logo.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectAccessible('a rule of several answers, its list open');
    // No walk of the screens reaches a question this long, and the audit above leaves contrast out.
    expect((await sweep(page)).failures, 'the rule has text below AA').toEqual([]);

    // Read again, as chips and nothing else.
    await page.reload();
    await page.getByTestId('form-step-review').click();
    await expect(answers.chips).toHaveCount(2);
    await expect(answers.chips.nth(0)).toContainText(first.label);
    await expect(answers.chips.nth(1)).toContainText(second.label);
    await expect(answers.field).toHaveValue('');

    // A chip taken away goes from what is saved, and Backspace in the empty field takes the last.
    await Promise.all([saved(), answers.chipRemoves.nth(0).click()]);
    await expect(answers.chips).toHaveCount(1);
    const stored = async () => {
      const res = await request.get(`${BACKEND_URL}/markets/${marketId}`);
      return ((await res.json()) as { market: { rejectionRules: unknown } }).market.rejectionRules;
    };
    await expect.poll(stored).toEqual([{ key, answers: [second.value] }]);
    await answers.field.focus();
    await Promise.all([saved(), answers.field.press('Backspace')]);
    await expect(answers.chips).toHaveCount(0);
    await answers.field.fill(first.label);
    await Promise.all([saved(), answers.option(first.value).click()]);
    await answers.field.press('Tab');
    await expect(answers.field).toHaveValue('');
    await expect.poll(stored).toEqual([{ key, answers: [first.value] }]);

    // Someone who may not change the rule reads what it holds, and can take nothing.
    await grantMarketRole(request, marketId, VIEWER, 'viewer');
    await withUser(browser, VIEWER.email, VIEWER.password, async (viewerPage) => {
      await openReviewSetup(viewerPage, marketId);
      const fixed = new ChoiceField(viewerPage, `rejection-answers-${key}`);
      await expect(fixed.chips).toHaveCount(1);
      await expect(fixed.chips).toContainText(first.label);
      await expect(fixed.field).toBeDisabled();
      await expect(fixed.chipRemoves).toBeDisabled();
      await expect(viewerPage.getByTestId('rejection-rule-add')).toHaveCount(0);
      expect((await sweep(viewerPage)).failures, 'the fixed rule has text below AA').toEqual([]);
    });
  });
});

test.describe('a choice that adds, on the question of 129 answers', () => {
  async function startedForm(request: APIRequestContext, marketId: string) {
    const res = await request.get(`${BACKEND_URL}/markets/${marketId}`);
    const { market } = (await res.json()) as {
      market: {
        applicationForm: { fields: Array<{ key: string; options: string[] }> };
        setupObject: { priority: Array<{ target: string; ordering: string[] }> };
        exampleColumns: Array<{ key: string; label: string }>;
      };
    };
    return market;
  }

  test('three answers found and added in a row by the keys, read back in order', async ({
    authenticatedPage: page,
    request,
    expectAccessible,
  }) => {
    test.setTimeout(120_000);
    const marketId = await startFromFiveDay(page, request, { keepAll: true });
    const key = await sellingKey(request, marketId);
    const started = await startedForm(request, marketId);
    const offered = started.applicationForm.fields.find((field) => field.key === key)!.options;
    expect(offered).toHaveLength(129);
    // Whole words only one answer holds, so the first row the words find is the one wanted.
    const unique = offered.filter(
      (answer) => offered.filter((other) => other.includes(answer)).length === 1,
    );
    const wanted = [unique.at(-1)!, unique.at(-2)!, unique.at(-3)!];

    await page.goto(marketSetupPath(marketId, 'settings'));
    await page.getByTestId('priority-add-rule').click({ timeout: 15000 });
    const rule = page.getByTestId('priority-rule-row');
    await new ChoiceField(rule, 'priority-target-select').choose(key);

    const add = new ChoiceField(rule, 'priority-ordering-add');
    await expect(add.field).toHaveAttribute('placeholder', 'Add an answer');
    await expect(rule.locator('.ordering-hint')).toBeVisible();

    // "All others" leads the 129, so the cap never hides it, and the list says what it left out.
    await add.field.focus();
    await page.keyboard.press('ArrowDown');
    await expect(add.options).toHaveCount(50);
    await expect(add.options.first()).toHaveText('<All others>');
    await expect(add.more).toHaveText('80 more, type to narrow');
    await sweep(page);
    await page.keyboard.press('Escape');

    for (const [at, answer] of wanted.entries()) {
      await page.keyboard.type(answer);
      await expect(add.options.first()).toHaveText(answer);
      await page.keyboard.press('Enter');

      await expect(rule.getByTestId('priority-ordering-answer')).toHaveCount(at + 1);
      await expect(add.field).toHaveValue('');
      await expect(add.list).toHaveCount(0);
      await expect(add.field).toBeFocused();
    }
    await expect(rule.getByTestId('priority-ordering-answer')).toHaveText(wanted);
    await expect(rule.locator('.ordering-hint')).toHaveCount(0);

    // The hint gone, the list lies past the card's foot, whole: a body that scrolled cut it off there.
    await page.keyboard.press('ArrowDown');
    const pastTheCard = await add.list.evaluate((list) => {
      list.scrollIntoView({ block: 'end' });
      const box = list.getBoundingClientRect();
      const foot = list.closest('.setting-container')!.getBoundingClientRect().bottom;
      const under = document.elementFromPoint(box.left + 8, box.bottom - 8);
      return { past: box.bottom > foot, seen: list.contains(under) };
    });
    expect(pastTheCard).toEqual({ past: true, seen: true });
    await page.keyboard.press('Escape');

    // An answer added is no longer offered.
    await page.keyboard.type(wanted[0]!);
    await expect(add.none).toBeVisible();
    await add.field.fill('');
    await page.keyboard.press('Escape');

    await expect
      .poll(async () => (await startedForm(request, marketId)).setupObject.priority[0]?.ordering, {
        timeout: 15000,
      })
      .toEqual(wanted);

    await page.reload();
    const again = page.getByTestId('priority-rule-row');
    await expect(again.getByTestId('priority-ordering-answer')).toHaveText(wanted, {
      timeout: 15000,
    });
    await expect(new ChoiceField(again, 'priority-ordering-add').field).toHaveValue('');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectAccessible('a rule on a question of 129 answers');
  });

  test('"Add from your file" finds a column by typing, and stands ready for the next', async ({
    authenticatedPage: page,
    request,
  }) => {
    test.setTimeout(120_000);
    const marketId = await startFromFiveDay(page, request, { keepAll: false });
    const { exampleColumns, applicationForm } = await startedForm(request, marketId);
    expect(exampleColumns.length).toBeGreaterThan(12);
    const held = new Set(applicationForm.fields.map((field) => field.key));
    const toAdd = exampleColumns.filter((column) => !held.has(column.key));
    expect(toAdd.length).toBeGreaterThanOrEqual(2);
    const [first, second] = toAdd;

    const form = new ApplicationFormPage(page);
    await page.goto(marketSetupPath(marketId, 'form'));
    await form.openStep('questions');
    const before = await form.builder.locator('.field-item').count();

    await form.addFromFile.field.fill(first!.label);
    await form.addFromFile.option(first!.key).click();
    await expect(form.builder.locator('.field-item')).toHaveCount(before + 1);
    await expect(form.addFromFile.field).toHaveValue('');
    await expect(form.addFromFile.list).toHaveCount(0);
    await expect(form.addFromFile.field).toBeFocused();

    // Gone from the list, and the next found without leaving the field.
    await page.keyboard.type(first!.label);
    await expect(form.addFromFile.option(first!.key)).toHaveCount(0);
    await form.addFromFile.field.fill('');
    await page.keyboard.type(second!.label);
    await page.keyboard.press('Enter');
    await expect(form.builder.locator('.field-item')).toHaveCount(before + 2);
    await expect(form.labelInput(before + 1)).toHaveValue(second!.label);
  });
});
