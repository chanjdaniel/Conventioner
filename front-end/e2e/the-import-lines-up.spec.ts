import type { Locator } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { CsvImportPage } from './pages/CsvImportPage';
import { StartFromCsvPage } from './pages/StartFromCsvPage';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { marketScreenPath } from './helpers/marketScreens';

/**
 * The import and the proposal line up (items 1 to 4 of bug 43; E26/F10/S01).
 *
 * The import showed a heading in full - one export's terms-and-conditions question ran to twenty
 * lines - left a grid's select blank until it was chosen, and started each value's "Choose…"
 * wherever the value ended. The proposal floated a rare option's "chosen by 2 - keep?" to the far
 * edge of its row, and drew its ceiling select half the width of the rest.
 */
test.use({ viewport: { width: 1440, height: 900 } });

const TERMS =
  'By applying you agree to the market rules, the setup and teardown times, the insurance ' +
  'requirements and the refund policy described in the vendor handbook. '.repeat(4) +
  'Do you agree?';

const lines = (locator: Locator) =>
  locator.evaluate((el) =>
    Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
  );

test('a long heading keeps to two lines, a grid reads as ignored, and the value choices line up', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject() },
  );
  const headers = [
    'Timestamp',
    'Email Address',
    'Full Legal Name',
    'Business name',
    'What do you sell?',
    'Which days can you attend?',
    'Which tiers will you accept?',
    'Full or half table?',
    'Rank the sections [Main Hall]',
    'Rank the sections [Garden]',
    `"${TERMS}"`,
  ];
  const csv = [
    headers.join(','),
    '2026/05/02 9:14:03,nadia@ember.test,Nadia Okonkwo,Ember Ceramics,Pottery,"Saturday one, Saturday two",Gold,full,1st,2nd,Yes',
    '2026/05/02 9:15:03,theo@thistle.test,Theo Marchetti,Thorn & Thistle,Dried flowers,Whichever Saturday has the best weather for it,Silver,half,2nd,1st,Yes',
  ].join('\n');

  const importPage = new CsvImportPage(page);
  await page.goto(marketScreenPath(marketId, 'import'));
  await importPage.chooseFile(csv);

  const terms = page.locator('.ledger-header-text').filter({ hasText: 'By applying' });
  expect(await lines(terms)).toBeLessThanOrEqual(2);
  await expect(terms).toHaveAttribute('title', TERMS);

  // Unmapped, a grid says so, as every column does.
  const grid = page.getByTestId('import-group-select-8');
  expect(await grid.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.text)).toBe(
    'Ignore these columns',
  );

  await importPage.mapColumns(headers, {
    'Full Legal Name': 'essential_full_name',
    'Business name': 'business_name',
    'What do you sell?': 'product_type',
    'Which days can you attend?': 'essential_available_dates',
    'Which tiers will you accept?': 'essential_tier_preference',
    'Full or half table?': 'essential_table_choice',
  });
  await importPage.mapGroup(headers, 'Rank the sections [Main Hall]', 'essential_section_ranking');
  await importPage.clickPreview();
  await expect(page.getByTestId('import-unmatched-value')).toHaveCount(3);
  const lefts = await page
    .locator('[data-testid="import-value-fixes"] select')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
  expect(lefts).toHaveLength(3);
  expect(new Set(lefts).size, `selects start at ${lefts.join(', ')}`).toBe(1);
});

test("the proposal keeps a rare option's count beside it, and its choices one width", async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const rare = 'Hand-poured soy candles and other small-batch home fragrance, made to order';
  const sells = ['Pottery', 'Pottery', 'Pottery', 'Prints', 'Prints', 'Prints', rare, rare];
  const csv = [
    'Timestamp,Email Address,What do you sell?',
    ...sells.map((s, i) => `2026/05/0${i + 1} 9:14:03,v${i}@example.test,"${s}"`),
  ].join('\n');

  const start = new StartFromCsvPage(page);
  await start.open(marketId);
  await start.fileInput.setInputFiles({
    name: 'responses.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  const sell = start.row('What do you sell?');
  await sell.getByTestId('proposal-row-type').selectOption('select');

  const option = sell.getByTestId('proposal-option').filter({ hasText: 'soy candles' });
  const placement = await option.evaluate((label) => {
    const count = label.querySelector('.muted')!.getBoundingClientRect();
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    let text: Text | null = null;
    while (walker.nextNode()) {
      if ((walker.currentNode.textContent ?? '').includes('soy candles')) {
        text = walker.currentNode as Text;
      }
    }
    const range = document.createRange();
    range.selectNodeContents(text!);
    const rects = Array.from(range.getClientRects());
    const last = rects[rects.length - 1];
    return {
      sameLine: Math.abs(count.top - last.top) < 4,
      gap: Math.round(count.left - last.right),
      fromStart: Math.round(count.left - rects[0].left),
    };
  });
  // Right after the option's last word, or at the start of the next line - never off at the edge.
  if (placement.sameLine) expect(placement.gap).toBeLessThan(16);
  else expect(Math.abs(placement.fromStart)).toBeLessThan(4);

  const widths = await page
    .locator('[data-testid="proposal-row-fate"], [data-testid="proposal-plan-ceiling-days"]')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
  expect(new Set(widths).size, `choices are ${widths.join(', ')} wide`).toBe(1);
});
