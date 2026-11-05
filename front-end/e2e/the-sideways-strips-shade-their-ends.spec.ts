import type { Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { ensureTestOrg } from './helpers/seeds';
import { PHONE_AND_DESK } from './helpers/phoneWindow';

/**
 * The market's sideways strips (T217): on a phone the bar's tabs, the phase rail and the market's
 * pages have no bar, so a shade at an edge says there is more that way, and goes at the end reached.
 * At a desk each fits and is no scroller at all, since a scroller would clip a tab's outer halo.
 */
const phone = PHONE_AND_DESK.find((size) => size.phone)!;

const assignments = (marketId: string) => `/markets/${marketId}/assignments`;

async function aMarket(page: Page, request: Parameters<typeof seedAssignedMarket>[0]) {
  await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const { marketId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await page.goto(assignments(marketId));
  await expect(page.getByTestId('market-bar-tabs')).toBeVisible({ timeout: 15000 });
  return marketId;
}

/** A thumb's drag across the strip: a negative distance moves it towards its far end. */
async function drag(page: Page, strip: Locator, xDistance: number) {
  await strip.scrollIntoViewIfNeeded();
  const box = (await strip.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.synthesizeScrollGesture', {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    xDistance,
  });
  await cdp.detach();
}

/** Drags the strip to each end in turn, and finds each shade only while there is more its way. */
async function expectShadesFollow(page: Page, strip: Locator, shades: string) {
  const left = page.getByTestId(`${shades}-shade-left`);
  const right = page.getByTestId(`${shades}-shade-right`);
  const position = () => strip.evaluate((el) => el.scrollLeft);
  await expect(right, 'more lies to the right').toBeVisible();
  await expect(left, 'nothing lies to the left yet').toHaveCount(0);

  await drag(page, strip, -2000);
  await expect.poll(position, 'the thumb moved it').toBeGreaterThan(0);
  await expect(left, 'more lies to the left').toBeVisible();
  await expect(right, 'the far end is reached').toHaveCount(0);

  await drag(page, strip, 2000);
  await expect.poll(position, 'the thumb brought it back').toBe(0);
  await expect(left, 'back at the start').toHaveCount(0);
  await expect(right).toBeVisible();

  await expect(right).toHaveAttribute('aria-hidden', 'true');
}

/** The colour a shade starts from. */
const shadeInk = (shade: Locator) =>
  shade.evaluate((el) => getComputedStyle(el).backgroundImage.match(/rgba?\([^)]*\)/)?.[0]);

test.describe('on a phone', () => {
  test.use(phone.use);

  test("the bar's tabs shade their ends, in the bar's dark tone, and the rail in the light", async ({
    authenticatedPage: page,
    request,
  }) => {
    await aMarket(page, request);

    const tabs = page.getByTestId('market-bar-tabs');
    await expectShadesFollow(page, tabs, 'market-bar-tabs');
    expect(await shadeInk(page.getByTestId('market-bar-tabs-shade-right'))).toBe(
      'rgba(255, 255, 255, 0.25)',
    );

    const spine = page.getByTestId('phase-rail-spine');
    await expectShadesFollow(page, spine, 'phase-rail-spine');
    expect(await shadeInk(page.getByTestId('phase-rail-spine-shade-right'))).toBe(
      'rgba(39, 35, 35, 0.12)',
    );
  });

  test("the market's pages fit a 390 phone with no shade, and shade their ends on a narrower one", async ({
    authenticatedPage: page,
    request,
  }) => {
    await aMarket(page, request);
    const pages = page.getByTestId('market-pages');
    await expect(pages).toBeVisible();
    await expect(page.getByTestId('market-pages-shade-right')).toHaveCount(0);
    await expect(page.getByTestId('market-pages-shade-left')).toHaveCount(0);

    await page.setViewportSize({ width: 320, height: 640 });
    await expectShadesFollow(page, pages, 'market-pages');
  });

  test('a tab that takes focus scrolls into view, its inset halo whole', async ({
    authenticatedPage: page,
    request,
  }) => {
    await aMarket(page, request);
    const strip = page.getByTestId('market-bar-tabs');
    const last = page.getByTestId('market-bar-tab-stats');
    const inside = () =>
      last.evaluate((tab) => {
        const scroller = tab.closest('[data-testid="market-bar-tabs"]')!.getBoundingClientRect();
        const box = tab.getBoundingClientRect();
        return box.left >= scroller.left && box.right <= scroller.right;
      });
    expect(await inside(), 'the last tab starts past the edge').toBe(false);

    // Tab walks to it, as a keyboard does, rather than a script's focus().
    await page.getByTestId('market-bar-tab-setup').focus();
    await expect
      .poll(async () => {
        await page.keyboard.press('Tab');
        return last.evaluate((tab) => tab === document.activeElement);
      })
      .toBe(true);
    await expect.poll(inside, 'the focused tab is whole in the strip').toBe(true);
    expect(
      await last.evaluate((tab) => getComputedStyle(tab).boxShadow),
      'a halo the scroller cannot cut',
    ).toContain('inset');
    await expect(strip).toHaveJSProperty('scrollTop', 0);
  });

  test('the spine, with nothing in it to focus, is a named stop the arrow keys scroll', async ({
    authenticatedPage: page,
    request,
  }) => {
    await aMarket(page, request);
    const spine = page.getByTestId('phase-rail-spine');
    await expect(spine).toHaveAttribute('tabindex', '0');
    await expect(page.getByRole('region', { name: 'Phases' })).toHaveCount(1);

    await spine.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => spine.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await expect(page.getByTestId('phase-rail-spine-shade-left')).toBeVisible();
    expect(await spine.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('inset');
  });

  test('a shade takes no tap, and the rail and the tabs keep their roles', async ({
    authenticatedPage: page,
    request,
  }) => {
    await aMarket(page, request);
    const shade = page.getByTestId('market-bar-tabs-shade-right');
    await expect(shade).toBeVisible();
    await expect(shade).toHaveCSS('pointer-events', 'none');

    await expect(page.getByRole('navigation', { name: 'Market' }).getByRole('link')).toHaveCount(7);
    const rail = page.getByRole('list', { name: 'Phases' });
    expect(await rail.getByRole('listitem').count()).toBeGreaterThan(3);
  });
});

test.describe('at a desk', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('no strip is a scroller, a stop or a landmark, and a tab keeps its outer halo', async ({
    authenticatedPage: page,
    request,
  }) => {
    await aMarket(page, request);

    for (const id of ['market-bar-tabs', 'phase-rail-spine', 'market-pages']) {
      const strip = page.getByTestId(id);
      await expect(strip, `${id} draws`).toBeVisible();
      await expect(strip, `${id} clips nothing`).toHaveCSS('overflow-x', 'visible');
      await expect(strip, `${id} clips nothing`).toHaveCSS('overflow-y', 'visible');
      await expect(strip, `${id} is no stop`).not.toHaveAttribute('tabindex', /.*/);
      await expect(page.locator(`[data-testid^="${id}-shade-"]`), `${id} shades`).toHaveCount(0);
    }
    await expect(page.getByRole('region', { name: 'Phases' })).toHaveCount(0);

    const tab = page.getByTestId('market-bar-tab-stats');
    await tab.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(tab).toBeFocused();
    expect(await tab.evaluate((el) => getComputedStyle(el).boxShadow)).not.toContain('inset');
  });

  test('the strips keep their one row, and their list and navigation roles', async ({
    authenticatedPage: page,
    request,
  }) => {
    await aMarket(page, request);

    const tabs = page.getByRole('navigation', { name: 'Market' }).getByRole('link');
    await expect(tabs).toHaveCount(7);
    const rail = page.getByRole('list', { name: 'Phases' }).getByRole('listitem');
    expect(await rail.count()).toBeGreaterThan(3);
    await expect(page.getByRole('navigation', { name: 'Pages' }).getByRole('link')).toHaveCount(4);

    const tops = async (items: Locator) =>
      new Set(await items.evaluateAll((all) => all.map((el) => el.getBoundingClientRect().top)));
    expect((await tops(tabs)).size, 'the tabs hold one row').toBe(1);
    expect((await tops(rail)).size, 'the spine holds one row').toBe(1);
  });
});
