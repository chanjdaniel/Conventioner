import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ApplicationFormPage } from './pages/ApplicationFormPage';
import { ChoiceField } from './pages/ChoiceField';
import { ToolsPage } from './pages/ToolsPage';
import { StartFromCsvPage } from './pages/StartFromCsvPage';
import { CsvImportPage } from './pages/CsvImportPage';
import { finishStartedPlan, UPCOMING_YEAR } from './helpers/finishStartedPlan';
import {
  createApplicantLoginChallenge,
  planSetupObject,
  seedApplicantMarket,
} from './helpers/seedApplicantMarket';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { seedPhaseMarket } from './helpers/seedPhaseMarket';
import { decideReviewSetup } from './helpers/decideReviewSetup';
import { marketSetupPath } from './helpers/marketScreens';
import { grantMarketRole } from './helpers/grantMarketRole';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { sweep } from './helpers/contrastSweep';
import { fakeDiscordId, seedFakeDiscordServer } from './helpers/fakeDiscord';
import { mongoEval } from './helpers/mongo';
import { PHONE } from './helpers/screens';
import {
  detectLayout,
  gates,
  minTargetAt,
  SPACE_SCALE,
  TYPE_SCALE,
} from './helpers/layoutDetectors';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import { VendorPage } from './pages/VendorPage';

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

test('a price group\'s "Add a condition on" past 12 questions shows its whole list on the card', async ({
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

  await page.goto(marketSetupPath(marketId, 'setup'));
  const card = page.getByTestId('plan-card-pricing');
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.getByTestId('pricing-add-group').click();

  const question = new ChoiceField(card, 'pricing-group-0-rule-question');
  await question.field.click();
  await expect(question.options.filter({ hasText: 'Question number 12' })).toBeVisible();

  // Nothing around the list clips it or scrolls it away: its last row answers where it is drawn.
  const last = question.options.last();
  await last.scrollIntoViewIfNeeded();
  const answers = await last.evaluate((row) => {
    const { left, top, width, height } = row.getBoundingClientRect();
    return row.contains(document.elementFromPoint(left + width / 2, top + height / 2));
  });
  expect(answers, "the list's last row is under something else").toBe(true);
  const scrolls = await card
    .getByTestId('pricing-frame')
    .evaluate((frame) => frame.scrollHeight > frame.clientHeight + 1);
  expect(scrolls, "the table's frame grew a scroller for the list").toBe(false);

  await question.choose('question_11', 'number 11');
  await card.getByTestId('pricing-group-0-rule-add').click();
  await expect(card.getByTestId('pricing-group-0-rule-question_11')).toContainText(
    'Question number 11',
  );
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

test.describe('the Discord card, on a server of 250 roles', () => {
  const WANTED_ROLE = 'Market vendor 137';
  const WANTED_QUESTION = 'Question 22, your Discord username';

  /** A draft connected to a fake server of 250 roles, on a form of 30 text questions. */
  async function connectedAtScale(request: APIRequestContext): Promise<string> {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'form' },
    );
    const guildId = fakeDiscordId();
    const botRoleId = fakeDiscordId();
    seedFakeDiscordServer({
      guildId,
      name: 'Riverside Makers',
      roles: [
        ...Array.from({ length: 249 }, (_, at) => ({
          id: `${guildId}${at}`,
          name: `Market vendor ${at}`,
          position: at + 1,
        })),
        { id: botRoleId, name: 'Conventioner', position: 250 },
      ],
      botRoles: [botRoleId],
      members: [],
    });
    const questions = Array.from({ length: 30 }, (_, at) => ({
      key: `question_${at}`,
      label: at === 22 ? WANTED_QUESTION : `Question ${at}`,
      type: 'text',
      required: false,
    }));
    mongoEval(
      `db.markets.updateOne({ id: ${JSON.stringify(marketId)} }, { $set: ${JSON.stringify({
        applicationForm: { fields: questions },
        discord: { guildId, guildName: 'Riverside Makers' },
      })} })`,
    );
    return marketId;
  }

  /** The open list stands inside the window, whole across it, whichever way it runs. */
  async function expectListInTheWindow(choice: ChoiceField): Promise<void> {
    const { left, right, width } = await choice.list.evaluate((list) => {
      const box = list.getBoundingClientRect();
      return { left: box.left, right: box.right, width: window.innerWidth };
    });
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(width);
  }

  for (const size of [{ width: 1280, height: 800 }, PHONE]) {
    test(`at ${size.width}, finds a role and a question by typing, written as taken, read back after a reload`, async ({
      authenticatedPage: page,
      request,
    }) => {
      const marketId = await connectedAtScale(request);
      await page.setViewportSize(size);
      const tools = new ToolsPage(page);
      await tools.goto(marketId);
      const role = tools.roleChoice;
      await expect(role.field, 'DISCORD_FAKE=true answers for the server').toBeVisible({
        timeout: 15000,
      });

      // The card's link opens the list: 50 of the 250, saying what it left out.
      await tools.givingNeedsRole.click();
      await expect(role.field).toBeFocused();
      await expect(role.options).toHaveCount(50);
      await expect(role.more).toHaveText('200 more, type to narrow');
      await expectListInTheWindow(role);
      await sweep(page);

      // Typing alone writes nothing.
      let writes = 0;
      page.on('request', (sent) => {
        if (sent.method() === 'PUT' && sent.url().endsWith('/discord')) writes += 1;
      });
      await page.keyboard.type(WANTED_ROLE);
      await expect(role.options).toHaveText([WANTED_ROLE]);
      expect(writes).toBe(0);

      // A word finds it, and Enter takes it: the save takes it off what is still needed.
      await page.keyboard.press('Enter');
      await expect(tools.givingNeedsRole).toHaveCount(0);
      await expect(role.field).toHaveValue(WANTED_ROLE);
      expect(writes).toBe(1);

      const question = tools.questionChoice;
      await tools.givingNeedsQuestion.click();
      await expect(question.field).toBeFocused();
      await expect(question.options).not.toHaveCount(0);
      await expectListInTheWindow(question);
      await page.keyboard.type('your discord');
      await expect(question.options).toHaveText([WANTED_QUESTION]);
      await page.keyboard.press('Enter');
      await expect(tools.givingNeedsQuestion).toHaveCount(0);
      expect(writes).toBe(2);

      await page.reload();
      await expect(role.field).toHaveValue(WANTED_ROLE, { timeout: 15000 });
      await expect(question.field).toHaveValue(WANTED_QUESTION);
    });
  }

  test('between phone and desk, the first column`s list stays in the window', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await connectedAtScale(request);
    await page.setViewportSize({ width: 700, height: 800 });
    const tools = new ToolsPage(page);
    await tools.goto(marketId);
    await expect(tools.roleChoice.field).toBeVisible({ timeout: 15000 });

    await tools.givingNeedsRole.click();
    await expect(tools.roleChoice.list).toBeVisible();
    await expectListInTheWindow(tools.roleChoice);
    await page.keyboard.press('Escape');

    await tools.givingNeedsQuestion.click();
    await expect(tools.questionChoice.list).toBeVisible();
    await expectListInTheWindow(tools.questionChoice);
  });
});

test.describe('an applicant on a question of many options', () => {
  const DATE = '2099-08-01';
  const CODE = '731846';
  /** A long answer, so a phone's narrow row wraps it. */
  const LONG_ANSWER =
    'Hand-printed linen tea towels, block-printed cushion covers and a small range of table runners';
  const WARES = [LONG_ANSWER, ...Array.from({ length: 59 }, (_, at) => `Ware ${at + 1}`)];
  const CLUBS = Array.from({ length: 60 }, (_, at) => `Club ${at + 1}`);
  const TWELVE = Array.from({ length: 12 }, (_, at) => `Day ${at + 1}`);
  const LONG_QUESTIONS = [
    {
      key: 'wares',
      label: 'What do you sell?',
      type: 'select',
      required: true,
      options: WARES,
      order: 0,
    },
    {
      key: 'clubs',
      label: 'Which clubs do you belong to?',
      type: 'multi_select',
      required: true,
      options: CLUBS,
      order: 1,
    },
    {
      key: 'short_one',
      label: 'Twelve to choose from',
      type: 'select',
      required: false,
      options: TWELVE,
      order: 2,
    },
    {
      key: 'short_several',
      label: 'Twelve to tick',
      type: 'multi_select',
      required: false,
      options: TWELVE,
      order: 3,
    },
  ];

  async function holdsItsLayout(page: Page, width: number, what: string) {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      `${what}: the page runs past the window`,
    ).toBeLessThanOrEqual(0);
    const findings = await page.evaluate(detectLayout, {
      spaceScale: SPACE_SCALE,
      textScale: TYPE_SCALE,
      minTarget: minTargetAt(width),
    });
    expect(
      findings
        .filter((finding) => gates(finding, width))
        .map((f) => `${f.kind} ${f.el}: ${f.detail}`),
      `${what}: the layout detectors' gating findings`,
    ).toEqual([]);
  }

  for (const width of [390, 320]) {
    test(`at ${width}, found by typing, several as chips, an error, a submit, read back by the organizer`, async ({
      page,
      browser,
      request,
      expectAccessible,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 844 });
      const vendor = `long-questions-${width}-${Date.now()}@example.com`;
      const market = await seedApplicantMarket(
        request,
        BACKEND_URL,
        TEST_USER.email,
        TEST_USER.password,
        { fields: LONG_QUESTIONS, setupObject: planSetupObject([DATE]) },
      );
      const form = new VendorPage(page);
      await form.goto(market.marketSlug);
      await form.requestCode(vendor);
      createApplicantLoginChallenge(market.marketId, vendor, CODE);
      await form.enterCode(CODE);
      await form.applyButton.click();
      await expect(form.form).toBeVisible({ timeout: 30000 });

      await form.fullNameInput.fill('Riley Fixture');
      await form.tierCheckbox(DATE, 'Gold').check();
      await form.maxDatesInput.fill('1');
      await form.tableChoiceRadio('full').check();

      // At 12 or fewer, the select and the checkboxes they were.
      await expect(form.input('short_one')).toHaveJSProperty('tagName', 'SELECT');
      await expect(page.getByTestId('apply-input-short_several-Day 12')).toBeVisible();
      await expect(page.getByTestId('apply-field-short_several').getByRole('checkbox')).toHaveCount(
        12,
      );

      const wares = form.longQuestion('wares');
      const clubs = form.longQuestion('clubs');
      await expect(wares.field).toHaveAttribute('placeholder', 'Find an answer');
      // One name, the question's own, as a select's; its words on the page are not read again.
      await expect(
        page.getByRole('combobox', { name: 'What do you sell? *', exact: true }),
      ).toBeVisible();
      const words = page.locator('#apply-wares-label');
      await expect(words).toHaveAttribute('aria-hidden', 'true');
      await words.click();
      await expect(wares.field).toBeFocused();

      // Saved with neither answered: each reads and is read as any question in error.
      await form.submit();
      await expect(form.fieldError('wares')).toHaveText('"What do you sell?" is required.');
      await expect(form.fieldError('clubs')).toHaveText(
        '"Which clubs do you belong to?" is required.',
      );
      await expect(wares.field).toHaveAttribute('aria-invalid', 'true');
      await expect(wares.field).toHaveAccessibleDescription('"What do you sell?" is required.');
      await expect(clubs.field).toHaveAttribute('aria-invalid', 'true');
      await expect(wares.field).toHaveCSS(
        'border-top-color',
        await form.fieldError('wares').evaluate((error) => getComputedStyle(error).color),
      );
      // A phone has no pointer to leave resting on the button, whose hover dims it.
      await page.mouse.move(0, 0);
      await holdsItsLayout(page, width, 'a question in error');
      await expectAccessible('a long question in error');
      expect((await sweep(page)).failures, 'the question in error has text below AA').toEqual([]);

      // 50 of the 60 as it opens, the long answer wrapped inside the window.
      await wares.field.click();
      await expect(wares.options).toHaveCount(50);
      await expect(wares.more).toHaveText('10 more, type to narrow');
      await holdsItsLayout(page, width, 'the list open');
      await expectAccessible('a long question, its list open');
      expect((await sweep(page)).failures, 'the open list has text below AA').toEqual([]);

      // Words it does not find say so, and clear on leaving the field: they are no answer.
      await wares.field.pressSequentially('no such ware');
      await expect(wares.none).toHaveText('Nothing matches "no such ware".');
      await page.getByTestId('apply-essential-full-name-input').click();
      await expect(wares.field).toHaveValue('');

      // Found by typing; Enter takes it and does not submit, and the error goes.
      await wares.field.click();
      await wares.field.pressSequentially('Ware 42');
      await expect(wares.options).toHaveText(['Ware 42']);
      await page.keyboard.press('Enter');
      await expect(wares.field).toHaveValue('Ware 42');
      await expect(wares.list).toHaveCount(0);
      await expect(form.form).toBeVisible();
      await expect(form.fieldError('wares')).toHaveCount(0);
      await expect(wares.field).not.toHaveAttribute('aria-invalid');

      // Several, as chips.
      await clubs.field.click();
      await clubs.field.pressSequentially('Club 7');
      await clubs.option('Club 7').click();
      await clubs.field.fill('Club 60');
      await clubs.option('Club 60').click();
      await expect(clubs.chips).toHaveCount(2);
      await expect(form.fieldError('clubs')).toHaveCount(0);
      await holdsItsLayout(page, width, 'two chips, the list open');
      await expectAccessible('a long question, two chips and its list open');
      expect((await sweep(page)).failures, 'the chips have text below AA').toEqual([]);

      // Words left in the field when it is left are no chip.
      await clubs.field.fill('Club 3');
      await page.getByTestId('apply-essential-full-name-input').click();
      await expect(clubs.field).toHaveValue('');
      await expect(clubs.chips).toHaveCount(2);

      // Backspace takes the last; one more stands in for it.
      await clubs.field.click();
      await clubs.field.press('Backspace');
      await expect(clubs.chips).toHaveText([/^Club 7/]);
      await clubs.field.fill('Club 12');
      await clubs.field.press('Enter');
      await expect(clubs.chips).toHaveCount(2);
      await clubs.field.press('Escape');
      await expect(clubs.list).toHaveCount(0);

      // With the list closed Enter submits, as the form did.
      await wares.field.click();
      await wares.field.press('Escape');
      await wares.field.press('Enter');
      await expect(form.form).toHaveCount(0, { timeout: 10000 });
      await expect(form.status).toContainText('Submitted');
      await expect(form.answer('wares')).toContainText('Ware 42');
      await expect(form.answer('clubs')).toContainText('Club 7');
      await expect(form.answer('clubs')).toContainText('Club 12');

      // Edit opens on them.
      await form.editButton.click();
      await expect(form.form).toBeVisible();
      await expect(wares.field).toHaveValue('Ware 42');
      await expect(clubs.chips).toHaveText([/^Club 7/, /^Club 12/]);
      await form.cancelButton.click();

      // The organizer reads what they sent.
      await withUser(browser, TEST_USER.email, TEST_USER.password, async (organizer) => {
        const monitor = new ApplicationMonitorPage(organizer);
        await monitor.goto(market.marketId);
        await expect(monitor.answers).toContainText('Ware 42', { timeout: 15000 });
        await expect(monitor.answers).toContainText('Club 7');
        await expect(monitor.answers).toContainText('Club 12');
      });
    });
  }

  test('a stored answer no option offers: a chip among several, and on one choice the required check speaks', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const vendor = `long-gone-${Date.now()}@example.com`;
    const market = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { fields: LONG_QUESTIONS, setupObject: planSetupObject([DATE]) },
    );
    const form = new VendorPage(page);
    await form.goto(market.marketSlug);
    await form.requestCode(vendor);
    createApplicantLoginChallenge(market.marketId, vendor, CODE);
    await form.enterCode(CODE);
    await form.applyButton.click();
    await expect(form.form).toBeVisible({ timeout: 30000 });
    await form.fullNameInput.fill('Riley Fixture');
    await form.tierCheckbox(DATE, 'Gold').check();
    await form.maxDatesInput.fill('1');
    await form.tableChoiceRadio('full').check();
    await form.longQuestion('wares').choose('Ware 1');
    await form.longQuestion('clubs').field.fill('Club 1');
    await form.longQuestion('clubs').option('Club 1').click();
    await form.submit();
    await expect(form.status).toContainText('Submitted', { timeout: 10000 });

    // The form has since stopped offering both.
    mongoEval(
      `db.applications.updateOne({market_id: ${JSON.stringify(market.marketId)}, applicant_email: ${JSON.stringify(vendor)}}, {$set: {'form_data.wares': 'A ware since gone', 'form_data.clubs': ['Club 1', 'A club since gone']}})`,
    );
    await page.reload();
    await form.editButton.click();
    await expect(form.form).toBeVisible();

    await expect(form.longQuestion('wares').field).toHaveValue('');
    await expect(form.longQuestion('clubs').chips).toHaveText([/^Club 1/, /^A club since gone/]);
    await form.submit();
    await expect(form.fieldError('wares')).toHaveText('"What do you sell?" is required.');
    await expect(form.form).toBeVisible();
  });

  test("the organizer's preview shows what an applicant will get, at either side of 12", async ({
    authenticatedPage: page,
    request,
  }) => {
    const market = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { fields: LONG_QUESTIONS, setupObject: planSetupObject([DATE]), draft: true },
    );
    await page.goto(`${marketSetupPath(market.marketId, 'form')}?step=preview`);
    const form = new ApplicationFormPage(page);
    await expect(form.preview).toBeVisible({ timeout: 15000 });

    for (const key of ['wares', 'clubs']) {
      const question = form.previewLongQuestion(key);
      await expect(question.field).toBeDisabled();
      await expect(question.field).toHaveAttribute('placeholder', 'Find an answer');
    }
    await expect(
      page.getByRole('combobox', { name: 'What do you sell? *', exact: true }),
    ).toBeVisible();
    await expect(form.previewField('short_one').locator('select')).toBeDisabled();
    await expect(form.previewField('short_several').getByRole('checkbox')).toHaveCount(12);
    expect((await sweep(page)).failures, 'the preview has text below AA').toEqual([]);
  });
});
