import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketSetupPath } from './helpers/marketScreens';
import { seedPhaseMarket } from './helpers/seedPhaseMarket';
import { savePlan } from './helpers/savePlan';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';

/**
 * The priority rules table is drawn from the primitives (E28/F03/S01).
 *
 * Each answer row was centred, so its rank and its remove control moved with the answer's length
 * and never formed a column; the answers scrolled inside a 200px box; the selects were borderless.
 */
const GOLD = { id: 1, name: 'Gold' };
const CRAFTS = [
  'Ceramics',
  'Prints and posters, hand-pulled',
  'Jewellery',
  'Candles',
  'Textiles, quilts and anything woven on a loom',
  'Zines',
  'Woodwork',
  'Glass',
  'Leather',
  'Stickers',
  'Plants',
  'Baked goods',
];

test('the answers line up, the row grows, and dragging still reorders', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const form = await request.put(`${BACKEND_URL}/markets/${marketId}/application-form`, {
    data: {
      fields: [
        { key: 'craft', label: 'Craft', type: 'select', required: true, order: 0, options: CRAFTS },
      ],
    },
  });
  expect(form.ok(), await form.text()).toBeTruthy();
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
    priority: [
      { id: 1, target: 'craft', ordering: CRAFTS, direction: null },
      { id: 2, target: 'application.submitted_at', ordering: [], direction: 'ascending' },
    ],
    marketDates: [{ date: '2099-05-01' }],
    tiers: [GOLD],
    locations: [{ name: 'Main Hall' }],
    sections: [{ name: 'Hall A', location: { name: 'Main Hall' }, tier: GOLD, count: 4 }],
    assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: 50 },
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(marketSetupPath(marketId, 'assignment'));
  const answers = page.getByTestId('priority-ordering-row');
  await expect(answers).toHaveCount(12, { timeout: 15000 });

  const geometry = await answers.evaluateAll((rows) =>
    rows.map((row) => ({
      rank: Math.round(
        row.querySelector('[data-testid="priority-ordering-rank"]')!.getBoundingClientRect().left,
      ),
      remove: Math.round(
        row.querySelector('[data-testid="priority-ordering-remove"]')!.getBoundingClientRect()
          .right,
      ),
    })),
  );
  expect(new Set(geometry.map((g) => g.rank)).size, 'the ranks form a column').toBe(1);
  expect(new Set(geometry.map((g) => g.remove)).size, 'the removes form a column').toBe(1);

  // The row grows; nothing inside it scrolls.
  const rule = page.getByTestId('priority-rule-row').first();
  const scrollers = await rule.evaluate(
    (row) =>
      [row, ...Array.from(row.querySelectorAll('*'))].filter(
        (el) => el.scrollHeight > el.clientHeight + 1,
      ).length,
  );
  expect(scrollers, 'an element inside the rule scrolls').toBe(0);
  const ruleBox = (await rule.boundingBox())!;
  expect(ruleBox.height).toBeGreaterThan(12 * 28);

  // An answer's remove is quieter than the rule's.
  const answerRemove = (await answers
    .first()
    .getByTestId('priority-ordering-remove')
    .boundingBox())!;
  const ruleRemove = (await rule.getByTestId('priority-rule-remove').boundingBox())!;
  expect(answerRemove.width).toBeLessThan(ruleRemove.width);

  // Dragging by the handle still reorders the answers.
  await answers
    .nth(1)
    .getByTestId('priority-ordering-handle')
    .dragTo(answers.nth(0), { targetPosition: { x: 10, y: 4 } });
  await expect(answers.nth(0).getByTestId('priority-ordering-answer')).toHaveText(CRAFTS[1]);
});

/**
 * A settled market draws its rules as a record, with no handles and no removes - and the answer row
 * is a four-track grid, so with two of its four items missing the rank and the answer fell into the
 * two narrow tracks and every answer wrapped a few letters to a line.
 */
test('a settled market reads its rules as a record, one answer to a line', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const market = await request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
  });
  const { market: stored } = (await market.json()) as {
    market: { setupObject: Record<string, unknown> };
  };
  await savePlan(request, BACKEND_URL, TEST_USER.email, seed.marketId, {
    ...stored.setupObject,
    priority: [
      {
        id: 1,
        target: 'application.application_type',
        ordering: ['waitlist', 'main'],
        direction: null,
      },
    ],
  });
  const published = await request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
    data: { toPhase: 'market_days' },
  });
  expect(published.ok(), await published.text()).toBeTruthy();

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(marketSetupPath(seed.marketId, 'assignment'));
  await expect(page.getByTestId('assignment-rules-settled')).toBeVisible({ timeout: 15000 });
  const answers = page.getByTestId('priority-ordering-answer');
  await expect(answers).toHaveCount(2);
  await expect(page.getByTestId('priority-ordering-handle')).toHaveCount(0);
  await expect(page.getByTestId('priority-ordering-remove')).toHaveCount(0);

  const boxes = await answers.evaluateAll((spans) =>
    spans.map((span) => {
      const box = span.getBoundingClientRect();
      return { width: box.width, height: box.height, text: span.textContent };
    }),
  );
  for (const box of boxes) {
    expect(box.height, `"${box.text}" on one line`).toBeLessThan(30);
  }
  const ranks = await page
    .getByTestId('priority-ordering-rank')
    .evaluateAll((spans) => spans.map((span) => Math.round(span.getBoundingClientRect().left)));
  const texts = await answers.evaluateAll((spans) =>
    spans.map((span) => Math.round(span.getBoundingClientRect().left)),
  );
  expect(texts[0] - ranks[0], 'the answer sits beside its rank').toBeGreaterThan(8);
});

/**
 * A rule's question is chosen from every question on the form, and a select is as wide as its
 * longest option (`.field--select`). A form that asks one question in a full sentence pushed every
 * rule's question select past its column, under the answers beside it and out of the card - on a
 * settled market a beige band from the question to beyond the card's edge.
 */
test("a rule's question stays in its column, however long the form's other questions", async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const form = await request.put(`${BACKEND_URL}/markets/${marketId}/application-form`, {
    data: {
      fields: [
        {
          key: 'student',
          label: 'Are you an Example College student or alumni?',
          type: 'select',
          required: true,
          order: 0,
          options: [
            'Yes, I am a CURRENT Example College student',
            'Yes, I am Example College alumni/staff',
            'No',
          ],
        },
        {
          key: 'returning',
          label:
            'Have you vended with us before, at any of our markets in the last three years, under this or any other business name?',
          type: 'select',
          required: true,
          order: 1,
          options: ['Yes', 'No'],
        },
      ],
    },
  });
  expect(form.ok(), await form.text()).toBeTruthy();
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
    priority: [
      {
        id: 1,
        target: 'student',
        ordering: [
          'Yes, I am a CURRENT Example College student',
          'Yes, I am Example College alumni/staff',
          'No',
        ],
        direction: null,
      },
    ],
    marketDates: [{ date: '2099-05-01' }],
    tiers: [GOLD],
    locations: [{ name: 'Main Hall' }],
    sections: [{ name: 'Hall A', location: { name: 'Main Hall' }, tier: GOLD, count: 4 }],
    assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(marketSetupPath(marketId, 'assignment'));
  const target = page.getByTestId('priority-target-select');
  await expect(target).toHaveValue('student', { timeout: 15000 });

  const overflow = await target.evaluate((select) => {
    const cell = select.parentElement!.getBoundingClientRect();
    return select.getBoundingClientRect().right - cell.right;
  });
  expect(overflow, 'the question select reaches past its column').toBeLessThanOrEqual(0);
});
