import type { Locator, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, LoginPage } from './fixtures';
import { barsDrawn, barWidth, withClassicBars } from './helpers/classicBars';
import { marketScreenPath } from './helpers/marketScreens';
import { openScreen, SCREENS } from './helpers/screens';
import { seedTheScreens, type TheScreensSeed } from './helpers/seedTheScreens';

/**
 * A long dialog keeps its title, close and buttons in view while only its body scrolls (T217).
 *
 * Each of these scrolled as a whole, by thousands of pixels at a laptop's window, so its title and
 * its Save left the view, and on a browser drawing classic bars the bar squared its right corners
 * and lay over what it held. This opens the three longest on the stress seed, on such a browser,
 * and scrolls each to its end with a real wheel.
 */

const WINDOWS = [
  { name: 'at a laptop', viewport: { width: 1440, height: 900 }, tall: 900 * 0.8 },
  // As tall as the window less the gutter, 24px above and below.
  { name: 'on a phone', viewport: { width: 390, height: 844 }, tall: 844 - 48 },
] as const;

let seed: TheScreensSeed;

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  seed = await seedTheScreens(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
});

async function signIn(page: Page) {
  await new LoginPage(page).login(TEST_USER.email, TEST_USER.password);
  await page.waitForURL('**/dashboard');
}

async function openManageMarket(page: Page) {
  const name = seed.big.marketName;
  await page.goto('/markets');
  await page.getByTestId('markets-search-input').fill(name);
  await page
    .getByTestId('market-card')
    .filter({ hasText: name })
    .getByTestId('market-card-manage-button')
    .click();
  await expect(page.getByTestId('manage-market-window')).toBeVisible();
}

async function openManageOrganization(page: Page) {
  await page.goto('/organizations');
  await page
    .getByTestId('organization-card')
    .filter({ hasText: seed.organization.name })
    .getByTestId('organizations-manage-button')
    .click();
  await expect(page.getByTestId('manage-org-member-email').first()).toBeVisible();
}

/**
 * What every one of them must do once it is open and its body overflows: the wheel takes the body to
 * its end, and everything pinned stays where it was, with no bar drawn and nothing past the body's
 * right edge.
 */
async function expectOnlyItsBodyScrolls(
  page: Page,
  testid: string,
  tall: number,
  pinned: Locator[] = [],
) {
  const window = page.getByTestId(`${testid}-window`);
  const body = page.getByTestId(`${testid}-body`);
  await expect
    .poll(() => body.evaluate((el) => el.scrollHeight - el.clientHeight), `${testid} overflows`)
    .toBeGreaterThan(1);

  const parts = [
    window.getByRole('heading', { level: 2 }),
    page.getByTestId(`${testid}-close-button`),
    ...pinned,
  ];
  const before = await Promise.all(parts.map(async (part) => (await part.boundingBox())!.y));

  // Reaching what opened it may have moved the body, so this starts from the top.
  await body.evaluate((el) => el.scrollTo(0, 0));
  await expect(page.getByTestId(`${testid}-shade-top`)).toHaveCount(0);
  await expect(page.getByTestId(`${testid}-shade-bottom`)).toBeVisible();
  const box = (await body.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(async () => {
    await page.mouse.wheel(0, 100_000);
    expect(
      await body.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    ).toBeLessThanOrEqual(1);
  }, 'the wheel reaches the end of the body').toPass({ timeout: 5000 });

  await expect(page.getByTestId(`${testid}-shade-top`)).toBeVisible();
  await expect(page.getByTestId(`${testid}-shade-bottom`)).toHaveCount(0);

  for (const [index, part] of parts.entries()) {
    await expect(part, 'a pinned part stays in view').toBeInViewport({ ratio: 1 });
    expect((await part.boundingBox())!.y, 'a pinned part does not move').toBe(before[index]);
  }

  const frame = await window.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      corners: [style.borderTopRightRadius, style.borderBottomRightRadius],
      scrolls: el.scrollHeight > el.clientHeight,
    };
  });
  expect(frame, 'the window is a round frame that does not scroll').toEqual({
    corners: ['10px', '10px'],
    scrolls: false,
  });
  expect((await window.boundingBox())!.height, 'the window keeps to its cap').toBeLessThanOrEqual(
    tall + 1,
  );
  expect(await barWidth(body), 'the body gives no room to a bar').toBe(0);
  expect(await barsDrawn(page), 'what draws a bar under body').toEqual([]);

  const past = await body.evaluate((el) => {
    const edge = el.getBoundingClientRect().right;
    return [...el.querySelectorAll('*')]
      .filter((inside) => {
        const rect = inside.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1 && rect.right > edge + 0.5;
      })
      .map((inside) => `${inside.tagName.toLowerCase()}.${inside.className}`);
  });
  expect(past, "what runs past the body's right edge").toEqual([]);
}

for (const { name, viewport, tall } of WINDOWS) {
  test.describe(`${name}, on a browser that draws classic bars`, () => {
    test('Manage market scrolls only its body', async ({ playwright, baseURL }) => {
      await withClassicBars({ playwright, baseURL }, viewport, async (page) => {
        await signIn(page);
        await openManageMarket(page);
        await page.getByTestId('manage-market-history-toggle').click();
        await expect(page.getByTestId('market-history-entry').first()).toBeVisible();

        await expectOnlyItsBodyScrolls(page, 'manage-market', tall);
      });
    });

    test('Manage organization scrolls only its body', async ({ playwright, baseURL }) => {
      await withClassicBars({ playwright, baseURL }, viewport, async (page) => {
        await signIn(page);
        await openManageOrganization(page);
        await page.getByTestId('manage-org-history-toggle').click();
        await expect(page.getByTestId('org-history-entry').first()).toBeVisible();

        await expectOnlyItsBodyScrolls(page, 'manage-org', tall);
      });
    });

    test('Update info scrolls only its body, with Save in view', async ({
      playwright,
      baseURL,
    }) => {
      await withClassicBars({ playwright, baseURL }, viewport, async (page) => {
        await signIn(page);
        await page.goto(marketScreenPath(seed.big.marketId, 'vendors'));
        await page.getByTestId('vendors-list-item').first().click();
        await page.getByTestId('vendors-detail-update-info').click();
        await expect(page.getByTestId('update-info-window')).toBeVisible();

        await expectOnlyItsBodyScrolls(page, 'update-info', tall, [
          page.getByTestId('update-info-submit-button'),
          page.getByTestId('update-info-cancel-button'),
        ]);
      });
    });
  });
}

/** Fully inside the scroller's box, not only inside the window: the body clips what is past it. */
async function expectShownInTheBody(body: Locator, inside: Locator) {
  const within = await inside.evaluate(
    (el, testid) => {
      const scroller = document.querySelector(`[data-testid="${testid}"]`)!.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      return rect.top >= scroller.top && rect.bottom <= scroller.bottom;
    },
    (await body.getAttribute('data-testid'))!,
  );
  expect(within, 'it scrolled into view in the body').toBe(true);
}

test.describe('in a window too short to show the whole body', () => {
  test.use({ viewport: { width: 1280, height: 480 } });

  test("with nothing pinned at its foot, the body and its shade run to the window's edge", async ({
    authenticatedPage: page,
  }) => {
    await openManageMarket(page);
    const window = (await page.getByTestId('manage-market-window').boundingBox())!;
    const edge = window.y + window.height;
    const body = page.getByTestId('manage-market-body');
    const shade = (await page.getByTestId('manage-market-shade-bottom').boundingBox())!;
    expect(shade.y + shade.height, 'the shade ends at the frame').toBeCloseTo(edge, 0);

    // Its end still holds the window's inset, the last of its content 24px above the frame.
    await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(page.getByTestId('manage-market-shade-bottom')).toHaveCount(0);
    const scrolled = page.getByTestId('manage-market-scrolled');
    const end = (await body.boundingBox())!;
    const inset =
      end.y +
      end.height -
      (await scrolled.evaluate((el) => el.lastElementChild!.getBoundingClientRect().bottom));
    // Within a pixel, since a browser rounds the extent of a body whose content is a fractional
    // height, so the same inset can read 24.5 at its end.
    expect(Math.abs(inset - 24)).toBeLessThanOrEqual(1);
  });

  test("Manage market's Add row scrolls into view, and its form still submits by Enter", async ({
    authenticatedPage: page,
  }) => {
    await openManageMarket(page);
    const body = page.getByTestId('manage-market-body');

    const add = page.getByTestId('manage-market-add-user-button');
    await add.scrollIntoViewIfNeeded();
    await add.click();
    const field = page.getByTestId('manage-market-add-user-input');
    await expect(field).toBeFocused();
    await expectShownInTheBody(body, field);
    await expectShownInTheBody(body, page.getByTestId('manage-market-add-user-submit'));

    // Enter runs the row's own form, whose refusal names the address, with the dialog still open.
    await field.fill('nobody-has-this-address@example.com');
    await field.press('Enter');
    await expect(page.getByTestId('manage-market-add-user-error')).toBeVisible();
    await expect(page.getByTestId('manage-market-window')).toBeVisible();
    await expectShownInTheBody(body, page.getByTestId('manage-market-add-user-error'));
  });

  test("Manage organization's Add rows scroll into view, and their forms still submit by Enter", async ({
    authenticatedPage: page,
  }) => {
    await openManageOrganization(page);
    const body = page.getByTestId('manage-org-body');

    for (const [button, input, error] of [
      ['manage-org-add-admin-button', 'manage-org-add-admin-input', 'manage-org-add-admin-error'],
      [
        'manage-org-add-member-button',
        'manage-org-add-member-input',
        'manage-org-add-member-error',
      ],
    ]) {
      const add = page.getByTestId(button);
      await add.scrollIntoViewIfNeeded();
      await add.click();
      const field = page.getByTestId(input);
      await expect(field).toBeFocused();
      await expectShownInTheBody(body, field);

      await field.fill('nobody-has-this-address@example.com');
      await field.press('Enter');
      await expect(page.getByTestId(error)).toBeVisible();
      await expect(page.getByTestId('manage-org-window')).toBeVisible();
    }
  });
});

/** An anchored dialog holds its top where it opened, and measures its cap from there. */
/*
 * What the rule for "long" named and no other spec reads (`dialogs.md`): each scrolls its `-body`,
 * and has no `-scroll`, which is what a dialog scrolling whole has. The rest are read where a spec
 * already opens them: Fix the form, Load market, Load Template and the permissions reset.
 */
test.describe('each dialog a market can outgrow scrolls only its body', () => {
  for (const [state, testid] of [
    ['the change-placement dialog', 'placement-dialog'],
    ['the placement history', 'placement-history-dialog'],
    ['the delete-organization dialog, refused while markets are under way', 'delete-org'],
    ['opening applications, choosing reviewers', 'open-applications'],
  ] as const) {
    test(testid, async ({ authenticatedPage: page }) => {
      await openScreen(
        page,
        SCREENS.find((s) => s.name === state)!,
        seed,
      );
      await expect(page.getByTestId(`${testid}-body`)).toBeVisible();
      await expect(page.getByTestId(`${testid}-scroll`)).toHaveCount(0);
    });
  }
});

test.describe('an anchored long dialog', () => {
  async function openReviewers(page: Page) {
    await page.goto(marketScreenPath(seed.open.marketId, 'applications'));
    await page.getByTestId('reviewers-change').click();
    const window = page.getByTestId('reviewers-dialog-window');
    await expect(window).toBeVisible();
    await expect(page.getByTestId('reviewers-dialog-body')).toBeVisible();
    return window;
  }

  test('keeps its top at a laptop, and stops at the cap when it outgrows it', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const window = await openReviewers(page);
    const body = page.getByTestId('reviewers-dialog-scrolled');
    const short = (await window.boundingBox())!;
    expect(short.y).toBe(48);
    expect(short.height, 'it holds only what its content needs').toBeLessThan(900 * 0.8);

    // More chosen reviewers than the seed has: what grows here is the list, and only its height counts.
    await body.evaluate((el) => {
      el.append(Object.assign(document.createElement('div'), { style: 'height: 2000px' }));
    });
    await expect(page.getByTestId('reviewers-dialog-shade-bottom')).toBeVisible();

    const grown = (await window.boundingBox())!;
    expect(grown.y, 'its top stays where it opened').toBe(48);
    expect(grown.height, "80% of the window's height").toBe(900 * 0.8);
  });

  test('on a phone it runs from that top to the gutter', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const box = (await (await openReviewers(page)).boundingBox())!;
    expect(box.y).toBe(48);
    expect(box.y + box.height).toBeCloseTo(844 - 24, 0);
  });
});
