import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { eachWindow, openEntry } from './helpers/componentLibrary';
import {
  detectLayout,
  gates,
  minTargetAt,
  SPACE_SCALE,
  TYPE_SCALE,
} from './helpers/layoutDetectors';
import { inTheWindow, type PhoneOrDesk } from './helpers/phoneWindow';

/**
 * The component library's `components` entry (T200): each reusable component that exists today,
 * the real one, in the variants and states its props allow, its section naming the screens that
 * use it, ending with the choices left for Daniel; at a desk and on a phone, nothing scrolls
 * sideways or is clipped, and the components that act do.
 */

const COMPONENTS = [
  'ReadFailed',
  'PhaseBadge',
  'SummaryCard',
  'EmailAddress',
  'VendorNameButton',
  'RowMenu',
  'StepHeader',
  'AnswerValue',
  'SignInMessage',
  'CodeInput',
  'BarLedger',
  'FileDropZone',
  'ScrollBox',
  'ListFreshness',
];

/**
 * The library's `expectLaidOut`, less one finding the real component brings with it:
 * `StepHeader`'s step is a 32px target, and its one screen, the form tab, is built for a desk
 * (the router's `fitsAPhone` names only Applications among a market's pages), so on a phone its
 * steps are under a thumb's 44px. The entry shows the component as it is, and asks Daniel about
 * it in its choices; every other finding still fails.
 */
async function expectLaidOut(page: Page, size: PhoneOrDesk, what: string): Promise<void> {
  await inTheWindow(size).expectFits(page, what);
  const { width } = page.viewportSize()!;
  const findings = await page.evaluate(detectLayout, {
    spaceScale: SPACE_SCALE,
    textScale: TYPE_SCALE,
    minTarget: minTargetAt(width),
  });
  const stepAtDeskSize = (finding: { kind: string; el: string }) =>
    finding.kind === 'small-target' && finding.el.endsWith('.step-button');
  expect(
    findings.filter((finding) => gates(finding, width) && !stepAtDeskSize(finding)),
    `${what}: the layout detectors' gating findings`,
  ).toEqual([]);
}

eachWindow('the existing components entry', (size) => {
  test('shows each component, labelled with its screens, and fits the window', async ({ page }) => {
    await openEntry(page, 'components');

    const entry = page.getByTestId('library-entry-components');
    for (const name of COMPONENTS) {
      const heading = entry.getByRole('heading', { level: 2, name, exact: true });
      await expect(heading).toBeVisible();
      await expect(heading.locator('xpath=following-sibling::p[1]')).toContainText('Used on:');
    }
    // Six phases on each of the two intake paths, then no phase and an unknown one; and the
    // market rows' badges.
    await expect(entry.getByTestId('phase-badge')).toHaveCount(6 * 2 + 2 + 3);
    for (const state of ['Failed: offline', 'Empty: nothing counted', 'Empty: no notice']) {
      await expect(entry.getByRole('region', { name: state, exact: true })).toBeVisible();
    }
    await expect(
      entry
        .getByRole('region', { name: 'Waiting: the link is on its way (disabled)' })
        .getByRole('button', { name: 'Send the link again' }),
    ).toBeDisabled();
    // The ledger is unfolded, as today: every answer to the question is a row.
    await expect(entry.getByTestId('library-answer')).toHaveCount(228);
    await expect(page.getByTestId('choices-for-you')).toBeVisible();
    await expectLaidOut(page, size, 'the existing components entry');
  });

  test('its vendor name and row menu act, and read out what they did', async ({ page }) => {
    await openEntry(page, 'components');
    const press = inTheWindow(size).press;

    const vendor = page.getByRole('region', { name: 'A named vendor' });
    const name = await vendor.getByTestId('vendor-identity-name').textContent();
    await press(page.getByTestId('library-vendor-named'));
    await expect(
      page.getByRole('region', { name: 'Pressed', exact: true }).getByTestId('read-out'),
    ).toHaveText(`Opened the drawer of: ${name!.trim()}`);

    const menuButton = page.getByTestId('library-entry-menu-button');
    await press(menuButton);
    await expect(page.getByTestId('library-entry-menu')).toBeVisible();
    await press(page.getByTestId('library-entry-menu-remove'));
    await expect(page.getByTestId('library-entry-menu')).toBeHidden();
    await expect(menuButton).toBeFocused();
    await expect(
      page.getByRole('region', { name: 'Chosen', exact: true }).getByTestId('read-out'),
    ).toHaveText('Chose: remove');

    // Words on the button: named by them, and the same menu behind it.
    const words = page.getByRole('button', { name: 'organizer@example.com' });
    await press(words);
    await expect(page.getByTestId('library-account-menu')).toBeVisible();
    await press(page.getByTestId('library-account-menu-sign-out'));
    await expect(page.getByTestId('library-account-menu')).toBeHidden();
    await expect(words).toBeFocused();
    await expect(
      page.getByRole('region', { name: 'Chosen', exact: true }).getByTestId('read-out'),
    ).toHaveText('Chose: sign-out');
  });

  test('ListFreshness says how old a list is, in each state, and asks for a read', async ({
    page,
  }) => {
    await openEntry(page, 'components');
    const press = inTheWindow(size).press;

    await expect(page.getByTestId('library-freshness-never-updated')).toHaveCount(0);
    await expect(page.getByTestId('library-freshness-now-updated')).toHaveText('Updated just now');
    await expect(page.getByTestId('library-freshness-minutes-updated')).toHaveText(
      'Updated 5 minutes ago',
    );
    await expect(page.getByTestId('library-freshness-refreshing-refresh')).toBeDisabled();
    await expect(page.getByTestId('library-freshness-failed-refresh-error')).toHaveText(
      'Could not update. The roster is as it was last read.',
    );

    await press(page.getByTestId('library-freshness-failed-refresh'));
    await expect(
      page.getByRole('region', { name: 'Refresh, pressed', exact: true }).getByTestId('read-out'),
    ).toHaveText('Asked to read again: 1 time');
  });

  test('its drop zone reads out the file it takes, and takes none while reading one', async ({
    page,
  }) => {
    await openEntry(page, 'components');

    await page.getByTestId('library-zone-input').setInputFiles({
      name: 'responses.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Name\n'),
    });
    await expect(
      page.getByRole('region', { name: 'File taken', exact: true }).getByTestId('read-out'),
    ).toHaveText('Took: responses.csv');

    await expect(page.getByTestId('library-zone-busy')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('library-zone-busy-input')).toBeDisabled();
    // Held by the real component's own rule for a file over it, not a copy of its colours.
    const over = page.getByTestId('library-zone-over');
    await expect(over).toHaveAttribute('data-dragging', 'true');
    await expect(over).not.toHaveCSS(
      'background-color',
      await page
        .getByTestId('library-zone')
        .evaluate((zone) => getComputedStyle(zone).backgroundColor),
    );
  });

  test('ScrollBox shades only the edges with more beyond them, each way and on each ground', async ({
    page,
  }) => {
    await openEntry(page, 'components');
    const shade = (box: string, edge: string) => page.getByTestId(`${box}-shade-${edge}`);
    const scrollTo = (box: string, top: number, left: number) =>
      page.getByTestId(box).evaluate(
        (el, to) => {
          el.scrollTop = to.top;
          el.scrollLeft = to.left;
        },
        { top, left },
      );

    // Down.
    await expect(shade('library-scroll-y', 'bottom')).toBeVisible();
    await expect(shade('library-scroll-y', 'top')).toHaveCount(0);
    await scrollTo('library-scroll-y', 1_000_000, 0);
    await expect(shade('library-scroll-y', 'top')).toBeVisible();
    await expect(shade('library-scroll-y', 'bottom')).toHaveCount(0);

    // Sideways, named as a region, and never down.
    await expect(page.getByRole('region', { name: 'Applicants', exact: true })).toBeVisible();
    await expect(shade('library-scroll-x', 'right')).toBeVisible();
    await expect(shade('library-scroll-x', 'left')).toHaveCount(0);
    await expect(shade('library-scroll-x', 'bottom')).toHaveCount(0);
    await scrollTo('library-scroll-x', 0, 1_000_000);
    await expect(shade('library-scroll-x', 'left')).toBeVisible();
    await expect(shade('library-scroll-x', 'right')).toHaveCount(0);

    // Both ways, each edge for itself.
    await expect(shade('library-scroll-both', 'bottom')).toBeVisible();
    await expect(shade('library-scroll-both', 'right')).toBeVisible();
    await scrollTo('library-scroll-both', 1_000_000, 1_000_000);
    await expect(shade('library-scroll-both', 'top')).toBeVisible();
    await expect(shade('library-scroll-both', 'left')).toBeVisible();
    await expect(shade('library-scroll-both', 'bottom')).toHaveCount(0);
    await expect(shade('library-scroll-both', 'right')).toHaveCount(0);

    // The dark ground's shade is its own, a light one: a dark shade is lost there.
    const ground = (box: string) =>
      shade(box, 'right').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(await ground('library-scroll-dark')).toContain('rgba(255, 255, 255');
    await scrollTo('library-scroll-x', 0, 0);
    await expect(shade('library-scroll-x', 'right')).toBeVisible();
    expect(await ground('library-scroll-x')).toContain('rgba(39, 35, 35');

    // A Tab stop stands in for the bar, unless a control inside takes the keys.
    await expect(page.getByTestId('library-scroll-y')).toHaveAttribute('tabindex', '0');
    await expect(page.getByTestId('library-scroll-controls')).not.toHaveAttribute('tabindex', /.*/);
    const stop = page.getByTestId('library-scroll-y');
    await stop.evaluate((el) => (el.scrollTop = 0));
    await stop.focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => stop.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // A list that has shrunk: no shade, and no stop.
    const shrinking = page.getByTestId('library-scroll-shrinking');
    await expect(shade('library-scroll-shrinking', 'bottom')).toBeVisible();
    await inTheWindow(size).press(page.getByRole('button', { name: 'Shrink it to two' }));
    await expect(shade('library-scroll-shrinking', 'bottom')).toHaveCount(0);
    await expect(shrinking).not.toHaveAttribute('tabindex', /.*/);
  });

  test('ScrollBox draws no shade and clips nothing in print', async ({ page }) => {
    await openEntry(page, 'components');
    await expect(page.getByTestId('library-scroll-y-shade-bottom')).toBeVisible();

    await page.emulateMedia({ media: 'print' });

    await expect(page.getByTestId('library-scroll-y-shade-bottom')).toBeHidden();
    await expect(page.getByTestId('library-scroll-y')).toHaveCSS('overflow-y', 'visible');
    await expect(page.getByTestId('library-scroll-y').locator('..')).toHaveCSS(
      'overflow-y',
      'visible',
    );
  });
});

/**
 * A press that only dismisses a row's "..." (T209). Focus comes back to the button so the keys carry
 * on from the row, and a mouse's press draws no halo there; a thumb's drag is no press at all, and
 * leaves nothing behind to act on the next tap.
 */
test.describe("a row's menu dismissed by a press elsewhere", () => {
  const focusIsVisible = (page: Page) =>
    page.getByTestId('library-line-menu-button').evaluate((el) => el.matches(':focus-visible'));

  test('with the mouse, focus comes back to the button with no halo on it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEntry(page, 'components');
    const button = page.getByTestId('library-line-menu-button');

    await button.click();
    await expect(page.getByTestId('library-line-menu')).toBeVisible();
    await page.mouse.click(4, 400);

    await expect(page.getByTestId('library-line-menu')).toBeHidden();
    await expect(button).toBeFocused();
    expect(await focusIsVisible(page)).toBe(false);
  });

  test.describe('with a thumb', () => {
    test.use({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });

    test('a drag that closes it leaves the next tap moving no focus to the button', async ({
      page,
    }) => {
      await openEntry(page, 'components');
      const button = page.getByTestId('library-line-menu-button');

      await button.scrollIntoViewIfNeeded();
      await button.tap();
      await expect(page.getByTestId('library-line-menu')).toBeVisible();
      await page.evaluate(() => {
        const seen: string[] = [];
        (window as unknown as { seen: string[] }).seen = seen;
        for (const type of ['pointerdown', 'pointerup', 'pointercancel']) {
          document.addEventListener(type, () => seen.push(type), true);
        }
      });

      const cdp = await page.context().newCDPSession(page);
      // A thumb's own touches: the browser takes the drag for a scroll, and cancels the pointer.
      const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y?: number) =>
        cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: y === undefined ? [] : [{ x: 20, y }],
        });
      await touch('touchStart', 700);
      for (const y of [680, 640, 600, 560, 500]) await touch('touchMove', y);
      await touch('touchEnd');
      await cdp.detach();
      await expect(page.getByTestId('library-line-menu')).toBeHidden();
      const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
      expect(seen).toContain('pointercancel');
      expect(seen).not.toContain('pointerup');

      // Focus goes somewhere else, then a tap on nothing: the closed menu has no say in it.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.touchscreen.tap(4, 700);
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { seen: string[] }).seen.at(-1)))
        .toBe('pointerup');
      await expect(button).not.toBeFocused();
    });
  });
});
