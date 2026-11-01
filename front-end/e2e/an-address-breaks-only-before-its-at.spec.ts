import type { Locator } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedTheScreens } from './helpers/seedTheScreens';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { VendorsPage } from './pages/VendorsPage';

/**
 * An address in a review sentence breaks only before its "@" or at a dot, never at its hyphen
 * (T181), as the history table's already did (T137 review note 7).
 *
 * On the screens seed's divided-review market every open application is dealt to
 * `e2e-screens-reviewer@example.com`, an address with hyphens in its local part. At 390 the dealt
 * warning on One by one's card and in the All view's drawer, the reviewer line, and a history
 * sentence naming whose share a verdict was each lay it out; no line inside it may end at a hyphen.
 *
 * The Applications page keeps the desk's width at 390 (its route has no `fitsAPhone`), so One by
 * one's card and the All view's rows are as wide there as at a desk, and the address fits on their
 * line; the drawer is a phone's width. So each sentence is also drawn in a line narrower than the
 * address, as a phone's layout would draw it, where the address has to break somewhere.
 */

const SIZES = [
  { name: 'on a phone', viewport: { width: 390, height: 844 } },
  { name: 'at a desk', viewport: { width: 1440, height: 900 } },
] as const;

let dealtMarketId: string;
let reviewer: string;

test.beforeAll(async ({ request }) => {
  test.setTimeout(120_000);
  ({
    dealt: { marketId: dealtMarketId, reviewer },
  } = await seedTheScreens(request, BACKEND_URL, TEST_USER.email, TEST_USER.password));
});

/**
 * Where the lines inside each `address` in an element's text break, as "before|after": every
 * character the element draws, with the top of the line it is drawn on. With `narrow`, the element
 * is first drawn narrower than the address and wider than the part before its "@", as a phone's
 * layout would draw it, so the address has to break and has room to break before its "@".
 */
function breaksIn(locator: Locator, address: string, narrow: boolean): Promise<string[]> {
  return locator.evaluate(
    (element, [address, narrow]) => {
      type Drawn = { char: string; top: number; left: number; right: number };
      const draw = (): Drawn[] => {
        const drawn: Drawn[] = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? '';
          for (let i = 0; i < text.length; i += 1) {
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const rect = range.getClientRects()[0];
            if (rect) drawn.push({ char: text[i], ...rect.toJSON() });
          }
        }
        return drawn;
      };
      const textOf = (drawn: Drawn[]) => drawn.map((d) => d.char).join('');
      if (narrow) {
        element.style.display = 'inline-block';
        element.style.whiteSpace = 'nowrap';
        const drawn = draw();
        const at = textOf(drawn).indexOf(address);
        const local = drawn[at + address.indexOf('@') - 1].right - drawn[at].left;
        const whole = drawn[at + address.length - 1].right - drawn[at].left;
        element.style.whiteSpace = '';
        element.style.width = `${(local + whole) / 2}px`;
      }
      const drawn = draw();
      const text = textOf(drawn);
      const breaks: string[] = [];
      for (let at = text.indexOf(address); at !== -1; at = text.indexOf(address, at + 1)) {
        for (let i = at; i < at + address.length - 1; i += 1) {
          if (drawn[i + 1].top > drawn[i].top + 1)
            breaks.push(`${text.slice(at, i + 1)}|${text.slice(i + 1, at + address.length)}`);
        }
      }
      return breaks;
    },
    [address, narrow] as const,
  );
}

/**
 * The address in `locator` breaks, if at all, only before its "@" or before a dot, and its
 * accessible name keeps it one word. `narrow` draws the words in a line narrower than the address, where
 * it must break.
 */
async function expectWholeAddress(locator: Locator, address: string, narrow = false) {
  await expect(locator).toContainText(address);
  expect(await locator.ariaSnapshot()).toContain(address);
  const breaks = await breaksIn(locator, address, narrow);
  if (narrow) expect(breaks.length).toBeGreaterThan(0);
  for (const at of breaks) expect(at).toMatch(/\|[@.]/);
}

for (const size of SIZES) {
  test(`One by one's card keeps the reviewer's address whole, ${size.name}`, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize(size.viewport);
    const monitor = new ApplicationMonitorPage(page);
    await monitor.goto(dealtMarketId);
    await monitor.helpOthersButton.click();
    await expect(monitor.dealtWarning).toBeVisible();

    await expectWholeAddress(monitor.dealtWarning, reviewer);
    await expectWholeAddress(monitor.reviewer, reviewer);
  });

  test(`the All view's drawer and its history keep the reviewer's address whole, ${size.name}`, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize(size.viewport);
    const all = new ApplicationsAllPage(page);
    const drawer = new VendorsPage(page);
    const vendor = `applicant${size.viewport.width === 390 ? 0 : 1}@example.com`;
    await all.goto(dealtMarketId, 'anyone');
    await expectWholeAddress(all.reviewerOf(vendor), reviewer);
    await all.open(vendor);

    await expectWholeAddress(all.drawerDealtWarning, reviewer);
    await expectWholeAddress(all.drawerReviewer, reviewer);

    // Deciding someone else's share writes ", dealt to <address>" into the entry's sentence.
    await all.drawerButton('approve').click();
    await expect(all.drawerDealtWarning).toHaveCount(0);
    await drawer.openTab('history');
    const sentence = drawer.detailHistorySentences.filter({ hasText: `dealt to ${reviewer}` });
    await expectWholeAddress(sentence, reviewer);
  });
}

test('in a line narrower than the address, each sentence breaks it only before its "@" or a dot', async ({
  authenticatedPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const monitor = new ApplicationMonitorPage(page);
  await monitor.goto(dealtMarketId);
  await monitor.helpOthersButton.click();
  await expectWholeAddress(monitor.dealtWarning, reviewer, true);
  await expectWholeAddress(monitor.reviewer, reviewer, true);

  const all = new ApplicationsAllPage(page);
  const drawer = new VendorsPage(page);
  const vendor = 'applicant2@example.com';
  await all.goto(dealtMarketId, 'anyone');
  await expectWholeAddress(all.reviewerOf(vendor), reviewer, true);
  await all.open(vendor);
  await expectWholeAddress(all.drawerDealtWarning, reviewer, true);
  await expectWholeAddress(all.drawerReviewer, reviewer, true);

  await all.drawerButton('approve').click();
  await expect(all.drawerDealtWarning).toHaveCount(0);
  await drawer.openTab('history');
  const sentence = drawer.detailHistorySentences.filter({ hasText: `dealt to ${reviewer}` });
  await expectWholeAddress(sentence, reviewer, true);
});
