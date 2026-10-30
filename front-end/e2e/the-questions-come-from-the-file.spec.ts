import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, TEST_USER, BACKEND_URL, ApplicationFormPage } from './fixtures';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { marketSetupPath } from './helpers/marketScreens';
import { namelessControls } from './helpers/accessibleNames';

/**
 * The Questions tab of a market started from a Google Form's responses offers what the example
 * file said (E38/F02/S02): a question turned into a Select takes its options from its column, and
 * a column the start left out can become a question with its label, type and options.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', '..', 'back-end', 'tests', 'test_data', 'example_columns.csv');
const BOOTH = 4;

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
  await expect(form.addFromFile.locator('option')).toHaveText([
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
  await expect(form.addFromFile.locator('option')).toHaveText(['Choose a column', 'Notes']);

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
