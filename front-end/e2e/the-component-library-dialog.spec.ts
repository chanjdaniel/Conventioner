import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';
import { inTheWindow, type PhoneOrDesk } from './helpers/phoneWindow';

/**
 * The component library's `dialog` entry (T200): `AppDialog` grown, opened from the entry's
 * buttons at a desk and on a phone. Each width is its step capped by the window; a body that
 * scrolls keeps the title and actions in view, its shades say there is more, and nothing in it is
 * clipped; the tray stays pinned and scrolls inside itself; and every behaviour a dialog had is
 * kept in either scroll. Dialogs close by Escape and by Cancel.
 */

const SECTIONS = [
  'Sizes',
  'The window scrolls, or only the body',
  'The body scrolls, with a tray',
  'Every behaviour kept',
];

/** Each width's step, in CSS pixels: 26rem, 38rem and 60rem. */
const STEPS = { narrow: 416, wide: 608, broad: 960 } as const;
/** The gutter at each side a dialog keeps from the window's edge. */
const GUTTER = 16;

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
  test('shows each section with what it serves, the choices, and fits the window', async ({
    page,
  }) => {
    await openEntry(page, 'dialog');

    const entry = page.getByTestId('library-entry-dialog');
    for (const title of SECTIONS) {
      const heading = entry.getByRole('heading', { level: 2, name: title, exact: true });
      await expect(heading).toBeVisible();
      await expect(heading.locator('xpath=following-sibling::p[1]')).toHaveText(/^Serves: /);
    }
    await expect(page.getByTestId('choices-for-you')).toContainText('The broad width');
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
    const proposed = page.getByRole('region', { name: 'Proposed: only the body' });
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
    await expect(readOut(page, 'Proposed: only the body')).toHaveText(
      'Last: Closed, nothing saved',
    );
  });

  test("today's dialog scrolls whole: its title and Save leave the view", async ({ page }) => {
    await openEntry(page, 'dialog');
    const today = page.getByRole('region', { name: 'Today: the whole window scrolls' });
    await inTheWindow(size).press(today.getByRole('button'));
    const window = dialogWindow(page, 'window');
    await expect(window).toBeVisible();

    await expect(page.getByTestId('library-window-submit-button')).not.toBeInViewport();
    await window.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(window.getByRole('heading', { name: 'Change reviewers' })).not.toBeInViewport();
    await expect(page.getByTestId('library-window-body')).toHaveCount(0);

    await inTheWindow(size).press(page.getByTestId('library-window-cancel-button'));
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
