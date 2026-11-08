import type { Locator, Page, PlaywrightWorkerArgs } from '@playwright/test';
import { test, expect } from './fixtures';
import { barWidth, withClassicBars } from './helpers/classicBars';
import { disabledWithoutLine } from './helpers/contrastSweep';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';
import { inTheWindow, type PhoneOrDesk } from './helpers/phoneWindow';

/**
 * The component library's `dialog` entry (T200, T217): `AppDialog`, opened from the entry's buttons
 * at a desk and on a phone. Each width is its step capped by the window; a body that scrolls keeps
 * the title and actions in view, its shades say there is more, and nothing in it is clipped; a long
 * dialog is capped at 80% of a desk's window and fills a phone's or a short window's less the
 * gutter; on a browser that draws classic scroll bars no bar reaches it; the tray stays pinned and
 * scrolls inside itself; a footer needs no form; a dialog with nothing to focus opens where the keys
 * scroll it; and every behaviour a dialog had is kept in either scroll. Dialogs close by Escape and
 * by Cancel.
 */

const SECTIONS = [
  'Sizes',
  'The window scrolls, or only the body',
  'The body scrolls, with a tray',
  'The body scrolls, with nothing else to focus or no form',
  'Every behaviour kept',
];

/** Each width's step, in CSS pixels: 26rem, 38rem and 60rem. */
const STEPS = { narrow: 416, wide: 608, broad: 960 } as const;
/** The gutter at each side a dialog keeps from the window's edge. */
const GUTTER = 16;

/** The two panels that open the same 150 people, each scrolling its own way. */
const SHORT = 'A short dialog: the whole window scrolls';
const LONG = 'A long dialog: only the body';

const opener = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name, exact: true });
const dialogWindow = (page: Page, testid: string) => page.getByTestId(`library-${testid}-window`);
const readOut = (page: Page, panel: string) =>
  page.getByRole('region', { name: panel, exact: true }).getByTestId('read-out');

/** Opens a dialog from its button on the entry and waits for its window. */
async function openDialog(page: Page, size: PhoneOrDesk, button: string | RegExp, testid: string) {
  await inTheWindow(size).press(opener(page, button));
  const window = dialogWindow(page, testid);
  await expect(window).toBeVisible();
  return window;
}

/** The body's scroller, scrolled to its top or its bottom. */
async function scrollBody(body: Locator, to: 'top' | 'bottom') {
  await body.evaluate((el, end) => {
    el.scrollTop = end === 'top' ? 0 : el.scrollHeight;
  }, to);
}

/** Nothing in the body runs past its right edge, so no row is clipped by its scroll bar (F03). */
async function expectNothingClipped(body: Locator, what: string) {
  const overflow = await body.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const right = box.left + el.clientLeft + el.clientWidth;
    const past = [...el.querySelectorAll('*')]
      .map((child) => child.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.right > right + 0.5).length;
    return { sideways: el.scrollWidth - el.clientWidth, past };
  });
  expect(overflow, `${what}: nothing runs past the body's right edge`).toEqual({
    sideways: 0,
    past: 0,
  });
}

eachWindow('the dialog entry', (size) => {
  test('shows each section with what it serves, asks nothing, and fits the window', async ({
    page,
  }) => {
    await openEntry(page, 'dialog');

    const entry = page.getByTestId('library-entry-dialog');
    for (const title of SECTIONS) {
      const heading = entry.getByRole('heading', { level: 2, name: title, exact: true });
      await expect(heading).toBeVisible();
      await expect(heading.locator('xpath=following-sibling::p[1]')).toHaveText(/^Serves: /);
    }
    // Daniel's choices 20 to 22 are made: nothing here asks them any more.
    await expect(page.getByTestId('choices-for-you')).toHaveCount(0);
    await expectLaidOut(page, size, 'the dialog entry');
  });

  test('each width is its step, capped by the window, and Escape closes it', async ({ page }) => {
    await openEntry(page, 'dialog');
    const { width } = page.viewportSize()!;

    for (const [step, px] of Object.entries(STEPS)) {
      const window = await openDialog(page, size, `Open the ${step} dialog`, step);
      const box = (await window.boundingBox())!;
      expect(box.width, `the ${step} dialog's width`).toBeCloseTo(
        Math.min(px, width - 2 * GUTTER),
        0,
      );
      await inTheWindow(size).expectInside(window, `the ${step} dialog`);

      await page.keyboard.press('Escape');
      await expect(window).toBeHidden();
      await expect(opener(page, `Open the ${step} dialog`)).toBeFocused();
    }
    await expect(
      readOut(page, 'Broad, 60rem: a list beside what it gathers (Export vendors)'),
    ).toHaveText('Last: Closed, nothing saved');
  });

  test('only the body scrolls: the title and actions stay in view, and nothing is clipped', async ({
    page,
  }) => {
    // The row that is long is checked at a laptop's 1280 as well as on the phone.
    if (!size.phone) await page.setViewportSize({ width: 1280, height: 800 });
    await openEntry(page, 'dialog');
    const proposed = page.getByRole('region', { name: LONG });
    await inTheWindow(size).press(proposed.getByRole('button'));
    const window = dialogWindow(page, 'body');
    await expect(window).toBeVisible();

    const body = page.getByTestId('library-body-body');
    const title = window.getByRole('heading', { name: 'Change reviewers' });
    const save = page.getByTestId('library-body-submit-button');
    await expect(page.getByTestId('library-body-shade-top')).toHaveCount(0);
    await expect(page.getByTestId('library-body-shade-bottom')).toBeVisible();

    await scrollBody(body, 'bottom');
    await expect(page.getByTestId('library-body-shade-top')).toBeVisible();
    await expect(page.getByTestId('library-body-shade-bottom')).toHaveCount(0);
    for (const [part, what] of [
      [title, 'the title'],
      [page.getByTestId('library-body-close-button'), 'the close'],
      [save, 'Save'],
      [page.getByTestId('library-body-cancel-button'), 'Cancel'],
    ] as const) {
      await expect(part, `${what} stays in view`).toBeInViewport({ ratio: 1 });
    }
    await expect(window.getByText(/Each application is dealt/)).not.toBeInViewport();
    await expectNothingClipped(body, 'the 150 people');

    // The window keeps its corners: it does not scroll, the body does, between the pinned parts.
    const frame = await window.evaluate((el) => ({
      radius: getComputedStyle(el).borderTopRightRadius,
      scrolls: el.scrollHeight > el.clientHeight,
    }));
    expect(frame).toEqual({ radius: '10px', scrolls: false });
    const [titleBox, bodyBox, saveBox] = await Promise.all(
      [title, body, save].map(async (part) => (await part.boundingBox())!),
    );
    expect(bodyBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
    expect(saveBox.y).toBeGreaterThanOrEqual(bodyBox.y + bodyBox.height);

    const viewport = page.viewportSize()!;
    if (size.phone) {
      // As tall as the window less the gutter, 24px above and below.
      expect((await window.boundingBox())!.height).toBeCloseTo(viewport.height - 48, 0);
    }

    await inTheWindow(size).press(page.getByTestId('library-body-cancel-button'));
    await expect(window).toBeHidden();
    await expect(readOut(page, LONG)).toHaveText('Last: Closed, nothing saved');
  });

  test('a short dialog scrolls whole inside its frame: its close stays, and its corners', async ({
    page,
  }) => {
    await openEntry(page, 'dialog');
    const short = page.getByRole('region', { name: SHORT });
    await inTheWindow(size).press(short.getByRole('button'));
    const window = dialogWindow(page, 'window');
    await expect(window).toBeVisible();

    const scroller = page.getByTestId('library-window-scroll');
    await expect(page.getByTestId('library-window-submit-button')).not.toBeInViewport();
    await expect(page.getByTestId('library-window-shade-top')).toHaveCount(0);
    await expect(page.getByTestId('library-window-shade-bottom')).toBeVisible();

    await scrollBody(scroller, 'bottom');
    await expect(window.getByRole('heading', { name: 'Change reviewers' })).not.toBeInViewport();
    await expect(page.getByTestId('library-window-submit-button')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('library-window-close-button')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('library-window-shade-top')).toBeVisible();
    await expect(page.getByTestId('library-window-shade-bottom')).toHaveCount(0);
    await expect(page.getByTestId('library-window-body')).toHaveCount(0);

    const frame = await window.evaluate((el) => ({
      radius: getComputedStyle(el).borderTopRightRadius,
      scrolls: el.scrollHeight > el.clientHeight,
      scrolled: el.scrollTop,
    }));
    expect(frame).toEqual({ radius: '10px', scrolls: false, scrolled: 0 });

    // The close answers, over what scrolled beneath it.
    await inTheWindow(size).press(page.getByTestId('library-window-close-button'));
    await expect(window).toBeHidden();
  });

  test('the tray stays pinned above the actions, and scrolls inside itself past its cap', async ({
    page,
  }) => {
    await openEntry(page, 'dialog');
    const window = await openDialog(page, size, 'Choose reviewers, with a tray', 'tray');
    const tray = page.getByTestId('library-tray-tray');
    await expect(page.getByTestId('library-tray-count')).toHaveText('Chosen: 12 people of 150');

    await inTheWindow(size).press(window.getByRole('button', { name: 'Choose everyone' }));
    await expect(page.getByTestId('library-tray-count')).toHaveText('Chosen: 150 people of 150');
    const { height } = page.viewportSize()!;
    const cap = await tray.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      scrolls: el.scrollHeight > el.clientHeight,
    }));
    expect(cap.height).toBeLessThanOrEqual(height * 0.4 + 0.5);
    expect(cap.scrolls).toBe(true);

    await scrollBody(page.getByTestId('library-tray-body'), 'bottom');
    await expect(tray).toBeInViewport();
    await expect(page.getByTestId('library-tray-submit-button')).toBeInViewport({ ratio: 1 });
    await expectNothingClipped(page.getByTestId('library-tray-body'), 'the tray dialog body');

    await inTheWindow(size).press(page.getByTestId('library-tray-submit-button'));
    await expect(window).toBeHidden();
    await expect(readOut(page, 'The chosen, pinned above the actions')).toHaveText(
      'Last: Saved 150 people',
    );
  });

  for (const scroll of ['The body scrolls', 'The window scrolls']) {
    test(`every behaviour is kept when ${scroll.toLowerCase()}`, async ({ page }) => {
      await openEntry(page, 'dialog');
      const press = inTheWindow(size).press;
      await press(
        page.getByRole('group', { name: 'Scroll' }).getByRole('button', { name: scroll }),
      );
      const pinned = scroll === 'The body scrolls';

      // Destructive: it opens on Cancel, and Cancel saves nothing.
      let window = await openDialog(page, size, /^Remove /, 'destructive');
      await expect(page.getByTestId('library-destructive-cancel-button')).toBeFocused();
      await expect(page.getByTestId('library-destructive-body')).toHaveCount(pinned ? 1 : 0);
      await press(page.getByTestId('library-destructive-cancel-button'));
      await expect(window).toBeHidden();
      await expect(readOut(page, 'Destructive: opens on Cancel')).toHaveText(
        'Last: Closed, nothing saved',
      );

      // An error about the whole submission: above the actions, and the dialog stays open.
      window = await openDialog(page, size, 'Change the amount owed', 'error');
      await press(page.getByTestId('library-error-submit-button'));
      const error = page.getByTestId('library-error-error');
      await expect(error).toHaveText(/offline/);
      await expect(window).toBeVisible();
      const [errorBox, actionsBox] = await Promise.all([
        error.boundingBox(),
        page.getByTestId('library-error-submit-button').boundingBox(),
      ]);
      expect(errorBox!.y + errorBox!.height).toBeLessThanOrEqual(actionsBox!.y);
      await page.keyboard.press('Escape');
      await expect(window).toBeHidden();

      // Anchored: its top holds as a field's error appears beneath the field.
      window = await openDialog(page, size, 'Add an address', 'anchored');
      const top = (await window.boundingBox())!.y;
      await page.getByTestId('library-anchored-address').fill('not an address');
      await expect(page.getByTestId('library-anchored-field-error')).toBeVisible();
      expect((await window.boundingBox())!.y).toBeCloseTo(top, 0);
      await expect(page.getByTestId('library-anchored-submit-button')).toBeDisabled();
      await page.getByTestId('library-anchored-address').fill('someone.new@example.com');
      await page.getByTestId('library-anchored-address').press('Enter');
      await expect(window).toBeHidden();
      await expect(readOut(page, 'Anchored: its top holds as an error appears')).toHaveText(
        'Last: Added someone.new@example.com',
      );

      // A save in flight: Cancel and the close control are drawn disabled, and no close takes it.
      window = await openDialog(page, size, 'Name the template', 'in-flight');
      const save = page.getByTestId('library-in-flight-submit-button');
      const close = page.getByTestId('library-in-flight-close-button');
      const closeBox = await close.boundingBox();
      await press(save);
      await expect(save).toHaveText('Saving…');
      await expect(close).toBeDisabled();
      await expect(page.getByTestId('library-in-flight-cancel-button')).toBeDisabled();
      expect(await close.boundingBox(), 'its line moves nothing').toEqual(closeBox);
      expect(await disabledWithoutLine(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await page.mouse.click(2, 2);
      await expect(window).toBeVisible();
      await press(page.getByTestId('library-in-flight-land'));
      await expect(window).toBeHidden();
      await expect(
        readOut(page, 'A save in flight: nothing closes it until it answers'),
      ).toHaveText('Last: Saved');

      // Several actions and no footer: its own forms act, and nothing closes it but a close.
      window = await openDialog(page, size, 'Manage market', 'several');
      await expect(page.getByTestId('library-several-cancel-button')).toHaveCount(0);
      const role = window.getByRole('combobox').first();
      await role.selectOption('viewer');
      await expect(window).toBeVisible();
      await expect(readOut(page, 'Several actions, no footer')).toHaveText(
        /^Last: Changed .+ to Viewer$/,
      );
      if (pinned) {
        await scrollBody(page.getByTestId('library-several-body'), 'bottom');
        await expect(page.getByTestId('library-several-close-button')).toBeInViewport();
        await expectNothingClipped(page.getByTestId('library-several-body'), 'Manage market');
      }
      await page.keyboard.press('Escape');
      await expect(window).toBeHidden();
    });
  }
});

eachWindow('a dialog with nothing to focus', (size) => {
  test('opens on its body, and the arrow keys scroll it', async ({ page }) => {
    await openEntry(page, 'dialog');
    await openDialog(page, size, 'Read who has access', 'read');

    const body = page.getByTestId('library-read-body');
    await expect(body).toBeFocused();
    await expect(body).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByTestId('library-read-shade-top')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(opener(page, 'Read who has access')).toBeFocused();
  });
});

eachWindow('a dialog with buttons of its own and no form', (size) => {
  test('pins them at its foot, and its inner form submits alone', async ({ page }) => {
    await openEntry(page, 'dialog');
    const window = await openDialog(page, size, 'Rename and reset', 'actions');
    const panel = 'Buttons of its own, pinned at its foot, and no form';

    await expect(window.locator('form')).toHaveCount(1);
    await expect(page.getByTestId('library-actions-rename')).toBeVisible();
    await expect(
      page.getByTestId('library-actions-reset').locator('xpath=ancestor::form'),
    ).toHaveCount(0);

    await scrollBody(page.getByTestId('library-actions-body'), 'bottom');
    await expect(page.getByTestId('library-actions-done')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('library-actions-reset')).toBeInViewport({ ratio: 1 });
    await scrollBody(page.getByTestId('library-actions-body'), 'top');

    await inTheWindow(size).press(page.getByTestId('library-actions-reset'));
    await expect(window).toBeVisible();
    await window.getByRole('textbox').press('Enter');
    await expect(window).toBeVisible();
    await inTheWindow(size).press(page.getByTestId('library-actions-done'));
    await expect(window).toBeHidden();
    await expect(readOut(page, panel)).toHaveText('Last: Closed, nothing saved');
  });
});

/*
 * What a long dialog's height is, by the window: 80% at a desk, and the window less the 24px gutter
 * above and below on a phone or in a window split short, where 80% would leave the body nothing.
 */
const HEIGHTS = [
  { width: 1440, height: 900, expected: 900 * 0.8, what: '80% of a desk' },
  { width: 1280, height: 720, expected: 720 * 0.8, what: '80% of a laptop' },
  { width: 390, height: 844, expected: 844 - 48, what: 'a phone, less the gutter' },
  { width: 1280, height: 600, expected: 600 - 48, what: 'a short window, less the gutter' },
];

for (const { width, height, expected, what } of HEIGHTS) {
  test.describe(`a long dialog at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test(`measures ${what}`, async ({ page }) => {
      await openEntry(page, 'dialog');
      await page.getByRole('region', { name: LONG }).getByRole('button').click();
      const window = dialogWindow(page, 'body');
      await expect(window).toBeVisible();

      expect((await window.boundingBox())!.height).toBeCloseTo(expected, 0);
      await expect(page.getByTestId('library-body-submit-button')).toBeInViewport({ ratio: 1 });
      await expect(window.getByRole('heading', { name: 'Change reviewers' })).toBeInViewport({
        ratio: 1,
      });
    });
  });
}

test.describe('on a browser that draws classic scroll bars', () => {
  /** The library's `dialog` entry, on a browser of its own that draws them. */
  async function onClassicBars(
    { playwright, baseURL }: Pick<PlaywrightWorkerArgs, 'playwright'> & { baseURL?: string },
    drive: (page: Page) => Promise<void>,
  ) {
    await withClassicBars({ playwright, baseURL }, { width: 1280, height: 720 }, async (page) => {
      await openEntry(page, 'dialog');
      await drive(page);
    });
  }

  test('a scrolled long dialog keeps its title, actions and corners, and nothing passes its edge', async ({
    playwright,
    baseURL,
  }) => {
    await onClassicBars({ playwright, baseURL }, async (page) => {
      await page.getByRole('region', { name: LONG }).getByRole('button').click();
      const window = dialogWindow(page, 'body');
      const body = page.getByTestId('library-body-body');
      await expect(window).toBeVisible();

      await scrollBody(body, 'bottom');
      await expect(page.getByTestId('library-body-shade-top')).toBeVisible();
      for (const part of [
        window.getByRole('heading', { name: 'Change reviewers' }),
        page.getByTestId('library-body-close-button'),
        page.getByTestId('library-body-submit-button'),
        page.getByTestId('library-body-cancel-button'),
      ]) {
        await expect(part).toBeInViewport({ ratio: 1 });
      }
      expect(await barWidth(body), "the body's bar").toBe(0);
      await expectNothingClipped(body, 'the 150 people');
      expect(await window.evaluate((el) => getComputedStyle(el).borderTopRightRadius)).toBe('10px');
      const [windowBox, bodyBox] = await Promise.all([window.boundingBox(), body.boundingBox()]);
      expect(bodyBox!.x + bodyBox!.width).toBeCloseTo(windowBox!.x + windowBox!.width, 0);
    });
  });

  test('a short dialog scrolling whole keeps its corners, with no bar at its edge', async ({
    playwright,
    baseURL,
  }) => {
    await onClassicBars({ playwright, baseURL }, async (page) => {
      await page.getByRole('region', { name: SHORT }).getByRole('button').click();
      const window = dialogWindow(page, 'window');
      const scroller = page.getByTestId('library-window-scroll');
      await expect(window).toBeVisible();

      await scrollBody(scroller, 'bottom');
      expect(await barWidth(scroller), "the scroller's bar").toBe(0);
      await expectNothingClipped(scroller, 'the 150 people');
      expect(await window.evaluate((el) => getComputedStyle(el).borderTopRightRadius)).toBe('10px');
    });
  });
});
