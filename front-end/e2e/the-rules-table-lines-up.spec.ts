import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketSetupPath } from './helpers/marketScreens';
import { seedPhaseMarket } from './helpers/seedPhaseMarket';
import { savePlan } from './helpers/savePlan';

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
