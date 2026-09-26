import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg, seedPublishedMarketWithAssignments } from './helpers/seeds';

/**
 * Things that are meant to line up, do (E15/F01/S03).
 *
 * Three defects of one kind, each invisible in the source and obvious once measured:
 *
 *   - Down the Vendors list the right-hand metadata started at 1387, 1389 and 1391 depending on the
 *     digits in the row. Outfit's `0`, `1` and `2` are different widths, so a right-aligned group
 *     shifts by a pixel or two per row and the column reads ragged.
 *   - Two footer actions sat 21px apart on a row meant to be one line, because an explanation was
 *     stacked ABOVE its button inside a centred
 *     column.
 *   - The check-in email field was 42px and the button beside it 40px, both starting at the same y.
 *
 * Measured rather than asserted against fixed numbers: the point is that peers agree with each
 * other, not that they sit at any particular coordinate.
 */

test.describe('Things meant to line up do', () => {
  let marketSlug: string;
  let marketId: string;

  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const seeded = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    marketSlug = seeded.marketSlug;
    marketId = seeded.marketId;
  });

  test('a column of figures does not shift with its digits', async ({
    authenticatedPage: page,
  }) => {
    await page.goto(`/markets/${marketId}/vendors`);
    // Wait for a ROW, not for the search box. The box renders before the list has loaded, so
    // waiting on it measured an empty list and the assertion below passed or failed on timing.
    await expect(page.locator('.vendor-date-count').first()).toBeVisible({ timeout: 15000 });

    const counts = await page.locator('.vendor-date-count').evaluateAll((nodes) =>
      nodes.map((n) => ({
        text: (n.textContent ?? '').trim(),
        left: Math.round(n.getBoundingClientRect().left),
        numerals: getComputedStyle(n).fontVariantNumeric,
      })),
    );
    expect(counts.length, 'no vendor rows to measure').toBeGreaterThan(0);

    // The property, always. The geometric check below only means something when the fixture
    // happens to produce rows whose digits differ, and a guard that passes vacuously is worse
    // than none - this one did, on a seed where every vendor reads "1 / 1 dates".
    for (const c of counts) {
      expect(c.numerals, `"${c.text}" does not use fixed-width digits`).toContain('tabular-nums');
    }

    // And the geometry, when there is variety to expose it.
    const varied = new Set(counts.map((c) => c.text)).size > 1;
    if (varied) {
      const distinct = [...new Set(counts.map((c) => c.left))];
      expect(distinct, `ragged column: ${JSON.stringify(counts)}`).toHaveLength(1);
    }
  });

  test('the check-in field and its button are the same height', async ({ page }) => {
    await page.goto(`/${marketSlug}/check-in`);
    const input = page.getByTestId('attendance-checkin-email-input');
    const button = page.getByTestId('attendance-checkin-lookup-button');
    await expect(input).toBeVisible({ timeout: 10000 });

    const [i, b] = await Promise.all([input.boundingBox(), button.boundingBox()]);
    expect(Math.round(i!.height), 'field and button disagree').toBe(Math.round(b!.height));
  });
});
