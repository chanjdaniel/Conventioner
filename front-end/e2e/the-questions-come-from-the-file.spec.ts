import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, ApplicationFormPage } from './fixtures';
import { sweep } from './helpers/contrastSweep';
import { UPCOMING_YEAR } from './helpers/finishStartedPlan';
import { seedApplication } from './helpers/seedApplication';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { namelessControls } from './helpers/accessibleNames';
import { StartFromCsvPage } from './pages/StartFromCsvPage';

/**
 * The Questions tab of a market started from a Google Form's responses offers what the example
 * file said (E38/F02/S02): a question turned into a Select takes its options from its column, and
 * a column the start left out can become a question with its label, type and options. An option
 * on such a question lists every answer the file gave that is no other option, and keeps whatever
 * is typed (T213).
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', '..', 'back-end', 'tests', 'test_data', 'example_columns.csv');
const GRID = join(
  HERE,
  '..',
  '..',
  'back-end',
  'tests',
  'test_data',
  'google_forms',
  'five-day-grid.csv',
);
const BOOTH = 4;
/** The grid's choice column: mostly one-off answers, with a few common ones. */
const SELLS = 'What do you plan to sell at the fair?';

interface Reading {
  select: string[];
  multiSelect: string[];
}
interface Column {
  key: string;
  label: string;
  question: boolean;
  options: Reading;
  answers?: Reading;
}

/** A draft market started from the five-day grid, its year answered, on its Questions step. */
async function startFromGrid(page: Page, request: APIRequestContext) {
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const started = await request.post(`${BACKEND_URL}/markets/${marketId}/csv-proposal/confirm`, {
    data: { csvContent: readFileSync(GRID, 'utf8'), year: 2025 },
  });
  expect(started.ok(), await started.text()).toBe(true);
  const market = (await (await request.get(`${BACKEND_URL}/markets/${marketId}`)).json()).market;
  const sells: Column = market.exampleColumns.find((c: Column) => c.label === SELLS);
  return { marketId, sells, form: new ApplicationFormPage(page) };
}

async function openQuestions(page: Page, form: ApplicationFormPage, marketId: string) {
  await page.goto(`${marketScreenPath(marketId, 'form')}?step=questions`);
  await form.builder.locator('.field-item').first().waitFor();
  const at = (await form.builder.locator('.field-item').allInnerTexts()).findIndex((card) =>
    card.includes(SELLS),
  );
  expect(at).toBeGreaterThanOrEqual(0);
  return at;
}

/** A reading in its order, less the options already on the question. */
const less = (reading: string[], options: string[]) =>
  reading.filter((answer) => !options.includes(answer));

test('the Questions tab fills options from the example file and adds a left-out column', async ({
  authenticatedPage: page,
  request,
  expectAccessible,
}) => {
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  // Started with "Booth size" read as a tick-box, as the walk's team column was.
  const started = await request.post(`${BACKEND_URL}/markets/${marketId}/csv-proposal/confirm`, {
    data: {
      csvContent: readFileSync(FIXTURE, 'utf8'),
      rows: [{ column: BOOTH, type: 'checkbox' }],
    },
  });
  expect(started.ok(), await started.text()).toBe(true);

  const form = new ApplicationFormPage(page);
  await page.goto(marketSetupPath(marketId));
  await form.openFormTab();
  await form.openStep('questions');
  const booth = (await form.builder.locator('.field-item').allInnerTexts()).findIndex((card) =>
    card.includes('Booth size'),
  );
  expect(booth).toBeGreaterThanOrEqual(0);
  await expect(form.typeSelect(booth)).toHaveValue('checkbox');

  // Checkbox to Select: the column's answers; to Multi-Select: the options inside them.
  await form.selectType(booth, 'select');
  await expect.poll(() => form.optionValues(booth)).toEqual(['Small', 'Large', 'Medium']);
  await expect(form.optionsFromFile(booth)).toBeVisible();

  // An edit survives a change of type, and the file's answers come back only when asked.
  await form.optionInputs(booth).nth(2).fill('Medium (shared)');
  await form.selectType(booth, 'multi_select');
  await form.selectType(booth, 'select');
  await expect.poll(() => form.optionValues(booth)).toEqual(['Small', 'Large', 'Medium (shared)']);
  await form.useFileOptionsButton(booth).click();
  await expect.poll(() => form.optionValues(booth)).toEqual(['Small', 'Large', 'Medium']);

  // The team's own "Status" column was left out; it can come back as a question.
  await expect(form.addFromFile.root.locator('option')).toHaveText([
    'Choose a column',
    'Status',
    'Notes',
  ]);
  await form.addQuestionFromFile('Status');
  const status = (await form.builder.locator('.field-item').count()) - 1;
  await expect(form.labelInput(status)).toHaveValue('Status');
  await expect(form.keyInput(status)).toHaveValue('status');
  await expect(form.typeSelect(status)).toHaveValue('select');
  await expect.poll(() => form.optionValues(status)).toEqual(['Accepted', 'Waitlist', 'Rejected']);
  await expect(form.addFromFile.root.locator('option')).toHaveText(['Choose a column', 'Notes']);

  // The walk of every control never sees a market started from a file, so this screen is looked
  // at here: the new controls are named by the words they show.
  expect(await namelessControls(page)).toEqual([]);
  await expectAccessible('the Questions step of a market started from a file');

  await form.save();
  await expect(form.saveSuccess).toBeVisible();
  const market = (await (await request.get(`${BACKEND_URL}/markets/${marketId}`)).json()).market;
  const fields = Object.fromEntries(
    market.applicationForm.fields.map((f: { key: string }) => [f.key, f]),
  );
  expect(fields.booth_size).toMatchObject({
    type: 'select',
    options: ['Small', 'Large', 'Medium'],
  });
  expect(fields.status).toMatchObject({
    type: 'select',
    options: ['Accepted', 'Waitlist', 'Rejected'],
  });
});

test('an option lists every answer the file gave that is no other option, and keeps what is typed', async ({
  authenticatedPage: page,
  request,
  expectAccessible,
}) => {
  const { marketId, sells, form } = await startFromGrid(page, request);
  const every = sells.answers!.multiSelect;
  const common = sells.options.multiSelect;
  const at = await openQuestions(page, form, marketId);
  await expect(form.typeSelect(at)).toHaveValue('multi_select');
  await expect.poll(() => form.optionValues(at)).toEqual(common);

  // The new option, clicked with nothing typed: all of them, in order, with no cap and no counts.
  await form.fieldCard(at).getByTestId('form-field-add-option-button').click();
  const added = form.optionInputs(at).last();
  await added.click();
  const offered = less(every, common);
  await expect.poll(() => form.optionsOffered(at)).toEqual(offered);
  expect(await form.optionRows(at).allInnerTexts()).toEqual(offered);
  await expect(form.fieldCard(at).getByTestId('form-field-option-more')).toHaveCount(0);

  // One-offs are among them, and nothing that holds an address, a link, a handle or a phone number.
  const oneOff = offered.find((answer) => answer.length > 5)!;
  expect(common).not.toContain(oneOff);
  expect(offered.filter((answer) => /@|:\/\/|\d{7}/.test(answer))).toEqual([]);

  expect(await namelessControls(page)).toEqual([]);
  await expectAccessible('an option on a question from the file, its list open');

  // Typing narrows, the typed words lead, and Enter takes the active row.
  const words = oneOff.slice(1, -1).trim();
  await added.fill(words);
  const found = offered.filter((answer) => answer.toLowerCase().includes(words.toLowerCase()));
  expect(found).toContain(oneOff);
  await expect
    .poll(() => form.optionsOffered(at))
    .toEqual(found.includes(words) ? found : [words, ...found]);
  await added.press('ArrowDown');
  await added.press('Enter');
  await expect(form.optionList(at)).toHaveCount(0);
  const taken = await added.inputValue();
  expect(found).toContain(taken);

  // An arrow key opens it too, and Escape closes it, keeping the words.
  await form.fieldCard(at).getByTestId('form-field-add-option-button').click();
  const next = form.optionInputs(at).last();
  await next.focus();
  await expect(form.optionList(at)).toHaveCount(0);
  await next.press('ArrowDown');
  await expect.poll(() => form.optionsOffered(at)).toEqual(less(every, [...common, taken]));
  await next.press('Escape');
  await expect(form.optionList(at)).toHaveCount(0);
  await expect(form.validationError).toContainText('blank');

  // Words in no list are kept on leaving the field, with no word of a blank option over them.
  await next.fill('Words the file never held');
  await expect(form.validationError).toHaveCount(0);
  await form.labelInput(at).click();
  await expect(next).toHaveValue('Words the file never held');
  await expect(form.validationError).toHaveCount(0);

  // A press on what lies below an open list lands, though the list goes as the focus leaves.
  await next.fill('Words the file never held');
  await expect(form.optionList(at)).toBeVisible();
  const before = await form.optionInputs(at).count();
  await form.fieldCard(at).getByTestId('form-field-add-option-button').click();
  await expect(form.optionInputs(at)).toHaveCount(before + 1);
  await expect(form.optionList(at)).toHaveCount(0);
  await form.fieldCard(at).getByTestId('form-field-remove-option-button').last().click();
  await expect(form.optionInputs(at)).toHaveCount(before);

  // An answer on another option is not listed; the filled option keeps its own, and comes back
  // for the others once it is removed.
  const first = common[0]!;
  await next.click();
  await expect(form.optionList(at)).toBeVisible();
  expect(await form.optionsOffered(at)).not.toContain(first);
  await form.labelInput(at).click();
  await form.optionInputs(at).first().click();
  await expect.poll(() => form.optionsOffered(at)).toContain(first);
  await form.labelInput(at).click();
  await form.fieldCard(at).getByTestId('form-field-remove-option-button').first().click();
  await form.optionInputs(at).last().click();
  await expect.poll(() => form.optionsOffered(at)).toContain(first);
  await form.labelInput(at).click();

  // A Select lists the whole answers, and the list follows the type back and forth.
  const kept = await form.optionValues(at);
  await form.selectType(at, 'select');
  await form.optionInputs(at).last().click();
  await expect
    .poll(() => form.optionsOffered(at))
    .toEqual(
      less(
        sells.answers!.select,
        kept.filter((option) => option !== kept.at(-1)),
      ),
    );
  await form.labelInput(at).click();
  await form.selectType(at, 'multi_select');
  await form.optionInputs(at).last().click();
  await expect
    .poll(() => form.optionsOffered(at))
    .toEqual(
      less(
        every,
        kept.filter((option) => option !== kept.at(-1)),
      ),
    );
  await form.labelInput(at).click();

  // Saved as they stand, and the list is still whole after the read a save is followed by.
  await form.save();
  await expect(form.saveSuccess).toBeVisible();
  const market = (await (await request.get(`${BACKEND_URL}/markets/${marketId}`)).json()).market;
  const saved = market.applicationForm.fields.find((f: { key: string }) => f.key === sells.key);
  expect(saved.options).toEqual(kept);
  expect(saved.options).toContain('Words the file never held');
  await form.fieldCard(at).getByTestId('form-field-add-option-button').click();
  await form.optionInputs(at).last().click();
  await expect.poll(() => form.optionsOffered(at)).toEqual(less(every, kept));
});

test("an answer typed in other capitals takes the file's spelling, however the field is left", async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId, sells, form } = await startFromGrid(page, request);
  const every = sells.answers!.multiSelect;
  const at = await openQuestions(page, form, marketId);
  await expect.poll(() => form.optionValues(at)).toEqual(sells.options.multiSelect);
  const spelt = less(every, sells.options.multiSelect).filter(
    (answer) => answer !== answer.toLowerCase() && !every.includes(answer.toLowerCase()),
  );
  expect(spelt.length).toBeGreaterThan(1);
  const add = form.fieldCard(at).getByTestId('form-field-add-option-button');

  // Leaving by a press on the next control, as an organizer does between two options.
  await add.click();
  const left = form.optionInputs(at).last();
  await left.fill(spelt[0]!.toLowerCase());
  await form.labelInput(at).click();
  await expect(left).toHaveValue(spelt[0]!);

  // A press on what lies below its open list, which lands and adds the next option.
  await add.click();
  const before = await form.optionInputs(at).count();
  const pressed = form.optionInputs(at).nth(before - 1);
  await pressed.fill(spelt[1]!.toLowerCase());
  await expect(form.optionList(at)).toBeVisible();
  await add.click();
  await expect(form.optionInputs(at)).toHaveCount(before + 1);
  await expect(pressed).toHaveValue(spelt[1]!);
});

test('a type change and "Use the answers in your file" fill the common answers, never every one', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId, sells, form } = await startFromGrid(page, request);
  const at = await openQuestions(page, form, marketId);
  expect(sells.answers!.select.length).toBeGreaterThan(sells.options.select.length);
  expect(sells.answers!.multiSelect.length).toBeGreaterThan(sells.options.multiSelect.length);

  await form.selectType(at, 'select');
  await expect.poll(() => form.optionValues(at)).toEqual(sells.options.select);

  await form.optionInputs(at).first().fill('Words the file never held');
  await form.labelInput(at).click();
  await form.useFileOptionsButton(at).click();
  await expect.poll(() => form.optionValues(at)).toEqual(sells.options.select);
});

test('a market with no `answers` offers the common answers it kept', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId, sells, form } = await startFromGrid(page, request);
  // Standing in for a market started before the start kept them: no read serves the key.
  await page.route(`**/markets/${marketId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    for (const column of body.market.exampleColumns) delete column.answers;
    return route.fulfill({ response, json: body });
  });
  const at = await openQuestions(page, form, marketId);

  const options = await form.optionValues(at);
  const taken = options.slice(1);
  await form.optionInputs(at).first().click();
  await expect.poll(() => form.optionsOffered(at)).toEqual(less(sells.options.multiSelect, taken));
});

test('a column the start left out, retyped as a choice, offers its rare answers', async ({
  authenticatedPage: page,
  request,
  expectAccessible,
}) => {
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const started = await request.post(`${BACKEND_URL}/markets/${marketId}/csv-proposal/confirm`, {
    data: { csvContent: readFileSync(FIXTURE, 'utf8') },
  });
  expect(started.ok(), await started.text()).toBe(true);
  const market = (await (await request.get(`${BACKEND_URL}/markets/${marketId}`)).json()).market;
  const notes: Column = market.exampleColumns.find((c: Column) => c.label === 'Notes');

  const form = new ApplicationFormPage(page);
  await page.goto(marketSetupPath(marketId));
  await form.openFormTab();
  await form.openStep('questions');
  await form.addQuestionFromFile('Notes');
  const at = (await form.builder.locator('.field-item').count()) - 1;
  await form.selectType(at, 'select');
  await expect.poll(() => form.optionValues(at)).toEqual([]);
  await form.fieldCard(at).getByTestId('form-field-add-option-button').click();

  await form.optionInputs(at).click();
  expect(notes.answers!.select).toContain('Late fee');
  expect(notes.options.select).not.toContain('Late fee');
  await expect.poll(() => form.optionsOffered(at)).toEqual(notes.answers!.select);
  expect(notes.answers!.select.filter((answer) => /\d{7}|\d{3}-\d{3}-\d{4}/.test(answer))).toEqual(
    [],
  );
  await expectAccessible('an option on a question added from the file, its list open');

  // A question of no column keeps the plain input: nothing to offer, so nothing suggests it.
  await form.addField();
  const plain = (await form.builder.locator('.field-item').count()) - 1;
  await form.fillLabel(plain, 'Own question');
  await form.selectType(plain, 'select');
  await form.addOption(plain, 'Own option');
  await expect(form.optionInputs(plain)).not.toHaveAttribute('role', 'combobox');
  await expect(form.optionList(plain)).toHaveCount(0);
});

test.describe('a question of every answer the file gave', () => {
  /** A draft started from the five-day grid with "Keep all" on its choice column, at its question. */
  async function startKeepingAll(page: Page, request: APIRequestContext) {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const flow = new StartFromCsvPage(page);
    await flow.open(marketId);
    await flow.chooseFile(GRID);
    await flow.answerYear(UPCOMING_YEAR['five-day-grid']);
    await flow.row(SELLS).getByTestId('proposal-row-keep-all').click();
    await flow.confirm.click();
    await expect(page).toHaveURL(marketSetupPath(marketId, 'form'));

    const form = new ApplicationFormPage(page);
    const at = await openQuestions(page, form, marketId);
    return { marketId, form, at };
  }

  const inView = (locator: Locator) =>
    locator.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight;
    });

  test('folds at 20, and every row past the fold acts on its own option', async ({
    authenticatedPage: page,
    request,
    expectAccessible,
  }) => {
    test.setTimeout(60_000);
    const { marketId, form, at } = await startKeepingAll(page, request);
    const fold = form.optionsFold(at);
    const saved = async (): Promise<string[]> => {
      const res = await request.get(`${BACKEND_URL}/markets/${marketId}`);
      const { market } = await res.json();
      return market.applicationForm.fields.find((f: { label: string }) => f.label === SELLS)
        .options;
    };
    const all = await saved();
    expect(all).toHaveLength(129);

    // Folded: the first 20, and how many there are.
    await expect(form.optionInputs(at)).toHaveCount(20);
    await expect(fold).toContainText('Show all 129 options');
    await expect.poll(() => form.optionValues(at)).toEqual(all.slice(0, 20));
    await expectAccessible('a question of 129 options, folded');
    // No walk of the screens reaches a question this long, and the audit above leaves contrast out.
    expect((await sweep(page)).failures, 'the fold has text below AA').toEqual([]);

    // Unfolded by the keys: the rows are in place, and Tab goes on from the first new one.
    await fold.focus();
    await page.keyboard.press('Enter');
    await expect(form.optionInputs(at)).toHaveCount(129);
    await expect(fold).toContainText('Show fewer');
    const rows = form.fieldCard(at).locator('.option-row');
    await expect(rows.nth(20)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(form.optionInputs(at).nth(20)).toBeFocused();
    expect(await namelessControls(page)).toEqual([]);

    // Past the fold, an option's list holds its own answer and none another option holds, since
    // "Keep all" left it nothing else; its value and its Remove act on that row and no other.
    const row = 99;
    const input = form.optionInputs(at).nth(row);
    await input.click();
    await expect(form.optionList(at)).toBeVisible();
    await expect.poll(() => form.optionsOffered(at)).toContain(all[row]);
    expect(await form.optionsOffered(at)).not.toContain(all[row - 1]);
    await form.labelInput(at).click();
    await input.fill('Words the file never held');
    await form.labelInput(at).click();
    const edited = all.map((option, place) =>
      place === row ? 'Words the file never held' : option,
    );
    await expect.poll(() => form.optionValues(at)).toEqual(edited);
    await rows.nth(120).getByTestId('form-field-remove-option-button').click();
    const removed = edited.filter((_, place) => place !== 120);
    await expect.poll(() => form.optionValues(at)).toEqual(removed);
    await expect(fold).toContainText('Show fewer');

    // Folded again: the button comes back into view, it says the new count, and nothing is lost.
    await fold.focus();
    await page.keyboard.press('Enter');
    await expect(form.optionInputs(at)).toHaveCount(20);
    await expect(fold).toBeFocused();
    expect(await inView(fold)).toBe(true);
    await expect(fold).toContainText('Show all 128 options');
    await form.save();
    await expect(form.saveSuccess).toBeVisible();
    await expect.poll(saved).toEqual(removed);

    // "Add option" on the folded question: every row, with the new one in view and empty.
    const add = form.fieldCard(at).getByTestId('form-field-add-option-button');
    await add.click();
    await expect(form.optionInputs(at)).toHaveCount(129);
    await expect(form.optionInputs(at).last()).toHaveValue('');
    expect(await inView(form.optionInputs(at).last())).toBe(true);
    await expect(fold).toContainText('Show fewer');

    // The way back to the file's common answers reaches behind a fold too.
    await fold.focus();
    await page.keyboard.press('Enter');
    await form.useFileOptionsButton(at).click();
    await expect(form.optionsFromFile(at)).toBeVisible();
    await expect(fold).toHaveCount(0);
    await expect.poll(() => form.optionValues(at)).not.toContain('');
  });

  test('folds read only on a locked form', async ({ authenticatedPage: page, request }) => {
    const { marketId, form, at } = await startKeepingAll(page, request);
    await form.save();
    await expect(form.saveSuccess).toBeVisible();
    seedApplication(marketId);

    await page.goto(`${marketScreenPath(marketId, 'form')}?step=questions`);
    await expect(form.lockBanner).toBeVisible();
    await expect(form.optionInputs(at)).toHaveCount(20);
    await expect(form.optionInputs(at).first()).toBeDisabled();
    await expect(form.fieldCard(at).getByTestId('form-field-add-option-button')).toHaveCount(0);

    await form.optionsFold(at).click();
    await expect(form.optionInputs(at)).toHaveCount(129);
    await expect(form.optionInputs(at).last()).toBeDisabled();
    await form.optionsFold(at).click();
    await expect(form.optionInputs(at)).toHaveCount(20);
  });
});

/**
 * The Questions tab keeps the desk's 1000px floor in a phone's window (`fitsAPhone`), so the page
 * scrolls sideways there, list or no list, and a phone's own emulation widens its layout to that
 * floor; a plain window of its width measures the same column. What the list must not do is add to
 * the page's width.
 */
for (const width of [390, 1280]) {
  test.describe(`an option's open list at ${width}`, () => {
    test.use({ viewport: { width, height: 844 } });

    test('stays in its column with its remove button on the field and the rows below moved down', async ({
      authenticatedPage: page,
      request,
    }) => {
      const { marketId, sells, form } = await startFromGrid(page, request);
      const at = await openQuestions(page, form, marketId);
      await form.selectType(at, 'select');
      const add = form.fieldCard(at).getByTestId('form-field-add-option-button');
      await add.click();
      await add.click();

      const longest = sells.answers!.select.reduce((a, b) => (b.length > a.length ? b : a));
      expect(longest.length).toBeGreaterThan(50);

      const pageWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
      const closed = await pageWidth();
      const rows = form.fieldCard(at).locator('.option-row');
      const count = await rows.count();
      const row = rows.nth(count - 2);
      const below = rows.nth(count - 1);
      const field = form.optionInputs(at).nth(count - 2);
      await field.click();
      const list = form.optionList(at);
      await expect(list).toBeVisible();
      const long = form.optionRows(at).filter({ hasText: longest });
      await long.scrollIntoViewIfNeeded();
      expect(await pageWidth()).toBe(closed);

      const fieldBox = (await field.boundingBox())!;
      const listBox = (await list.boundingBox())!;
      const removeBox = (await row.getByTestId('form-field-remove-option-button').boundingBox())!;
      const longBox = (await long.boundingBox())!;
      const belowBox = (await below.boundingBox())!;

      // The remove button stays on the field's own line, not the middle of field and list.
      const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
      expect(Math.abs(middle(removeBox) - middle(fieldBox))).toBeLessThanOrEqual(1);
      // The list holds to the field's column, and the long answer wraps inside it.
      expect(listBox.x).toBeGreaterThanOrEqual(fieldBox.x - 1);
      expect(listBox.x + listBox.width).toBeLessThanOrEqual(fieldBox.x + fieldBox.width + 1);
      expect(longBox.x + longBox.width).toBeLessThanOrEqual(listBox.x + listBox.width);
      expect(await list.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
      // A row is as tall as the window's own target, a thumb's on a phone.
      const target = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--target-min')),
      );
      expect(longBox.height).toBeGreaterThanOrEqual(target);
      // The rows below move down rather than being covered.
      expect(belowBox.y).toBeGreaterThanOrEqual(listBox.y + listBox.height);
      // The name stays for a screen reader alone.
      expect((await row.locator('label').boundingBox())!.width).toBeLessThanOrEqual(1);
    });
  });
}
