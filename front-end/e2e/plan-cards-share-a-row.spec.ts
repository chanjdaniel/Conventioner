import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg, loginViaApi, seedMarketWithVendors } from './helpers/seeds';
import { savePlan } from './helpers/savePlan';
import { marketSetupPath } from './helpers/marketScreens';
import type { Page } from '@playwright/test';

/**
 * Plan cards share a row, by one written rule (E23/F01/S01, from the-plan-uses-its-space 01).
 *
 * A screen of cards is a two-track grid: a card is half width unless it declares itself wide, a
 * card ends at its own content, below 900px of room it is one track, and every card has the same
 * inner gutter. On the plan, Market Dates and Section Setup are wide; Tier Setup sits beside
 * Location Setup, and How vendors apply beside Application form.
 */

const CARDS = ['dates', 'tiers', 'locations', 'sections', 'intake', 'form'] as const;
type Card = (typeof CARDS)[number];

const TIERS = [
  { id: 1, name: 'Premium' },
  { id: 2, name: 'Standard' },
  { id: 3, name: 'Community' },
];
const LOCATIONS = [
  'Main Hall',
  'East Wing',
  'West Wing',
  'Courtyard',
  'Mezzanine',
  'Loading Bay',
  'Garden Terrace',
  'Foyer',
  'Rooftop',
].map((name) => ({ name }));

/** Three tiers beside nine locations: two cards of very different heights in one row. */
const PLAN = {
  priority: [],
  marketDates: [{ date: '2026-10-03' }, { date: '2026-10-10' }],
  tiers: TIERS,
  locations: LOCATIONS,
  sections: [
    { name: 'Front Row', location: { name: 'Main Hall' }, tier: TIERS[0], count: 12 },
    { name: 'Courtyard Stalls', location: { name: 'Courtyard' }, tier: TIERS[2], count: 20 },
  ],
  assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
};

async function boxes(page: Page) {
  return page.evaluate(
    (cards) => {
      const out: Record<
        string,
        { x: number; y: number; w: number; h: number; inset: number | null }
      > = {};
      for (const card of cards) {
        const el = document.querySelector(`[data-testid="plan-card-${card}"]`) as HTMLElement;
        const box = el.getBoundingClientRect();
        const row = el.querySelector('.rows > *') as HTMLElement | null;
        out[card] = {
          x: Math.round(box.left),
          y: Math.round(box.top),
          w: Math.round(box.width),
          h: Math.round(box.height),
          inset: row ? Math.round(row.getBoundingClientRect().left - box.left) : null,
        };
      }
      return out;
    },
    CARDS as unknown as string[],
  ) as Promise<Record<Card, { x: number; y: number; w: number; h: number; inset: number | null }>>;
}

/** Whether any select in Section Setup shows less than the whole of its chosen value. */
async function truncatedSelects(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas').getContext('2d')!;
    return Array.from(
      document.querySelectorAll('[data-testid="plan-card-sections"] select'),
    ).flatMap((node) => {
      const select = node as HTMLSelectElement;
      const style = getComputedStyle(select);
      canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const text = select.options[select.selectedIndex]?.text ?? '';
      // The room for the value: the box less its padding and the native arrow (about 20px).
      const room =
        select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 20;
      return canvas.measureText(text).width > room ? [text] : [];
    });
  });
}

test.describe('Plan cards share a row', () => {
  let marketId: string;

  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const seeded = await seedMarketWithVendors(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    marketId = seeded.marketId;
    await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, PLAN);
  });

  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
  ]) {
    test(`at ${size.width}px, tiers sit beside locations and intake beside the form`, async ({
      authenticatedPage: page,
    }) => {
      await page.setViewportSize(size);
      await page.goto(marketSetupPath(marketId, 'setup'));
      await expect(page.getByTestId('plan-card-locations')).toBeVisible({ timeout: 15000 });
      const b = await boxes(page);

      expect(b.tiers.y, 'Tier and Location share a row').toBe(b.locations.y);
      expect(b.tiers.x).toBeLessThan(b.locations.x);
      expect(b.intake.y, 'How vendors apply and Application form share a row').toBe(b.form.y);
      expect(b.intake.x).toBeLessThan(b.form.x);

      // The wide cards span the row: as wide as the two halves and the gap between them.
      const row = b.locations.x + b.locations.w - b.tiers.x;
      expect(b.dates.w).toBe(row);
      expect(b.sections.w).toBe(row);
      expect(b.tiers.w).toBe(b.locations.w);

      // A card ends at its own content: three tiers beside nine locations do not stretch to match.
      expect(b.tiers.h).toBeLessThan(b.locations.h - 100);

      // One inner gutter: every list's rows start at the same inset from their card.
      expect(new Set([b.tiers.inset, b.locations.inset, b.sections.inset]).size).toBe(1);

      expect(await truncatedSelects(page)).toEqual([]);
    });
  }

  test('below 900px of room, every card is full width, in plan order', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto(marketSetupPath(marketId, 'setup'));
    await expect(page.getByTestId('plan-card-locations')).toBeVisible({ timeout: 15000 });
    const b = await boxes(page);

    const widths = new Set(CARDS.map((card) => b[card].w));
    expect(widths.size, JSON.stringify(b)).toBe(1);
    const tops = CARDS.map((card) => b[card].y);
    expect(tops).toEqual([...tops].sort((a, c) => a - c));
    expect(await truncatedSelects(page)).toEqual([]);
  });
});
