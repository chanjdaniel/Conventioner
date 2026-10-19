import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketSetupPath } from './helpers/marketScreens';
import { savePlan } from './helpers/savePlan';
import { completePlan } from './helpers/seeds';
import { seedPhaseMarket } from './helpers/seedPhaseMarket';

/**
 * A blocked step offers its fix as the main button (E32/F01/S02).
 *
 * The one obvious button on the rail was a move that could not be pressed, with a small "Fix it"
 * in the sentence beside it. While a page of the market resolves what refuses the move, the main
 * button is that work, named by the guard, and the move waits disabled beside it.
 */
test.describe('A blocked step offers its fix', () => {
  test('a draft with no location offers Add a location, and it leads to Market Setup', async ({
    authenticatedPage: page,
  }, testInfo) => {
    const seed = await seedPhaseMarket(
      page.request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      {
        intakeMode: 'form',
      },
    );
    await savePlan(page.request, BACKEND_URL, TEST_USER.email, seed.marketId, {
      ...completePlan(),
      locations: [],
      sections: [{ name: 'Hall A', tier: { id: 1, name: 'Gold' }, count: 5 }],
    });

    await page.goto(marketSetupPath(seed.marketId, 'form'));
    const fix = page.getByTestId('phase-rail-fix');
    await expect(fix).toHaveText('Add a location', { timeout: 15000 });
    const open = page.getByTestId('phase-transition-applications_open');
    await expect(open).toBeDisabled();
    await expect(page.getByTestId('phase-rail-next-link')).toHaveCount(0);
    // A link standing in for a button stands as tall as the buttons beside it.
    const [fixBox, openBox] = await Promise.all([fix.boundingBox(), open.boundingBox()]);
    expect(fixBox!.height).toBeCloseTo(openBox!.height, 0);
    expect(fixBox!.y).toBeCloseTo(openBox!.y, 0);
    await page.getByTestId('phase-rail').screenshot({ path: testInfo.outputPath('rail-fix.png') });

    await fix.click();

    await expect(page).toHaveURL(/\/setup$/);
    // The work is in front of the organizer now; the move still waits on it.
    await expect(fix).toHaveCount(0);
    await expect(open).toBeDisabled();
  });

  test('a market with nothing refusing its step offers the step itself', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedPhaseMarket(
      page.request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      {
        intakeMode: 'form',
      },
    );

    await page.goto(marketSetupPath(seed.marketId, 'form'));
    await expect(page.getByTestId('phase-transition-applications_open')).toBeEnabled({
      timeout: 15000,
    });
    await expect(page.getByTestId('phase-rail-fix')).toHaveCount(0);
  });
});
