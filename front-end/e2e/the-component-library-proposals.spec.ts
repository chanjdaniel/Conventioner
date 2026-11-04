import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { eachWindow, expectLaidOut, openEntry } from './helpers/componentLibrary';
import { inTheWindow } from './helpers/phoneWindow';
import { settle } from './helpers/settle';

/**
 * The component library's `proposals` entry (T200), at a desk and on a phone: the chip's five tones
 * at both sizes beside the one-off badges each would replace, the `.data-table` scrolling sideways
 * inside its own scroller, and the `SidePanel` shell opened and closed every way, with the page
 * never scrolling sideways.
 */

const TONES = ['neutral', 'positive', 'attention', 'informational', 'destructive'];
/** The fixture's first application, which the side panel opens on. */
const APPLICANT = 'Angela Lee';

const panel = (page: Page) => page.getByTestId('library-side-panel-window');
const closeButton = (page: Page) => page.getByTestId('library-side-panel-close-button');
const opener = (page: Page) => page.getByTestId('library-panel-open');
/** What a fixed box spans: the window, less the gutter the page keeps for its scroll bar. */
const windowWidth = (page: Page) =>
  page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement('div'));
    probe.style.cssText = 'position: fixed; inset: 0';
    const { width } = probe.getBoundingClientRect();
    probe.remove();
    return width;
  });

eachWindow('the proposals entry', (size) => {
  const { press, expectFits, expectInside } = inTheWindow(size);

  async function openPanel(page: Page) {
    await press(opener(page));
    await expect(closeButton(page)).toBeFocused();
    await settle(page);
  }

  /** Closed, and the page is live again with focus back on the button that opened it. */
  async function expectClosed(page: Page) {
    await expect(closeButton(page)).toHaveCount(0);
    await expect(panel(page)).toBeHidden();
    await expect(opener(page)).toBeFocused();
    await expect(page.locator('[inert]')).toHaveCount(0);
  }

  test.beforeEach(async ({ page }) => {
    await openEntry(page, 'proposals');
  });

  test('names what it serves, is laid out whole, and ends with the choices left', async ({
    page,
    expectAccessible,
  }) => {
    const serves = page.getByTestId('library-serves');
    await expect(serves).toContainText('The 15 one-off badges');
    await expect(serves).toContainText('the 6 tables');
    await expect(serves).toContainText('the vendor drawer and the navigation drawer');

    const choices = page.getByTestId('choices-for-you');
    await expect(choices).toContainText('Which one-off badges become which tone');
    await expect(choices).toContainText("The table's look");
    await expect(choices).toContainText("The side panel's width");

    await expectLaidOut(page, size, 'the proposals entry');
    await expectAccessible('the proposals entry');
  });

  test('draws each tone at both sizes, with what it would replace beside it', async ({ page }) => {
    for (const tone of TONES) {
      const box = page.getByTestId(`library-tone-${tone}`);
      const chip = box.getByTestId('library-chip');
      const small = box.getByTestId('library-chip-small');
      await expect(chip).toHaveClass(new RegExp(`\\bchip--${tone}\\b`));
      await expect(small).toHaveClass(new RegExp(`\\bchip--${tone}\\b`));

      const [whole, step] = [(await chip.boundingBox())!, (await small.boundingBox())!];
      expect(step.height, `${tone}: the small step is shorter`).toBeLessThan(whole.height);
      await expect(small, `${tone}: the same type as the chip`).toHaveCSS('font-size', '12px');
      await expect(small, `${tone}: the same ground as the chip`).toHaveCSS(
        'background-color',
        await chip.evaluate((element) => getComputedStyle(element).backgroundColor),
      );

      await expect(box.getByTestId('library-one-off').first()).toBeVisible();
    }

    await expect(page.getByTestId('library-tone-informational')).toContainText('role-badge, owner');
    await expect(page.getByTestId('library-tone-destructive')).toContainText('required-badge');
    await expect(page.getByTestId('library-tone-destructive')).toContainText(
      'components/application/FormBuilder.vue',
    );
    await expect(page.getByTestId('phase-badge')).toHaveCount(3);
  });

  test('scrolls the table of 30 inside its scroller, its corners kept, the page still', async ({
    page,
  }) => {
    await expect(page.getByTestId('library-table-row')).toHaveCount(30);

    const scroller = page.getByTestId('library-table-scroll');
    await expect(scroller).toHaveCSS('border-top-left-radius', '6px');

    const sizes = await scroller.evaluate((element) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
    }));
    expect(sizes.scroll, 'the table is wider than its scroller').toBeGreaterThan(sizes.client);

    await scroller.evaluate((element) => element.scrollTo({ left: 200 }));
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollLeft), 'the table scrolled')
      .toBe(200);
    await expectFits(page, 'the page, with the table scrolled');
  });

  test('a keyboard reaches the table and scrolls it', async ({ page }) => {
    const scroller = page.getByTestId('library-table-scroll');
    await scroller.focus();
    await expect(scroller).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  });

  test('a table of few columns wraps its cells and needs no scroll', async ({ page }) => {
    const scroller = page.getByTestId('library-table-wrapped-scroll');
    const sizes = await scroller.evaluate((element) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
    }));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
  });

  test('opens the panel, and closes it by Escape, giving focus back', async ({
    page,
    expectAccessible,
  }) => {
    await openPanel(page);
    await expect(panel(page)).toHaveRole('dialog');
    await expect(panel(page)).toHaveAccessibleName(APPLICANT);
    await expectInside(panel(page), 'the panel');
    await expectFits(page, 'the page, with the panel open');
    expect(
      await opener(page).evaluate((element) => element.closest('[inert]') !== null),
      'the page behind is inert',
    ).toBe(true);
    await expectAccessible('the side panel open');

    await page.keyboard.press('Escape');
    await expectClosed(page);
  });

  test('closes the panel by its close button', async ({ page }) => {
    await openPanel(page);
    await press(closeButton(page));
    await expectClosed(page);
  });

  test('closes the panel by a press on the scrim beside it', async ({ page }) => {
    await openPanel(page);
    const scrim = page.getByTestId('library-side-panel-background');
    const position = { x: 4, y: 400 };
    await (size.phone ? scrim.tap({ position }) : scrim.click({ position }));
    await expectClosed(page);
  });

  test('scrolls only the panel body, its title and close staying in view', async ({ page }) => {
    await openPanel(page);
    const body = page.getByTestId('library-side-panel-body');
    const overflow = await body.evaluate((element) => element.scrollHeight - element.clientHeight);
    expect(overflow, 'the body is longer than the panel').toBeGreaterThan(0);

    await body.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expectInside(closeButton(page), 'the close button');
    await expectInside(panel(page).getByRole('heading', { level: 2 }), 'the title');
    await expect(
      page.getByTestId('library-panel-others').getByRole('listitem').last(),
    ).toBeInViewport();
    await expect
      .poll(() => panel(page).evaluate((element) => element.scrollTop), 'the panel itself stays')
      .toBe(0);
  });

  test('takes a side and a width, leaving a gutter of scrim', async ({ page }) => {
    const width = await windowWidth(page);

    await press(page.getByTestId('library-panel-width-wide'));
    await openPanel(page);
    const wide = (await panel(page).boundingBox())!;
    expect(wide.x + wide.width, 'on the right').toBe(width);
    expect(wide.x, 'a gutter of scrim').toBeGreaterThanOrEqual(32);
    await press(closeButton(page));
    await expectClosed(page);

    await press(page.getByTestId('library-panel-width-narrow'));
    await press(page.getByTestId('library-panel-side-left'));
    await expect(page.getByTestId('read-out').last()).toContainText('closed, left, narrow');
    await openPanel(page);
    const narrow = (await panel(page).boundingBox())!;
    expect(narrow.x, 'on the left').toBe(0);
    expect(narrow.width, 'narrow is narrower than wide').toBeLessThan(wide.width);
    await expectInside(panel(page), 'the narrow panel');
  });

  test('a dialog opened from the panel lies over the window, and takes Escape first', async ({
    page,
  }) => {
    await openPanel(page);
    await press(page.getByTestId('library-panel-ask'));
    const dialog = page.getByTestId('library-panel-dialog-window');
    await expect(dialog).toBeVisible();
    await settle(page);

    const box = (await dialog.boundingBox())!;
    const width = await windowWidth(page);
    expect(
      Math.abs(box.x + box.width / 2 - width / 2),
      'the dialog is centred in the window, not in the panel',
    ).toBeLessThanOrEqual(1);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
    await expect(page.getByTestId('library-panel-ask')).toBeFocused();

    await page.keyboard.press('Escape');
    await expectClosed(page);
  });
});
