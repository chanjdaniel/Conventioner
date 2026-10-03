import type { Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { seedApplicantMarket } from './helpers/seedApplicantMarket';
import { seedPhaseMarket } from './helpers/seedPhaseMarket';

/**
 * A market's frame is the same on every page of it, and the rail is one row at 1440 (bugs 11 and
 * 12, and items 12 and 13 of bug 43; E26/F10/S01; settles claims-and-room 07).
 *
 * Each screen placed the frame itself, so it sat at x 16 on most pages, x 0 on Start from your
 * Google Form and the floorplan wizard, and x 32 on the import - and the last two had no card and
 * no rail at all. The application page's address pushed "Close Applications" onto a row of its
 * own. And until the market arrived, every screen showed an empty black bar.
 */
test.use({ viewport: { width: 1440, height: 900 } });

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not rendered');
  return b;
}

const middle = (b: { y: number; height: number }) => b.y + b.height / 2;

/** The bar's box once its market has arrived, so each page is compared in the same state. */
async function frameOn(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('market-bar-title')).toBeVisible();
  return box(page.getByTestId('market-bar'));
}

test('the rail holds the application page and the next step on one row at 1440', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await page.goto(marketSetupPath(marketId, 'applications'));

  const spine = await box(page.getByTestId('phase-rail-spine'));
  const chip = page.getByTestId('phase-rail-apply');
  const next = page.getByTestId('phase-transition-applications_closed');
  expect(Math.abs(middle(await box(chip)) - middle(spine))).toBeLessThan(4);
  expect(Math.abs(middle(await box(next)) - middle(spine))).toBeLessThan(4);

  // Shortened to fit, never lost: the whole address is the link, its hover text, and what Copy copies.
  const link = chip.getByRole('link');
  await expect(link).toHaveAttribute('href', /\/apply$/);
  await expect(link).toHaveAttribute('title', /\/apply$/);
  await expect(page.getByTestId('phase-rail-apply-copy')).toBeVisible();
});

test('where the rail cannot hold one row, the address and the next step share the second', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(marketSetupPath(marketId, 'applications'));

  const spine = await box(page.getByTestId('phase-rail-spine'));
  const chip = await box(page.getByTestId('phase-rail-apply'));
  const next = await box(page.getByTestId('phase-transition-applications_closed'));
  // Never a lone button on a row of its own beside an empty band: the second row is designed.
  expect(chip.y).toBeGreaterThan(spine.y + spine.height);
  expect(Math.abs(middle(next) - middle(chip))).toBeLessThan(4);
});

test('every page of a market puts its frame in the same place, flows included', async ({
  authenticatedPage: page,
  request,
}) => {
  const draft = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const open = await seedApplicantMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);

  const plan = await frameOn(page, marketSetupPath(draft.marketId, 'setup'));
  // A page that scrolls and one that does not must not differ by the scrollbar's width. Headless
  // Chromium hides scrollbars, so this is pinned as the rule that prevents it.
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter),
  ).toBe('stable');

  for (const path of [
    marketSetupPath(draft.marketId, 'form'),
    marketSetupPath(draft.marketId, 'start-from-csv'),
    marketScreenPath(draft.marketId, 'floorplan'),
    marketSetupPath(open.marketId, 'applications'),
    marketScreenPath(open.marketId, 'import'),
  ]) {
    expect(await frameOn(page, path), path).toEqual(plan);
    // The flows stand in the frame too, rail and all.
    await expect(page.getByTestId('phase-rail'), path).toBeVisible();
  }
});

test('the floorplan wizard fills the card rather than ending above a grey void', async ({
  authenticatedPage: page,
  request,
}) => {
  const draft = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  await frameOn(page, marketScreenPath(draft.marketId, 'floorplan'));

  const card = await box(page.getByTestId('market-frame-card'));
  const next = await box(page.getByTestId('floorplan-workflow-next-btn'));
  // The wizard's own Next sits at the foot of the card, which reaches the foot of the window.
  expect(card.y + card.height).toBeGreaterThan(900 - 24);
  expect(card.y + card.height - (next.y + next.height)).toBeLessThan(32);
});

test('a market on its way shows the frame it will fill, and one that is missing no bar at all', async ({
  authenticatedPage: page,
  request,
}) => {
  const draft = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/api/markets/${draft.marketId}`, async (route) => {
    await held;
    await route.continue();
  });

  await page.goto(marketScreenPath(draft.marketId, 'vendors'));
  await expect(page.getByTestId('market-arrival-loading')).toBeVisible();
  // Where the name will be, something that reads as on its way rather than an empty black band.
  await expect(page.getByTestId('market-bar-loading')).toBeVisible();
  release();
  await expect(page.getByTestId('market-bar-title')).toHaveText(draft.marketName);
  await expect(page.getByTestId('market-bar-loading')).toHaveCount(0);

  await page.goto(marketScreenPath('no-such-market', 'vendors'));
  await expect(page.getByTestId('market-arrival-missing')).toBeVisible();
  await expect(page.getByTestId('market-bar')).toHaveCount(0);
});
