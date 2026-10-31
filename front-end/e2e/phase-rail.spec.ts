import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { seedAssignedMarket, type AssignedSeedResult } from './helpers/seedAssignedMarket';
import { seedApplication } from './helpers/seedApplication';
import { seedPhaseMarket } from './helpers/seedPhaseMarket';
import { savePlan } from './helpers/savePlan';
import { completePlan, seedPublishedMarketWithAssignments } from './helpers/seeds';
import type { Locator } from '@playwright/test';

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not rendered');
  return b;
}

/** A plan with a date, so the essential questions have something to ask. */
// Complete, so the form market may leave draft (E31/F01/S01).
const PLAN = completePlan();

/**
 * The phase rail (E10/F01).
 *
 * The strip it replaces floated above the card, labelled "Current Phase:" in white on a white
 * page. The rail is a band below the market header, on every market screen, and it is where the
 * check-in URL publishing puts on the air is finally stated.
 */
test.describe('The phase rail', () => {
  let seed: AssignedSeedResult;

  test.beforeAll(async ({ request }) => {
    // A long name, so a later test can measure the rail with a long check-in URL. Given at creation:
    // a market can only be renamed while it is a draft (E21/F03/S04). Unique per run, because a
    // public address belongs to one market (E21/F03/S03).
    seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
      name: `Example Holiday Makers Fair December ${Date.now()}`,
    });
  });

  async function openMarket(page: import('@playwright/test').Page, path: string) {
    const res = await page.request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market } = (await res.json()) as { market: Record<string, unknown> };
    await page.evaluate((m) => {
      const copy = { ...(m as Record<string, unknown>) };
      delete copy._id;
      localStorage.setItem('user', JSON.stringify('e2e@example.com'));
    }, market);
    await page.goto(path);
  }

  test('is below the header on every market screen', async ({ authenticatedPage: page }) => {
    for (const path of [
      marketSetupPath(seed.marketId, 'setup'),
      marketScreenPath(seed.marketId, 'assignments'),
      marketScreenPath(seed.marketId, 'vendors'),
      marketScreenPath(seed.marketId, 'attendance'),
      marketScreenPath(seed.marketId, 'stats'),
    ]) {
      await openMarket(page, path);
      const rail = page.getByTestId('phase-rail');
      await expect(rail, `no rail on ${path}`).toBeVisible({ timeout: 15000 });
      await expect(rail.getByTestId('phase-rail-current')).toHaveText(/Assignment/);
    }
  });

  test('no two adjacent labels overlap at 1920x1080 with a long check-in URL', async ({
    authenticatedPage: page,
  }) => {
    // Container overflow does not detect this: the step boxes shrink below their labels, so the
    // labels paint over each other while the row still fits.
    await page.setViewportSize({ width: 1920, height: 1080 });

    await page.request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { toPhase: 'market_days' },
    });

    await openMarket(page, marketSetupPath(seed.marketId, 'setup'));
    const chip = page.getByTestId('phase-rail-checkin');
    await expect(chip).toBeVisible({ timeout: 15000 });
    const url = (await chip.locator('a').getAttribute('href')) ?? '';
    expect(url.length).toBeGreaterThan(60);

    const smallestGap = await page.evaluate(() => {
      // `Array.from`, not a spread: this runs inside the page under the e2e tsconfig, where a
      // `NodeListOf<Element>` is not iterable.
      const boxes = Array.from(document.querySelectorAll('.phase-step-label')).map((el) =>
        el.getBoundingClientRect(),
      );
      let smallest = Infinity;
      for (let i = 1; i < boxes.length; i += 1) {
        smallest = Math.min(smallest, boxes[i].left - (boxes[i - 1].left + boxes[i - 1].width));
      }
      return smallest;
    });
    expect(smallestGap).toBeGreaterThan(0);
  });

  test('the check-in URL is on the rail once published, and copies in one action', async ({
    authenticatedPage: page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await openMarket(page, marketSetupPath(seed.marketId, 'setup'));

    const chip = page.getByTestId('phase-rail-checkin');
    await expect(chip).toBeVisible({ timeout: 15000 });
    // The whole address is the link; what it shows is shortened to fit the rail (bug 11).
    const url = (await chip.locator('a').getAttribute('href')) ?? '';
    await expect(chip.locator('a')).toHaveAttribute('title', url);

    await page.getByTestId('phase-rail-checkin-copy').click();
    await expect(page.getByTestId('phase-rail-checkin-copy')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

    // And it is the page publishing actually put on the air.
    await page.goto(new URL(url).pathname);
    await expect(page.locator('body')).not.toContainText('Page not found');
  });

  test('a CSV market carries no application chip, and a form market does', async ({
    authenticatedPage: page,
  }) => {
    // The seeded market takes its vendors by import, so the chip must not appear: its `/apply` URL
    // answers exactly as a market that does not exist, and a chip would be the one place the
    // product admitted it was real (E18/F04/S02).
    await openMarket(page, marketSetupPath(seed.marketId, 'setup'));
    await expect(page.getByTestId('phase-rail')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('phase-rail-apply')).toHaveCount(0);

    // A market taking applications by form does carry it, pointing at its own address. Intake
    // mode is chosen while a market is a draft and fixed after, so this is a market of its own.
    const formMarket = await seedPhaseMarket(
      page.request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await savePlan(page.request, BACKEND_URL, TEST_USER.email, formMarket.marketId, PLAN, 'form');
    const opened = await page.request.post(
      `${BACKEND_URL}/markets/${formMarket.marketId}/transition`,
      {
        headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
        data: { toPhase: 'applications' },
      },
    );
    expect(opened.ok(), await opened.text()).toBeTruthy();
    await page.goto(marketSetupPath(formMarket.marketId, 'setup'));

    const chip = page.getByTestId('phase-rail-apply');
    await expect(chip).toBeVisible({ timeout: 15000 });
    await expect(chip.locator('a')).toHaveAttribute('href', /\/apply$/);
  });

  test('archiving states in words that the market is over', async ({ authenticatedPage: page }) => {
    await page.request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { toPhase: 'archived' },
    });
    await openMarket(page, marketSetupPath(seed.marketId, 'setup'));

    const frozen = page.getByTestId('phase-rail-frozen');
    await expect(frozen).toBeVisible({ timeout: 15000 });
    await expect(frozen).toContainText('This market is archived');
    // This market was published earlier in the file, and its phase history says so: it ran, so
    // nothing is struck through (E26/F06/S03). Strikethrough is only ever reinforcement for the
    // words; `market-remembers-phases.spec.ts` covers a market that stopped short.
    await expect(frozen).toContainText('It was published and ran its market days.');
    await expect(page.locator('[data-phase="market_days"]')).toHaveAttribute('data-state', 'done');
    await expect(page.locator('.rail-button--forward')).toHaveCount(0);
  });
});

/**
 * The rail on a phone (T142): only the bar pins there, so the rail stands at the top of the page,
 * and a form market's two addresses, More… and the next step have to read in the room a phone has.
 * It squeezed the application page into a 171x148px box showing one character of its address, and
 * put the door's check-in list under a rail that ran to 409px of 844.
 */
test.describe('The phase rail on a phone', () => {
  let seed: { marketId: string };

  test.beforeAll(async ({ request }) => {
    seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'form' },
    );
  });

  test.use({ viewport: { width: 390, height: 844 } });

  test('leaves the door its screen: the list starts within the top 340px', async ({
    authenticatedPage: page,
  }) => {
    await page.goto(marketScreenPath(seed.marketId, 'attendance'));
    await expect(page.getByTestId('attendance-summary')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('phase-rail-checkin')).toBeVisible();

    // The first thing after the frame in the card: the door itself, on first paint.
    const door = page.locator('[data-testid="market-frame"] + *');
    expect((await box(door)).y).toBeLessThanOrEqual(340);
  });

  test('draws each address as one line: its name as the link, and Copy', async ({
    authenticatedPage: page,
  }) => {
    await page.goto(marketScreenPath(seed.marketId, 'attendance'));
    for (const [testId, name, end] of [
      ['phase-rail-apply', 'Application page', '/apply'],
      ['phase-rail-checkin', 'Check-in page', '/check-in'],
    ] as const) {
      const chip = page.getByTestId(testId);
      await expect(chip).toBeVisible({ timeout: 15000 });
      // A phone can show only a fragment of the address, so it shows none: the link carries it.
      const link = chip.getByRole('link', { name, exact: true });
      const href = (await link.getAttribute('href')) ?? '';
      expect(href.endsWith(end), href).toBe(true);
      await expect(link).toHaveAttribute('title', href);
      await expect(chip).not.toContainText(new URL(href).host);
      const copy = page.getByTestId(`${testId}-copy`);
      await expect(copy).toBeVisible();
      const outer = await box(chip);
      expect(outer.height).toBeLessThanOrEqual(50);
      // Copy stands inside the chip's border, never on it: with no inset its border lay on the
      // chip's and the two read as one doubled line.
      const inner = await box(copy);
      expect(inner.y - outer.y, 'Copy inset at the top').toBeGreaterThanOrEqual(3);
      expect(
        outer.y + outer.height - (inner.y + inner.height),
        'at the bottom',
      ).toBeGreaterThanOrEqual(3);
      expect(
        outer.x + outer.width - (inner.x + inner.width),
        'at the right',
      ).toBeGreaterThanOrEqual(3);
    }
  });

  test("sizes both address chips by the phone's own rule", async ({ authenticatedPage: page }) => {
    // Each asks for just over half its row, so two never share one. The tablet's rule, for a rail
    // under 45rem, matched a phone's rail too and set its own basis on both chips, so a change to
    // the phone's rule never reached them; both lay out alike here, so only the basis tells.
    await page.goto(marketScreenPath(seed.marketId, 'attendance'));
    for (const testId of ['phase-rail-apply', 'phase-rail-checkin']) {
      const chip = page.getByTestId(testId);
      await expect(chip).toBeVisible({ timeout: 15000 });
      expect(await chip.evaluate((el) => getComputedStyle(el).flexBasis), testId).toBe(
        'calc(50% + 8px)',
      );
    }
  });

  test('puts the addresses first and the actions at the end, none over another', async ({
    authenticatedPage: page,
  }) => {
    await page.goto(marketScreenPath(seed.marketId, 'attendance'));
    await expect(page.getByTestId('phase-rail-checkin')).toBeVisible({ timeout: 15000 });

    const apply = await box(page.getByTestId('phase-rail-apply'));
    const checkIn = await box(page.getByTestId('phase-rail-checkin'));
    const more = await box(page.getByTestId('phase-rail-menu-button'));
    const rail = await box(page.getByTestId('phase-rail'));
    const apart = (a: Box, b: Box) =>
      a.x + a.width <= b.x ||
      b.x + b.width <= a.x ||
      a.y + a.height <= b.y ||
      b.y + b.height <= a.y;
    for (const [a, b] of [
      [apply, checkIn],
      [apply, more],
      [checkIn, more],
    ]) {
      expect(apart(a, b), `${JSON.stringify(a)} and ${JSON.stringify(b)} overlap`).toBe(true);
    }
    // In reading order: the chips, then More… at the row's end, inside the rail.
    expect(apply.x).toBeLessThan(more.x);
    expect(checkIn.y).toBeLessThanOrEqual(more.y);
    expect(more.x + more.width).toBeLessThanOrEqual(rail.x + rail.width);
    expect(rail.x + rail.width).toBeLessThanOrEqual(390);
  });

  test('stands the next step on its own line, a 44px target', async ({
    authenticatedPage: page,
  }) => {
    // On Tools the step leads to the door, so it is offered.
    await page.goto(marketScreenPath(seed.marketId, 'tools'));
    const sentence = await box(page.getByTestId('phase-rail-next'));
    const link = await box(page.getByTestId('phase-rail-next-link'));
    expect(link.height).toBeGreaterThanOrEqual(44);
    expect(link.x).toBe(sentence.x);
    expect(link.y).toBeGreaterThan(sentence.y);
  });

  test('shows the whole address again past the phone break', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(marketScreenPath(seed.marketId, 'attendance'));
    const link = page.getByTestId('phase-rail-checkin').getByRole('link');
    await expect(link).toHaveText(/\/check-in$/, { timeout: 15000 });
  });
});

/**
 * The rail's end, its address chips then its actions, wraps an item onto a row of its own only when
 * it does not fit at the end of the row before (T142 review note 2). The actions wrapped as one
 * group, so on a phone More… stood alone under two buttons that had room beside the application
 * page, and at 1920 the two addresses stood one above the other with More… beside an empty band.
 */
test.describe("The rail's end wraps only when it must", () => {
  let doorSeed: { marketId: string };
  let openSeed: { marketId: string };
  let draftSeed: { marketId: string };
  let reviewSeed: { marketId: string };

  test.beforeAll(async ({ request }) => {
    // A long name, so the addresses are long, as a real market's are.
    doorSeed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'form', namePrefix: 'Example Makers Fair At The Old Riverside Warehouse' },
    );
    openSeed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    await savePlan(request, BACKEND_URL, TEST_USER.email, openSeed.marketId, PLAN, 'form');
    const opened = await request.post(`${BACKEND_URL}/markets/${openSeed.marketId}/transition`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { toPhase: 'applications' },
    });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    // One still to decide, so the rail offers Finish deciding beside the move it waits on.
    seedApplication(openSeed.marketId);

    // Three actions before More…, on a row a phone cannot fit them on: a draft with no market
    // dates (Pick market dates, Open Applications), and the CSV path's Review with one still to
    // decide (Finish deciding, Begin Assignment).
    draftSeed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    await savePlan(request, BACKEND_URL, TEST_USER.email, draftSeed.marketId, {
      ...PLAN,
      marketDates: [],
    });
    reviewSeed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    // Its response, there before the move, as an import's would be: Review waits for one.
    seedApplication(reviewSeed.marketId);
    const reviewing = await request.post(
      `${BACKEND_URL}/markets/${reviewSeed.marketId}/transition`,
      {
        headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
        data: { toPhase: 'applications' },
      },
    );
    expect(reviewing.ok(), await reviewing.text()).toBeTruthy();
  });

  /** The end's items in reading order, each on the row it was given, with the row's right edge. */
  async function theEnd(page: import('@playwright/test').Page) {
    await expect(page.getByTestId('phase-rail-menu-button')).toBeVisible({ timeout: 15000 });
    const rail = page.getByTestId('phase-rail');
    const items = await rail
      .locator(
        [
          '[data-testid="phase-rail-apply"]',
          '[data-testid="phase-rail-checkin"]',
          '[data-testid="phase-rail-fix"]',
          '[data-testid^="phase-transition-"]',
          '[data-testid="phase-rail-menu-button"]',
        ].join(', '),
      )
      .evaluateAll((els) =>
        els.map((el) => {
          const b = el.getBoundingClientRect();
          return {
            id: el.getAttribute('data-testid'),
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
          };
        }),
      );
    const right = await rail.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return b.right - parseFloat(getComputedStyle(el).paddingRight);
    });
    return { items, right };
  }

  /** More… shares its row with another of the end's items. */
  async function expectMoreNotAlone(page: import('@playwright/test').Page, where: string) {
    const { items } = await theEnd(page);
    const more = items[items.length - 1];
    const beside = items.filter(
      (i) => i !== more && i.y < more.y + more.height && more.y < i.y + i.height,
    );
    expect(
      beside.length,
      `More… alone on its row ${where}: ${JSON.stringify(items)}`,
    ).toBeGreaterThan(0);
  }

  async function expectNoNeedlessWrap(page: import('@playwright/test').Page) {
    const { items, right } = await theEnd(page);
    expect(items.length).toBeGreaterThan(1);
    for (let i = 1; i < items.length; i++) {
      const [before, item] = [items[i - 1], items[i]];
      // On the same row, the two stand side by side, whatever their heights.
      if (item.y < before.y + before.height - 1) continue;
      // At the rail's smallest gap, --space-2.
      expect(
        before.x + before.width + 8 + item.width,
        `${item.id} wrapped under ${before.id}, but fitted beside it`,
      ).toBeGreaterThan(right);
    }
    return items;
  }

  test('on a phone, in every phase with More… and an action or address before it', async ({
    authenticatedPage: page,
  }) => {
    // Phones from 375 to 430 wide, a classic scrollbar taking 15px of some: at a 326px rail both
    // chips fitted on one row and More… fell alone under them.
    for (const width of [375, 390, 405, 430]) {
      await page.setViewportSize({ width, height: 844 });
      for (const marketId of [
        doorSeed.marketId,
        openSeed.marketId,
        draftSeed.marketId,
        reviewSeed.marketId,
      ]) {
        await page.goto(marketScreenPath(marketId, 'attendance'));
        const items = await expectNoNeedlessWrap(page);
        // More… at the end of its row, where the rail's actions end, and never alone on it.
        const more = items[items.length - 1];
        const { right } = await theEnd(page);
        expect(
          Math.abs(more.x + more.width - right),
          `More… ends its row at ${width}`,
        ).toBeLessThanOrEqual(1);
        await expectMoreNotAlone(page, `at ${width}`);
      }
    }
  });

  test('between a phone and a desk, More… beside an address', async ({
    authenticatedPage: page,
  }) => {
    // The door, Tools and the Assignments page lift the desktop floor, so they reach these widths
    // too: both addresses filled the first row and More… stood alone on the second.
    for (const width of [680, 700, 720, 768, 780]) {
      await page.setViewportSize({ width, height: 1024 });
      await page.goto(marketScreenPath(doorSeed.marketId, 'attendance'));
      await expectNoNeedlessWrap(page);
      await expectMoreNotAlone(page, `at ${width}`);
    }
  });

  test('at a desk, both addresses and More… on one row', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(marketScreenPath(doorSeed.marketId, 'attendance'));
    const items = await expectNoNeedlessWrap(page);
    const bottom = Math.min(...items.map((i) => i.y + i.height));
    for (const item of items) expect(item.y, JSON.stringify(items)).toBeLessThan(bottom);
  });
});
